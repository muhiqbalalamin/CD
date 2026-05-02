from sqlalchemy import Column, Float, ForeignKey, Integer, String, TIMESTAMP
from datetime import datetime
from .db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True)
    email = Column(String, unique=True)
    password_hash = Column(String)
    role = Column(String, default="user")
    school_id = Column(Integer, ForeignKey("sekolah.sekolah_id"), nullable=True)
    created_at = Column(TIMESTAMP, default=datetime.utcnow)
    is_online     = Column(Integer, default=0)  # 0 = non-aktif, 1 = aktif


# ── Profil data untuk user umum ─────────────────────────────────
class UserProfile(Base):
    __tablename__ = "user_profiles"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    nama        = Column(String, nullable=True)
    telepon     = Column(String, nullable=True)
    alamat      = Column(String, nullable=True)
    kota        = Column(String, nullable=True)
    nama_anak   = Column(String, nullable=True)
    jenjang_anak    = Column(String, nullable=True)
    sekolah_tujuan  = Column(String, nullable=True)
    updated_at  = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Profil data untuk admin ──────────────────────────────────────
class AdminProfile(Base):
    __tablename__ = "admin_profiles"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    nama        = Column(String, nullable=True)
    telepon     = Column(String, nullable=True)
    afiliasi    = Column(String, nullable=True)
    kode        = Column(String, nullable=True)
    updated_at  = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Profil data untuk operator sekolah ──────────────────────────
class OperatorProfile(Base):
    __tablename__ = "operator_profiles"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    nama        = Column(String, nullable=True)
    telepon     = Column(String, nullable=True)
    afiliasi    = Column(String, nullable=True)
    kode        = Column(String, nullable=True)
    updated_at  = Column(TIMESTAMP, default=datetime.utcnow, onupdate=datetime.utcnow)


class School(Base):
    __tablename__ = "sekolah"

    sekolah_id   = Column(Integer, primary_key=True, index=True)
    nama_sekolah = Column(String)
    npsn         = Column(String, index=True, nullable=True)  # unique enforced via DB partial index
    jenjang      = Column(String)
    alamat       = Column(String)
    kecamatan    = Column(String)
    latitude     = Column(Float)
    longitude    = Column(Float)
    kuota        = Column(Integer)
    daya_tampung = Column(Integer)
    status       = Column(String)
    akreditasi   = Column(String)


class Zonasi(Base):
    __tablename__ = "zonasi"

    zonasi_id = Column(Integer, primary_key=True, index=True)
    nama_zonasi = Column(String)
    radius_meter = Column(Float)
    wilayah = Column(String)
    keterangan = Column(String)
