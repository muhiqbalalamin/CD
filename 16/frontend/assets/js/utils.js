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
/**
 * detectJenjang — klasifikasi berdasarkan 2-3 huruf pertama nama sekolah
 * atau field jenjang dari database (lebih akurat).
 * Prefix matching: 2 huruf → SD, MI, MT, MA | 3 huruf → SMP, SMA, SMK
 */
export function detectJenjang(nama = '', jenjangDB = '') {
  // Priority 1: gunakan kolom jenjang dari DB jika ada
  if (jenjangDB) {
    const j = jenjangDB.trim().toUpperCase();
    if (j.startsWith('SMK')) return 'smk';
    if (j.startsWith('SMA') || j === 'MA' || j.startsWith('MA ')) return 'sma';
    if (j.startsWith('SMP') || j === 'MTS' || j.startsWith('MTS') || j.startsWith('MT')) return 'smp';
    if (j.startsWith('SD')  || j === 'MI'  || j.startsWith('MI ') || j.startsWith('MIN') || j.startsWith('MIS')) return 'sd';
  }

  // Priority 2: prefix matching dari nama sekolah
  const raw = nama.trim().toUpperCase().replace(/^(SEKOLAH\s+)/, '');

  // 3-char prefixes (check first — more specific)
  const p3 = raw.slice(0, 3);
  if (p3 === 'SMK') return 'smk';
  if (p3 === 'SMA') return 'sma';
  if (p3 === 'SMP') return 'smp';

  // 2-char prefixes
  const p2 = raw.slice(0, 2);
  if (p2 === 'SD') return 'sd';
  if (p2 === 'MI') return 'sd';   // Madrasah Ibtidaiyah → setara SD
  if (p2 === 'MA') return 'sma';  // Madrasah Aliyah     → setara SMA
  if (p2 === 'MT') return 'smp';  // MTs                 → setara SMP

  // 4-char prefix for SMKN/SMPN/SMAN/SMAN/SDIT/SMPIT etc.
  const p4 = raw.slice(0, 4);
  if (p4 === 'SMKN' || p4 === 'SMKS') return 'smk';
  if (p4 === 'SMAN' || p4 === 'SMAS') return 'sma';
  if (p4 === 'SMPN' || p4 === 'SMPS') return 'smp';
  if (p4 === 'SDNI' || p4 === 'SDN ') return 'sd';

  // Fallback: keyword search
  const n = raw;
  if (n.includes('SMK') || n.includes('KEJURUAN'))   return 'smk';
  if (n.includes('SMA') || n.includes('ALIYAH'))     return 'sma';
  if (n.includes('SMP') || n.includes('TSANAWIYAH')) return 'smp';
  if (n.includes('SD') || n.includes('IBTIDAIYAH') || n.includes('DASAR')) return 'sd';

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
