/**
 * utils.js — Fungsi utilitas murni (pure functions)
 */

/** Haversine: jarak dua koordinat dalam km */
export function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Klasifikasi warna marker:
 *   green  = dalam radius
 *   yellow = 1–3 km di luar radius
 *   red    = lebih dari radius+3 km
 */
export function classifyDistance(distance, radius) {
  if (distance <= radius)     return 'green';
  if (distance <= radius + 3) return 'yellow';
  return 'red';
}

/** Format jarak ke string */
export function formatDist(km) {
  if (km === null || km === undefined) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** Debounce */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** Ambil kecamatan unik dari array sekolah */
export function uniqueKecamatan(schools) {
  return [...new Set(schools.map(s => s.kecamatan).filter(Boolean))].sort();
}

/** Filter sekolah berdasarkan nama, kategori, biaya */
export function filterSchools(schools, { nama = '', kat = '', biayaMax = '', akreditasi='' } = {}) {
  return schools.filter(s => {
    const okNama = !nama || s.nama.toLowerCase().includes(nama.toLowerCase());
    const okKat  = !kat  || s.nama.toUpperCase().startsWith(kat);
    const okAkr  = !akreditasi || s.akreditasi === akreditasi;
    const okBiaya = !biayaMax || s.biaya <= biayaMax;
    return okNama && okKat && okAkr && okBiaya;
  });
}

/** Fungsi Sort Jarak */
export function sortByDistance(schools, userLoc) {
  if (!userLoc) return schools;
  return [...schools].sort((a, b) => {
    const distA = haversineDistance(userLoc.lat, userLoc.lng, a.lat, a.lng);
    const distB = haversineDistance(userLoc.lat, userLoc.lng, b.lat, b.lng);
    return distA - distB;
  });
}

/** Pagination: ambil slice sesuai halaman */
export function paginate(arr, page, perPage = 5) {
  const total = Math.ceil(arr.length / perPage) || 1;
  const p = Math.max(1, Math.min(page, total));
  return {
    items: arr.slice((p - 1) * perPage, p * perPage),
    page: p,
    total,
  };
}

/* ══════════════════════════════════════════════════════
   JENJANG HELPERS
   Dipindah ke utils.js agar bisa diimport dari ui.js & map.js
   tanpa circular dependency
══════════════════════════════════════════════════════ */

/** Deteksi jenjang dari nama sekolah */
export function detectJenjang(nama = '') {
  const n = nama.toUpperCase();
  if (/SMK|SMKN/.test(n))                      return 'smk';
  if (/SMA|SMAN|MA|MADRASAH ALIYAH/.test(n))  return 'sma';
  if (/SMP|SMPN|MTS|TSANAWIYAH/.test(n))      return 'smp';
  if (/SD|SDN|MI|MADRASAH IBTIDAIYAH/.test(n)) return 'sd';
  return 'other';
}

/** Konfigurasi warna & label tiap jenjang */
export const JENJANG_CFG = {
  sd:    { color: '#1565C0', label: 'SD / MI',   dot: '🔵' },
  smp:   { color: '#2e7d32', label: 'SMP / MTs', dot: '🟢' },
  sma:   { color: '#c62828', label: 'SMA / MA',  dot: '🔴' },
  smk:   { color: '#6a1b9a', label: 'SMK',       dot: '🟣' },
  other: { color: '#546e7a', label: 'Lainnya',   dot: '⚫' },
};
