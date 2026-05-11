CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS sekolah (
    sekolah_id SERIAL PRIMARY KEY,
    nama_sekolah TEXT NOT NULL,
    npsn TEXT,
    jenjang TEXT,
    alamat TEXT,
    kecamatan TEXT,
    kabupaten TEXT,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location GEOGRAPHY(POINT, 4326),
    kuota INTEGER DEFAULT 0,
    daya_tampung INTEGER DEFAULT 0,
    status TEXT,
    akreditasi TEXT
);

ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS npsn TEXT;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS jenjang TEXT;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS alamat TEXT;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS kecamatan TEXT;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS kabupaten TEXT;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS kuota INTEGER DEFAULT 0;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS daya_tampung INTEGER DEFAULT 0;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE sekolah ADD COLUMN IF NOT EXISTS akreditasi TEXT;

CREATE TABLE IF NOT EXISTS zonasi (
    zonasi_id SERIAL PRIMARY KEY,
    nama_zonasi TEXT NOT NULL,
    radius_meter DOUBLE PRECISION,
    wilayah TEXT,
    keterangan TEXT
);

ALTER TABLE zonasi ADD COLUMN IF NOT EXISTS nama_zonasi TEXT;
ALTER TABLE zonasi ADD COLUMN IF NOT EXISTS radius_meter DOUBLE PRECISION;
ALTER TABLE zonasi ADD COLUMN IF NOT EXISTS wilayah TEXT;
ALTER TABLE zonasi ADD COLUMN IF NOT EXISTS keterangan TEXT;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    school_id INTEGER,
    is_online INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_online INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS user_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    nama TEXT,
    telepon TEXT,
    alamat TEXT,
    home_lat FLOAT,
    home_lng FLOAT,
    kota TEXT,
    nama_anak TEXT,
    jenjang_anak TEXT,
    sekolah_tujuan TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    nama TEXT,
    telepon TEXT,
    afiliasi TEXT,
    kode TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS operator_profiles (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    nama TEXT,
    telepon TEXT,
    afiliasi TEXT,
    kode TEXT,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS batasan_wilayah (
    boundary_id SERIAL PRIMARY KEY,
    nama_zonasi TEXT,
    radius_meter DOUBLE PRECISION,
    wilayah TEXT,
    keterangan TEXT,
    objectid INTEGER,
    fcode TEXT,
    remark TEXT,
    metadata TEXT,
    srs_id TEXT,
    kode_kecamatan TEXT,
    kode_desa TEXT,
    kode_kabupaten TEXT,
    kode_provinsi TEXT,
    nama_kecamatan TEXT,
    nama_desa TEXT,
    nama_kabupaten TEXT,
    nama_provinsi TEXT,
    tipadm INTEGER,
    luaswh DOUBLE PRECISION,
    uupp TEXT,
    shape_length DOUBLE PRECISION,
    shape_area DOUBLE PRECISION,
    geom GEOMETRY(MULTIPOLYGON, 4326)
);

ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS nama_zonasi TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS radius_meter DOUBLE PRECISION;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS wilayah TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS keterangan TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS objectid INTEGER;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS fcode TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS metadata TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS srs_id TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS kode_kecamatan TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS kode_desa TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS kode_kabupaten TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS kode_provinsi TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS nama_kecamatan TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS nama_desa TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS nama_kabupaten TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS nama_provinsi TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS tipadm INTEGER;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS luaswh DOUBLE PRECISION;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS uupp TEXT;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS shape_length DOUBLE PRECISION;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS shape_area DOUBLE PRECISION;
ALTER TABLE batasan_wilayah ADD COLUMN IF NOT EXISTS geom GEOMETRY(MULTIPOLYGON, 4326);

CREATE INDEX IF NOT EXISTS idx_sekolah_location ON sekolah USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_sekolah_npsn ON sekolah (npsn);
CREATE INDEX IF NOT EXISTS idx_sekolah_kecamatan ON sekolah (kecamatan);
CREATE INDEX IF NOT EXISTS idx_zonasi_nama_zonasi ON zonasi (nama_zonasi);
CREATE INDEX IF NOT EXISTS idx_batasan_wilayah_geom ON batasan_wilayah USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_batasan_nama_kecamatan ON batasan_wilayah (nama_kecamatan);
CREATE INDEX IF NOT EXISTS idx_batasan_kode_kecamatan ON batasan_wilayah (kode_kecamatan);
