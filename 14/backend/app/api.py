from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session
from .db import SessionLocal
from .schemas import (
    LoginSchema,
    RegisterSchema,
    SchoolMapResponse,
    SchoolResponse,
    ZonasiResponse,
    SchoolCreate, 
    SchoolUpdate, 
    ZonasiCreate, 
    ZonasiUpdate
)
from .crud import (
    UserAlreadyExistsError,
    authenticate_user,
    logout_user,
    create_user,
    get_school_by_npsn,
    get_school_by_id,
    get_schools,
    get_zonasi,
    get_zonasi_by_id,
    create_school,
    update_school,
    delete_school,
    create_zonasi,
    update_zonasi,
    delete_zonasi,
    get_school_by_user,
    get_profile,
    upsert_profile,
    get_all_users,
)

router = APIRouter()

# dependency DB
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from sqlalchemy import text
@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    """Daftar semua pengguna terdaftar."""
    users = get_all_users(db)
    return [
        {
            "id":        u.id,
            "username":  u.username,
            "email":     u.email,
            "role":      u.role,
            "school_id": u.school_id,
        }
        for u in users
    ]


@router.get("/profile/{user_id}")
def get_user_profile(user_id: int, role: str, db: Session = Depends(get_db)):
    """Ambil profil berdasarkan user_id dan role."""
    profile = get_profile(db, user_id, role)
    if not profile:
        return {}
    data = {c.name: getattr(profile, c.name) for c in profile.__table__.columns}
    return data


@router.put("/profile/{user_id}")
def save_user_profile(
    user_id: int,
    role: str,
    data: dict = Body(...),
    db: Session = Depends(get_db)
):
    """Simpan/update profil berdasarkan role."""
    for key in ("id", "user_id", "updated_at"):
        data.pop(key, None)
    upsert_profile(db, user_id, role, data)
    return {"message": "Profil berhasil disimpan", "user_id": user_id}


# Register
@router.post("/auth/register")
def register(data: RegisterSchema, db: Session = Depends(get_db)):
    if data.role == "admin":
        if data.admin_code != "ADM-JABAR-2026":
            raise HTTPException(status_code=403, detail="Kode registrasi Admin tidak valid")
    elif data.role == "sekolah":
        if data.operator_code != "OPS-SEKOLAH-2026":
            raise HTTPException(status_code=403, detail="Kode registrasi Operator tidak valid")
        if not data.npsn:
            raise HTTPException(status_code=400, detail="NPSN / ID Sekolah wajib diisi untuk Instansi Sekolah")

        sekolah = get_school_by_npsn(db, data.npsn)
        if not sekolah:
            raise HTTPException(status_code=404, detail="NPSN / ID Sekolah tidak ditemukan")

    try:
        user = create_user(db, data.username, data.email, data.password, data.role, data.npsn if data.role == "sekolah" else None)
    except UserAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc)
        ) from exc

    return {
        "message": "User berhasil dibuat",
        "username": user.username,
        "email": user.email,
        "role": user.role
    }


# Login
@router.post("/auth/login")
def login(data: LoginSchema, db: Session = Depends(get_db)):
    user = authenticate_user(db, data.email, data.password)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="email atau password salah"
        )

    return {
        "message": "Login berhasil",
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role
    }

@router.post("/auth/logout")
def logout(user_id: int = Body(..., embed=True), db: Session = Depends(get_db)):
    logout_user(db, user_id)
    return {"message": "Logout berhasil"}


@router.get("/users")
def list_users(db: Session = Depends(get_db)):
    users = get_all_users(db)
    return [
        {
            "id":        u.id,
            "username":  u.username,
            "email":     u.email,
            "role":      u.role,
            "school_id": u.school_id,
            "is_online": u.is_online,   # ← tambah ini
        }
        for u in users
    ]

@router.get("/schools", response_model=list[SchoolResponse])
def list_schools(
    jenjang: Optional[str] = Query(default=None),
    kecamatan: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    nama: Optional[str] = Query(default=None),
    db: Session = Depends(get_db)
):
    return get_schools(
        db,
        jenjang=jenjang,
        kecamatan=kecamatan,
        status=status_filter,
        nama=nama
    )


@router.get("/schools/{school_id}", response_model=SchoolResponse)
def school_detail(school_id: int, db: Session = Depends(get_db)):
    school = get_school_by_id(db, school_id)
    if not school:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="data sekolah tidak ditemukan"
        )
    return school


