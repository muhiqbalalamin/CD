from sqlalchemy.orm import Session
from models import BatasanWilayah, School, SekolahBiaya, User, Zonasi, RiwayatPenerimaan
from utils import hash_password, verify_password
from typing import Optional
from sqlalchemy import text, func, case, or_
from datetime import datetime, timedelta
import json
import math
from routing import get_distances_many_to_one, get_distances_one_to_many, haversine_km

# Ambang waktu utk dianggap "benar-benar sedang aktif" — is_online=1 mentah
# gampang basi (user nutup tab tanpa klik Keluar, is_online tetap 1
# selamanya). Dianggap aktif kalau heartbeat terakhirnya masih dalam
# rentang ini; lebih lama dari itu dianggap Tidak Aktif walau is_online
# masih 1 di DB.
ONLINE_THRESHOLD_MINUTES = 10

class UserAlreadyExistsError(Exception):
    pass


def create_user(db: Session, username, email, password, role="user", npsn=None):
    existing_username = db.query(User).filter(User.username == username).first()
    if existing_username:
        raise UserAlreadyExistsError("username sudah digunakan")

    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email:
        raise UserAlreadyExistsError("email sudah digunakan")

    target_school_id = None
    if npsn and role == "sekolah":
        school = db.query(School).filter(School.npsn == npsn).first()
        if school:
            target_school_id = school.sekolah_id 
    hashed = hash_password(password)
    user = User(
        username=username,
        email=email,
        password_hash=hashed,
        role=role,
        school_id=target_school_id 
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


def authenticate_user(db: Session, email, password):
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(password, user.password_hash):
        return None
    # Set online saat login
    user.is_online = 1
    user.last_seen = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user

def logout_user(db: Session, user_id: int):
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.is_online = 0
        db.commit()


def touch_last_seen(db: Session, user_id: int) -> bool:
    """Heartbeat — dipanggil berkala oleh frontend selama sesi user masih
    terbuka, supaya status 'Aktif' di Manajemen Pengguna (Admin) benar-benar
    merefleksikan siapa yang SEDANG memakai aplikasi, bukan cuma sekadar
    'pernah login dan belum sempat klik Keluar'."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return False
    user.last_seen = datetime.utcnow()
    if not user.is_online:
        user.is_online = 1
    db.commit()
    return True


def admin_deactivate_user(db: Session, user_id: int) -> Optional[User]:
    """Admin memaksa akun jadi Tidak Aktif (force-logout) — dipakai tombol
    'Nonaktifkan' di Manajemen Pengguna. User yang bersangkutan akan
    dianggap logout; kalau ingin memakai aplikasi lagi, dia perlu login
    ulang (sesi/localStorage di sisi browser tidak otomatis kehapus,
    tapi panggilan API berikutnya akan diperlakukan sebagai tidak aktif)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    user.is_online = 0
    user.last_seen = None
    db.commit()
    db.refresh(user)
    return user

# 09-05-2026
def get_school_count(db: Session) -> int:
    """Hitung total sekolah terdaftar — dipakai badge statistik di Home
    page ("Sekolah Terdaftar"). Sengaja jadi query terpisah & seringan
    mungkin (murni COUNT, tidak ikut fetch baris data sekolah)."""
    return db.query(School).count()


def get_schools(
    db: Session,
    jenjang: str | None = None,
    kecamatan: str | None = None,
    status: str | None = None,
    nama: str | None = None,
    apply_sampling: bool = False,
    page: int | None = None,
    limit: int = 100,
    biaya_max: int | None = None,   # ← filter biaya masuk maks (Rp)
):
    # Limit per jenjang per kabupaten
    LIMITS = {
        'SD':  50,
        'SMP': 50,
        'SMA': 100,
        'SMK': 100,
    }

    # Kondisi filter WHERE biasa
    conditions = []
    params = {}

    if jenjang:
        conditions.append("jenjang ILIKE :jenjang")
        params["jenjang"] = jenjang
    if kecamatan:
        conditions.append("kecamatan ILIKE :kecamatan")
        params["kecamatan"] = f"%{kecamatan}%"
    if status:
        conditions.append("status ILIKE :status")
        params["status"] = status
    if nama:
        conditions.append("nama_sekolah ILIKE :nama")
        params["nama"] = f"%{nama}%"

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    if not apply_sampling:
        # Query biasa tanpa sampling. biaya_masuk di-LEFT JOIN & dihitung
        # SELALU (bukan cuma saat biaya_max diisi) — kalau tidak, atribut
        # biaya_masuk tidak pernah ter-set di objek School yang dikembalikan,
        # sehingga filter biaya di frontend (client-side) selalu menganggap
        # semua sekolah "belum ada data biaya" dan tidak pernah tersaring.
        # biaya_expr HARUS menghasilkan NULL (bukan 0) untuk sekolah yang
        # sama sekali belum punya baris di sekolah_biaya — bukan cuma
        # SELALU dihitung. Sebelumnya pakai COALESCE(...,0) polos di ketiga
        # komponen, yang membuat biaya_masuk selalu 0 saat LEFT JOIN tidak
        # menemukan pasangan (bukan NULL) — akibatnya sekolah "belum ada
        # data biaya" tampak seolah biayanya Rp 0 dan otomatis lolos di
        # SETIAP rentang filter biaya (0 selalu <= atau masuk rentang
        # manapun). CASE ini memastikan hanya sekolah yang memang punya
        # baris sekolah_biaya yang dapat nilai terhitung; sisanya NULL.
        biaya_expr = case(
            (
                SekolahBiaya.sekolah_id.isnot(None),
                func.coalesce(SekolahBiaya.gedung, 0)
                + func.coalesce(SekolahBiaya.seragam, 0)
                + func.coalesce(SekolahBiaya.buku, 0),
            ),
            else_=None,
        ).label("biaya_masuk")

        query = (
            db.query(School, biaya_expr)
            .outerjoin(SekolahBiaya, SekolahBiaya.sekolah_id == School.sekolah_id)
        )
        if jenjang:
            query = query.filter(School.jenjang.ilike(jenjang))
        if kecamatan:
            query = query.filter(School.kecamatan.ilike(f"%{kecamatan}%"))
        if status:
            query = query.filter(School.status.ilike(status))
        if nama:
            query = query.filter(School.nama_sekolah.ilike(f"%{nama}%"))
        if biaya_max:
            # Sekolah tanpa baris sekolah_biaya (biaya_masuk NULL) sengaja
            # TIDAK disaring keluar — konsisten dgn perilaku filter di
            # frontend (data belum diisi = ditampilkan, bukan dianggap Rp 0).
            query = query.filter(
                text("sekolah_biaya.sekolah_id IS NULL OR "
                     "(COALESCE(sekolah_biaya.gedung,0) + COALESCE(sekolah_biaya.seragam,0) + "
                     "COALESCE(sekolah_biaya.buku,0)) <= :bmax")
            ).params(bmax=biaya_max)
        query = query.order_by(School.nama_sekolah.asc())
        total = query.count()
        if page is not None:
            offset = (page - 1) * limit
            rows  = query.offset(offset).limit(limit).all()
        else:
            rows  = query.all()

        items = []
        for s, biaya_masuk in rows:
            s.biaya_masuk = biaya_masuk or 0
            items.append(s)
        return {"items": items, "total": total}

    # ── Sampling dengan CTE + ROW_NUMBER + LEFT JOIN biaya ────────
    # Filter biaya tambahan pada WHERE jika diminta
    biaya_having = ""
    if biaya_max:
        params["biaya_max"] = biaya_max
        biaya_having = "AND COALESCE(b.gedung,0) + COALESCE(b.seragam,0) + COALESCE(b.buku,0) <= :biaya_max"

    sql = text(f"""
        WITH classified AS (
            SELECT s.*,
                COALESCE(b.gedung,0) + COALESCE(b.seragam,0) + COALESCE(b.buku,0) AS biaya_masuk,
                CASE
                    WHEN s.jenjang ILIKE 'SD%%' OR s.jenjang ILIKE 'MI%%'  THEN 'SD'
                    WHEN s.jenjang ILIKE 'SMP%%' OR s.jenjang ILIKE 'MTS%%' OR s.jenjang ILIKE 'MT%%' THEN 'SMP'
                    WHEN s.jenjang ILIKE 'SMA%%' OR s.jenjang ILIKE 'MA%%'  THEN 'SMA'
                    WHEN s.jenjang ILIKE 'SMK%%'                           THEN 'SMK'
                    ELSE 'OTHER'
                END AS jenjang_group
            FROM sekolah s
            LEFT JOIN sekolah_biaya b ON b.sekolah_id = s.sekolah_id
            {where_sql}
        ),
        ranked AS (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY kabupaten, jenjang_group
                    ORDER BY nama_sekolah ASC
                ) AS rn
            FROM classified
            WHERE jenjang_group != 'OTHER'
            {biaya_having}
        )
        SELECT sekolah_id, nama_sekolah, npsn, jenjang, alamat,
               kecamatan, kabupaten, latitude, longitude,
               kuota, daya_tampung, status, akreditasi, biaya_masuk
        FROM ranked
        WHERE
            (jenjang_group = 'SD'  AND rn <= :lim_sd)  OR
            (jenjang_group = 'SMP' AND rn <= :lim_smp) OR
            (jenjang_group = 'SMA' AND rn <= :lim_sma) OR
            (jenjang_group = 'SMK' AND rn <= :lim_smk)
        ORDER BY nama_sekolah ASC
    """)

    params.update({
        "lim_sd":  LIMITS["SD"],
        "lim_smp": LIMITS["SMP"],
        "lim_sma": LIMITS["SMA"],
        "lim_smk": LIMITS["SMK"],
    })

    rows = db.execute(sql, params).mappings().all()

    # Konversi ke ORM object + simpan biaya_masuk sebagai atribut tambahan
    result = []
    for r in rows:
        s = School()
        for col in School.__table__.columns.keys():
            if col in r:
                setattr(s, col, r[col])
        s.biaya_masuk = r.get("biaya_masuk", 0) or 0
        result.append(s)

    return result        


def get_school_by_id(db: Session, school_id: int):
    return db.query(School).filter(School.sekolah_id == school_id).first()

def get_school_by_npsn(db: Session, npsn: str):
    return db.query(School).filter(School.npsn == npsn).first()

def get_zonasi(
    db: Session,
    jenjang: str | None = None,
    wilayah: str | None = None
):
    query = db.query(Zonasi)

    if jenjang:
        query = query.filter(Zonasi.nama_zonasi.ilike(jenjang))
    if wilayah:
        query = query.filter(Zonasi.wilayah.ilike(f"%{wilayah}%"))

    return query.order_by(Zonasi.nama_zonasi.asc(), Zonasi.wilayah.asc()).all()


def get_zonasi_by_id(db: Session, zonasi_id: int):
    return db.query(Zonasi).filter(Zonasi.zonasi_id == zonasi_id).first()


def get_batasan_wilayah(
    db: Session,
    wilayah: str | None = None,
    kecamatan: str | None = None,
    kabupaten: str | None = None,
    desa: str | None = None,
    kode_kecamatan: str | None = None,
    kode_kabupaten: str | None = None,
):
    query = db.query(BatasanWilayah)

    if wilayah:
        query = query.filter(BatasanWilayah.wilayah.ilike(f"%{wilayah}%"))
    if kecamatan:
        query = query.filter(BatasanWilayah.nama_kecamatan.ilike(f"%{kecamatan}%"))
    if kabupaten:
        query = query.filter(BatasanWilayah.nama_kabupaten.ilike(f"%{kabupaten}%"))
    if desa:
        query = query.filter(BatasanWilayah.nama_desa.ilike(f"%{desa}%"))
    if kode_kecamatan:
        query = query.filter(BatasanWilayah.kode_kecamatan == kode_kecamatan)
    if kode_kabupaten:
        query = query.filter(BatasanWilayah.kode_kabupaten == kode_kabupaten)

    return query.order_by(
        BatasanWilayah.nama_kabupaten.asc(),
        BatasanWilayah.nama_kecamatan.asc(),
        BatasanWilayah.nama_desa.asc(),
        BatasanWilayah.nama_zonasi.asc(),
    ).all()


def get_batasan_wilayah_by_id(db: Session, boundary_id: int):
    return db.query(BatasanWilayah).filter(BatasanWilayah.boundary_id == boundary_id).first()


def get_batasan_wilayah_geojson(
    db: Session,
    wilayah: str | None = None,
    kecamatan: str | None = None,
    kabupaten: str | None = None,
    desa: str | None = None,
    kode_kecamatan: str | None = None,
    kode_kabupaten: str | None = None,
):
    conditions = []
    params: dict[str, str] = {}

    if wilayah:
        conditions.append("wilayah ILIKE :wilayah")
        params["wilayah"] = f"%{wilayah}%"
    if kecamatan:
        conditions.append("""
            (
                nama_kecamatan ILIKE :kecamatan
                OR regexp_replace(lower(nama_kecamatan), '^(kec\\.?|kecamatan)\\s+', '') ILIKE :kecamatan_normalized
            )
        """)
        kecamatan_normalized = (
            str(kecamatan)
            .strip()
            .lower()
            .removeprefix("kecamatan ")
            .removeprefix("kec. ")
            .removeprefix("kec ")
            .strip()
        )
        params["kecamatan"] = f"%{kecamatan}%"
        params["kecamatan_normalized"] = f"%{kecamatan_normalized}%"
    if kabupaten:
        conditions.append("nama_kabupaten ILIKE :kabupaten")
        params["kabupaten"] = f"%{kabupaten}%"
    if desa:
        conditions.append("nama_desa ILIKE :desa")
        params["desa"] = f"%{desa}%"
    if kode_kecamatan:
        conditions.append("kode_kecamatan = :kode_kecamatan")
        params["kode_kecamatan"] = kode_kecamatan
    if kode_kabupaten:
        conditions.append("kode_kabupaten = :kode_kabupaten")
        params["kode_kabupaten"] = kode_kabupaten

    where_sql = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    query = text(f"""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(
                json_build_object(
                    'type', 'Feature',
                    'id', boundary_id,
                    'geometry', ST_AsGeoJSON(geom)::json,
                    'properties', json_build_object(
                        'boundary_id', boundary_id,
                        'nama_zonasi', nama_zonasi,
                        'radius_meter', radius_meter,
                        'wilayah', wilayah,
                        'keterangan', keterangan,
                        'objectid', objectid,
                        'fcode', fcode,
                        'remark', remark,
                        'metadata', metadata,
                        'srs_id', srs_id,
                        'kode_kecamatan', kode_kecamatan,
                        'kode_desa', kode_desa,
                        'kode_kabupaten', kode_kabupaten,
                        'kode_provinsi', kode_provinsi,
                        'nama_kecamatan', nama_kecamatan,
                        'nama_desa', nama_desa,
                        'nama_kabupaten', nama_kabupaten,
                        'nama_provinsi', nama_provinsi,
                        'tipadm', tipadm,
                        'luaswh', luaswh,
                        'uupp', uupp,
                        'shape_length', shape_length,
                        'shape_area', shape_area
                    )
                )
                ORDER BY nama_kabupaten, nama_kecamatan, nama_desa, nama_zonasi
            ), '[]'::json)
        ) AS feature_collection
        FROM batasan_wilayah
        {where_sql}
    """)
    return db.execute(query, params).scalar()


def get_batasan_wilayah_geojson_by_id(db: Session, boundary_id: int):
    query = text("""
        SELECT json_build_object(
            'type', 'Feature',
            'id', boundary_id,
            'geometry', ST_AsGeoJSON(geom)::json,
            'properties', json_build_object(
                'boundary_id', boundary_id,
                'nama_zonasi', nama_zonasi,
                'radius_meter', radius_meter,
                'wilayah', wilayah,
                'keterangan', keterangan,
                'objectid', objectid,
                'fcode', fcode,
                'remark', remark,
                'metadata', metadata,
                'srs_id', srs_id,
                'kode_kecamatan', kode_kecamatan,
                'kode_desa', kode_desa,
                'kode_kabupaten', kode_kabupaten,
                'kode_provinsi', kode_provinsi,
                'nama_kecamatan', nama_kecamatan,
                'nama_desa', nama_desa,
                'nama_kabupaten', nama_kabupaten,
                'nama_provinsi', nama_provinsi,
                'tipadm', tipadm,
                'luaswh', luaswh,
                'uupp', uupp,
                'shape_length', shape_length,
                'shape_area', shape_area
            )
        ) AS feature
        FROM batasan_wilayah
        WHERE boundary_id = :boundary_id
    """)
    return db.execute(query, {"boundary_id": boundary_id}).scalar()

# --- School CRUD ---
 
def create_school(db: Session, data) -> "School":
    result = db.execute(
        text("""
            INSERT INTO sekolah 
                (nama_sekolah, npsn, jenjang, alamat, kecamatan, kabupaten,
                 latitude, longitude, location,
                 kuota, daya_tampung, status, akreditasi)
            VALUES 
                (:nama_sekolah, :npsn, :jenjang, :alamat, :kecamatan, :kabupaten,
                 :latitude, :longitude,
                 ST_SetSRID(ST_Point(:longitude, :latitude), 4326)::geography,
                 :kuota, :daya_tampung, :status, :akreditasi)
            RETURNING sekolah_id
        """),
        {
            "nama_sekolah": data.nama_sekolah,
            "npsn":         data.npsn or None,
            "jenjang":      data.jenjang,
            "alamat":       data.alamat,
            "kecamatan":    data.kecamatan,
            "kabupaten":    data.kabupaten,
            "latitude":     data.latitude,
            "longitude":    data.longitude,
            "kuota":        data.kuota,
            "daya_tampung": data.daya_tampung,
            "status":       data.status,
            "akreditasi":   data.akreditasi,
        }
    )
    db.commit()
    new_id = result.scalar()
    return db.query(School).filter(School.sekolah_id == new_id).first()
 
 
def update_school(db: Session, school_id: int, data) -> Optional["School"]:
    school = db.query(School).filter(School.sekolah_id == school_id).first()
    if not school:
        return None

    update_data = data.model_dump(exclude_unset=True)
    
    # Pisahkan lat/lng dari field biasa
    lat = update_data.pop("latitude", None)
    lng = update_data.pop("longitude", None)

    # Update field biasa via ORM
    for key, value in update_data.items():
        setattr(school, key, value)

    # Update lat, lng, dan location sekaligus
    if lat is not None and lng is not None:
        db.execute(
            text("""
                UPDATE sekolah 
                SET latitude = :lat, longitude = :lng,
                    location = ST_SetSRID(ST_Point(:lng, :lat), 4326)::geography
                WHERE sekolah_id = :id
            """),
            {"lat": lat, "lng": lng, "id": school_id}
        )
    
    db.commit()
    return db.query(School).filter(School.sekolah_id == school_id).first()
 
 
def delete_school(db: Session, school_id: int) -> bool:
    school = db.query(School).filter(School.sekolah_id == school_id).first()
    if not school:
        return False
    db.delete(school)
    db.commit()
    return True
 
 
# --- Zonasi CRUD ---
 
def create_zonasi(db: Session, data) -> "Zonasi":
    zonasi = Zonasi(
        nama_zonasi=data.nama_zonasi,
        radius_meter=data.radius_meter,
        wilayah=data.wilayah,
        keterangan=data.keterangan,
    )
    db.add(zonasi)
    db.commit()
    db.refresh(zonasi)
    return zonasi
 
 
def update_zonasi(db: Session, zonasi_id: int, data) -> Optional["Zonasi"]:
    zonasi = db.query(Zonasi).filter(Zonasi.zonasi_id == zonasi_id).first()
    if not zonasi:
        return None
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(zonasi, key, value)
    db.commit()
    db.refresh(zonasi)
    return zonasi
 
 
def delete_zonasi(db: Session, zonasi_id: int) -> bool:
    zonasi = db.query(Zonasi).filter(Zonasi.zonasi_id == zonasi_id).first()
    if not zonasi:
        return False
    db.delete(zonasi)
    db.commit()
    return True
 
 
# --- Operator: ambil sekolah afiliasi berdasarkan user ---
 
def get_school_by_user(db: Session, user_id: int) -> Optional["School"]:
    """Ambil sekolah yang diasosiasikan ke akun operator."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.school_id:
        return None
    return db.query(School).filter(School.sekolah_id == user.school_id).first()
# ─── Profile CRUD ────────────────────────────────────────────────
from models import UserProfile, AdminProfile, OperatorProfile

def _get_profile_model(role: str):
    if role == "admin":    return AdminProfile
    if role == "sekolah":  return OperatorProfile
    return UserProfile

def get_profile(db: Session, user_id: int, role: str):
    Model = _get_profile_model(role)
    return db.query(Model).filter(Model.user_id == user_id).first()

def upsert_profile(db: Session, user_id: int, role: str, data: dict):
    Model = _get_profile_model(role)
    profile = db.query(Model).filter(Model.user_id == user_id).first()
    if profile:
        for k, v in data.items():
            setattr(profile, k, v)
    else:
        profile = Model(user_id=user_id, **data)
        db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile

def get_all_users(db: Session):
    return db.query(User).order_by(User.id.asc()).all()

# 10-05-2026
def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Hitung jarak dua koordinat (km) — haversine formula."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlng / 2) ** 2
    )
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
 
 
# ── Normalisasi jenjang ke key sederhana (SD/SMP/SMA/SMK) ─────────
def _norm_jenjang(j: str) -> str:
    j = (j or "").upper().strip()
    if any(x in j for x in ("SMK",)):           return "SMK"
    if any(x in j for x in ("SMA", "MA")):      return "SMA"
    if any(x in j for x in ("SMP", "MTS")):     return "SMP"
    if any(x in j for x in ("SD", "MI")):       return "SD"
    return ""


# Pola ILIKE per kategori jenjang, dipakai _jenjang_sql_filter() di bawah —
# HARUS senada dgn substring yg dicek _norm_jenjang() di atas, supaya
# hasil filter di level SQL & normalisasi di Python tetap konsisten.
JENJANG_SQL_PATTERNS = {
    "SD":  ["%SD%", "%MI%"],
    "SMP": ["%SMP%", "%MTS%"],
    "SMA": ["%SMA%", "%MA%"],
    "SMK": ["%SMK%"],
}


def _jenjang_sql_filter(jenjang_key: str):
    """
    Kondisi SQL (OR ILIKE) utk filter School.jenjang berdasar kategori
    jenjang yg SUDAH dinormalisasi (_norm_jenjang) — dipakai supaya filter
    jenjang diterapkan SEBELUM query dibatasi (mis. LIMIT pengaman di
    get_riwayat_penerimaan), bukan cuma disaring belakangan di Python
    SETELAH baris sudah kepotong LIMIT. Kalau disaring belakangan,
    kategori yang baris mentahnya sedikit (dibanding SD yang jumlahnya
    jauh lebih banyak se-Jawa Barat) bisa keburu habis kepotong LIMIT
    duluan sebelum sempat ketemu barisnya sendiri — hasilnya kelihatan
    "kosong" walau datanya sebenarnya ada (bug yg diperbaiki di sini).
    """
    patterns = JENJANG_SQL_PATTERNS.get(jenjang_key)
    if not patterns:
        return None
    return or_(*[School.jenjang.ilike(p) for p in patterns])


def _norm_status(raw) -> str | None:
    """
    Normalisasi status kepemilikan sekolah ke kode kanonik 'N' (Negeri) /
    'S' (Swasta). Data di DB tidak konsisten — sebagian tersimpan sebagai
    huruf tunggal 'N'/'S' (input lewat form admin), sebagian sebagai kata
    penuh 'Negeri'/'Swasta' (hasil import lama). Fungsi ini menerima
    keduanya (case-insensitive). Mengembalikan None jika tidak dikenali/kosong.
    """
    if not raw:
        return None
    v = str(raw).strip().upper()
    if v in ("N", "NEGERI"):
        return "N"
    if v in ("S", "SWASTA"):
        return "S"
    return None


# ── Jalur Prestasi: bobot poin berdasarkan tingkat pencapaian ────
TINGKAT_POIN_PRESTASI = {
    "nasional":  100,
    "provinsi":  75,
    "kabupaten": 50,
    "sekolah":   25,
}

# Skala TKA: 0–200 — gabungan TKA Bahasa Indonesia (0–100) + TKA
# Matematika (0–100), sesuai skala resmi portal SPMB.
TKA_MAX = 200

def _poin_prestasi_tertinggi(prestasi_list) -> int:
    """Ambil poin tertinggi dari semua prestasi yang diinput (skala 0-100)."""
    if not prestasi_list or not isinstance(prestasi_list, list):
        return 0
    poin = 0
    for p in prestasi_list:
        if not isinstance(p, dict):
            continue
        tingkat = (p.get("tingkat") or "").strip().lower()
        poin = max(poin, TINGKAT_POIN_PRESTASI.get(tingkat, 0))
    return poin


def _hitung_skor_spmb(nilai_rapor, nilai_tka, poin_penghargaan, pakai_tka: bool) -> dict:
    """
    Hitung semua skor SPMB.

    Dengan TKA — DISESUAIKAN dgn halaman resmi spmb.jabarprov.go.id
    ("Informasi Skor SPMB", dikonfirmasi ulang oleh Antara/Detik/Medcom/
    Tirto per rilis SPMB Jabar 2025):
      skor_rapor_tka (Jalur Prestasi Akademik/Rapor) = TNR × 50% + TKA × 50%
      skor_prestasi  (Jalur Prestasi Kejuaraan)      = Penghargaan × 50% + TKA × 50%
        (catatan: 30%/70% memang muncul di regulasi resmi, tapi itu formula
        BEDA — utk menormalisasi skor piagam itu sendiri: 30% skor piagam +
        70% nilai uji kompetensi kejuaraan, sebelum digabung 50/50 dgn TKA.
        Bukan split TKA-vs-Penghargaan di level atas seperti versi lama.)

    Tanpa TKA (skenario TKA tidak berlaku di daerah/sekolah ybs):
      skor_rapor_tka = TNR × 60% + Penghargaan × 40%
      skor_prestasi  = skor_rapor_tka (sama, krn tidak ada komponen TKA)
      !! PERINGATAN: bobot 60/40 di sini TIDAK ditemukan sumber resminya
      saat riset (Jul 2026). Ini estimasi internal aplikasi utk kondisi yg
      tidak dibahas eksplisit oleh Jabar (yg selalu mensyaratkan tes
      terstandar utk jalur prestasi). Tampilkan sbg estimasi, bukan rumus
      resmi, sampai ada sumber yang bisa memverifikasinya.

    Return dict:
      skor_spmb       : skor utama yang dipakai untuk ranking jalur rapor
      skor_prestasi   : skor untuk jalur prestasi
      skor_akademik   : alias skor_spmb (dipakai di Skor Kelayakan Top 10)
    """
    tnr   = float(nilai_rapor or 0)
    tka   = float(nilai_tka or 0) if nilai_tka is not None else None
    poin  = float(poin_penghargaan or 0)

    if pakai_tka and tka is not None:
        skor_spmb     = round(tnr * 0.50 + tka * 0.50, 2)
        skor_prestasi = round(poin * 0.50 + tka * 0.50, 2)
    else:
        # Tanpa TKA: rapor 60% + penghargaan 40% — lihat peringatan di docstring.
        skor_spmb     = round(tnr * 0.60 + poin * 0.40, 2)
        skor_prestasi = skor_spmb

    return {
        "skor_spmb":     skor_spmb,
        "skor_prestasi": skor_prestasi,
        "skor_akademik": skor_spmb,   # alias untuk Skor Kelayakan rekomendasi
        "pakai_tka":     pakai_tka and tka is not None,
    }


def get_sekolah_dalam_radius(db: Session, lat: float, lng: float,
                             radius_km: float, extra_km: float = 5.0,
                             jenjang: str | None = None,
                             nama: str | None = None) -> list:
    """
    Kembalikan sekolah dalam jarak (radius_km + extra_km) dari titik pusat.
    Pakai bounding box dulu (murah di DB), lalu saring Haversine di Python.
    Ini jauh lebih cepat dari mengirim 8000+ sekolah ke browser lalu filter di sana.
    """
    max_km    = radius_km + extra_km
    lat_delta = max_km / 111.0
    lng_delta = max_km / (111.0 * max(math.cos(math.radians(lat)), 0.1))

    q = (
        db.query(School)
        .filter(School.latitude.isnot(None), School.longitude.isnot(None))
        .filter(School.latitude.between(lat - lat_delta, lat + lat_delta))
        .filter(School.longitude.between(lng - lng_delta, lng + lng_delta))
    )
    if jenjang:
        q = q.filter(School.jenjang.ilike(jenjang))
    if nama:
        q = q.filter(School.nama_sekolah.ilike(f"%{nama}%"))

    rows = q.all()

    # Filter Haversine presisi di Python
    result = []
    for s in rows:
        d = _haversine(lat, lng, s.latitude, s.longitude)
        if d <= max_km:
            result.append(s)

    return result


# ── Rekomendasi Sekolah: radius zona per jenjang ──────────────────
DEFAULT_RADIUS_KM = {"SD": 3, "SMP": 5, "SMA": 8, "SMK": 8}
MAX_RADIUS_KM     = 15   # batas maksimum absolut, walau radius zonasi > ini


AKADEMIK_SKOR_MAKS = 350  # nilai acuan atas skala skor akademik gabungan (TNR+TKA/prestasi) — titik di mana Skor Akademik = 100%, BUKAN klaim nilai tertinggi yg mungkin dicapai siswa.


def _skor_jarak_ambang(jarak_km, jarak_maks_km):
    """
    Indeks Kesesuaian Jarak — dibandingkan terhadap jarak_maks_meter
    (jarak terjauh siswa yang diterima di sekolah ini pada riwayat
    penerimaan tahun lalu).

    J    = jarak rumah anak -> sekolah (km)
    Jmax = jarak maksimum siswa yang diterima tahun lalu (km)

        J \u2264 Jmax :  Skor Jarak = 50 + 50 x (1 - J / Jmax)
        J >  Jmax :  Skor Jarak = 50 x (Jmax / J)

    Sifat kurva:
      J = 0          -> 100%
      J = 0.5 x Jmax ->  75%   (di dalam ambang: turun LINEAR/konstan per km)
      J = Jmax       ->  50%   (persis di ambang batas — BUKAN 100%,
                                 supaya masih ada ruang naik/turun di
                                 kedua sisi ambang, tidak langsung mentok)
      J > Jmax       -> < 50%, makin jauh makin mendekati 0% (tanpa negatif)

    Dalam ambang (J \u2264 Jmax) sengaja LINEAR (bukan kurva) — tiap km lebih
    dekat menaikkan skor dgn jumlah yang sama persis, jadi lebih gampang
    dijelaskan & konsisten dgn cara Skor Akademik naik linear di atas
    ambangnya (lihat _skor_akademik_ambang). Di luar ambang (J > Jmax),
    dipakai kurva 50 x (Jmax/J) — BUKAN linear diteruskan — supaya tidak
    pernah nyentuh 0% keras/negatif walau jaraknya jauh sekali; ini juga
    membuat kurva SAMBUNG MULUS tanpa "patahan" di J=Jmax: turunan kedua
    rumus di titik itu sama persis (-50/Jmax), bukan cuma nilainya (50%)
    yang ketemu.
    """
    if jarak_maks_km is None or jarak_maks_km <= 0 or jarak_km is None or jarak_km < 0:
        return None
    if jarak_km <= jarak_maks_km:
        skor = 50 + 50 * (1 - jarak_km / jarak_maks_km)
    else:
        skor = 50 * (jarak_maks_km / jarak_km)
    return max(0, min(100, round(skor)))


def _skor_akademik_ambang(skor_akademik, nilai_min):
    """
    Indeks Kesesuaian Akademik — dibandingkan terhadap nilai_akademis_min
    (nilai akademik terendah siswa yang diterima di sekolah ini pada
    riwayat penerimaan tahun lalu).

    A    = skor akademik anak (gabungan TNR+TKA, atau TNR+Prestasi)
    Amin = nilai akademis minimum diterima tahun lalu
    Amax = 350 (konstanta acuan atas — lihat AKADEMIK_SKOR_MAKS)

        Skor Akademik = 50 x (A / Amin)                          , jika A <  Amin
                       = 50 + 50 x (A - Amin) / (Amax - Amin)     , jika A >= Amin

    Tepat di nilai minimum (A = Amin) menghasilkan 50% — bukan 100% seperti
    versi sebelumnya yang langsung mentok begitu memenuhi ambang. Di atas
    ambang, skor naik LINEAR menuju 100% di A = Amax, sehingga anak yang
    nilainya jauh melampaui ambang tahun lalu tetap tampil lebih unggul
    daripada yang cuma pas-pasan memenuhi ambang — keduanya tidak lagi
    sama-sama tampil 100%. Di bawah ambang, skor turun linear dari 50%
    menuju 0%.
    """
    if nilai_min is None or nilai_min <= 0 or skor_akademik is None or skor_akademik < 0:
        return None
    if skor_akademik < nilai_min:
        skor = 50 * (skor_akademik / nilai_min)
    else:
        rentang_atas = AKADEMIK_SKOR_MAKS - nilai_min
        skor = 100 if rentang_atas <= 0 else 50 + 50 * (skor_akademik - nilai_min) / rentang_atas
    return max(0, min(100, round(skor)))


def _hasil_dasar_sekolah(s, home_lat: float, home_lng: float, radius_km: float, skor_akademik: float) -> dict:
    """
    Bangun dict metrik dasar utk SATU baris School `s` — dipakai baik utk
    kandidat dalam radius pencarian (di get_rekomendasi_sekolah) MAUPUN utk
    sekolah "Sekolah Tujuan Anda" yg dipilih manual oleh user (bisa jadi
    ada di LUAR radius). skor_jarak tetap dihitung relatif thdp radius_km
    (dipakai sbg fallback "umum" — lihat _terapkan_indeks_rekomendasi),
    dan otomatis mentok 0 (via max(0.0, ...)) kalau jaraknya melebihi radius.
    """
    dist_km = _haversine(home_lat, home_lng, s.latitude, s.longitude)
    skor_jarak     = max(0.0, round((1 - dist_km / radius_km) * 100, 1))
    skor_kelayakan = round(skor_jarak * 0.7 + skor_akademik * 0.3, 1)
    return {
        "sekolah_id":     s.sekolah_id,
        "nama_sekolah":   s.nama_sekolah,
        "jenjang":        s.jenjang,
        "kecamatan":      s.kecamatan,
        "alamat":         s.alamat,
        "akreditasi":     s.akreditasi,
        "status":         _norm_status(s.status),   # dinormalisasi ke 'N'/'S'/None
        "status_asli":    s.status,                 # nilai mentah dari DB, untuk keperluan debug/tampilan lain
        "kuota":          s.kuota,
        "pendaftar":      s.pendaftar if hasattr(s, 'pendaftar') else 0,
        "lat":            s.latitude,
        "lng":            s.longitude,
        "jarak_lurus_km": round(dist_km, 2),
        "skor_jarak":     skor_jarak,
        "skor_akademik":  skor_akademik,
        "skor_kelayakan": skor_kelayakan,
    }


def _terapkan_indeks_rekomendasi(r: dict, ambang_by_sekolah: dict, skor_akademik: float,
                                  nilai_rapor_f, poin_prestasi: int, skor_dict: dict) -> None:
    """
    Isi field indeks_jarak/indeks_akademik/skor_rekomendasi/indeks_prestasi
    ke dalam `r` (in-place) — dipisah dari get_rekomendasi_sekolah supaya
    bisa dipakai ulang utk kandidat radius MAUPUN "Sekolah Tujuan Anda".
    Lihat docstring get_rekomendasi_sekolah utk penjelasan lengkap rumus.
    """
    ambang = ambang_by_sekolah.get(r["sekolah_id"])
    if ambang:
        # jarak_maks_meter disimpan dalam meter, sedangkan jarak_lurus_km
        # (dan _skor_jarak_ambang di sini) bekerja dalam skala km — konversi dulu.
        jarak_maks_km  = ambang.jarak_maks_meter / 1000 if ambang.jarak_maks_meter is not None else None
        indeks_jarak   = _skor_jarak_ambang(r["jarak_lurus_km"], jarak_maks_km)
        # Dibandingkan ke skor_akademik gabungan (TNR+TKA), bukan TNR
        # saja, supaya konsisten dgn nilai_akademis_min yg juga gabungan.
        indeks_akademik = _skor_akademik_ambang(skor_akademik, ambang.nilai_akademis_min) if nilai_rapor_f else None
        if indeks_akademik is not None:
            skor_rekomendasi = round(indeks_jarak * 0.7 + indeks_akademik * 0.3)
        else:
            skor_rekomendasi = indeks_jarak
        r["skor_rekomendasi"]        = skor_rekomendasi
        r["skor_rekomendasi_sumber"] = "historis"
        r["ambang_tahun"]            = ambang.tahun
        # Angka mentah pembanding (BUKAN indeks) — dikirim ke frontend
        # supaya panel "rincian perhitungan" bisa menampilkan angka
        # riil yg dibandingkan (mis. "jarak maksimum diterima: 2.4 km"),
        # bukan cuma hasil akhir indeksnya saja.
        r["ambang_jarak_maks_km"]      = round(jarak_maks_km, 2) if jarak_maks_km is not None else None
        r["ambang_nilai_akademis_min"] = ambang.nilai_akademis_min

        r["indeks_jarak"]        = indeks_jarak
        r["indeks_jarak_sumber"] = "historis"
        if indeks_akademik is not None:
            r["indeks_akademik"]        = indeks_akademik
            r["indeks_akademik_sumber"] = "historis"
        else:
            r["indeks_akademik"]        = max(0, min(100, round(skor_akademik)))
            r["indeks_akademik_sumber"] = "umum"
    else:
        # Fallback: sekolah ini belum punya data riwayat_penerimaan
        # lengkap (nilai_akademis_min & jarak_maks_meter) utk tahun
        # manapun — pakai indeks umum berbasis radius pencarian
        # (skor_jarak lama), akademik TIDAK disertakan (krn tidak ada
        # pembanding riil, bukan krn nilainya nol).
        r["skor_rekomendasi"]        = max(0, min(100, round(r["skor_jarak"])))
        r["skor_rekomendasi_sumber"] = "umum"
        r["ambang_tahun"]            = None
        r["ambang_jarak_maks_km"]      = None
        r["ambang_nilai_akademis_min"] = None

        r["indeks_jarak"]           = max(0, min(100, round(r["skor_jarak"])))
        r["indeks_jarak_sumber"]    = "umum"
        r["indeks_akademik"]        = max(0, min(100, round(skor_akademik)))
        r["indeks_akademik_sumber"] = "umum"

    # Kategori Prestasi: riwayat_penerimaan belum punya kolom ambang
    # khusus prestasi, jadi selalu "umum" (skor prestasi mentah
    # anak, bukan dibandingkan ke data riil sekolah). None kalau
    # anak memang tidak punya poin prestasi sama sekali, karena
    # kategori ini tidak berlaku untuknya.
    r["indeks_prestasi"]        = max(0, min(100, round(skor_dict["skor_prestasi"]))) if poin_prestasi > 0 else None
    r["indeks_prestasi_sumber"] = "umum"


def get_rekomendasi_sekolah(db: Session, home_lat: float, home_lng: float,
                             jenjang_anak: str, nilai_rapor, prestasi_list,
                             nilai_tka=None, pakai_tka=True, sekolah_tujuan=None):
    """
    Cari Top 10 sekolah NEGERI dan Top 10 sekolah SWASTA dengan Skor
    Kelayakan tertinggi untuk anak ini (total maks. 20 rekomendasi).

    Skor Kelayakan = Indeks Jarak × 0.7 + Indeks Akademik × 0.3
      - Indeks Jarak    : posisi jarak anak dibanding jarak_maks_meter
                          (riwayat_penerimaan tahun terakhir sekolah tsb) —
                          BUKAN rasio jarak/radius pencarian.
      - Indeks Akademik : posisi skor_akademik anak dibanding
                          nilai_akademis_min (riwayat_penerimaan tahun
                          terakhir sekolah tsb) — BUKAN skor_akademik
                          mentah (yg skalanya tidak terbatas, mis. bisa
                          250+, sehingga tidak sepadan kalau langsung
                          dijumlah-bobotkan dgn skor_jarak yg 0-100).
      Lihat _skor_jarak_ambang() dan _skor_akademik_ambang() untuk rumus
      kurva nilai mentah -> indeks.
      CATATAN PENAMAAN: "Skor Kelayakan" dipakai (bukan "Estimasi
      Peluang") krn angka ini adalah indeks perangkingan/rekomendasi
      dari perbandingan kurva thdp ambang historis — bukan probabilitas
      yang terkalibrasi (data yg ada tidak cukup utk itu).

    Kalau sekolah BELUM punya data riwayat_penerimaan (nilai_akademis_min
    & jarak_maks_meter keduanya terisi) utk tahun manapun, dipakai fallback
    "umum": Indeks Jarak dihitung dari rasio jarak/radius pencarian (skor_jarak
    lama), Akademik tidak ikut disertakan (krn tidak ada pembanding riil) —
    skor_rekomendasi_sumber ditandai 'umum' vs 'historis' supaya beda skor
    bisa dibedakan tampilannya di frontend, bukan disamakan begitu saja.

    skor_jarak/skor_akademik/skor_kelayakan (skala lama, radius-relatif +
    jumlah TNR/TKA mentah tanpa batas atas) TETAP disimpan di tiap hasil
    untuk konteks/transparansi (mis. field mentah yg dipakai utk hitung
    indeks), TAPI TIDAK LAGI dipakai utk urutan/seleksi top-10 — sebelumnya
    seleksi top-10 masih pakai skor_kelayakan mentah ini duluan, baru
    skor_rekomendasi historis dihitung belakangan cuma utk 10 yg sudah terpilih;
    akibatnya urutan & angka yg ditampilkan bisa tidak sinkron (skor
    gabungan yg dipakai memilih beda dgn yg ditampilkan ke user), dan
    skor_akademik yg tidak dinormalisasi bikin bobot 70/30 jadi tidak
    berarti (skor_akademik ratusan mendominasi meski cuma berbobot 30%).

    Radius pencarian pakai default tetap per jenjang (SD 3km, SMP 5km,
    SMA/SMK 8km) — TIDAK mengikuti tabel Zonasi admin, karena radius
    zonasi cuma relevan untuk penentuan Kategori Jarak (lihat get_simulasi_ppdb),
    bukan untuk seberapa luas pool rekomendasi Kategori Prestasi/Rapor di sini.
    Radius ini juga jadi fallback pembanding jarak utk sekolah yg belum
    py data riwayat_penerimaan (lihat "umum" di atas).

    sekolah_tujuan (opsional): daftar nama sekolah yg dipilih manual user
    di Profil ("Sekolah Tujuan Anda", maks. 3). Kalau diisi, metrik yg
    SAMA PERSIS (indeks_jarak/indeks_akademik/skor_rekomendasi/dst, lihat
    _hasil_dasar_sekolah & _terapkan_indeks_rekomendasi) juga dihitung utk
    sekolah-sekolah ini — TERMASUK yang di LUAR radius pencarian atau beda
    jenjang (krn ini pilihan eksplisit user, bukan hasil pencarian otomatis)
    — dikembalikan lewat key "sekolah_tujuan" pada urutan yg sama dgn input,
    supaya kartu "Sekolah Tujuan Anda" di frontend bisa menampilkan info
    selengkap kartu rekomendasi, bukan cuma nama sekolahnya saja.
    """
    jenjang_norm = _norm_jenjang(jenjang_anak)
    if not jenjang_norm:
        return {"error": "Jenjang anak belum diisi di profil"}

    if home_lat is None or home_lng is None:
        return {"error": "Lokasi rumah belum diisi di profil"}

    # ── Radius pencarian: default tetap per jenjang (SD 3km, SMP 5km,
    # SMA/SMK 8km), TIDAK mengikuti radius Zonasi yang di-set admin.
    # Radius Zonasi admin itu representasi aturan Kategori Jarak saja —
    # kalau dipakai di sini juga, rekomendasi jadi ikut sempit padahal
    # Kategori Prestasi/Rapor pada praktiknya tidak dibatasi radius zonasi.
    # (get_simulasi_ppdb/Step 2-3 tidak memakai radius ini sama sekali —
    # jadi keputusan Kategori Jarak yang sesungguhnya tidak terpengaruh.)
    radius_km = min(DEFAULT_RADIUS_KM.get(jenjang_norm, 8), MAX_RADIUS_KM)

    lat_delta = radius_km / 111.0
    lng_delta = radius_km / (111.0 * max(math.cos(math.radians(home_lat)), 0.1))

    rows = (
        db.query(School)
        .filter(School.latitude.isnot(None), School.longitude.isnot(None))
        .filter(School.latitude.between(home_lat - lat_delta, home_lat + lat_delta))
        .filter(School.longitude.between(home_lng - lng_delta, home_lng + lng_delta))
        .all()
    )

    # ── Skor SPMB (konstant untuk anak ini) ─────────────────────────
    try:
        nilai_rapor_f = float(nilai_rapor) if nilai_rapor is not None else None
    except (TypeError, ValueError):
        nilai_rapor_f = None

    try:
        nilai_tka_f = float(nilai_tka) if nilai_tka is not None else None
    except (TypeError, ValueError):
        nilai_tka_f = None

    poin_prestasi  = _poin_prestasi_tertinggi(prestasi_list)
    pakai_tka_bool = bool(pakai_tka) and nilai_tka_f is not None
    skor_dict = _hitung_skor_spmb(nilai_rapor_f, nilai_tka_f, poin_prestasi, pakai_tka_bool)
    skor_akademik = skor_dict["skor_akademik"]

    results = []
    for s in rows:
        if _norm_jenjang(s.jenjang or "") != jenjang_norm:
            continue
        dist_km = _haversine(home_lat, home_lng, s.latitude, s.longitude)
        if dist_km > radius_km:
            continue
        results.append(_hasil_dasar_sekolah(s, home_lat, home_lng, radius_km, skor_akademik))

    # ── Skor Rekomendasi (indeks jarak & akademik vs riwayat_penerimaan
    # TERBARU sekolah tsb) dihitung utk SEMUA kandidat dalam radius DI SINI
    # — SEBELUM seleksi top-10 — bukan cuma utk 10 yg sudah kepilih lewat
    # skor_kelayakan mentah (lihat docstring). Ini supaya sekolah yg justru
    # lebih unggul secara indeks riil (dibanding data penerimaan tahun
    # lalu) tidak keburu tersingkir krn kalah di skor_jarak/skor_akademik
    # mentah yg skalanya tidak sepadan.
    # ── Resolve "Sekolah Tujuan Anda" (nama -> baris School) LEBIH DULU
    # supaya id-nya bisa digabung ke query ambang di bawah (satu query,
    # bukan dua) — dicari via ILIKE substring sama seperti endpoint
    # /simulasi/cari-sekolah, TANPA batas radius/jenjang (ini pilihan
    # eksplisit user, bukan hasil pencarian otomatis).
    tujuan_resolved = []   # [{"nama_input": str, "school": School|None}, ...] sesuai urutan input
    if sekolah_tujuan:
        for nama in sekolah_tujuan:
            nama = (nama or "").strip()
            if not nama:
                tujuan_resolved.append({"nama_input": nama, "school": None})
                continue
            school = (
                db.query(School)
                .filter(School.nama_sekolah.ilike(f"%{nama}%"))
                .filter(School.latitude.isnot(None), School.longitude.isnot(None))
                .first()
            )
            tujuan_resolved.append({"nama_input": nama, "school": school})

    sekolah_ids_semua = [r["sekolah_id"] for r in results]
    sekolah_ids_semua += [
        t["school"].sekolah_id for t in tujuan_resolved
        if t["school"] and t["school"].sekolah_id not in sekolah_ids_semua
    ]
    riwayat_rows = (
        db.query(RiwayatPenerimaan)
        .filter(RiwayatPenerimaan.sekolah_id.in_(sekolah_ids_semua))
        .filter(RiwayatPenerimaan.nilai_akademis_min.isnot(None))
        .filter(RiwayatPenerimaan.jarak_maks_meter.isnot(None))
        .order_by(RiwayatPenerimaan.sekolah_id.asc(), RiwayatPenerimaan.tahun.desc())
        .all()
    ) if sekolah_ids_semua else []
    # Ambil cuma riwayat TERBARU per sekolah (baris pertama krn sudah di-order tahun desc)
    ambang_by_sekolah = {}
    for rw in riwayat_rows:
        if rw.sekolah_id not in ambang_by_sekolah:
            ambang_by_sekolah[rw.sekolah_id] = rw

    for r in results:
        _terapkan_indeks_rekomendasi(r, ambang_by_sekolah, skor_akademik, nilai_rapor_f, poin_prestasi, skor_dict)

    # ── Bangun hasil "Sekolah Tujuan Anda" — SAMA PERSIS metriknya dgn
    # kartu rekomendasi (lihat docstring parameter sekolah_tujuan di atas).
    # Kalau sekolahnya kebetulan sudah ada di `results` (dalam radius &
    # sejenjang), REUSE dict yg sudah dihitung (bukan hitung ulang) supaya
    # angkanya taruh dijamin identik dgn yg tampil di kartu Rekomendasi.
    results_by_id = {r["sekolah_id"]: r for r in results}
    sekolah_tujuan_hasil = []
    for i, t in enumerate(tujuan_resolved):
        if not t["nama_input"]:
            sekolah_tujuan_hasil.append(None)
            continue
        school = t["school"]
        if not school:
            sekolah_tujuan_hasil.append({
                "pilihan_ke": i + 1,
                "ditemukan":  False,
                "nama_input": t["nama_input"],
            })
            continue
        existing = results_by_id.get(school.sekolah_id)
        if existing:
            r = dict(existing)   # copy — beri label pilihan_ke tanpa mengubah entri asli di results
        else:
            r = _hasil_dasar_sekolah(school, home_lat, home_lng, radius_km, skor_akademik)
            _terapkan_indeks_rekomendasi(r, ambang_by_sekolah, skor_akademik, nilai_rapor_f, poin_prestasi, skor_dict)
        r["pilihan_ke"] = i + 1
        r["ditemukan"]  = True
        sekolah_tujuan_hasil.append(r)

    # ── Urutkan & pilih top-10 berdasar Skor Rekomendasi (indeks vs
    # riwayat_penerimaan, atau fallback radius) — INI yg dipakai jadi
    # dasar seleksi & urutan, BUKAN skor_kelayakan mentah lagi. skor_kelayakan
    # tetap tersimpan di tiap hasil (lihat docstring) tapi cuma konteks.
    results.sort(key=lambda x: x["skor_rekomendasi"], reverse=True)
    top10_negeri = [r for r in results if r["status"] == "N"][:10]
    top10_swasta = [r for r in results if r["status"] == "S"][:10]
    top10 = results[:10]   # dipertahankan untuk kompatibilitas mundur (gabungan tanpa filter status)

    # ── Jarak via jalan untuk gabungan sekolah yang tampil saja (hemat kuota
    # ORS) — termasuk sekolah_tujuan_hasil yg BELUM tentu ada di top10 (mis.
    # di luar radius), supaya kartunya juga dapat jarak_jalan_km spt kartu
    # rekomendasi lain, bukan cuma jarak lurus saja.
    #
    # PENTING: dikelompokkan per sekolah_id -> LIST semua objek dict yg
    # merujuk sekolah tsb (bisa lebih dari satu — mis. sekolah yang sama
    # muncul di top10 DAN sebagai salinan di sekolah_tujuan_hasil, lihat
    # dict(existing) di atas). Kalau cuma disimpan satu dict per id (spt
    # sebelumnya), objek yang "kalah" tidak pernah dapat jarak_jalan_km
    # sama sekali walau sekolahnya sama persis.
    union_by_id = {}
    for r in (top10_negeri + top10_swasta + top10 + sekolah_tujuan_hasil):
        if r and r.get("ditemukan", True) and "sekolah_id" in r:
            union_by_id.setdefault(r["sekolah_id"], []).append(r)

    if union_by_id:
        destinations = [
            {"sekolah_id": sid, "lat": objs[0]["lat"], "lng": objs[0]["lng"]}
            for sid, objs in union_by_id.items()
        ]
        dual = get_distances_one_to_many(db, home_lat, home_lng, destinations)
        for sid, objs in union_by_id.items():
            info = dual.get(sid)
            for r in objs:
                if info:
                    r["jarak_jalan_km"]     = info["jarak_jalan_km"]
                    r["durasi_jalan_menit"] = info["durasi_jalan_menit"]
                    r["jalan_tersedia"]     = info["jalan_tersedia"]
                r.pop("lat", None)
                r.pop("lng", None)

    return {
        "jenjang":             jenjang_norm,
        "radius_km":           radius_km,
        "nilai_rapor":         nilai_rapor_f,
        "nilai_tka":           nilai_tka_f,
        "pakai_tka":           pakai_tka_bool,
        "poin_prestasi":       poin_prestasi,
        "skor_akademik":       skor_akademik,
        "skor_spmb":           skor_dict["skor_spmb"],
        "skor_prestasi":       skor_dict["skor_prestasi"],
        "total_kandidat":      len(results),
        "total_kandidat_negeri": sum(1 for r in results if r["status"] == "N"),
        "total_kandidat_swasta": sum(1 for r in results if r["status"] == "S"),
        "rekomendasi":         top10,           # gabungan (kompatibilitas mundur)
        "rekomendasi_negeri":  top10_negeri,
        "rekomendasi_swasta":  top10_swasta,
        "sekolah_tujuan":      sekolah_tujuan_hasil,
    }


def get_simulasi_ppdb(db, sekolah_id: int, requesting_user_id=None, anak_idx=None):
    from models import UserProfile
 
    school = db.query(School).filter(School.sekolah_id == sekolah_id).first()
    if not school:
        return None
 
    if school.latitude is None or school.longitude is None:
        return {
            "sekolah_id":      school.sekolah_id,
            "nama_sekolah":    school.nama_sekolah,
            "kuota":           school.kuota,
            "akreditasi":      school.akreditasi,
            "kecamatan":       school.kecamatan,
            "alamat":          school.alamat,
            "jenjang_sekolah": school.jenjang,
            "status_sekolah":  _norm_status(school.status) or school.status,
            "school_lat":      None,
            "school_lng":      None,
            "peringkat_saya":  None,
            "status_saya":     None,
            "kuota_prestasi":          None,
            "peringkat_prestasi_saya": None,
            "status_prestasi_saya":    None,
            "skor_prestasi_saya":      None,
            "kuota_rapor":             None,
            "peringkat_rapor_saya":    None,
            "status_rapor_saya":       None,
            "total_pendaftar": 0,
            "peserta":         [],
        }
 
    profiles   = db.query(UserProfile).all()
    candidates = []
    target     = school.nama_sekolah.strip().lower()
    seen_pairs = set()  # (user_id, nama_anak) agar tidak duplikat

    sekolah_jenjang = _norm_jenjang(school.jenjang or "")

    def _make_candidate(profile, child):
        """Bangun dict kandidat dari (profile, child). Return None jika data tidak lengkap."""
        if profile.home_lat is None or profile.home_lng is None:
            return None

        dist_km = _haversine(
            profile.home_lat, profile.home_lng,
            school.latitude,  school.longitude,
        )

        # ── Skor SPMB (jalur rapor) dan jalur prestasi ──────────
        nilai_rapor = child.get("nilaiRapor")
        try:
            nilai_rapor = float(nilai_rapor) if nilai_rapor is not None else None
        except (TypeError, ValueError):
            nilai_rapor = None

        nilai_tka   = child.get("nilaiTKA")
        try:
            nilai_tka = float(nilai_tka) if nilai_tka is not None else None
        except (TypeError, ValueError):
            nilai_tka = None

        pakai_tka    = bool(child.get("pakaiTKA", True))
        poin_prestasi = _poin_prestasi_tertinggi(child.get("prestasi"))
        skor_dict     = _hitung_skor_spmb(nilai_rapor, nilai_tka, poin_prestasi, pakai_tka)

        return {
            "user_id":   profile.user_id,
            "nama_anak": (child.get("nama") or "").strip() or "—",
            "jenjang":   (child.get("jenjang") or "").strip() or "—",
            "jarak_lurus_km": round(dist_km, 2),
            "home_lat":  profile.home_lat,
            "home_lng":  profile.home_lng,
            "is_me":     profile.user_id == requesting_user_id,
            "kecamatan": getattr(profile, "kecamatan", None) or "—",
            "kelurahan": getattr(profile, "kelurahan", None) or "—",
            "nilai_rapor":   nilai_rapor,
            "nilai_tka":     nilai_tka,
            "pakai_tka":     skor_dict["pakai_tka"],
            "skor_spmb":     skor_dict["skor_spmb"],
            "skor_prestasi": skor_dict["skor_prestasi"],
            "poin_prestasi": poin_prestasi,   # dipakai utk filter kelayakan Jalur Prestasi
        }

    for profile in profiles:
        if profile.home_lat is None or profile.home_lng is None:
            continue
        if not profile.data_anak:
            continue

        try:
            children = json.loads(profile.data_anak)
            if not isinstance(children, list):
                continue
        except (json.JSONDecodeError, TypeError):
            continue

        for child in children:
            # sekolahTujuan bisa string (lama) atau array (baru)
            raw = child.get("sekolahTujuan") or ""
            if isinstance(raw, list):
                tujuan_list = [t.strip().lower() for t in raw if t]
            else:
                tujuan_list = [raw.strip().lower()] if raw.strip() else []

            if target not in tujuan_list:
                continue

            # Validasi jenjang anak harus sesuai jenjang sekolah (jalur zonasi)
            child_jenjang = _norm_jenjang(child.get("jenjang") or "")
            if sekolah_jenjang and child_jenjang and child_jenjang != sekolah_jenjang:
                continue  # jenjang tidak cocok, lewati

            # Hindari duplikat anak yang sama dari user yang sama
            pair_key = (profile.user_id, (child.get("nama") or "").strip().lower())
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)

            candidate = _make_candidate(profile, child)
            if candidate is None:
                continue
            candidates.append(candidate)
            # Tidak break — biarkan anak lain dari user yg sama ikut jika ada

    # ── Fallback: user memilih sekolah dari Top 10 Rekomendasi ───────
    # Sekolah Top 10 dipilih berdasarkan jarak/skor, bukan dari
    # sekolahTujuan — jadi user tidak akan masuk kandidat dari loop di
    # atas. Kalau user belum ada di list, tambahkan anak mereka sekarang.
    if requesting_user_id is not None and anak_idx is not None:
        already_in = any(c["user_id"] == requesting_user_id for c in candidates)
        if not already_in:
            req_profile = db.query(UserProfile).filter(
                UserProfile.user_id == requesting_user_id
            ).first()
            if req_profile and req_profile.data_anak:
                try:
                    req_children = json.loads(req_profile.data_anak)
                    if isinstance(req_children, list) and anak_idx < len(req_children):
                        c = _make_candidate(req_profile, req_children[anak_idx])
                        if c is not None:
                            candidates.append(c)
                except (json.JSONDecodeError, TypeError):
                    pass

    # ── Peringkat & status zonasi resmi: berbasis JARAK LURUS ────────
    candidates.sort(key=lambda x: x["jarak_lurus_km"])

    # ── Jarak via jalan: info tambahan, dihitung berdampingan ────────
    if candidates:
        origins = [
            {"key": idx, "lat": c["home_lat"], "lng": c["home_lng"]}
            for idx, c in enumerate(candidates)
        ]
        dual = get_distances_many_to_one(
            db, origins, school.latitude, school.longitude, school.sekolah_id
        )
        for idx, c in enumerate(candidates):
            info = dual.get(idx)
            if info:
                c["jarak_jalan_km"]     = info["jarak_jalan_km"]
                c["durasi_jalan_menit"] = info["durasi_jalan_menit"]
                c["jalan_tersedia"]     = info["jalan_tersedia"]

    kuota          = school.kuota or 0

    # ── Jalur Prestasi (Kejuaraan): ranking berdasarkan skor_prestasi ─
    # skor_prestasi sudah dihitung per kandidat oleh _make_candidate
    # menggunakan _hitung_skor_spmb (Penghargaan×50%+TKA×50% dgn TKA;
    # rapor×60%+penghargaan×40% tanpa TKA — lihat docstring fungsi tsb).
    #
    # PENTING: kandidat yang poin_prestasi=0 (belum/sudah tidak punya
    # prestasi/sertifikat sama sekali) TIDAK diikutkan dalam ranking ini,
    # walau skor_prestasi-nya tetap > 0 murni dari komponen TKA. Jalur
    # Prestasi secara definisi untuk pendaftar yang punya bukti prestasi
    # — tanpa itu mereka tidak berhak dirangking/"Lolos" di jalur ini,
    # berapa pun nilai TKA-nya.
    #
    # Kuota jalur prestasi minimal 30% dari daya tampung per ketentuan
    # SPMB Jabar (spmb.jabarprov.go.id, dikonfirmasi Antara/Tirto 2025).
    # Sekolah boleh menetapkan persentase sendiri antar sub-jalur
    # (akademik rapor / kejuaraan / kepemimpinan) — karena split per
    # sekolah itu tidak ada di data kita, di sini 30% dipakai sbg
    # perkiraan atas utk masing2 sub-jalur (prestasi & rapor) secara
    # independen, bukan penjumlahan kursi riil.
    kuota_prestasi = max(1, round(kuota * 0.3)) if kuota else 0

    kandidat_prestasi_valid = [c for c in candidates if c.get("poin_prestasi", 0) > 0]
    candidates_by_prestasi = sorted(kandidat_prestasi_valid, key=lambda x: x["skor_prestasi"], reverse=True)
    for i, c in enumerate(candidates_by_prestasi):
        c["peringkat_prestasi"] = i + 1
        c["status_prestasi"] = "Lolos" if c["peringkat_prestasi"] <= kuota_prestasi else "Tidak Lolos"
    # Kandidat tanpa prestasi: c["peringkat_prestasi"]/c["status_prestasi"]
    # sengaja tidak diset sama sekali → tetap None saat diakses lewat
    # c.get(...) di bawah, ditampilkan frontend sebagai "tidak berlaku".

    # ── Jalur Rapor (Prestasi Akademik): ranking berdasarkan skor_spmb ─
    # skor_spmb sebelumnya dihitung tapi tidak pernah dirangking/
    # ditampilkan sbg jalur tersendiri — ditambahkan di sini supaya
    # peluang lewat nilai rapor bisa dilihat terpisah dari jalur jarak
    # (zonasi) & jalur prestasi kejuaraan. Hanya kandidat yang sudah
    # mengisi nilai rapor yang diikutkan.
    kuota_rapor = max(1, round(kuota * 0.3)) if kuota else 0

    kandidat_rapor_valid = [c for c in candidates if c.get("nilai_rapor") is not None]
    candidates_by_rapor = sorted(kandidat_rapor_valid, key=lambda x: x["skor_spmb"], reverse=True)
    for i, c in enumerate(candidates_by_rapor):
        c["peringkat_rapor"] = i + 1
        c["status_rapor"] = "Lolos" if c["peringkat_rapor"] <= kuota_rapor else "Tidak Lolos"

    peserta        = []
    peringkat_saya = None
    status_saya    = None
    peringkat_prestasi_saya = None
    status_prestasi_saya    = None
    skor_prestasi_saya      = None
    peringkat_rapor_saya    = None
    status_rapor_saya       = None

    for i, c in enumerate(candidates):
        rank   = i + 1
        status = "Lolos" if rank <= kuota else "Tidak Lolos"
        if c["is_me"]:
            peringkat_saya = rank
            status_saya    = status
            peringkat_prestasi_saya = c.get("peringkat_prestasi")
            status_prestasi_saya    = c.get("status_prestasi")
            skor_prestasi_saya      = c.get("skor_prestasi")
            peringkat_rapor_saya    = c.get("peringkat_rapor")
            status_rapor_saya       = c.get("status_rapor")
        peserta.append({
            "peringkat": rank,
            "nama_anak": c["nama_anak"],
            "jenjang":   c["jenjang"],
            "jarak_lurus_km":     c["jarak_lurus_km"],
            "jarak_jalan_km":     c.get("jarak_jalan_km"),
            "durasi_jalan_menit": c.get("durasi_jalan_menit"),
            "jalan_tersedia":     c.get("jalan_tersedia", False),
            "status":    status,
            "is_me":     c["is_me"],
            "kecamatan": c["kecamatan"],
            "kelurahan": c["kelurahan"],
            "nilai_rapor":        c.get("nilai_rapor"),
            "nilai_tka":          c.get("nilai_tka"),
            "pakai_tka":          c.get("pakai_tka", False),
            "skor_spmb":          c.get("skor_spmb"),
            "skor_prestasi":      c.get("skor_prestasi"),
            "poin_prestasi":      c.get("poin_prestasi", 0),
            "peringkat_prestasi": c.get("peringkat_prestasi"),
            "status_prestasi":    c.get("status_prestasi"),
            "peringkat_rapor":    c.get("peringkat_rapor"),
            "status_rapor":       c.get("status_rapor"),
        })
 
    return {
        "sekolah_id":      school.sekolah_id,
        "nama_sekolah":    school.nama_sekolah,
        "kuota":           school.kuota,
        "akreditasi":      school.akreditasi,
        "kecamatan":       school.kecamatan,
        "alamat":          school.alamat,
        "jenjang_sekolah": school.jenjang,
        "status_sekolah":  _norm_status(school.status) or school.status,
        "school_lat":      school.latitude,    # ← untuk map di frontend
        "school_lng":      school.longitude,   # ← untuk map di frontend
        "peringkat_saya":  peringkat_saya,
        "status_saya":     status_saya,
        "kuota_prestasi":          kuota_prestasi,
        "peringkat_prestasi_saya": peringkat_prestasi_saya,
        "status_prestasi_saya":    status_prestasi_saya,
        "skor_prestasi_saya":      skor_prestasi_saya,
        "kuota_rapor":             kuota_rapor,
        "peringkat_rapor_saya":    peringkat_rapor_saya,
        "status_rapor_saya":       status_rapor_saya,
        "skor_spmb_saya":          next((c.get("skor_spmb") for c in candidates if c["is_me"]), None),
        "total_pendaftar": len(candidates),
        "peserta":         peserta,
    }

def get_wilayah_kabupaten(db):
    """Daftar kabupaten/kota unik dari batasan_wilayah, sorted."""
    rows = db.execute(
        text("""
            SELECT DISTINCT nama_kabupaten
            FROM batasan_wilayah
            WHERE nama_kabupaten IS NOT NULL AND nama_kabupaten != ''
            ORDER BY nama_kabupaten ASC
        """)
    ).fetchall()
    return [r[0] for r in rows]
 
 
def get_wilayah_kecamatan(db, kabupaten: str):
    """Daftar kecamatan unik untuk kabupaten tertentu."""
    rows = db.execute(
        text("""
            SELECT DISTINCT nama_kecamatan
            FROM batasan_wilayah
            WHERE nama_kabupaten ILIKE :kab
              AND nama_kecamatan IS NOT NULL AND nama_kecamatan != ''
            ORDER BY nama_kecamatan ASC
        """),
        {"kab": kabupaten}
    ).fetchall()
    return [r[0] for r in rows]
 
 
def get_wilayah_kelurahan(db, kabupaten: str, kecamatan: str):
    """Daftar desa/kelurahan unik untuk kecamatan tertentu."""
    rows = db.execute(
        text("""
            SELECT DISTINCT nama_desa
            FROM batasan_wilayah
            WHERE nama_kabupaten ILIKE :kab
              AND nama_kecamatan ILIKE :kec
              AND nama_desa IS NOT NULL AND nama_desa != ''
            ORDER BY nama_desa ASC
        """),
        {"kab": kabupaten, "kec": kecamatan}
    ).fetchall()
    return [r[0] for r in rows]

# ─── Biaya CRUD ──────────────────────────────────────────────────
def get_biaya(db, sekolah_id: int):
    from models import SekolahBiaya
    return db.query(SekolahBiaya).filter(SekolahBiaya.sekolah_id == sekolah_id).first()
 
def upsert_biaya(db, sekolah_id: int, data: dict):
    from models import SekolahBiaya
    biaya = db.query(SekolahBiaya).filter(SekolahBiaya.sekolah_id == sekolah_id).first()
    if biaya:
        for k, v in data.items():
            setattr(biaya, k, v)
    else:
        biaya = SekolahBiaya(sekolah_id=sekolah_id, **data)
        db.add(biaya)
    db.commit()
    db.refresh(biaya)
    return biaya
 
# ─── Fasilitas CRUD ──────────────────────────────────────────────
def get_fasilitas(db, sekolah_id: int):
    from models import SekolahFasilitas
    return db.query(SekolahFasilitas).filter(
        SekolahFasilitas.sekolah_id == sekolah_id
    ).all()
 
def create_fasilitas(db, sekolah_id: int, data: dict):
    from models import SekolahFasilitas
    f = SekolahFasilitas(sekolah_id=sekolah_id, **data)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f
 
def update_fasilitas(db, fasilitas_id: int, data: dict):
    from models import SekolahFasilitas
    f = db.query(SekolahFasilitas).filter(SekolahFasilitas.id == fasilitas_id).first()
    if not f:
        return None
    for k, v in data.items():
        setattr(f, k, v)
    db.commit()
    db.refresh(f)
    return f
 
def delete_fasilitas(db, fasilitas_id: int):
    from models import SekolahFasilitas
    f = db.query(SekolahFasilitas).filter(SekolahFasilitas.id == fasilitas_id).first()
    if not f:
        return False
    db.delete(f)
    db.commit()
    return True
 
# ─── Pendaftar (reuse logika simulasi) ──────────────────────────
def get_pendaftar_sekolah(db, sekolah_id: int):
    "Daftar user yang salah satu anaknya memilih sekolah ini."
    from models import UserProfile, User
    school = db.query(School).filter(School.sekolah_id == sekolah_id).first()
    if not school:
        return []
 
    profiles  = db.query(UserProfile).all()
    candidates = []
    target    = school.nama_sekolah.strip().lower()
 
    for profile in profiles:
        if not profile.data_anak:
            continue
        try:
            children = json.loads(profile.data_anak)
            if not isinstance(children, list):
                continue
        except (json.JSONDecodeError, TypeError):
            continue
 
        for child in children:
            raw = child.get("sekolahTujuan") or ""
            if isinstance(raw, list):
                tujuan_list = [t.strip().lower() for t in raw if t]
            else:
                tujuan_list = [raw.strip().lower()] if raw.strip() else []
 
            if target not in tujuan_list:
                continue
 
            # Ambil nama user (ortu)
            user = db.query(User).filter(User.id == profile.user_id).first()
 
            candidates.append({
                "user_id":   profile.user_id,
                "nama_anak": (child.get("nama") or "").strip() or "—",
                "nama_ortu": user.username if user else "—",
                "alamat":    getattr(profile, "alamat", None) or "—",
                "kecamatan": getattr(profile, "kecamatan", None) or "—",
                "jenjang":   (child.get("jenjang") or "").strip() or "—",
                "home_lat":  profile.home_lat,
                "home_lng":  profile.home_lng,
                "jarak_lurus_km": None,
            })
            break

    # ── Jarak lurus (selalu) + jarak jalan (info tambahan) ───────────
    if school.latitude and school.longitude:
        origins = [
            {"key": idx, "lat": c["home_lat"], "lng": c["home_lng"]}
            for idx, c in enumerate(candidates) if c["home_lat"] and c["home_lng"]
        ]
        if origins:
            dual = get_distances_many_to_one(
                db, origins, school.latitude, school.longitude, school.sekolah_id
            )
            for idx, c in enumerate(candidates):
                info = dual.get(idx)
                if info:
                    c["jarak_lurus_km"]     = info["jarak_lurus_km"]
                    c["jarak_jalan_km"]     = info["jarak_jalan_km"]
                    c["durasi_jalan_menit"] = info["durasi_jalan_menit"]
                    c["jalan_tersedia"]     = info["jalan_tersedia"]

    # ── Peringkat & status zonasi resmi: berbasis JARAK LURUS ────────
    candidates.sort(key=lambda x: (x["jarak_lurus_km"] is None, x["jarak_lurus_km"] or 0))

    kuota   = school.kuota or 0
    result  = []
    for i, c in enumerate(candidates):
        rank = i + 1
        result.append({
            "peringkat": rank,
            "nama_anak": c["nama_anak"],
            "nama_ortu": c["nama_ortu"],
            "alamat":    c["alamat"],
            "kecamatan": c["kecamatan"],
            "jenjang":   c["jenjang"],
            "jarak_lurus_km":     c["jarak_lurus_km"],
            "jarak_jalan_km":     c.get("jarak_jalan_km"),
            "durasi_jalan_menit": c.get("durasi_jalan_menit"),
            "jalan_tersedia":     c.get("jalan_tersedia", False),
            "status":    "Lolos" if rank <= kuota else "Tidak Lolos",
        })
    return result


# ═══════════════════════════════════════════════════════════════
# PAPAN PERINGKAT SEKOLAH (Home page)
#
# Tidak ada API resmi/eksternal yang menyediakan data nilai
# penerimaan PPDB secara publik (sudah dicek: informasi-spmb.site
# tidak punya API terbuka, dan spmb.jabarprov.go.id hanya bisa
# diakses per-akun individual). Karena itu papan peringkat ini
# dihitung LIVE dari data pendaftar simulasi di platform kami
# sendiri — bukan klaim data resmi Dinas Pendidikan.
#
# mode="nilai" -> nilai ambang = skor SPMB pendaftar pada posisi
#                 ke-kuota (setelah diurutkan dari skor tertinggi)
# mode="jarak" -> jarak ambang = jarak pendaftar pada posisi
#                 ke-kuota (setelah diurutkan dari jarak terdekat)
# ═══════════════════════════════════════════════════════════════
def get_ranking_sekolah(db, mode: str = "nilai", jenjang: str = "", kabupaten: str = "", limit: int = 30):
    jenjang_key = _norm_jenjang(jenjang or "")

    q = db.query(School)
    if kabupaten:
        q = q.filter(School.kabupaten == kabupaten)
    schools = q.all()
    if jenjang_key:
        schools = [s for s in schools if _norm_jenjang(s.jenjang or "") == jenjang_key]

    # ── Satu kali scan semua profil, kelompokkan kandidat per nama sekolah tujuan ──
    per_sekolah: dict[str, list[dict]] = {}
    for profile in db.query(UserProfile).all():
        if profile.home_lat is None or profile.home_lng is None:
            continue
        if not profile.data_anak:
            continue
        try:
            children = json.loads(profile.data_anak)
            if not isinstance(children, list):
                continue
        except (json.JSONDecodeError, TypeError):
            continue

        for child in children:
            raw = child.get("sekolahTujuan") or ""
            tujuan_list = (
                [t.strip().lower() for t in raw if t] if isinstance(raw, list)
                else ([raw.strip().lower()] if raw.strip() else [])
            )
            if not tujuan_list:
                continue

            nilai_rapor = child.get("nilaiRapor")
            try:
                nilai_rapor = float(nilai_rapor) if nilai_rapor is not None else None
            except (TypeError, ValueError):
                nilai_rapor = None
            nilai_tka = child.get("nilaiTKA")
            try:
                nilai_tka = float(nilai_tka) if nilai_tka is not None else None
            except (TypeError, ValueError):
                nilai_tka = None
            pakai_tka     = bool(child.get("pakaiTKA", True))
            poin_prestasi = _poin_prestasi_tertinggi(child.get("prestasi"))
            skor_dict     = _hitung_skor_spmb(nilai_rapor, nilai_tka, poin_prestasi, pakai_tka)

            entry = {
                "home_lat":      profile.home_lat,
                "home_lng":      profile.home_lng,
                "nilai_rapor":   nilai_rapor,
                "nilai_tka":     nilai_tka,
                "poin_prestasi": poin_prestasi,
                "skor_spmb":     skor_dict["skor_spmb"],
                "child_jenjang": _norm_jenjang(child.get("jenjang") or ""),
            }
            for nama_tujuan in tujuan_list:
                per_sekolah.setdefault(nama_tujuan, []).append(entry)

    # ── Hitung metrik ambang per sekolah ──
    hasil = []
    for s in schools:
        key            = (s.nama_sekolah or "").strip().lower()
        sekolah_jenjang = _norm_jenjang(s.jenjang or "")
        kandidat = [
            k for k in per_sekolah.get(key, [])
            if not sekolah_jenjang or not k["child_jenjang"] or k["child_jenjang"] == sekolah_jenjang
        ]
        if not kandidat:
            continue  # tidak ada data live — tidak bisa dirangking, lewati

        kuota = s.kuota or 0
        metric_val = None
        tnr_ambang = tka_ambang = penghargaan_ambang = None
        if kuota > 0:
            if mode == "jarak":
                jaraks = sorted(_haversine(k["home_lat"], k["home_lng"], s.latitude, s.longitude) for k in kandidat)
                metric_val = round(jaraks[min(kuota, len(jaraks)) - 1], 2)
            else:
                # urutkan kandidat LENGKAP (bukan cuma nilai skor_spmb-nya) supaya
                # rincian TNR/TKA/Penghargaan di garis ambang bisa ikut diambil
                kandidat_sorted = sorted(kandidat, key=lambda k: k["skor_spmb"], reverse=True)
                cutoff = kandidat_sorted[min(kuota, len(kandidat_sorted)) - 1]
                metric_val         = round(cutoff["skor_spmb"], 1)
                tnr_ambang         = cutoff["nilai_rapor"]
                tka_ambang         = cutoff["nilai_tka"]
                penghargaan_ambang = cutoff["poin_prestasi"]

        hasil.append({
            "sekolah_id":       s.sekolah_id,
            "nama_sekolah":     s.nama_sekolah,
            "kabupaten":        s.kabupaten,
            "kecamatan":        s.kecamatan,
            "kuota":            kuota,
            "tnr_ambang":         round(tnr_ambang, 1) if tnr_ambang is not None else None,
            "tka_ambang":         round(tka_ambang, 1) if tka_ambang is not None else None,
            "penghargaan_ambang": penghargaan_ambang,
            "jumlah_pendaftar": len(kandidat),
            "metric":           metric_val,
        })

    hasil.sort(key=lambda r: (r["metric"] is None, r["metric"]), reverse=(mode != "jarak"))
    return {"mode": mode, "total_sekolah_live": len(hasil), "data": hasil[:limit]}
    # ── get_ranking_sekolah tidak lagi dipakai di Home page (lihat
    #    get_riwayat_penerimaan di bawah) — dibiarkan, tidak dihapus,
    #    kalau-kalau nanti mau dipakai lagi untuk konteks lain.


# ═══════════════════════════════════════════════════════════════
# RIWAYAT PENERIMAAN (Home page) — pengganti get_ranking_sekolah
#
# Bukan dihitung otomatis dari simulasi. Data statis yang diinput
# manual (lewat Supabase Table Editor pada tabel riwayat_penerimaan,
# tabelnya otomatis terbuat saat backend di-deploy karena models.py
# sudah didaftarkan ke Base.metadata.create_all di main.py).
# Ditampilkan gaya "kartu info" per sekolah, bukan tabel ranking.
# ═══════════════════════════════════════════════════════════════
def get_kabupaten_sekolah(db):
    """
    Daftar kabupaten/kota UNIK dari tabel `sekolah` — dipakai KHUSUS utk
    dropdown filter Riwayat Penerimaan (Home page), BUKAN dari
    batasan_wilayah spt get_wilayah_kabupaten() di atas.

    Kenapa harus beda sumber: get_riwayat_penerimaan() memfilter dengan
    `School.kabupaten == kabupaten` (exact match ke tabel sekolah), tapi
    dropdown-nya sebelumnya diisi dari batasan_wilayah.nama_kabupaten —
    tabel BEDA yang datanya berasal dari sumber batas administratif utk
    kebutuhan zonasi, penulisannya tidak selalu identik dgn nama_kabupaten
    yang tersimpan di `sekolah` (mis. beda kapitalisasi atau varian
    penulisan "Kabupaten X" vs "Kota X"). Akibatnya sebagian besar pilihan
    di dropdown tidak pernah cocok dgn baris manapun di tabel sekolah, dan
    hasil filter tampak kosong. Dengan mengambil daftar LANGSUNG dari
    kolom yang sama yang difilter, setiap pilihan di dropdown dijamin
    selalu ada padanannya persis di tabel sekolah.
    """
    rows = (
        db.query(School.kabupaten)
        .filter(School.kabupaten.isnot(None), School.kabupaten != "")
        .distinct()
        .order_by(School.kabupaten.asc())
        .all()
    )
    return [r[0] for r in rows]


def get_riwayat_penerimaan(db, jenjang: str = "", kabupaten: str = "", include_empty: bool = True):
    jenjang_key = _norm_jenjang(jenjang or "")

    if not include_empty:
        # ── Dipakai Admin CRUD panel: hanya baris riwayat yang sungguh
        #    sudah diinput, supaya daftar tetap ringkas dan `id` selalu
        #    valid untuk aksi Edit/Hapus.
        q = (
            db.query(RiwayatPenerimaan, School)
            .join(School, School.sekolah_id == RiwayatPenerimaan.sekolah_id)
        )
        if kabupaten:
            q = q.filter(School.kabupaten == kabupaten)
        jenjang_cond = _jenjang_sql_filter(jenjang_key)
        if jenjang_cond is not None:
            q = q.filter(jenjang_cond)
        rows = q.order_by(RiwayatPenerimaan.tahun.desc(), School.nama_sekolah.asc()).all()

        hasil = []
        for riwayat, s in rows:
            hasil.append({
                "id":             riwayat.id,
                "sekolah_id":     s.sekolah_id,
                "nama_sekolah":   s.nama_sekolah,
                "jenjang":        s.jenjang,
                "kabupaten":      s.kabupaten,
                "kecamatan":      s.kecamatan,
                "tahun":          riwayat.tahun,
                "jalur":          riwayat.jalur,
                "kuota":          riwayat.kuota if riwayat.kuota is not None else s.kuota,
                "pendaftar":      riwayat.pendaftar,
                "nilai_akademis_min":  riwayat.nilai_akademis_min,
                "nilai_akademis_maks": riwayat.nilai_akademis_maks,
                "jarak_maks_meter":    riwayat.jarak_maks_meter,
                "catatan":        riwayat.catatan,
            })
        return hasil

    # ── Dipakai Home page publik (default): SEMUA sekolah ditampilkan
    #    (Negeri MAUPUN Swasta), walau belum ada satupun data riwayat
    #    diinput. Negeri diprioritaskan tampil duluan (lihat negeri_rank
    #    di order_by di bawah) — bukan disembunyikan, cuma diurutkan
    #    lebih dulu karena itu yang paling relevan utk mayoritas user.
    #    Basis query jadi tabel `sekolah` (LEFT JOIN ke riwayat_penerimaan)
    #    sehingga kolom yang datanya sudah ada di tabel sekolah (mis.
    #    kuota) langsung terisi, sementara kolom historis yang memang
    #    belum ada datanya (pendaftar, nilai akademis min/maks, jarak
    #    maksimum) dikirim null — ditampilkan "Belum Tersedia" oleh frontend.
    q = (
        db.query(School, RiwayatPenerimaan)
        .outerjoin(RiwayatPenerimaan, RiwayatPenerimaan.sekolah_id == School.sekolah_id)
    )
    if kabupaten:
        q = q.filter(School.kabupaten == kabupaten)
    # Jenjang WAJIB difilter di level SQL DI SINI (sebelum .limit() di
    # bawah) — bukan belakangan di loop Python seperti sebelumnya. Kalau
    # difilter belakangan, LIMIT 300 sudah kepotong duluan dari hasil
    # TANPA memandang jenjang, jadi begitu user pilih SMP/SMA/SMK (yang
    # baris mentahnya jauh lebih sedikit drpd SD se-Jawa Barat), baris
    # yang tersisa dari 300 hasil random itu seringkali sudah habis /
    # nyaris tidak ada yang cocok — tampil seperti "tidak ada data" padahal
    # datanya sebenarnya ada, cuma keburu terpotong LIMIT.
    jenjang_cond = _jenjang_sql_filter(jenjang_key)
    if jenjang_cond is not None:
        q = q.filter(jenjang_cond)
    # Status di DB tidak konsisten ('N' vs 'Negeri'), jadi dicek dua-duanya.
    # negeri_rank 0 = Negeri (tampil duluan), 1 = selain itu (Swasta/kosong).
    negeri_rank = case(
        (func.upper(School.status).in_(("N", "NEGERI")), 0),
        else_=1,
    )
    q = q.order_by(negeri_rank, RiwayatPenerimaan.tahun.desc().nullslast(), School.nama_sekolah.asc())
    if not kabupaten:
        # ── Batas pengaman: tanpa filter kabupaten, query ini menarik
        # SEMUA sekolah se-Jawa Barat (bisa ribuan baris) sekaligus —
        # itu penyebab utama load lambat di Home page. Filter jenjang
        # (di atas) sudah ikut diterapkan SEBELUM baris ini, jadi LIMIT
        # di sini memotong dari hasil yang SUDAH sesuai jenjang, bukan
        # dari semua jenjang campur aduk. Begitu user memilih kabupaten
        # tertentu, jumlah barisnya wajar (paling ratusan) jadi TIDAK
        # dibatasi. Urutan query (data asli dulu via tahun.desc().nullslast())
        # memastikan sekolah yang sudah punya data riwayat tetap
        # diprioritaskan tampil duluan.
        q = q.limit(300)
    rows = q.all()

    hasil = []
    for s, riwayat in rows:
        hasil.append({
            "id":             riwayat.id if riwayat else None,
            "sekolah_id":     s.sekolah_id,
            "nama_sekolah":   s.nama_sekolah,
            "jenjang":        s.jenjang,
            "kabupaten":      s.kabupaten,
            "kecamatan":      s.kecamatan,
            "tahun":          riwayat.tahun if riwayat else None,
            "jalur":          riwayat.jalur if riwayat else None,
            "kuota":          (riwayat.kuota if riwayat and riwayat.kuota is not None else s.kuota),
            "pendaftar":      riwayat.pendaftar if riwayat else None,
            "nilai_akademis_min":  riwayat.nilai_akademis_min if riwayat else None,
            "nilai_akademis_maks": riwayat.nilai_akademis_maks if riwayat else None,
            "jarak_maks_meter":    riwayat.jarak_maks_meter if riwayat else None,
            "catatan":        riwayat.catatan if riwayat else None,
        })
    return hasil


def create_riwayat_penerimaan(db: Session, data) -> "RiwayatPenerimaan":
    riwayat = RiwayatPenerimaan(
        sekolah_id=data.sekolah_id,
        tahun=data.tahun,
        jalur=data.jalur,
        kuota=data.kuota,
        pendaftar=data.pendaftar,
        nilai_akademis_min=data.nilai_akademis_min,
        nilai_akademis_maks=data.nilai_akademis_maks,
        jarak_maks_meter=data.jarak_maks_meter,
        catatan=data.catatan,
    )
    db.add(riwayat)
    db.commit()
    db.refresh(riwayat)
    return riwayat


def update_riwayat_penerimaan(db: Session, riwayat_id: int, data) -> Optional["RiwayatPenerimaan"]:
    riwayat = db.query(RiwayatPenerimaan).filter(RiwayatPenerimaan.id == riwayat_id).first()
    if not riwayat:
        return None
    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(riwayat, key, value)
    db.commit()
    db.refresh(riwayat)
    return riwayat


def delete_riwayat_penerimaan(db: Session, riwayat_id: int) -> bool:
    riwayat = db.query(RiwayatPenerimaan).filter(RiwayatPenerimaan.id == riwayat_id).first()
    if not riwayat:
        return False
    db.delete(riwayat)
    db.commit()
    return True