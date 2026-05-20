import json
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text


MIGRATION_DIR = Path(__file__).resolve().parent
BACKEND_DIR = MIGRATION_DIR.parent
GEOJSON_PATH = MIGRATION_DIR / "Salinan Jawa_Barat_Kecamatan_Only_4326.geojson"


def as_text(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def as_float(value):
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def as_int(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def load_features(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, dict) or payload.get("type") != "FeatureCollection":
        raise ValueError("GeoJSON harus FeatureCollection")
    features = payload.get("features", [])
    if not isinstance(features, list):
        raise ValueError("GeoJSON features harus list")
    return features


def import_geojson(database_url: str, features: list[dict]) -> tuple[int, int]:
    engine = create_engine(database_url)
    inserted = 0
    skipped = 0

    insert_sql = text(
        """
        INSERT INTO batasan_wilayah (
            nama_zonasi, radius_meter, wilayah, keterangan, objectid, fcode, remark,
            metadata, srs_id, kode_kecamatan, kode_desa, kode_kabupaten, kode_provinsi,
            nama_kecamatan, nama_desa, nama_kabupaten, nama_provinsi,
            tipadm, luaswh, uupp, shape_length, shape_area, geom
        )
        VALUES (
            :nama_zonasi, :radius_meter, :wilayah, :keterangan, :objectid, :fcode, :remark,
            :metadata, :srs_id, :kode_kecamatan, :kode_desa, :kode_kabupaten, :kode_provinsi,
            :nama_kecamatan, :nama_desa, :nama_kabupaten, :nama_provinsi,
            :tipadm, :luaswh, :uupp, :shape_length, :shape_area,
            ST_Multi(ST_CollectionExtract(ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON(:geometry_json), 4326)), 3))
        )
        """
    )

    with engine.begin() as conn:
        conn.execute(text("TRUNCATE TABLE batasan_wilayah RESTART IDENTITY"))
        for feature in features:
            geometry = feature.get("geometry")
            if not geometry:
                skipped += 1
                continue
            props = feature.get("properties", {}) or {}
            params = {
                "nama_zonasi": as_text(props.get("WADMKC") or props.get("nama_kecamatan")),
                "radius_meter": as_float(props.get("radius_meter")),
                "wilayah": as_text(props.get("wilayah")),
                "keterangan": as_text(props.get("uupp") or props.get("keterangan")),
                "objectid": as_int(props.get("OBJECTID") or props.get("objectid")),
                "fcode": as_text(props.get("FCODE") or props.get("fcode")),
                "remark": as_text(props.get("REMARK") or props.get("remark")),
                "metadata": as_text(props.get("METADATA") or props.get("metadata")),
                "srs_id": as_text(props.get("SRS_ID") or props.get("srs_id")),
                "kode_kecamatan": as_text(props.get("KDCPUM") or props.get("kode_kecamatan")),
                "kode_desa": as_text(props.get("KDEPUM") or props.get("kode_desa")),
                "kode_kabupaten": as_text(props.get("KDPKAB") or props.get("kode_kabupaten")),
                "kode_provinsi": as_text(props.get("KDPPUM") or props.get("kode_provinsi")),
                "nama_kecamatan": as_text(props.get("WADMKC") or props.get("nama_kecamatan")),
                "nama_desa": as_text(props.get("WADMKD") or props.get("nama_desa")),
                "nama_kabupaten": as_text(props.get("WADMKK") or props.get("nama_kabupaten")),
                "nama_provinsi": as_text(props.get("WADMPR") or props.get("nama_provinsi")),
                "tipadm": as_int(props.get("TIPADM") or props.get("tipadm")),
                "luaswh": as_float(props.get("LUASWH") or props.get("luaswh")),
                "uupp": as_text(props.get("UUPP") or props.get("uupp")),
                "shape_length": as_float(props.get("Shape_Leng") or props.get("shape_length")),
                "shape_area": as_float(props.get("Shape_Area") or props.get("shape_area")),
                "geometry_json": json.dumps(geometry),
            }
            conn.execute(insert_sql, params)
            inserted += 1

    return inserted, skipped


def main():
    load_dotenv(BACKEND_DIR.parent / ".env")
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL tidak ditemukan di .env")
    if not GEOJSON_PATH.exists():
        raise FileNotFoundError(f"File GeoJSON tidak ditemukan: {GEOJSON_PATH}")

    features = load_features(GEOJSON_PATH)
    inserted, skipped = import_geojson(database_url, features)
    print(f"GeoJSON      : {GEOJSON_PATH.name}")
    print(f"Total feature: {len(features)}")
    print(f"Inserted     : {inserted}")
    print(f"Skipped      : {skipped}")


if __name__ == "__main__":
    main()