@router.get("/zonasi", response_model=list[ZonasiResponse])
def list_zonasi(
    jenjang: Optional[str] = Query(default=None),
    wilayah: Optional[str] = Query(default=None),
    db: Session = Depends(get_db)
):
    return get_zonasi(db, jenjang=jenjang, wilayah=wilayah)


@router.get("/zonasi/{zonasi_id}", response_model=ZonasiResponse)
def zonasi_detail(zonasi_id: int, db: Session = Depends(get_db)):
    zonasi = get_zonasi_by_id(db, zonasi_id)
    if not zonasi:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="data zonasi tidak ditemukan"
        )
    return zonasi


@router.get("/map/schools", response_model=list[SchoolMapResponse])
def map_schools(
    jenjang: Optional[str] = Query(default=None),
    kecamatan: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    nama: Optional[str] = Query(default=None),
    db: Session = Depends(get_db)
):
    schools = get_schools(
        db,
        jenjang=jenjang,
        kecamatan=kecamatan,
        status=status_filter,
        nama=nama
    )
    return schools


@router.get("/map/zonasi", response_model=list[ZonasiResponse])
def map_zonasi(
    jenjang: Optional[str] = Query(default=None),
    wilayah: Optional[str] = Query(default=None),
    db: Session = Depends(get_db)
):
    return get_zonasi(db, jenjang=jenjang, wilayah=wilayah)

# ──────────────────────────────────────────────
# SCHOOL — Create (Admin only)
# ──────────────────────────────────────────────
@router.post("/schools", response_model=dict, status_code=201)
def create_school_endpoint(data: "SchoolCreate", db: "Session" = Depends(get_db)):
    school = create_school(db, data)
    return {"message": "Sekolah berhasil ditambahkan", "sekolah_id": school.sekolah_id}
 
 
# ──────────────────────────────────────────────
# SCHOOL — Update (Admin atau Operator sekolah sendiri)
# ──────────────────────────────────────────────
@router.put("/schools/{school_id}", response_model=SchoolResponse)
def update_school_endpoint(
    school_id: int,
    data: "SchoolUpdate",
    db: "Session" = Depends(get_db),
):
    school = update_school(db, school_id, data)
    if not school:
        raise HTTPException(status_code=404, detail="Sekolah tidak ditemukan")
    return school
 
 
# ──────────────────────────────────────────────
# SCHOOL — Delete (Admin only)
# ──────────────────────────────────────────────
@router.delete("/schools/{school_id}", response_model=dict)
def delete_school_endpoint(school_id: int, db: "Session" = Depends(get_db)):
    deleted = delete_school(db, school_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Sekolah tidak ditemukan")
    return {"message": "Sekolah berhasil dihapus"}
 
 
# ──────────────────────────────────────────────
# ZONASI — Create
# ──────────────────────────────────────────────
@router.post("/zonasi", response_model=dict, status_code=201)
def create_zonasi_endpoint(data: "ZonasiCreate", db: "Session" = Depends(get_db)):
    z = create_zonasi(db, data)
    return {"message": "Zonasi berhasil ditambahkan", "zonasi_id": z.zonasi_id}
 
 
# ──────────────────────────────────────────────
# ZONASI — Update
# ──────────────────────────────────────────────
@router.put("/zonasi/{zonasi_id}", response_model=ZonasiResponse)
def update_zonasi_endpoint(zonasi_id: int, data: "ZonasiUpdate", db: "Session" = Depends(get_db)):
    z = update_zonasi(db, zonasi_id, data)
    if not z:
        raise HTTPException(status_code=404, detail="Zonasi tidak ditemukan")
    return z
 
 
# ──────────────────────────────────────────────
# ZONASI — Delete
# ──────────────────────────────────────────────
@router.delete("/zonasi/{zonasi_id}", response_model=dict)
def delete_zonasi_endpoint(zonasi_id: int, db: "Session" = Depends(get_db)):
    deleted = delete_zonasi(db, zonasi_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Zonasi tidak ditemukan")
    return {"message": "Zonasi berhasil dihapus"}
 
 
# ──────────────────────────────────────────────
# OPERATOR — Ambil sekolah afiliasi sendiri
# Header: X-User-Id: <user_id>
# ──────────────────────────────────────────────
@router.get("/operator/my-school", response_model=SchoolResponse)
def get_my_school(
    x_user_id: int = Header(..., alias="X-User-Id"),
    db: "Session" = Depends(get_db),
):
    school = get_school_by_user(db, x_user_id)
    if not school:
        raise HTTPException(
            status_code=404,
            detail="Sekolah afiliasi tidak ditemukan. Hubungi admin untuk mengaitkan akun."
        )
    return school