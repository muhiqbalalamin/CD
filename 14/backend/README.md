# Backend PPDB GIS

Backend ini memakai FastAPI, PostgreSQL, dan PostGIS untuk menyimpan data sekolah serta menyediakan API untuk kebutuhan web GIS PPDB.

## Kebutuhan

Install aplikasi berikut:

- Python 3.10 atau lebih baru
- PostgreSQL
- PostGIS extension untuk PostgreSQL

Install package Python berikut:

```powershell
pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv bcrypt
```

## Setup Database

Buat database PostgreSQL terlebih dulu. Contoh:

```sql
CREATE DATABASE ppdb;
```

Pastikan user PostgreSQL yang dipakai punya akses ke database tersebut.

## Setup Environment

Buat file `.env` di root folder backend.

Contoh isi:

```env
DATABASE_URL="postgresql://postgres:password_database@localhost/ppdb"
```

Sesuaikan:

- `postgres` dengan username database
- `password_database` dengan password database
- `localhost` dengan host database
- `ppdb` dengan nama database

## Migrasi Database

Jalankan migrasi untuk membuat struktur tabel:

```powershell
psql -U postgres -d ppdb -f migrations/001_init_schema.sql
```

Jika `psql` tidak dikenali di terminal, tambahkan folder `bin` PostgreSQL ke PATH, atau jalankan perintah dari folder instalasi PostgreSQL.

Migrasi ini akan membuat:

- extension `postgis`
- tabel `users`
- tabel `sekolah`
- tabel `zonasi`
- index untuk kolom lokasi sekolah

## Import Data Sekolah

Data sekolah berada di:

```text
migrations/output.json
```

Untuk memasukkan data sekolah ke tabel `sekolah`:

```powershell
python migrations/import_schools_from_json.py
```

Jika ingin mengosongkan tabel `sekolah` dulu lalu import ulang dari awal:

```powershell
python migrations/import_schools_from_json.py --truncate
```

Script import akan:

- membaca data dari `output.json`
- mengisi tabel `sekolah`
- mengubah status `N` menjadi `Negeri`
- mengubah status `S` menjadi `Swasta`
- membuat kolom `location` PostGIS dari latitude dan longitude
- melewati data yang sudah pernah diinsert agar tidak dobel

## Menjalankan Backend

Jalankan server dari root folder backend:

```powershell
uvicorn app.main:app --reload   atau     python -m uvicorn app.main:app --reload
```

Backend akan berjalan di:

```text
http://127.0.0.1:8000
```

Swagger UI tersedia di:

```text
http://127.0.0.1:8000/docs
```

## Endpoint Yang Tersedia

Auth:

- `POST /auth/register`
- `POST /auth/login`

Sekolah:

- `GET /schools`
- `GET /schools/{school_id}`

Filter `GET /schools`:

- `jenjang`
- `kecamatan`
- `status`
- `nama`

Contoh:

```text
GET /schools?jenjang=SMA&status=Negeri
GET /schools?kecamatan=Kec. Cibinong
GET /schools?nama=smp
```

Zonasi:

- `GET /zonasi`
- `GET /zonasi/{zonasi_id}`

Map:

- `GET /map/schools`
- `GET /map/zonasi`

## Catatan

- Tabel `zonasi` saat ini sengaja dikosongkan datanya.
- Tabel `lokasi_pengguna` tidak digunakan karena lokasi user akan dikirim langsung dari device atau input manual.
- Endpoint routing jalan nyata belum dibuat karena perlu layanan routing seperti OSRM, GraphHopper, Mapbox Directions API, atau Google Directions API.
- File `.env` jangan dimasukkan ke repository publik karena berisi kredensial database.
