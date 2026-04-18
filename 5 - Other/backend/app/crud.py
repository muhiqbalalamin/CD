from sqlalchemy.orm import Session
from .models import School, User, Zonasi
from .utils import hash_password, verify_password


class UserAlreadyExistsError(Exception):
    pass


def create_user(db: Session, username, email, password, role="user"):
    existing_username = db.query(User).filter(User.username == username).first()
    if existing_username:
        raise UserAlreadyExistsError("username sudah digunakan")

    existing_email = db.query(User).filter(User.email == email).first()
    if existing_email:
        raise UserAlreadyExistsError("email sudah digunakan")

    hashed = hash_password(password)

    user = User(
        username=username,
        email=email,
        password_hash=hashed,
        role=role
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


def authenticate_user(db: Session, email, password):
    user = db.query(User).filter(User.email == email).first()

    if not user:
        return None

    if not verify_password(password, user.password_hash):
        return None
    return user


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
