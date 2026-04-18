from sqlalchemy import Column, Float, Integer, String, TIMESTAMP
from datetime import datetime
from .db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True)
    email = Column(String, unique=True)
    password_hash = Column(String)
    role = Column(String, default="user")
    created_at = Column(TIMESTAMP, default=datetime.utcnow)


class School(Base):
    __tablename__ = "sekolah"

    sekolah_id = Column(Integer, primary_key=True, index=True)
    nama_sekolah = Column(String)
    jenjang = Column(String)
    alamat = Column(String)
    kecamatan = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    kuota = Column(Integer)
    daya_tampung = Column(Integer)
    status = Column(String)
    akreditasi = Column(String)


class Zonasi(Base):
    __tablename__ = "zonasi"

    zonasi_id = Column(Integer, primary_key=True, index=True)
    nama_zonasi = Column(String)
    radius_meter = Column(Float)
    wilayah = Column(String)
    keterangan = Column(String)
