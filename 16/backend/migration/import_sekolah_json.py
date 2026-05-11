import argparse
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text


MIGRATION_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MIGRATION_DIR.parent
DATASET_2RB = MIGRATION_DIR / "output.json"
DATASET_75RB = MIGRATION_DIR / "sekolah_jabar_tanpa_tk75rb.json"


def pick_dataset(choice: str | None) -> Path:
    if choice in {"2rb", "75rb"}:
        return DATASET_2RB if choice == "2rb" else DATASET_75RB

    print("Pilih dataset sekolah:")
    print("1. 2rb data (output.json)")
    print("2. 75rb data (sekolah_jabar_tanpa_tk75rb.json)")
    selected = input("Masukkan pilihan (1/2): ").strip()
    if selected == "2":
        return DATASET_75RB
    return DATASET_2RB


def load_json(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    if isinstance(payload, dict):
        data = payload.get("data", [])
    elif isinstance(payload, list):
        data = payload
    else:
        raise ValueError("Format JSON tidak didukung")
    if not isinstance(data, list):
        raise ValueError("Data JSON bukan list")
    return data


def normalize_status(status_value) -> str:
    value = str(status_value or "").strip().upper()
    if value == "N":
        return "Negeri"
    if value == "S":
        return "Swasta"
    return str(status_value or "Tidak diketahui").strip() or "Tidak diketahui"


def as_text(value, default="-") -> str:
    text_value = str(value or "").strip()
    return text_value if text_value else default


def as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def import_sekolah(database_url: str, items: list[dict]) -> tuple[int, int]:
    engine = create_engine(database_url)
    inserted = 0
    skipped = 0

    insert_sql = text(
        """
        INSERT INTO sekolah (
            nama_sekolah, npsn, jenjang, alamat, kecamatan, kabupaten,
            latitude, longitude, location, kuota, daya_tampung, status, akreditasi
        )
        VALUES (
            :nama_sekolah, :npsn, :jenjang, :alamat, :kecamatan, :kabupaten,
            :latitude, :longitude,
            ST_SetSRID(ST_MakePoint(:longitude, :latitude), 4326)::geography,
            :kuota, :daya_tampung, :status, :akreditasi
        )
        """
    )

    with engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE sekolah RESTART IDENTITY"))
        for row in items:
            lat = as_float(row.get("lang"))
            lng = as_float(row.get("long"))
            if lat is None or lng is None:
                skipped += 1
                continue

            params = {
                "nama_sekolah": as_text(row.get("name")),
                "npsn": as_text(row.get("npsn"), default=""),
                "jenjang": as_text(row.get("grade"), default=""),
                "alamat": as_text(row.get("address")),
                "kecamatan": as_text(row.get("district_name")),
                "kabupaten": as_text(row.get("regency_name")),
                "latitude": lat,
                "longitude": lng,
                "kuota": 0,
                "daya_tampung": 0,
                "status": normalize_status(row.get("status")),
                "akreditasi": as_text(row.get("accreditation"), default="-"),
            }
            conn.execute(insert_sql, params)
            inserted += 1

    return inserted, skipped


def main():
    parser = argparse.ArgumentParser(description="Import data sekolah (2rb/75rb) ke tabel sekolah.")
    parser.add_argument("--dataset", choices=["2rb", "75rb"], help="Pilih dataset: 2rb atau 75rb.")
    args = parser.parse_args()

    load_dotenv(BACKEND_DIR.parent / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL tidak ditemukan di .env")

    dataset_path = pick_dataset(args.dataset)
    if not dataset_path.exists():
        raise FileNotFoundError(f"File dataset tidak ditemukan: {dataset_path}")

    items = load_json(dataset_path)
    inserted, skipped = import_sekolah(database_url, items)

    print(f"Dataset      : {dataset_path.name}")
    print(f"Total JSON   : {len(items)}")
    print(f"Inserted     : {inserted}")
    print(f"Skipped      : {skipped}")


if __name__ == "__main__":
    main()
