from pydantic import BaseModel
from typing import Optional


class RegisterSchema(BaseModel):
    username: str
    email: str
    password: str
    role: str = "user"
    admin_code: Optional[str] = None
    operator_code: Optional[str] = None
    npsn: Optional[str] = None

class LoginSchema(BaseModel):
    email: str
    password: str


class SchoolResponse(BaseModel):
    sekolah_id: int
    nama_sekolah: str
    jenjang: str | None = None
    alamat: str | None = None
    kecamatan: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    kuota: int | None = None
    daya_tampung: int | None = None
    status: str | None = None
    akreditasi: str | None = None


class SchoolMapResponse(BaseModel):
    sekolah_id: int
    nama_sekolah: str
    jenjang: str | None = None
    kecamatan: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    status: str | None = None
    alamat: str | None = None
    kuota: int | None = None
    daya_tampung: int | None = None
    akreditasi: str | None = None


class ZonasiResponse(BaseModel):
    zonasi_id: int
    nama_zonasi: str
    radius_meter: float | None = None
    wilayah: str | None = None
    keterangan: str | None = None

# --- School CRUD schemas ---
class SchoolCreate(BaseModel):
    nama_sekolah: str
    npsn:         Optional[str] = None
    jenjang:      Optional[str] = None
    alamat:       Optional[str] = None
    kecamatan:    Optional[str] = None
    latitude:     Optional[float] = None
    longitude:    Optional[float] = None
    kuota:        Optional[int] = None
    daya_tampung: Optional[int] = None
    status:       Optional[str] = None   
    akreditasi:   Optional[str] = None
 
class SchoolUpdate(SchoolCreate):
    nama_sekolah: Optional[str] = None  
 
# --- Zonasi CRUD schemas ---
class ZonasiCreate(BaseModel):
    nama_zonasi:  str
    radius_meter: Optional[float] = None
    wilayah:      Optional[str]   = None
    keterangan:   Optional[str]   = None
 
class ZonasiUpdate(ZonasiCreate):
    nama_zonasi: Optional[str] = None
# ─── Profile schemas ────────────────────────────────────────────
class UserProfileSchema(BaseModel):
    nama:           Optional[str] = None
    telepon:        Optional[str] = None
    alamat:         Optional[str] = None
    kota:           Optional[str] = None
    nama_anak:      Optional[str] = None
    jenjang_anak:   Optional[str] = None
    sekolah_tujuan: Optional[str] = None

class StaffProfileSchema(BaseModel):
    nama:     Optional[str] = None
    telepon:  Optional[str] = None
    afiliasi: Optional[str] = None
    kode:     Optional[str] = None

class UserProfileResponse(UserProfileSchema):
    id:      int
    user_id: int
    class Config: from_attributes = True

class StaffProfileResponse(StaffProfileSchema):
    id:      int
    user_id: int
    class Config: from_attributes = True
