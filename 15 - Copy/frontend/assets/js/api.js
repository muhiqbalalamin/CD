/**
 * api.js — Integrasi API
 * Fetch data dari endpoint, fallback ke data lokal jika gagal.
 */

const API_URL = 'http://localhost:8000/map/schools';

export function normalize(raw) {
  return {
    // Sesuaikan mapping dengan SchoolMapResponse di backend
    id:         raw.sekolah_id ?? Math.random(),
    nama:       raw.nama_sekolah ?? 'Tanpa Nama',
    kecamatan:  raw.kecamatan ?? '',
    lat:        parseFloat(raw.latitude ?? 0),
    lng:        parseFloat(raw.longitude ?? 0),
    status:     raw.status ?? '',
    akreditasi: raw.akreditasi ?? '-', 
    pendaftar:  raw.daya_tampung ?? 0, 
    kuota:      raw.kuota ?? 0,
    alamat:     raw.alamat ?? '-',
    jenjang:    raw.jenjang ?? '',
    npsn:       raw.npsn ?? '',
  };
}

/**
 * toBackendSchema — konversi objek frontend ke payload backend.
 * Frontend pakai: { nama, lat, lng, pendaftar, ... }
 * Backend pakai:  { nama_sekolah, latitude, longitude, daya_tampung, ... }
 */
export function toBackendSchema(data) {
  const payload = {
    nama_sekolah: data.nama    ?? data.nama_sekolah,
    jenjang:      data.jenjang,
    alamat:       data.alamat,
    kecamatan:    data.kecamatan,
    latitude:     data.lat     ?? data.latitude,
    longitude:    data.lng     ?? data.longitude,
    kuota:        data.kuota   != null ? Number(data.kuota)     : null,
    daya_tampung: data.pendaftar != null ? Number(data.pendaftar) : null,
    status:       data.status,
    akreditasi:   data.akreditasi,
  };
  // Only include npsn if it has a real value — avoids unique constraint on null
  const npsn = (data.npsn || '').trim();
  if (npsn) payload.npsn = npsn;
  return payload;
}

/* Fallback data — sekolah di Jawa Barat */
const FALLBACK = [
  { id:1,  nama:'SD 612 Bandung',     kecamatan:'Coblong',      lat:-6.8942, lng:107.6098, akreditasi:'A', pendaftar:251, kuota:300, biaya:13000000, spp:200000, alamat:'Jl. Bandung 9...' },
  { id:2,  nama:'SMA 231 Bekasi',     kecamatan:'Bekasi Utara', lat:-6.2349, lng:106.9925, akreditasi:'B', pendaftar:455, kuota:500, biaya:12000000, spp:300000, alamat:'Jl. Bekasi 12...' },
  { id:3,  nama:'SMP 415 Bandung',    kecamatan:'Antapani',     lat:-6.9175, lng:107.6653, akreditasi:'A', pendaftar:231, kuota:400, biaya:15000000, spp:100000, alamat:'Jl. Bandung 12...' },
  { id:4,  nama:'SDN 921 Depok',      kecamatan:'Depok',        lat:-6.4025, lng:106.7942, akreditasi:'C', pendaftar:312, kuota:400, biaya:16000000, spp:400000, alamat:'Jl. Depok 3...' },
  { id:5,  nama:'SMAN 1 Bandung',     kecamatan:'Sumur Bandung', lat:-6.9147, lng:107.6098, akreditasi:'A', pendaftar:251, kuota:300, biaya:18000000, spp:200000, alamat:'Jl. Ir. H. Juanda...' },
  { id:6,  nama:'SMPN 5 Bogor',       kecamatan:'Bogor Tengah', lat:-6.5944, lng:106.7892, akreditasi:'B', pendaftar:298, kuota:300, biaya:19000000, spp:300000, alamat:'Jl. Paledang...' },
  { id:7,  nama:'SDN Sukajadi',       kecamatan:'Sukajadi',     lat:-6.8872, lng:107.5892, akreditasi:'A', pendaftar:157, kuota:200, biaya:500000, spp:100000, alamat:'Jl. Sukajadi...' },
  { id:8,  nama:'SMKN 4 Bandung',     kecamatan:'Buah Batu',    lat:-6.9408, lng:107.6380, akreditasi:'A', pendaftar:350, kuota:350, biaya:12000000, spp:2000000, alamat:'Jl. Kliningan...' },
  { id:9,  nama:'SMA Pasundan Bekasi',kecamatan:'Bekasi Selatan',lat:-6.2702, lng:106.9942, akreditasi:'B', pendaftar:284, kuota:300, biaya:13000000, spp:100000, alamat:'Jl. Veteran...' },
  { id:10, nama:'SDN Dago',           kecamatan:'Coblong',      lat:-6.8794, lng:107.6147, akreditasi:'A', pendaftar:295, kuota:400, biaya:500000, spp:200000, alamat:'Jl. Dago...' },
  { id:11, nama:'SMPN 2 Cimahi',      kecamatan:'Cimahi Tengah',lat:-6.8703, lng:107.5422, akreditasi:'B', pendaftar:265, kuota:300, biaya:1500000, spp:250000, alamat:'Jl. Cimahi...' },
  { id:12, nama:'SMAN 3 Bogor',       kecamatan:'Bogor Barat',  lat:-6.5893, lng:106.7541, akreditasi:'A', pendaftar:310, kuota:400, biaya:500000, spp:300000, alamat:'Jl. Pajajaran...' },
  { id:13, nama:'SDN Cicendo',        kecamatan:'Cicendo',      lat:-6.9103, lng:107.5874, akreditasi:'B', pendaftar:178, kuota:300, biaya:5000000, spp:500000, alamat:'Jl. Cicendo...' },
  { id:14, nama:'SMKN 1 Depok',       kecamatan:'Pancoran Mas', lat:-6.3987, lng:106.8192, akreditasi:'A', pendaftar:247, kuota:300, biaya:10000000, spp:650000, alamat:'Jl. Nusantara...' },
  { id:15, nama:'SDN Cibeunying',     kecamatan:'Cibeunying',   lat:-6.9023, lng:107.6289, akreditasi:'C', pendaftar:155, kuota:300, biaya:1050000, spp:200000, alamat:'Jl. Cibeunying...' },
];

