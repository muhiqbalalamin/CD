from sqlalchemy.orm import Session
from .models import School, User, Zonasi
from .utils import hash_password, verify_password
from typing import Optional
from sqlalchemy import text

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
    db.commit()
    db.refresh(user)
    return user

def logout_user(db: Session, user_id: int):
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        user.is_online = 0
        db.commit()
        
def get_schools(
    db: Session,
    jenjang: str | None = None,
    kecamatan: str | None = None,
    status: str | None = None,
    nama: str | None = None
):
    query = db.query(School)

    if jenjang:
        query = query.filter(School.jenjang.ilike(jenjang))
    if kecamatan:
        query = query.filter(School.kecamatan.ilike(f"%{kecamatan}%"))
    if status:
        query = query.filter(School.status.ilike(status))
    if nama:
        query = query.filter(School.nama_sekolah.ilike(f"%{nama}%"))

    return query.order_by(School.nama_sekolah.asc()).all()


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

# --- School CRUD ---
 
def create_school(db: Session, data) -> "School":
    result = db.execute(
        text("""
            INSERT INTO sekolah 
                (nama_sekolah, npsn, jenjang, alamat, kecamatan,
                 latitude, longitude, location,
                 kuota, daya_tampung, status, akreditasi)
            VALUES 
                (:nama_sekolah, :npsn, :jenjang, :alamat, :kecamatan,
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
from .models import UserProfile, AdminProfile, OperatorProfile

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
