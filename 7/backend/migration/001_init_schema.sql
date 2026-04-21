CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sekolah (
    sekolah_id SERIAL PRIMARY KEY,
    nama_sekolah TEXT NOT NULL,
    npsn INT NOT NULL DEFAULT 0,
    jenjang TEXT NOT NULL,
    alamat TEXT NOT NULL,
    kecamatan TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    location GEOGRAPHY(POINT, 4326) NOT NULL,
    kuota INT NOT NULL DEFAULT 0,
    daya_tampung INT NOT NULL DEFAULT 0,
    akreditasi TEXT NOT NULL,
    status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zonasi (
    zonasi_id SERIAL PRIMARY KEY,
    nama_zonasi TEXT NOT NULL,
    radius_meter DOUBLE PRECISION NOT NULL,
    wilayah TEXT NOT NULL,
    keterangan TEXT
);

CREATE INDEX IF NOT EXISTS idx_sekolah_location
    ON sekolah
    USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_zonasi_nama_zonasi
    ON zonasi (nama_zonasi);