export async function fetchSekolah() {
  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 5000);
    const res  = await fetch(API_URL, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const raw  = Array.isArray(json) ? json : (json.data ?? []);
    return { data: raw.map(normalize), fromFallback: false };
  } catch (err) {
    console.warn('[API] Menggunakan data fallback karena:', err.message);
    return { data: FALLBACK, fromFallback: true };
  }
}

// 18-04-2026
const AUTH_URL = 'http://localhost:8000/auth';

export async function registerUser(username, email, password, role, admin_code, operator_code, npsn) {
  const response = await fetch(`${AUTH_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, role, admin_code, operator_code, npsn})
  });
  
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || 'Registrasi gagal');
  return result;
}

export async function loginUser(email, password) {
  try {
    const response = await fetch(`${AUTH_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error('Server tidak merespon dengan benar');
    }

      if (!response.ok) throw new Error(result.detail || 'Email atau password salah');

    localStorage.setItem('user_session', JSON.stringify(result));
    return result;

  } catch (err) {
    //  handle network error
    if (err.message === 'Failed to fetch') {
      throw new Error('Tidak bisa terhubung ke server');
    }
    throw err;
  }
}

const SCHOOL_URL = 'http://localhost:8000/schools';

export async function createSchool(data) {
  const res = await fetch(SCHOOL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || 'Gagal menambahkan sekolah');
  return json;
}

export async function updateSchool(id, data) {
  const res = await fetch(`${SCHOOL_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || 'Gagal memperbarui sekolah');
  return json;
}

export async function deleteSchool(id) {
  const res = await fetch(`${SCHOOL_URL}/${id}`, { method: 'DELETE' });
  if (!res.ok) { const j = await res.json(); throw new Error(j.detail || 'Gagal menghapus'); }
  return true;
}

export async function getMySchool(userId) {
  const res = await fetch('http://localhost:8000/operator/my-school', {
    headers: { 'X-User-Id': userId }
  });
  if (!res.ok) return null;
  return res.json();
}

/* ── Users API (Admin only) ─────────────────────── */
export async function fetchUsers() {
  try {
    const res = await fetch('http://localhost:8000/users');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[API] fetchUsers gagal:', err.message);
    return null; // null signals network failure
  }
}
const ZONASI_URL = 'http://localhost:8000/zonasi';

export async function fetchZonasi() {
  try {
    const res = await fetch(ZONASI_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn('[API] fetchZonasi gagal:', err.message);
    return [];
  }
}

export async function createZonasi(data) {
  const res = await fetch(ZONASI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || 'Gagal menambahkan zonasi');
  return json;
}

export async function updateZonasi(id, data) {
  const res = await fetch(`${ZONASI_URL}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || 'Gagal memperbarui zonasi');
  return json;
}

export async function deleteZonasi(id) {
  const res = await fetch(`${ZONASI_URL}/${id}`, { method: 'DELETE' });
  if (!res.ok) { const j = await res.json(); throw new Error(j.detail || 'Gagal menghapus zonasi'); }
  return true;
}

export async function logoutUser(userId) {
  try {
    await fetch(`${AUTH_URL}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });
  } catch (err) {
    console.warn('[API] Logout gagal:', err.message);
  } finally {
    localStorage.removeItem('user_session');
  }
}