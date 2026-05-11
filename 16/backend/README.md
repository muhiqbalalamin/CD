# Backend PPDB GIS (15 - Batasan)

Backend ini memakai FastAPI + PostgreSQL + PostGIS.

Struktur operasional final:
- 1 file SQL migrasi: `migration/001_bootstrap_schema.sql`
- 2 file import:
  - `import_batasan_geojson.py`
  - `import_sekolah_json.py`

## Prasyarat

- Python 3.10+
- PostgreSQL
- PostGIS extension

Install dependency Python:

```powershell
pip install fastapi uvicorn sqlalchemy psycopg2-binary python-dotenv bcrypt
```

## Setup `.env`

Buat file `.env` di root project `15 - Batasan` (satu level di atas folder `backend`):

```env
DATABASE_URL='postgresql://postgres:password@localhost/ppdb'
```

## 1) Jalankan Migrasi SQL (Idempotent)

Migrasi utama:

```powershell
psql -U postgres -d ppdb -f backend/migration/001_bootstrap_schema.sql
```

Catatan:
- Aman dijalankan berulang.
- Akan skip object yang sudah ada.
- Mencakup tabel: `users`, `sekolah`, `zonasi`, `batasan_wilayah`, `user_profiles`, `admin_profiles`, `operator_profiles`.

## 2) Import Batasan Wilayah (GeoJSON)

File sumber default:
- `backend/migration/Salinan Jawa_Barat_Kecamatan_Only_4326.geojson`

Jalankan:

```powershell
python backend/import_batasan_geojson.py
```

Perilaku:
- `TRUNCATE TABLE batasan_wilayah RESTART IDENTITY`
- Import ulang semua feature
- Geometry dinormalisasi ke 2D (drop Z), SRID 4326, disimpan sebagai MultiPolygon.

Contoh output:

```text
GeoJSON      : Salinan Jawa_Barat_Kecamatan_Only_4326.geojson
Total feature: 580
Inserted     : 580
Skipped      : 0
```

## 3) Import Data Sekolah (2rb / 75rb)

Dataset tersedia:
- 2rb: `backend/migration/output.json`
- 75rb: `backend/migration/sekolah_jabar_tanpa_tk75rb.json`

Jalankan interaktif:

```powershell
python backend/import_sekolah_json.py
```

Atau langsung via argumen:

```powershell
python backend/import_sekolah_json.py --dataset 2rb
python backend/import_sekolah_json.py --dataset 75rb
```

Perilaku:
- `TRUNCATE TABLE sekolah RESTART IDENTITY`
- Isi ulang tabel berdasarkan dataset pilihan
- Skip baris tanpa lat/lng valid
- Kolom `location` diisi dari `longitude/latitude`.

Contoh output:

```text
Dataset      : output.json
Total JSON   : 2000
Inserted     : 2000
Skipped      : 0
```

## Menjalankan Backend

```powershell
uvicorn backend.app.main:app --reload
```

Endpoint:
- API base: `http://127.0.0.1:8000`
- Swagger: `http://127.0.0.1:8000/docs`

## Troubleshooting

- `DATABASE_URL tidak ditemukan`:
  - Pastikan `.env` ada di root `15 - Batasan`.
- `psql command not found`:
  - Tambahkan PostgreSQL `bin` ke PATH.
- Error PostGIS (`type geography does not exist`):
  - Pastikan `CREATE EXTENSION postgis` berhasil.
- Error geometry Z-dimension:
  - Gunakan script `import_batasan_geojson.py` ini (sudah force 2D).
