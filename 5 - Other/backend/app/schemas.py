from pydantic import BaseModel


class RegisterSchema(BaseModel):
    username: str
    email: str
    password: str
    role: str = "user"

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
