from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from .db import SessionLocal
from .schemas import (
    LoginSchema,
    RegisterSchema,
    SchoolMapResponse,
    SchoolResponse,
    ZonasiResponse,
)
from .crud import (
    UserAlreadyExistsError,
    authenticate_user,
    create_user,
    get_school_by_id,
    get_schools,
    get_zonasi,
    get_zonasi_by_id,
)

router = APIRouter()

# dependency DB
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Register
@router.post("/auth/register")
def register(data: RegisterSchema, db: Session = Depends(get_db)):
    try:
        user = create_user(db, data.username, data.email, data.password, data.role)
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
        "username": user.username,
        "email": user.email,
        "role": user.role
    }


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
