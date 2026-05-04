import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text


BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_JSON_PATH = Path(__file__).resolve().parent / "output.json"


def normalize_status(status):
    if not status:
        return "Tidak diketahui"

    value = str(status).strip().upper()
    if value == "N":
        return "Negeri"
    if value == "S":
        return "Swasta"
    return str(status).strip()


def clean_text(value, default="-"):
    if value is None:
        return default

    cleaned = str(value).strip()
    return cleaned if cleaned else default


def load_schools(json_path):
    with json_path.open("r", encoding="utf-8") as file:
        payload = json.load(file)

    schools = payload.get("data", [])
    if not isinstance(schools, list):
        raise ValueError("Format output.json tidak valid: key 'data' harus berupa list")

    return schools


def insert_schools(engine, schools, truncate=False):
    insert_query = text("""
        INSERT INTO sekolah (
            nama_sekolah,
            npsn,
            jenjang,
            alamat,
            kecamatan,
            latitude,
            longitude,
            location,
            kuota,
            daya_tampung,
            status,
            akreditasi
        )
        SELECT
            :nama_sekolah,
            :npsn,
            :jenjang,
            :alamat,
            :kecamatan,
            :latitude,
            :longitude,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
            :kuota,
            :daya_tampung,
            :status,
            :akreditasi
        WHERE NOT EXISTS (
            SELECT 1
            FROM sekolah
            WHERE nama_sekolah = :nama_sekolah
              AND jenjang = :jenjang
              AND alamat = :alamat
        )
    """)

    inserted = 0
    skipped = 0

    with engine.begin() as conn:
        if truncate:
            conn.execute(text("TRUNCATE TABLE sekolah RESTART IDENTITY"))

        for school in schools:
            latitude = school.get("lang")
            longitude = school.get("long")

            if latitude is None or longitude is None:
                skipped += 1
                continue

            params = {
                "nama_sekolah": clean_text(school.get("name")),
                "npsn": clean_text(school.get("npsn")),
                "jenjang": clean_text(school.get("grade")),
                "alamat": clean_text(school.get("address")),
                "kecamatan": clean_text(school.get("district_name")),
                "latitude": latitude,
                "longitude": longitude,
                "kuota": 0,
                "daya_tampung": 0,
                "status": normalize_status(school.get("status")),
                "akreditasi": clean_text(school.get("accreditation")),
            }

            result = conn.execute(insert_query, params)
            if result.rowcount:
                inserted += 1
            else:
                skipped += 1

    return inserted, skipped


def main():
    parser = argparse.ArgumentParser(
        description="Import data sekolah dari output.json ke tabel sekolah."
    )
    parser.add_argument(
        "--json",
        default=str(DEFAULT_JSON_PATH),
        help="Path file JSON sekolah. Default: migrations/output.json",
    )
    parser.add_argument(
        "--truncate",
        action="store_true",
        help="Kosongkan tabel sekolah dulu sebelum import.",
    )
    args = parser.parse_args()

    load_dotenv(BASE_DIR / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL tidak ditemukan di file .env")

    json_path = Path(args.json)
    schools = load_schools(json_path)
    engine = create_engine(database_url)
    inserted, skipped = insert_schools(engine, schools, truncate=args.truncate)

    print(f"Total data JSON: {len(schools)}")
    print(f"Berhasil insert: {inserted}")
    print(f"Dilewati: {skipped}")


if __name__ == "__main__":
    main()
