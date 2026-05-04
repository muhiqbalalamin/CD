/**
 * main.js — Entry Point & Orkestrator
 * Mengelola routing halaman, 2-step zonasi flow,
 * dan menghubungkan semua modul.
 */
import { fetchSekolah, registerUser, loginUser, logoutUser,   createSchool, updateSchool, deleteSchool, getMySchool, normalize, toBackendSchema, fetchZonasi, createZonasi, updateZonasi, deleteZonasi, fetchUsers } from './api.js';
import {
  initMapPage, renderMapMarkers, flyToOnMap,
  initZonasiPage, renderZonasiMarkers, flyToOnZonasi,
  setUserMarker, updateCircle, invalidateMaps,
  highlightZonasiMarker, unhighlightZonasiMarker, highlightMapMarker,
} from './map.js';
import {
  showToast, hideLoading, showLoading,
  setActiveNav, toggleSearchBar, updateUIForLoggedInUser, 
  renderHomeTable, renderFlatList,
} from './ui.js';
import {
  getSchools, setSchools, getUserLocation, setUserLocation,
  getRadius, setRadius,
} from './state.js';
import { filterSchools, paginate, debounce, haversineDistance, sortByDistance } from './utils.js';

// ── Pagination state ──
let _homePageNum   = 1;
let _mapPageNum    = 1;
let _zonasiPageNum = 1;
let _mapInitDone   = false;
let _zonasiInitDone= false;
let _mapFilterKat  = '';
let _mapFilterAkr  = '';
let _mapFilterNama = '';
let _mapFilterBiaya = '';
let _zonFilterKat  = '';

// ── Kota terpilih di tab kota ──
let _selectedKota  = null; // { name, lat, lng }

/* ══════════════════════════════════════════════════
   DATA KOTA / KABUPATEN JAWA BARAT
   Koordinat pusat tiap kota/kabupaten
══════════════════════════════════════════════════ */
const KOTA_JABAR = [
  { name: 'Kota Bandung',           lat: -6.9147,  lng: 107.6098 },
  { name: 'Kota Bekasi',            lat: -6.2349,  lng: 106.9925 },
  { name: 'Kota Bogor',             lat: -6.5971,  lng: 106.8060 },
  { name: 'Kota Depok',             lat: -6.4025,  lng: 106.7942 },
  { name: 'Kota Cimahi',            lat: -6.8703,  lng: 107.5422 },
  { name: 'Kota Tasikmalaya',       lat: -7.3274,  lng: 108.2207 },
  { name: 'Kota Cirebon',           lat: -6.7320,  lng: 108.5523 },
  { name: 'Kota Sukabumi',          lat: -6.9211,  lng: 106.9272 },
  { name: 'Kota Banjar',            lat: -7.3697,  lng: 108.5402 },
  { name: 'Kabupaten Bandung',      lat: -7.0510,  lng: 107.5608 },
  { name: 'Kabupaten Bandung Barat',lat: -6.8495,  lng: 107.4629 },
  { name: 'Kabupaten Bekasi',       lat: -6.3142,  lng: 107.1541 },
  { name: 'Kabupaten Bogor',        lat: -6.5975,  lng: 106.8360 },
  { name: 'Kabupaten Ciamis',       lat: -7.3296,  lng: 108.3523 },
  { name: 'Kabupaten Cianjur',      lat: -6.8201,  lng: 107.1386 },
  { name: 'Kabupaten Cirebon',      lat: -6.8129,  lng: 108.4533 },
  { name: 'Kabupaten Garut',        lat: -7.2268,  lng: 107.8990 },
  { name: 'Kabupaten Indramayu',    lat: -6.3270,  lng: 108.3247 },
  { name: 'Kabupaten Karawang',     lat: -6.3215,  lng: 107.3383 },
  { name: 'Kabupaten Kuningan',     lat: -6.9758,  lng: 108.4846 },
  { name: 'Kabupaten Majalengka',   lat: -6.8358,  lng: 108.2276 },
  { name: 'Kabupaten Pangandaran',  lat: -7.6882,  lng: 108.5001 },
  { name: 'Kabupaten Purwakarta',   lat: -6.5567,  lng: 107.4428 },
  { name: 'Kabupaten Subang',       lat: -6.5703,  lng: 107.7585 },
  { name: 'Kabupaten Sukabumi',     lat: -6.9211,  lng: 106.9272 },
  { name: 'Kabupaten Sumedang',     lat: -6.8579,  lng: 107.9237 },
  { name: 'Kabupaten Tasikmalaya',  lat: -7.3548,  lng: 108.1130 },
];

/* ══════════════════════════════════════════════════
   ROUTING
══════════════════════════════════════════════════ */
// Halaman yang menyembunyikan navbar & bottom nav
const AUTH_PAGES = new Set(['login', 'register']);
const DASH_PAGES = new Set(['admin', 'operator']);

/* ── Session persistence ──────────────────────────
   Menyimpan halaman terakhir ke sessionStorage.
   Timeout 30 menit: jika refresh setelah 30 menit
   kembali ke home / login.
────────────────────────────────────────────────── */
const SESSION_PAGE_KEY   = 'zj_last_page';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 menit

function savePageSession(page) {
  if (AUTH_PAGES.has(page)) return; // Jangan simpan halaman auth
  try {
    sessionStorage.setItem(SESSION_PAGE_KEY, JSON.stringify({
      page,
      ts: Date.now(),
    }));
  } catch (_) {}
}

function restorePageSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_PAGE_KEY);
    if (!raw) return null;
    const { page, ts } = JSON.parse(raw);
    if (Date.now() - ts > SESSION_TIMEOUT_MS) {
      sessionStorage.removeItem(SESSION_PAGE_KEY);
      return null;
    }
    return page;
  } catch (_) {
    return null;
  }
}

function clearPageSession() {
  try { sessionStorage.removeItem(SESSION_PAGE_KEY); } catch (_) {}
}

function navigateTo(page) {
  // ── Auth guard: halaman zonasi butuh login ────── 04-05-2026
  if (page === 'zonasi' && !localStorage.getItem('user_session')) {
    showToast('Silakan login terlebih dahulu untuk mengakses Zonasi', 'info', 4000);
    page = 'login';
  }

  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (!target) return;
  target.classList.add('active');
  setActiveNav(page);

  // Simpan halaman terakhir ke sessionStorage (untuk restore saat refresh)
  savePageSession(page);

  // Sembunyikan navbar & bottom nav di halaman auth atau dashboard
  const isAuth = AUTH_PAGES.has(page);
  const isDash = DASH_PAGES.has(page);
  const hideNav = isAuth || isDash;
  document.querySelector('.navbar').style.display     = hideNav ? 'none' : '';
  document.querySelector('.bottom-nav').style.display  = hideNav ? 'none' : '';
  document.getElementById('search-bar-row').style.display = hideNav ? 'none' : '';
  // Expand page-container to full height when navbar is hidden
  const pc = document.querySelector('.page-container');
  if (pc) pc.classList.toggle('dash-mode', hideNav);

  toggleSearchBar(!isAuth && page === 'map');

  if (page === 'map' && !_mapInitDone) {
    _mapInitDone = true;
    setTimeout(() => { initMapPage(); renderMapPage(); invalidateMaps(); }, 50);
  }
  if (page === 'map' || page === 'zonasi') {
    setTimeout(invalidateMaps, 120);
  }
  // Sync dashboard banner when returning to home
  if (page === 'home') {
    const userJson = localStorage.getItem('user_session');
    if (userJson) {
      // Use setTimeout to ensure function is defined (called after boot init)
      setTimeout(() => {
        if (typeof syncDashboardBanner === 'function') syncDashboardBanner(JSON.parse(userJson));
      }, 0);
    }
  }
}

/* ══════════════════════════════════════════════════
   ZONASI: 2-STEP FLOW
══════════════════════════════════════════════════ */

/** Tampilkan Step 1 (form input), sembunyikan Step 2 (peta) */
function showZonasiInputStep() {
  document.getElementById('zonasi-input-step').classList.remove('hidden');
  document.getElementById('zonasi-result-step').classList.add('hidden');

  // Reset semua filter ke kondisi awal 05-2026
  _zonasiPageNum = 1;
  _zonFilterKat  = '';
  _zonSort       = 'distance';
  const elKat = document.getElementById('zon-toolbar-kat');
  const elAkr = document.getElementById('zon-toolbar-akr');
  const elSort = document.getElementById('zon-sort');
  const elSearch = document.getElementById('zon-search');
  if (elKat)    elKat.value    = '';
  if (elAkr)    elAkr.value    = '';
  if (elSort)   elSort.value   = 'distance';
  if (elSearch) elSearch.value = '';
}

/**
 * Tampilkan Step 2 (peta) setelah lokasi tersedia.
 * Inisialisasi peta jika belum ada.
 */
function showZonasiResultStep(lat, lng, label) {
  // Update info bar
  document.getElementById('zonasi-active-loc').textContent = label;
  document.getElementById('zonasi-radius-badge').textContent = `Radius: ${getRadius()} km`;

  // Sembunyikan step 1, tampilkan step 2
  document.getElementById('zonasi-input-step').classList.add('hidden');
  document.getElementById('zonasi-result-step').classList.remove('hidden');

  // Init peta hanya sekali
  if (!_zonasiInitDone) {
    _zonasiInitDone = true;
    setTimeout(() => {
      initZonasiPage();
      setUserLocation({ lat, lng });
      setUserMarker(lat, lng);
      updateCircle(lat, lng, getRadius());
      renderZonasiPage();
      invalidateMaps();
    }, 60);
  } else {
    setUserLocation({ lat, lng });
    setUserMarker(lat, lng);
    updateCircle(lat, lng, getRadius());
    renderZonasiPage();
    setTimeout(invalidateMaps, 60);
  }
}

/* ══════════════════════════════════════════════════
   GEOLOCATION
══════════════════════════════════════════════════ */
function requestGeoloc() {
  const btn    = document.getElementById('btn-geoloc');
  const status = document.getElementById('gps-status');

  if (!navigator.geolocation) {
    showToast('Browser tidak mendukung GPS', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ Mendeteksi lokasi…';
  status.textContent = '🔄 Sedang mendeteksi koordinat GPS…';
  status.className = 'gps-status detecting';

  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const { latitude: lat, longitude: lng } = coords;
      status.textContent = `✅ Terdeteksi: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      status.className = 'gps-status success';
      btn.disabled = false;
      btn.textContent = '📡 Deteksi Lokasi Saya';

      const label = `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      showZonasiResultStep(lat, lng, label);
      showToast('Lokasi berhasil dideteksi ✅', 'success');
    },
    (err) => {
      const msgs = {
        1: '❌ Akses lokasi ditolak. Izinkan di browser.',
        2: '❌ Posisi tidak dapat ditentukan.',
        3: '❌ Timeout mendeteksi lokasi.',
      };
      status.textContent = msgs[err.code] || '❌ Gagal mendapat lokasi';
      status.className = 'gps-status error';
      btn.disabled = false;
      btn.textContent = '📡 Deteksi Lokasi Saya';
      showToast(msgs[err.code] || 'Gagal mendapat lokasi', 'error');
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

/* ══════════════════════════════════════════════════
   TAB SWITCHING
══════════════════════════════════════════════════ */
function initTabs() {
  document.querySelectorAll('.loc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.loc-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.loc-tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

/* ══════════════════════════════════════════════════
   SUBMIT KOORDINAT MANUAL
══════════════════════════════════════════════════ */
function bindKoordinatSubmit() {
  document.getElementById('btn-submit-koordinat').addEventListener('click', () => {
    const lat = parseFloat(document.getElementById('input-lat').value);
    const lng = parseFloat(document.getElementById('input-lng').value);

    if (isNaN(lat) || isNaN(lng)) {
      showToast('Isi latitude dan longitude dengan benar', 'error');
      return;
    }
    if (lat < -90 || lat > 90) {
      showToast('Latitude harus antara -90 dan 90', 'error');
      return;
    }
    if (lng < -180 || lng > 180) {
      showToast('Longitude harus antara -180 dan 180', 'error');
      return;
    }

    const label = `Koordinat (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    showZonasiResultStep(lat, lng, label);

    // Di dalam event listener submit koordinat:
    const coords = { lat, lng };
    setUserLocation(coords);
    localStorage.setItem('user_coords', JSON.stringify(coords)); // Tambahkan ini
  });
}

/* ══════════════════════════════════════════════════
   KOTA DROPDOWN SEARCH
══════════════════════════════════════════════════ */
function bindKotaSearch() {
  const input    = document.getElementById('input-kota-search');
  const dropdown = document.getElementById('kota-dropdown');
  const infoEl   = document.getElementById('kota-selected-info');
  const submitBtn= document.getElementById('btn-submit-kota');

  // Reset selected kota
  _selectedKota = null;

  function renderDropdown(query) {
    const q = query.toLowerCase().trim();
    const matches = q
      ? KOTA_JABAR.filter(k => k.name.toLowerCase().includes(q))
      : KOTA_JABAR;

    if (!matches.length) {
      dropdown.innerHTML = '<div class="kota-option" style="color:#aaa;cursor:default">Tidak ditemukan</div>';
    } else {
      dropdown.innerHTML = matches.map(k => `
        <div class="kota-option" data-name="${k.name}" data-lat="${k.lat}" data-lng="${k.lng}">
          <span>${k.name}</span>
          <span class="kota-option-kab">${k.lat.toFixed(3)}, ${k.lng.toFixed(3)}</span>
        </div>`).join('');
    }
    dropdown.classList.add('open');
  }

  // Buka dropdown saat fokus
  input.addEventListener('focus', () => renderDropdown(input.value));

  // Filter saat mengetik
  input.addEventListener('input', debounce(() => renderDropdown(input.value), 150));

  // Klik opsi di dropdown
  dropdown.addEventListener('click', e => {
    const opt = e.target.closest('.kota-option');
    if (!opt || !opt.dataset.lat) return;

    _selectedKota = {
      name: opt.dataset.name,
      lat:  parseFloat(opt.dataset.lat),
      lng:  parseFloat(opt.dataset.lng),
    };

    input.value = _selectedKota.name;
    dropdown.classList.remove('open');

    infoEl.textContent = `✅ ${_selectedKota.name} dipilih (${_selectedKota.lat.toFixed(4)}, ${_selectedKota.lng.toFixed(4)})`;
    infoEl.classList.add('show');
    submitBtn.disabled = false;
  });

  // Tutup dropdown saat klik di luar
  document.addEventListener('click', e => {
    if (!e.target.closest('.kota-search-wrap')) {
      dropdown.classList.remove('open');
    }
  });

  // Submit
  submitBtn.addEventListener('click', () => {
    if (!_selectedKota) { showToast('Pilih kota terlebih dahulu', 'error'); return; }
    showZonasiResultStep(_selectedKota.lat, _selectedKota.lng, _selectedKota.name);
  });
}

/* ══════════════════════════════════════════════════
   RADIUS SYNC
══════════════════════════════════════════════════ */
function syncRadius(val) {
  val = Math.max(0.1, Math.min(50, parseFloat(val) || 5));
  setRadius(val);
  document.getElementById('radius-num').value   = val;
  document.getElementById('radius-range').value = Math.min(val, 20);
  // Sync preview label on input step
  const preview = document.getElementById('radius-preview-label');
  if (preview) preview.textContent = `${val} km`;
  // Update badge jika hasil sudah tampil
  const badge = document.getElementById('zonasi-radius-badge');
  if (badge) badge.textContent = `Radius: ${val} km`;
  // Update circle jika ada lokasi
  const loc = getUserLocation();
  if (loc) updateCircle(loc.lat, loc.lng, val);
  if (_zonasiInitDone) renderZonasiPage();
}

/* ══════════════════════════════════════════════════
   RENDER PAGES
══════════════════════════════════════════════════ */
function renderHomePage() {
  // Home page is now a visual landing page — no table to render
  // keeping function for compatibility (called on data load)
}

function renderMapPage() {
  const schools  = getSchools();
  const filtered = filterSchools(schools, { kat: _mapFilterKat, akreditasi: _mapFilterAkr, nama: _mapFilterNama, biayaMax: _mapFilterBiaya ? Number(_mapFilterBiaya) : '' });
  renderMapMarkers(filtered);
  // No flat list on map page — markers only
}

let _zonSort = 'distance'; // default sort by nearest

function renderZonasiPage() {
  const userLoc = getUserLocation();
  const radius  = getRadius();
  const MAX_EXTRA = 10; // km beyond radius still shown
  let schools = getSchools();

  // Filter by jenjang + akreditasi + name search
  const toolbarKat  = document.getElementById('zon-toolbar-kat')?.value || _zonFilterKat;
  const toolbarAkr  = document.getElementById('zon-toolbar-akr')?.value || '';
  const nameSearch  = document.getElementById('zon-search')?.value.trim() || '';
  schools = filterSchools(schools, { kat: toolbarKat, akreditasi: toolbarAkr, nama: nameSearch });

  // Distance limit: only show schools within radius + MAX_EXTRA km
  if (userLoc) {
    const hardLimit = radius + MAX_EXTRA;
    const withinRange = schools.filter(s => {
      const d = haversineDistance(userLoc.lat, userLoc.lng, s.lat, s.lng);
      return d <= hardLimit;
    });
    // Show popup if nothing found
    if (withinRange.length === 0 && schools.length > 0) {
      const popup = document.getElementById('popup-out-of-range');
      const oobR  = document.getElementById('oob-radius');
      if (popup) popup.style.display = 'flex';
      if (oobR)  oobR.textContent = `${radius} km`;
    }
    schools = withinRange;
  }

  // Sort
  if (_zonSort === 'distance' && userLoc) {
    schools = sortByDistance(schools, userLoc);
  } else if (_zonSort === 'name') {
    schools = [...schools].sort((a, b) => a.nama.localeCompare(b.nama));
  } else if (_zonSort === 'quota') {
    schools = [...schools].sort((a, b) => (b.kuota - b.pendaftar) - (a.kuota - a.pendaftar));
  }

  // Update count badge
  const countEl = document.getElementById('zon-count');
  if (countEl) countEl.textContent = schools.length;

  const { items, page, total } = paginate(schools, _zonasiPageNum, 8);
  renderZonasiMarkers(schools);
  renderFlatList('zon-list','zon-page-info','zon-prev','zon-next',
    items, page, total,
    s => flyToOnZonasi(s),
    s => highlightZonasiMarker(s.id),
    s => unhighlightZonasiMarker(s.id)
  );
}

/* ── Zonasi Regulation Buttons ───────────────────── 05 2026*/
let _zonasiRegulasi = []; // cache data dari API

async function loadZonasiRegulasi() {
  try {
    const list = await fetchZonasi();
    _zonasiRegulasi = list;
    renderZonasiRegulasiButtons();
  } catch { /* silent fail */ }
}

function renderZonasiRegulasiButtons() {
  const container = document.getElementById('zonasi-regulasi-btns');
  if (!container) return;

  // Kelompokkan per jenjang (SD, SMP, SMA/SMK)
  const JENJANG_ORDER = ['SD', 'SMP', 'SMA', 'SMK'];
  const map = {};
  _zonasiRegulasi.forEach(z => {
    const key = (z.nama_zonasi || '').toUpperCase();
    JENJANG_ORDER.forEach(j => {
      if (key.includes(j)) {
        if (!map[j] || z.radius_meter < map[j].radius_meter) map[j] = z;
      }
    });
  });

  const COLORS = { SD: '#1565C0', SMP: '#2e7d32', SMA: '#c62828', SMK: '#6a1b9a' };

  container.innerHTML = Object.entries(map).map(([jenjang, z]) => {
    const km = z.radius_meter >= 1000
      ? (z.radius_meter / 1000).toFixed(1) + ' km'
      : z.radius_meter + ' m';
    return `
      <button class="reg-btn" data-jenjang="${jenjang}" data-radius="${z.radius_meter / 1000}"
        style="border-color:${COLORS[jenjang]};color:${COLORS[jenjang]}">
        <span class="reg-btn-label">${jenjang}</span>
        <span class="reg-btn-radius">${km}</span>
      </button>`;
  }).join('');

  container.querySelectorAll('.reg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const radius = parseFloat(btn.dataset.radius);
      const jenjang = btn.dataset.jenjang;
      syncRadius(radius);
      // Set filter jenjang otomatis
      const elKat = document.getElementById('zon-toolbar-kat');
      if (elKat) elKat.value = jenjang;
      _zonFilterKat = jenjang;
      // Visual active state
      container.querySelectorAll('.reg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(`Radius zonasi ${jenjang} diset ke ${radius} km`, 'success');
    });
  });
}
  
function bindZonasiToolbar() {
  document.getElementById('zon-toolbar-kat')?.addEventListener('change', () => {
    _zonasiPageNum = 1; renderZonasiPage();
  });
  document.getElementById('zon-toolbar-akr')?.addEventListener('change', () => {
    _zonasiPageNum = 1; renderZonasiPage();
  });
  document.getElementById('zon-sort')?.addEventListener('change', e => {
    _zonSort = e.target.value; _zonasiPageNum = 1; renderZonasiPage();
  });
  // In-panel search (filters by name)
  const zonSearch = document.getElementById('zon-search');
  if (zonSearch) {
    zonSearch.addEventListener('input', debounce(() => {
      _zonasiPageNum = 1; renderZonasiPage();
    }, 250));
  }
  // Out-of-range popup buttons
  document.getElementById('popup-oob-close')?.addEventListener('click', () => {
    document.getElementById('popup-out-of-range').style.display = 'none';
  });
  document.getElementById('popup-oob-change')?.addEventListener('click', () => {
    document.getElementById('popup-out-of-range').style.display = 'none';
    showZonasiInputStep();
  });
}

/* ══════════════════════════════════════════════════
   USER LOGIN & REGISTER 18-04-2026
══════════════════════════════════════════════════ */
function bindAuthEvents() {
  const regForm = document.getElementById('register-form');
  const loginForm = document.getElementById('login-form');
  const roleSelect = document.getElementById('reg-role');

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('reg-user').value.trim();
      const email    = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-pass').value;
      const role     = document.getElementById('reg-role').value;
      const adminCode    = document.getElementById('reg-admin-code')?.value.trim() || null;
      const operatorCode = document.getElementById('reg-op-code')?.value.trim()    || null;
      const npsn         = document.getElementById('reg-school-id')?.value.trim()  || null;

      try {
        showLoading();
        await registerUser(username, email, password, role, adminCode, operatorCode, npsn);
        showToast('Registrasi berhasil! Silakan login.', 'success');
        navigateTo('login');
      } catch (err) {
        showToast(err.message || 'Registrasi gagal, coba lagi.', 'error');
      } finally {
        hideLoading();
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-pass').value;

      try {
        showLoading();
        const user = await loginUser(email, password);
        showToast(`Selamat datang, ${user.username} 👋`, 'success');
        updateUIForLoggedInUser();
        syncDashboardBanner(user);
        if (user.role === 'admin') {
          navigateTo('admin');
          initAdminDashboard(user);
        } else if (user.role === 'sekolah') {
          navigateTo('operator');
          await initOperatorDashboard(user);
        } else {
          navigateTo('home');
          setTimeout(() => maybeShowProfilePopup(user), 1000);
        }
      } catch (err) {
        showToast(err.message || 'Login gagal, periksa email & password.', 'error');
      } finally {
        hideLoading();
  
        // Kosongkan password
        document.getElementById('login-pass').value = '';
        // Fokus kembali ke password
        document.getElementById('login-pass').focus();
      }
    });
  }

  document.addEventListener('click', async e => {
    if (e.target.classList.contains('keluar-link')) {
      e.preventDefault();
      const session = JSON.parse(localStorage.getItem('user_session') || '{}');
      if (session?.user_id) await logoutUser(session.user_id);
      clearPageSession();
      showToast('Berhasil keluar', 'info');
      setTimeout(() => { window.location.reload(); }, 500);
    }
  });
}

/* ══════════════════════════════════════════════════
   BIND ALL EVENTS
══════════════════════════════════════════════════ */
function bindEvents() {

  // Navigasi global
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-page]');
    if (el) { e.preventDefault(); navigateTo(el.dataset.page); }
  });

   // 04-05-2026
   document.getElementById('btn-learn-more')?.addEventListener('click', () => {
    if (!localStorage.getItem('user_session')) {
      showToast('Silakan login terlebih dahulu', 'info', 3000);
      setTimeout(() => navigateTo('login'), 600);
      return;
    }
    const target = document.getElementById('section-cara-kerja');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  
  // ── Mulai Cek Zonasi: cek login dulu ──────────────
  document.getElementById('btn-mulai-zonasi')?.addEventListener('click', () => {
    if (localStorage.getItem('user_session')) {
      navigateTo('zonasi');
    } else {
      showToast('Silakan login terlebih dahulu untuk mengakses Zonasi', 'info', 4000);
      setTimeout(() => navigateTo('login'), 800);
    }
  });

  // ── Navbar Zonasi: guard login ─────────────────────
  document.getElementById('nav-zonasi-link')?.addEventListener('click', e => {
    e.preventDefault();
    if (localStorage.getItem('user_session')) {
      navigateTo('zonasi');
    } else {
      showToast('Silakan login terlebih dahulu untuk mengakses Zonasi', 'info', 4000);
      setTimeout(() => navigateTo('login'), 800);
    }
  });

  // Home pagination — elements are hidden but still exist
  document.getElementById('home-prev')?.addEventListener('click', () => { _homePageNum--; renderHomePage(); });
  document.getElementById('home-next')?.addEventListener('click', () => { _homePageNum++; renderHomePage(); });

  // Map filter
  document.getElementById('map-prev')?.addEventListener('click', () => {});
  document.getElementById('map-next')?.addEventListener('click', () => {});
  // Helper: read all filter values from search bar
  function readMapFilters() {
    _mapFilterKat   = document.getElementById('map-kat')?.value || '';
    _mapFilterAkr   = document.getElementById('filter-akreditasi')?.value || '';
    _mapFilterBiaya = document.getElementById('filter-biaya-range')?.value || '';
    _mapFilterNama  = document.getElementById('global-search')?.value.trim() || '';
  }

  document.getElementById('map-apply').addEventListener('click', () => {
    readMapFilters(); _mapPageNum = 1; renderMapPage();
    showToast('Filter diterapkan', 'success');
  });
  document.getElementById('map-clear').addEventListener('click', () => {
    _mapFilterKat = ''; _mapFilterAkr = ''; _mapFilterBiaya = ''; _mapFilterNama = '';
    ['map-kat','filter-akreditasi','filter-biaya-range','global-search'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    _mapPageNum = 1; renderMapPage();
    showToast('Filter direset', 'info');
  });

  // Auto-apply when any filter dropdown changes (fixes akreditasi bug)
  ['map-kat','filter-akreditasi','filter-biaya-range'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      readMapFilters(); _mapPageNum = 1; renderMapPage();
    });
  });

  // Zonasi pagination & filter (map overlay filter kept for backward compat)
  document.getElementById('zon-prev').addEventListener('click', () => { _zonasiPageNum--; renderZonasiPage(); });
  document.getElementById('zon-next').addEventListener('click', () => { _zonasiPageNum++; renderZonasiPage(); });
  document.getElementById('zon-apply')?.addEventListener('click', () => {
    _zonFilterKat = document.getElementById('zon-kat')?.value || '';
    _zonasiPageNum = 1; renderZonasiPage();
  });
  document.getElementById('zon-clear')?.addEventListener('click', () => {
    _zonFilterKat = '';
    if (document.getElementById('zon-kat')) document.getElementById('zon-kat').value = '';
    _zonasiPageNum = 1; renderZonasiPage();
  });
  bindZonasiToolbar();

  // Tombol Ganti Lokasi → kembali ke Step 1
  document.getElementById('btn-change-loc').addEventListener('click', () => {
    showZonasiInputStep();
    // Reset status GPS
    const status = document.getElementById('gps-status');
    if (status) { status.textContent = ''; status.className = 'gps-status'; }
  });

  // GPS
  document.getElementById('btn-geoloc').addEventListener('click', requestGeoloc);

  // Radius
  document.getElementById('radius-num').addEventListener('input',
    debounce(e => syncRadius(e.target.value), 300));
  document.getElementById('radius-range').addEventListener('input',
    e => syncRadius(e.target.value));

  // Password toggle (login & register)
  document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    });
  });
  
  // Profile password
  document.getElementById('btn-lihat-pass')?.addEventListener('click', () => {
    const el = document.getElementById('prof-pass');
    el.textContent = el.textContent === '••••••••••' ? 'password123' : '••••••••••';
  });

  // Global search
  document.getElementById('global-search').addEventListener('input',
    debounce(e => {
      const q = e.target.value.trim();
      const active = document.querySelector('.page.active')?.id;
      if (active === 'page-map' && _mapInitDone) {
        _mapFilterNama = q; _mapPageNum = 1; renderMapPage();
      }
    }, 300)
  );

  // Home jenjang cards → navigate to map with filter pre-applied
  document.querySelectorAll('.jenjang-card[data-kat]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kat = btn.dataset.kat;
      _mapFilterKat = kat;
      const el = document.getElementById('map-kat');
      if (el) el.value = kat;
      navigateTo('map');
      if (!_mapInitDone) {
        _mapInitDone = true;
        setTimeout(() => { initMapPage(); renderMapPage(); invalidateMaps(); }, 60);
      } else {
        renderMapPage();
      }
    });
  });

  // ── Hero background slideshow ─────────────────────────────────
  (function initHeroBgSlider() {
    const slides = document.querySelectorAll('.hero-bg-slide');
    const dots   = document.querySelectorAll('.hsd');
    const total  = slides.length;
    if (!total) return;
    let cur = 0, timer;
    function goTo(idx) {
      slides[cur].classList.remove('active');
      dots[cur]?.classList.remove('active');
      cur = (idx + total) % total;
      slides[cur].classList.add('active');
      dots[cur]?.classList.add('active');
    }
    function startAuto() { clearInterval(timer); timer = setInterval(() => goTo(cur + 1), 5000); }
    document.getElementById('hero-bg-prev')?.addEventListener('click', () => { goTo(cur - 1); startAuto(); });
    document.getElementById('hero-bg-next')?.addEventListener('click', () => { goTo(cur + 1); startAuto(); });
    dots.forEach(d => d.addEventListener('click', () => { goTo(parseInt(d.dataset.i)); startAuto(); }));
    startAuto();
  })();

  // ── Cegah event drag/scroll peta menembus filter box ──
  // Leaflet akan men-drag peta saat mouse bergerak di atas elemen apapun
  // kecuali elemen yang menghentikan propagasi event pointer-nya.
  ['map-filter-box', 'zonasi-filter-box'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Stop semua event yang bisa menyebabkan Leaflet drag/zoom
    ['mousedown','mousemove','mouseup','touchstart','touchmove',
     'touchend','wheel','dblclick','click','pointerdown'].forEach(evt => {
      el.addEventListener(evt, e => e.stopPropagation(), { passive: false });
    });
  });
}

/* ══════════════════════════════════════════════════
   PROFILE PAGE
══════════════════════════════════════════════════ */
const PROFILE_API = 'http://localhost:8000/profile';

function lsLoadProfile(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
  catch (_) { return null; }
}
function lsSaveProfile(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

/** Extract user_id from session, supporting both key names */
function getSessionUserId(user) {
  return user?.user_id ?? user?.id ?? null;
}

/* Load profile from backend; falls back to localStorage */
async function loadProfileFromServer(userId, role) {
  if (!userId) return null;
  try {
    const res = await fetch(`${PROFILE_API}/${userId}?role=${encodeURIComponent(role)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || Object.keys(data).length === 0) return null;
    // Remap snake_case backend keys → camelCase frontend keys
    if (role === 'admin' || role === 'sekolah') {
      return { nama: data.nama, telepon: data.telepon, afiliasi: data.afiliasi, kode: data.kode };
    }
    /* 04-05-2026 */
    return {
      nama: data.nama, telepon: data.telepon,
      alamat: data.alamat, kota: data.kota,
      anak: (() => { try { return JSON.parse(data.nama_anak || '[]'); } catch { return []; } })(),
    };
  } catch { return null; }
}

/* Save profile to backend + localStorage */
async function saveProfileToServer(userId, role, frontendData) {
  if (!userId) return;
  try {
    let payload;
    if (role === 'admin' || role === 'sekolah') {
      payload = { nama: frontendData.nama, telepon: frontendData.telepon, afiliasi: frontendData.afiliasi, kode: frontendData.kode };
    } else {
      /* 04-05-2026 */
      payload = {
        nama: frontendData.nama, telepon: frontendData.telepon,
        alamat: frontendData.alamat, kota: frontendData.kota,
        nama_anak:      JSON.stringify(frontendData.anak || []),
        jenjang_anak:   '',
        sekolah_tujuan: '',
      };
    }
    const res = await fetch(`${PROFILE_API}/${userId}?role=${encodeURIComponent(role)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch { return false; }
}

async function renderProfile() {
  const userJson = localStorage.getItem('user_session');
  if (!userJson) return;
  const user = JSON.parse(userJson);
  const isStaff = user.role === 'admin' || user.role === 'sekolah';
  const LS_KEY  = `zj_profil_${user.username || 'guest'}`;

  // Try server first (if user_id available), fallback to localStorage
  let data = null;
  const userId = getSessionUserId(user);
  if (userId) {
    data = await loadProfileFromServer(userId, user.role);
    if (data) lsSaveProfile(LS_KEY, data); // sync to localStorage
  }
  if (!data) data = lsLoadProfile(LS_KEY) || {};

  const roleLabel = user.role === 'admin' ? 'Administrator'
    : user.role === 'sekolah' ? 'Operator Sekolah' : 'Pengguna';

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v || '—'; };

  // All roles use same professional blue gradient — only badge text differs
  const header = document.querySelector('.profile-header');
  if (header) {
    header.style.background = '';  // always use CSS gradient, no inline override
  }

  const displayName = isStaff ? (data.nama || user.username || '—') : (data.nama || user.username || '—');
  set('prof-display-name', displayName);
  set('prof-email',        user.email || '—');
  set('prof-role-badge',   roleLabel);

  // Akun
  set('prof-username',  user.username || '—');
  set('prof-email-val', user.email    || '—');
  set('prof-role-val',  roleLabel);

  // Show/hide correct data card inside pribadi tab
  const staffCard = document.getElementById('prof-card-staff');
  const userCard  = document.getElementById('prof-card-user');
  if (staffCard) staffCard.style.display = isStaff ? 'block' : 'none';
  if (userCard)  userCard.style.display  = isStaff ? 'none'  : 'block';

  // Show dashboard button in sidebar
  const dashWrap = document.getElementById('prof-dash-wrap');
  if (dashWrap) dashWrap.style.display = isStaff ? 'block' : 'none';

  if (isStaff) {
    set('staff-nama',     data.nama      || '—');
    set('staff-telepon',  data.telepon   || '—');
    set('staff-afiliasi', data.afiliasi  || '—');
    set('staff-kode',     data.kode      || '—');
  } else {
    set('prof-nama-lengkap',   data.nama           || '—');
    set('prof-telepon',        data.telepon         || '—');
    set('prof-alamat',         data.alamat          || '—');
    set('prof-kota',           data.kota            || '—');
    const anakList = document.getElementById('prof-anak-list');
    if (anakList) {
      const anak = data.anak || [];
      const NUM_BG  = ['#dbeafe','#dcfce7','#fef9c3'];
      const NUM_CLR = ['#1d4ed8','#15803d','#a16207'];
      const BADGE_STYLE = {
        'SD / MI':  'background:#dbeafe;color:#1d4ed8;',
        'SMP / MTs':'background:#dcfce7;color:#15803d;',
        'SMA / MA': 'background:#fee2e2;color:#b91c1c;',
        'SMK':      'background:#f3e8ff;color:#7c3aed;',
      };
      if (!anak.length) {
        anakList.innerHTML = '<div style="font-size:14px;color:#94a3b8;padding:8px 0;">Belum ada data anak ditambahkan</div>';
      } else {
        anakList.innerHTML = `
          <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
            ${anak.map((a, i) => `
              <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:#f8fafc;${i > 0 ? 'border-top:1px solid #e2e8f0;' : ''}">
                <div style="width:28px;height:28px;border-radius:50%;background:${NUM_BG[i]};color:${NUM_CLR[i]};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${i+1}</div>
                <div style="flex:1;">
                  <div style="font-size:14px;font-weight:600;color:#1e293b;">${a.nama || '—'}</div>
                  <div style="font-size:12px;color:#64748b;margin-top:2px;">${a.jenjang || '—'} &nbsp;·&nbsp; ${a.sekolahTujuan || 'Belum ada sekolah tujuan'}</div>
                </div>
                <span style="font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;${BADGE_STYLE[a.jenjang] || 'background:#f1f5f9;color:#64748b;'}">
                  ${(a.jenjang || '').split(' ')[0] || '—'}
                </span>
              </div>`).join('')}
          </div>`;
      }
    }
  }
}

let _editAnak = [];

function renderAnakCards() {
  const container = document.getElementById('pe-anak-container');
  const btnTambah = document.getElementById('btn-tambah-anak');
  const slotInfo  = document.getElementById('anak-slot-info');
  if (!container) return;

  const NUM_BG  = ['#dbeafe','#dcfce7','#fef9c3'];
  const NUM_CLR = ['#1d4ed8','#15803d','#a16207'];
  const LABEL   = ['pertama','kedua','ketiga'];

  container.innerHTML = _editAnak.map((a, i) => `
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin-bottom:10px;background:#f8fafc;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:8px;font-size:14px;font-weight:600;color:#475569;">
          <div style="width:28px;height:28px;border-radius:50%;background:${NUM_BG[i]};color:${NUM_CLR[i]};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;">${i+1}</div>
          Anak ${LABEL[i]}
        </div>
        <button type="button" class="btn-hapus-anak" data-idx="${i}"
          style="font-size:12px;color:#ef4444;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;padding:4px 10px;cursor:pointer;">
          ✕ Hapus
        </button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Nama lengkap</label>
          <input class="mf-input anak-nama" data-idx="${i}" placeholder="Nama anak" value="${a.nama || ''}"
            style="width:100%;box-sizing:border-box;"/>
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Jenjang</label>
          <select class="mf-input anak-jenjang" data-idx="${i}" style="width:100%;box-sizing:border-box;">
            <option value="">Pilih jenjang</option>
            ${['SD / MI','SMP / MTs','SMA / MA','SMK'].map(j =>
              `<option value="${j}" ${a.jenjang === j ? 'selected' : ''}>${j}</option>`
            ).join('')}
          </select>
        </div>
        <div style="grid-column:1/-1;">
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px;">Sekolah tujuan</label>
          <input class="mf-input anak-sekolah" data-idx="${i}" placeholder="Nama sekolah tujuan" value="${a.sekolahTujuan || ''}"
            style="width:100%;box-sizing:border-box;"/>
        </div>
      </div>
    </div>`).join('');

  container.querySelectorAll('.anak-nama').forEach(el =>
    el.addEventListener('input', () => { _editAnak[+el.dataset.idx].nama = el.value; }));
  container.querySelectorAll('.anak-jenjang').forEach(el =>
    el.addEventListener('change', () => { _editAnak[+el.dataset.idx].jenjang = el.value; }));
  container.querySelectorAll('.anak-sekolah').forEach(el =>
    el.addEventListener('input', () => { _editAnak[+el.dataset.idx].sekolahTujuan = el.value; }));
  container.querySelectorAll('.btn-hapus-anak').forEach(btn =>
    btn.addEventListener('click', () => {
      _editAnak.splice(+btn.dataset.idx, 1);
      renderAnakCards();
    }));

  if (btnTambah) btnTambah.disabled = _editAnak.length >= 3;
  if (slotInfo)  slotInfo.textContent = `${_editAnak.length} / 3`;
}

function bindProfileEvents() {
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-page]');
    if (el?.dataset.page === 'profile') setTimeout(() => renderProfile(), 50);
  });

  // Sidebar tab navigation
  document.querySelectorAll('.prof-nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.prof-nav-item[data-tab]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.prof-tab').forEach(t => { t.style.display='none'; t.classList.remove('active'); });
      const tab = document.getElementById(`prof-tab-${btn.dataset.tab}`);
      if (tab) { tab.style.display='block'; tab.classList.add('active'); }
    });
  });

  document.getElementById('prof-nav-logout')?.addEventListener('click', () => {
    localStorage.removeItem('user_session');
    clearPageSession();
    showToast('Berhasil keluar', 'info');
    setTimeout(() => window.location.reload(), 500);
  });

  document.getElementById('prof-btn-dashboard')?.addEventListener('click', () => {
    const u = JSON.parse(localStorage.getItem('user_session') || '{}');
    navigateTo(u.role === 'admin' ? 'admin' : 'operator');
  });

  // Staff edit
  document.getElementById('btn-edit-staff')?.addEventListener('click', () => {
    const u = JSON.parse(localStorage.getItem('user_session') || '{}');
    const d = lsLoadProfile(`zj_profil_${u.username||'guest'}`) || {};
    document.getElementById('se-nama').value     = d.nama     || '';
    document.getElementById('se-telepon').value  = d.telepon  || '';
    document.getElementById('se-afiliasi').value = d.afiliasi || '';
    document.getElementById('se-kode').value     = d.kode     || '';
    document.getElementById('staff-display-mode').style.display = 'none';
    document.getElementById('staff-edit-mode').style.display    = 'block';
  });
  document.getElementById('btn-batal-staff')?.addEventListener('click', () => {
    document.getElementById('staff-display-mode').style.display = 'block';
    document.getElementById('staff-edit-mode').style.display    = 'none';
  });
  document.getElementById('btn-simpan-staff')?.addEventListener('click', async () => {
    const u = JSON.parse(localStorage.getItem('user_session') || '{}');
    const g = id => document.getElementById(id)?.value.trim() || '';
    const profileData = { nama:g('se-nama'), telepon:g('se-telepon'), afiliasi:g('se-afiliasi'), kode:g('se-kode') };
    lsSaveProfile(`zj_profil_${u.username||'guest'}`, profileData);
    const uid = getSessionUserId(u);
    if (uid) await saveProfileToServer(uid, u.role, profileData);
    document.getElementById('staff-display-mode').style.display = 'block';
    document.getElementById('staff-edit-mode').style.display    = 'none';
    renderProfile();
    showToast('Data pekerja berhasil disimpan ✅', 'success');
  });

  // User pribadi edit
  document.getElementById('btn-edit-profil-pribadi')?.addEventListener('click', () => {
    const u = JSON.parse(localStorage.getItem('user_session') || '{}');
    const d = lsLoadProfile(`zj_profil_${u.username||'guest'}`) || {};
    document.getElementById('pe-nama').value    = d.nama    || '';
    document.getElementById('pe-telepon').value = d.telepon || '';
    document.getElementById('pe-alamat').value  = d.alamat  || '';
    document.getElementById('pe-kota').value    = d.kota    || '';
    _editAnak = (d.anak || []).map(a => ({ ...a }));
    renderAnakCards();
    document.getElementById('profil-display-mode').style.display = 'none';
    document.getElementById('profil-edit-mode').style.display    = 'block';
  });
  document.getElementById('btn-batal-profil')?.addEventListener('click', () => {
    document.getElementById('profil-display-mode').style.display = 'block';
    document.getElementById('profil-edit-mode').style.display    = 'none';
  });
  document.getElementById('btn-simpan-profil')?.addEventListener('click', async () => {
    const u = JSON.parse(localStorage.getItem('user_session') || '{}');
    const g = id => document.getElementById(id)?.value.trim() || '';
    const profileData = {
      nama: g('pe-nama'), telepon: g('pe-telepon'),
      alamat: g('pe-alamat'), kota: g('pe-kota'),
      anak: _editAnak.filter(a => a.nama.trim()),
    };
    lsSaveProfile(`zj_profil_${u.username||'guest'}`, profileData);
    const uid = getSessionUserId(u);
    if (uid) await saveProfileToServer(uid, u.role, profileData);
    document.getElementById('profil-display-mode').style.display = 'block';
    document.getElementById('profil-edit-mode').style.display    = 'none';
    renderProfile();
    showToast('Data pribadi berhasil disimpan ✅', 'success');
  });
  document.getElementById('btn-tambah-anak')?.addEventListener('click', () => {
    if (_editAnak.length >= 3) return;
    _editAnak.push({ nama: '', jenjang: '', sekolahTujuan: '' });
    renderAnakCards();
  });

  document.getElementById('popup-profil-skip')?.addEventListener('click', () => {
    document.getElementById('popup-profil-incomplete').style.display = 'none';
  });
  document.getElementById('popup-profil-fill')?.addEventListener('click', () => {
    document.getElementById('popup-profil-incomplete').style.display = 'none';
    navigateTo('profile');
    setTimeout(() => { renderProfile(); document.querySelector('.prof-nav-item[data-tab="pribadi"]')?.click(); }, 100);
  });
}


/* ══════════════════════════════════════════════════
   BOOT
══════════════════════════════════════════════════ */
async function boot() {
  showLoading();

  const savedLoc = localStorage.getItem('user_coords');
  if (savedLoc) {
    setUserLocation(JSON.parse(savedLoc));
  }

  try {
    const { data, fromFallback } = await fetchSekolah();
    setSchools(data);
    renderHomePage();
    if (fromFallback) showToast('Menggunakan data contoh (API tidak tersedia)', 'info', 5000);
  } catch (err) {
    console.error('[main] boot error:', err);
    showToast('Gagal memuat data.', 'error');
  } finally {
    hideLoading();
  }

  // Inisialisasi komponen
  loadZonasiRegulasi(); // 05 2026
  initTabs();
  bindKoordinatSubmit();
  bindKotaSearch();
  bindEvents();
  bindAuthEvents();
  bindProfileEvents();
  updateUIForLoggedInUser();

  const userJson   = localStorage.getItem('user_session');
  const isRefresh  = sessionStorage.getItem('app_started'); // ada = refresh, null = launch pertama

  if (!isRefresh) {
    // ── Launch pertama: selalu ke home ──────────────
    sessionStorage.setItem('app_started', '1');
    navigateTo('home');

    if (userJson) {
      const user = JSON.parse(userJson);
      syncDashboardBanner(user);
      if (user.role === 'admin')   initAdminDashboard(user);
      if (user.role === 'sekolah') initOperatorDashboard(user);
      if (user.role === 'user')    setTimeout(() => maybeShowProfilePopup(user), 800);
    }

  } else {
    // ── Refresh: kembalikan ke halaman terakhir ──────
    const lastPage = restorePageSession();

    if (!userJson) {
      navigateTo(lastPage || 'home');
    } else {
      const user = JSON.parse(userJson);
      const target = lastPage || 'home';

      if (target === 'admin' && user.role === 'admin') {
        navigateTo('admin');
        initAdminDashboard(user);
      } else if (target === 'operator' && user.role === 'sekolah') {
        navigateTo('operator');
        await initOperatorDashboard(user);
      } else if (target === 'zonasi' && user) {
        navigateTo('zonasi');
      } else {
        navigateTo(target !== 'login' && target !== 'register' ? target : 'home');
        if (user.role === 'admin')   initAdminDashboard(user);
        if (user.role === 'sekolah') initOperatorDashboard(user);
      }
      syncDashboardBanner(user);
    }
  }

  showZonasiInputStep();
}
/** Tampilkan banner "Kembali ke Dashboard" di home jika admin/operator */
function syncDashboardBanner(user) {
  const banner = document.getElementById('dash-return-banner');
  if (!banner) return;
  if (user && (user.role === 'admin' || user.role === 'sekolah')) {
    banner.classList.remove('hidden');
    const roleLabel = user.role === 'admin' ? 'Admin' : 'Operator Sekolah';
    const roleEl = document.getElementById('dash-return-role');
    if (roleEl) roleEl.textContent = roleLabel;
    document.getElementById('dash-return-btn')?.addEventListener('click', () => {
      if (user.role === 'admin') {
        navigateTo('admin');
      } else {
        navigateTo('operator');
      }
    });
  } else {
    banner.classList.add('hidden');
  }
}

/** Popup lengkapi profil — tampil jika data pribadi belum diisi */
function maybeShowProfilePopup(user) {
  const LS_KEY = `zj_profil_${user?.username || 'guest'}`;
  const data = lsLoadProfile(LS_KEY);
  if (!data || !data.nama) {
    const popup = document.getElementById('popup-profil-incomplete');
    if (popup) popup.style.display = 'flex';
  }
}

boot();

// ── Auto-logout saat tab/browser ditutup ───────────────────────── 05 2026
window.addEventListener('beforeunload', () => {
  const session = JSON.parse(localStorage.getItem('user_session') || '{}');
  if (!session?.user_id) return;

  // Form data — lebih kompatibel dengan sendBeacon
  const form = new FormData();
  form.append('user_id', session.user_id);
  navigator.sendBeacon('http://localhost:8000/auth/beacon-logout', form);
});

/* ══════════════════════════════════════════════════════════════════
   DASHBOARD HELPERS
══════════════════════════════════════════════════════════════════ */

/** Format rupiah */
function fRupiah(n) {
  if (n === null || n === undefined || n === '') return '—';
  if (Number(n) === 0) return 'Gratis';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
}

/** Jenjang pill CSS class dari nama sekolah */
function jenjangCls(nama = '') {
  const n = nama.toUpperCase();
  if (/SMK/.test(n)) return 'jenjang-smk';
  if (/SMA|SMAN|MA\b/.test(n)) return 'jenjang-sma';
  if (/SMP|SMPN|MTS/.test(n)) return 'jenjang-smp';
  return 'jenjang-sd';
}

/** Buka / tutup modal universal */
function openModal(id)  { const m = document.getElementById(id); if (m) m.style.display = 'flex'; }
function closeModal(id) { const m = document.getElementById(id); if (m) m.style.display = 'none'; }

/** Modal hapus: tampilkan konfirmasi, jalankan callback saat OK */
let _hapusCb = null;
function showModalHapus(nama, cb) {
  document.getElementById('hapus-nama-target').textContent = `"${nama}"`;
  _hapusCb = cb;
  openModal('modal-hapus');
}
function bindModalHapus() {
  ['modal-hapus-close','modal-hapus-batal'].forEach(id =>
    document.getElementById(id)?.addEventListener('click', () => closeModal('modal-hapus'))
  );
  document.getElementById('modal-hapus-ok')?.addEventListener('click', () => {
    _hapusCb?.();
    closeModal('modal-hapus');
  });
  document.getElementById('modal-hapus')?.addEventListener('click', e => {
    if (e.target.id === 'modal-hapus') closeModal('modal-hapus');
  });
}

/* ══════════════════════════════════════════════════════════════════
   ADMIN DASHBOARD
══════════════════════════════════════════════════════════════════ */
let _adminPage       = 1;
let _adminSearch     = '';
let _adminFilterKat  = '';
let _adminFilterStat = '';
let _adminEditId     = null; // null = tambah, else = id yg diedit

function initAdminDashboard(user) {
  // Username di sidebar
  const nameEl = document.getElementById('admin-user-name');
  if (nameEl) nameEl.textContent = user?.username || 'Administrator';

  // Sidebar nav
  document.querySelectorAll('#page-admin .dash-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-admin .dash-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#page-admin .dash-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('admin-panel-' + btn.dataset.panel)?.classList.add('active');
    });
  });

  // Search & filter
  document.getElementById('admin-search-sekolah')?.addEventListener('input', debounce(e => {
    _adminSearch = e.target.value.trim();
    _adminPage = 1;
    renderAdminTable();
  }, 250));
  document.getElementById('admin-filter-kat')?.addEventListener('change', e => {
    _adminFilterKat = e.target.value; _adminPage = 1; renderAdminTable();
  });
  document.getElementById('admin-filter-status')?.addEventListener('change', e => {
    _adminFilterStat = e.target.value; _adminPage = 1; renderAdminTable();
  });

  // Pagination
  document.getElementById('admin-prev')?.addEventListener('click', () => { _adminPage--; renderAdminTable(); });
  document.getElementById('admin-next')?.addEventListener('click', () => { _adminPage++; renderAdminTable(); });

  // Tombol tambah
  document.getElementById('admin-btn-tambah')?.addEventListener('click', () => {
    _adminEditId = null;
    clearModalSekolah();
    document.getElementById('modal-sekolah-title').textContent = 'Tambah Sekolah Baru';
    openModal('modal-sekolah');
  });

  // Kembali ke Home
  document.getElementById('admin-back-home')?.addEventListener('click', () => {
    navigateTo('home');
  });

  // Logout
  document.getElementById('admin-logout-btn')?.addEventListener('click', async () => {
    const session = JSON.parse(localStorage.getItem('user_session') || '{}');
    if (session?.user_id) await logoutUser(session.user_id);
    clearPageSession();
    navigateTo('login');
    showToast('Berhasil keluar', 'info');
  });

  bindModalSekolah();
  bindModalHapus();
  bindModalZonasi();
  renderAdminTable();

  // Lazy-load zonasi panel
  let _zonasiPanelLoaded = false;
  // Lazy-load pengguna panel
  let _penggunaPanelLoaded = false;

  document.querySelectorAll('#page-admin .dash-nav-btn').forEach(btn => {
    if (btn.dataset.panel === 'zonasi-data') {
      btn.addEventListener('click', () => {
        if (!_zonasiPanelLoaded) { _zonasiPanelLoaded = true; renderAdminZonasiTable(); }
      });
    }
    if (btn.dataset.panel === 'pengguna') {
      btn.addEventListener('click', () => {
        if (!_penggunaPanelLoaded) { _penggunaPanelLoaded = true; renderAdminUsersTable(); }
      });
    }
  });

  // Pagination for users panel
  document.getElementById('admin-usr-prev')?.addEventListener('click', () => { _adminUsrPage--; renderAdminUsersRows(); });
  document.getElementById('admin-usr-next')?.addEventListener('click', () => { _adminUsrPage++; renderAdminUsersRows(); });
}

/* ── Admin Users (Pengguna) CRUD ─────────────────── */
let _adminUsersList = [];
let _adminUsrPage   = 1;
const USR_PER_PAGE  = 15;

async function renderAdminUsersTable() {
  const tbody = document.getElementById('admin-tbody-pengguna');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="td-empty">Memuat data…</td></tr>';
  const data = await fetchUsers();
  if (data === null) {
    tbody.innerHTML = '<tr><td colspan="6" class="td-empty">Gagal memuat — server tidak tersedia</td></tr>';
    return;
  }
  _adminUsersList = data;
  renderAdminUsersRows();
}

function renderAdminUsersRows() {
  const tbody = document.getElementById('admin-tbody-pengguna');
  if (!tbody) return;
  const total = Math.ceil(_adminUsersList.length / USR_PER_PAGE) || 1;
  _adminUsrPage = Math.max(1, Math.min(_adminUsrPage, total));
  const slice = _adminUsersList.slice(
    (_adminUsrPage - 1) * USR_PER_PAGE,
    _adminUsrPage * USR_PER_PAGE
  );

  const ROLE_BADGE = {
    admin:   '<span class="role-pill role-admin">Admin</span>',
    sekolah: '<span class="role-pill role-operator">Operator</span>',
    user:    '<span class="role-pill" style="background:#e8f0fe;color:#1565C0">Pengguna</span>',
  };

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="td-empty">Belum ada pengguna</td></tr>';
  } else {
    tbody.innerHTML = slice.map((u, i) => `
      <tr>
        <td>${(_adminUsrPage - 1) * USR_PER_PAGE + i + 1}</td>
        <td style="font-weight:600">${u.username}</td>
        <td style="color:#5a6a82">${u.email}</td>
        <td>${ROLE_BADGE[u.role] || u.role}</td>
        <td>
          ${u.is_online
            ? '<span class="badge-aktif">● Aktif</span>'
            : '<span class="badge-nonaktif">○ Tidak Aktif</span>'}
        </td>
        <td class="aksi-col">
          <button class="btn-hapus" data-uid="${u.id}" data-uname="${u.username}">Nonaktifkan</button>
        </td>
      </tr>`).join('');

    // Nonaktifkan — just shows toast for now (no deactivation endpoint)
    tbody.querySelectorAll('.btn-hapus[data-uid]').forEach(btn => {
      btn.addEventListener('click', () => {
        showToast(`Fitur nonaktifkan akun belum tersedia di API (${btn.dataset.uname})`, 'info', 4000);
      });
    });
  }

  const info = document.getElementById('admin-usr-page-info');
  if (info) info.textContent = `Page ${_adminUsrPage} of ${total}`;
  const prev = document.getElementById('admin-usr-prev');
  const next = document.getElementById('admin-usr-next');
  if (prev) prev.disabled = _adminUsrPage <= 1;
  if (next) next.disabled = _adminUsrPage >= total;
}

function getAdminFiltered() {
  return getSchools().filter(s => {
    const nama = (s.nama || '').toLowerCase();
    const kec  = (s.kecamatan || '').toLowerCase();
    const q    = _adminSearch.toLowerCase();
    const okQ  = !q || nama.includes(q) || kec.includes(q);
    const okK  = !_adminFilterKat || nama.toUpperCase().startsWith(_adminFilterKat);
    const okS  = !_adminFilterStat || s.status === _adminFilterStat;
    return okQ && okK && okS;
  });
}

function renderAdminTable() {
  const PER = 10;
  const filtered = getAdminFiltered();
  const total    = Math.ceil(filtered.length / PER) || 1;
  _adminPage     = Math.max(1, Math.min(_adminPage, total));
  const slice    = filtered.slice((_adminPage - 1) * PER, _adminPage * PER);

  const tbody = document.getElementById('admin-tbody-sekolah');
  if (!tbody) return;

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="td-empty">Tidak ada data sekolah ditemukan</td></tr>';
  } else {
    tbody.innerHTML = slice.map((s, i) => {
      const no     = (_adminPage - 1) * PER + i + 1;
      const nama   = s.nama || '—';
      const jCls   = jenjangCls(nama);
      const jLabel = nama.match(/^(SD|SDN|MI|SMP|SMPN|MTS|SMA|SMAN|MA|SMK|SMKN)/i)?.[0] || '—';
      const stTxt  = s.status === 'N' ? 'Negeri' : s.status === 'S' ? 'Swasta' : s.status || '—';
      const stColor= s.status === 'N' ? '#1565C0' : '#e65100';
      const sisa   = typeof s.kuota === 'number' && typeof s.pendaftar === 'number'
                     ? Math.max(0, s.kuota - s.pendaftar) : '—';
      const sisaColor = typeof sisa === 'number' && sisa < 20 ? '#c62828' : '#2e7d32';
      return `<tr>
        <td>${no}</td>
        <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis" title="${nama}">${nama}</td>
        <td><span class="jenjang-pill ${jCls}">${jLabel}</span></td>
        <td style="color:${stColor};font-weight:600">${stTxt}</td>
        <td>${s.akreditasi || '—'}</td>
        <td>${s.kecamatan || '—'}</td>
        <td>${typeof s.kuota === 'number' ? s.kuota.toLocaleString() : '—'}</td>
        <td>${typeof s.pendaftar === 'number' ? s.pendaftar.toLocaleString() : '—'}</td>
        <td style="font-weight:600;color:${sisaColor}">${typeof sisa === 'number' ? sisa.toLocaleString() : sisa}</td>
        <td>${fRupiah(s.biaya)}</td>
        <td class="aksi-col">
          <button class="btn-edit"  data-aid="${s.id}">Edit</button>
          <button class="btn-hapus" data-aid="${s.id}" data-nama="${nama}">Hapus</button>
        </td>
      </tr>`;
    }).join('');

    // Bind tombol per baris
    tbody.querySelectorAll('.btn-edit[data-aid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = getSchools().find(x => String(x.id) === btn.dataset.aid);
        if (!s) return;
        _adminEditId = s.id;
        fillModalSekolah(s);
        document.getElementById('modal-sekolah-title').textContent = 'Edit Data Sekolah';
        openModal('modal-sekolah');
      });
    });
    tbody.querySelectorAll('.btn-hapus[data-aid]').forEach(btn => {
      btn.addEventListener('click', () => {
        showModalHapus(btn.dataset.nama, async () => {
          showLoading();
          try {
            await deleteSchool(Number(btn.dataset.aid));
            setSchools(getSchools().filter(x => String(x.id) !== btn.dataset.aid));
            renderAdminTable();
            showToast('Data sekolah berhasil dihapus', 'success');
          } catch (err) {
            showToast('Gagal menghapus: ' + err.message, 'error');
          } finally {
            hideLoading();
          }
        });
      });
    });
  }

  document.getElementById('admin-page-info').textContent = `Page ${_adminPage} of ${total}`;
  document.getElementById('admin-prev').disabled = _adminPage <= 1;
  document.getElementById('admin-next').disabled = _adminPage >= total;
}

/* ── Modal Sekolah (Admin: tambah / edit) ────────── */
function clearModalSekolah() {
  ['mf-npsn','mf-nama','mf-kecamatan','mf-kabkota','mf-alamat'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['mf-kuota','mf-pendaftar','mf-biaya','mf-spp','mf-lat','mf-lng'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const j = document.getElementById('mf-jenjang'); if (j) j.value = '';
  const s = document.getElementById('mf-status');  if (s) s.value = 'N';
  const a = document.getElementById('mf-akreditasi'); if (a) a.value = '-';
}

function fillModalSekolah(s) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  set('mf-npsn',      s.npsn     || '');
  set('mf-nama',      s.nama     || '');
  set('mf-jenjang',   s.jenjang  || (() => {
    // fallback: deteksi dari nama jika field jenjang kosong
    const n = (s.nama || '').toUpperCase();
    if (/SMK/.test(n)) return 'SMK';
    if (/SMA|SMAN/.test(n)) return 'SMA';
    if (/SMP|SMPN/.test(n)) return 'SMP';
    if (/SD|SDN/.test(n)) return 'SD';
    return '';
  })());
  set('mf-status',    s.status    || 'N');
  set('mf-akreditasi',s.akreditasi|| '-');
  set('mf-kecamatan', s.kecamatan || '');
  set('mf-kabkota',   s.kabupaten || '');
  set('mf-alamat',    s.alamat    || '');
  set('mf-kuota',     s.kuota     ?? '');
  set('mf-pendaftar', s.pendaftar ?? '');
  set('mf-biaya',     s.biaya     ?? '');
  set('mf-spp',       s.spp       ?? '');
  set('mf-lat',       s.lat       ?? '');
  set('mf-lng',       s.lng       ?? '');
}

function readModalSekolah() {
  const g = id => document.getElementById(id)?.value?.trim() ?? '';
  const gn = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? null : v; };
  return {
    npsn:      g('mf-npsn'),
    nama:      g('mf-nama'),
    jenjang:   g('mf-jenjang'),
    status:    g('mf-status'),
    akreditasi:g('mf-akreditasi'),
    kecamatan: g('mf-kecamatan'),
    kabupaten: g('mf-kabkota'),
    alamat:    g('mf-alamat'),
    kuota:     gn('mf-kuota'),
    pendaftar: gn('mf-pendaftar'),
    biaya:     gn('mf-biaya'),
    spp:       gn('mf-spp'),
    lat:       gn('mf-lat'),
    lng:       gn('mf-lng'),
  };
}

function bindModalSekolah() {
  const close = () => closeModal('modal-sekolah');
  document.getElementById('modal-sekolah-close')?.addEventListener('click', close);
  document.getElementById('modal-sekolah-batal')?.addEventListener('click', close);
  document.getElementById('modal-sekolah')?.addEventListener('click', e => {
    if (e.target.id === 'modal-sekolah') close();
  });

  document.getElementById('modal-sekolah-simpan')?.addEventListener('click', async () => {
    const data = readModalSekolah();
    if (!data.nama) { showToast('Nama sekolah wajib diisi', 'error'); return; }

    const backendPayload = toBackendSchema(data);

    showLoading();
    try {
      if (_adminEditId !== null) {
        // ── UPDATE ke API ──
        const updated = await updateSchool(_adminEditId, backendPayload);
        // Perbarui state lokal dari response API
        setSchools(getSchools().map(s =>
          String(s.id) === String(_adminEditId) ? normalize(updated) : s
        ));
        showToast('Data sekolah berhasil diperbarui ✅', 'success');
      } else {
        // ── CREATE ke API ──
        const created = await createSchool(backendPayload);
        // Refetch agar ID dari DB terisi
        const { data: fresh } = await fetchSekolah();
        setSchools(fresh);
        showToast(`Sekolah berhasil ditambahkan ✅ (ID: ${created.sekolah_id})`, 'success');
      }
      close();
      renderAdminTable();

      // Jika operator yang edit profil sekolahnya sendiri
      if (_opMySchool && String(_adminEditId) === String(_opMySchool.id)) {
        _opMySchool = { ..._opMySchool, ...data };
        renderOpProfil();
      }
    } catch (err) {
      showToast('Gagal menyimpan: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });
}

/* ── Admin Zonasi CRUD ───────────────────────── */
let _adminZonasiList = [];
let _adminZonasiEditId = null;
let _adminZonasiPage   = 1;
const ZONASI_PER_PAGE  = 10;

async function renderAdminZonasiTable() {
  const tbody = document.getElementById('admin-tbody-zonasi');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="td-empty">Memuat data…</td></tr>';

  try {
    _adminZonasiList = await fetchZonasi();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="td-empty">Gagal memuat: ${err.message}</td></tr>`;
    return;
  }

  _renderZonasiRows();
}

function _renderZonasiRows() {
  const tbody = document.getElementById('admin-tbody-zonasi');
  const total = Math.ceil(_adminZonasiList.length / ZONASI_PER_PAGE) || 1;
  _adminZonasiPage = Math.max(1, Math.min(_adminZonasiPage, total));
  const slice = _adminZonasiList.slice(
    (_adminZonasiPage - 1) * ZONASI_PER_PAGE,
    _adminZonasiPage * ZONASI_PER_PAGE
  );

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="td-empty">Belum ada data zonasi</td></tr>';
  } else {
    tbody.innerHTML = slice.map((z, i) => `
      <tr>
        <td>${(_adminZonasiPage - 1) * ZONASI_PER_PAGE + i + 1}</td>
        <td style="font-weight:600">${z.nama_zonasi || '—'}</td>
        <td>${z.radius_meter != null ? Number(z.radius_meter).toLocaleString('id-ID') : '—'}</td>
        <td>${z.wilayah || '—'}</td>
        <td>${z.keterangan || '—'}</td>
        <td class="aksi-col">
          <button class="btn-edit"  data-zid="${z.zonasi_id}">Edit</button>
          <button class="btn-hapus" data-zid="${z.zonasi_id}" data-nama="${z.nama_zonasi}">Hapus</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('.btn-edit[data-zid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const z = _adminZonasiList.find(x => String(x.zonasi_id) === btn.dataset.zid);
        if (!z) return;
        _adminZonasiEditId = z.zonasi_id;
        document.getElementById('mz-nama').value       = z.nama_zonasi   || '';
        document.getElementById('mz-radius').value     = z.radius_meter  ?? '';
        document.getElementById('mz-wilayah').value    = z.wilayah       || '';
        document.getElementById('mz-keterangan').value = z.keterangan    || '';
        document.getElementById('modal-zonasi-title').textContent = 'Edit Zonasi';
        openModal('modal-zonasi');
      });
    });
    tbody.querySelectorAll('.btn-hapus[data-zid]').forEach(btn => {
      btn.addEventListener('click', () => {
        showModalHapus(btn.dataset.nama, async () => {
          showLoading();
          try {
            await deleteZonasi(Number(btn.dataset.zid));
            _adminZonasiList = _adminZonasiList.filter(x => String(x.zonasi_id) !== btn.dataset.zid);
            _renderZonasiRows();
            showToast('Zonasi berhasil dihapus', 'success');
          } catch (err) {
            showToast('Gagal menghapus: ' + err.message, 'error');
          } finally {
            hideLoading();
          }
        });
      });
    });
  }

  const pageInfo = document.getElementById('admin-zon-page-info');
  if (pageInfo) pageInfo.textContent = `Page ${_adminZonasiPage} of ${total}`;
  const prevBtn = document.getElementById('admin-zon-prev');
  const nextBtn = document.getElementById('admin-zon-next');
  if (prevBtn) prevBtn.disabled = _adminZonasiPage <= 1;
  if (nextBtn) nextBtn.disabled = _adminZonasiPage >= total;
}

function bindModalZonasi() {
  const closeZ = () => { closeModal('modal-zonasi'); _adminZonasiEditId = null; };
  document.getElementById('modal-zonasi-close')?.addEventListener('click', closeZ);
  document.getElementById('modal-zonasi-batal')?.addEventListener('click', closeZ);
  document.getElementById('modal-zonasi')?.addEventListener('click', e => {
    if (e.target.id === 'modal-zonasi') closeZ();
  });

  // Tambah button
  document.getElementById('admin-btn-tambah-zonasi')?.addEventListener('click', () => {
    _adminZonasiEditId = null;
    ['mz-nama','mz-radius','mz-wilayah','mz-keterangan'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('modal-zonasi-title').textContent = 'Tambah Zonasi';
    openModal('modal-zonasi');
  });

  // Zonasi pagination
  document.getElementById('admin-zon-prev')?.addEventListener('click', () => {
    _adminZonasiPage--; _renderZonasiRows();
  });
  document.getElementById('admin-zon-next')?.addEventListener('click', () => {
    _adminZonasiPage++; _renderZonasiRows();
  });

  // Simpan (create / update)
  document.getElementById('modal-zonasi-simpan')?.addEventListener('click', async () => {
    const nama       = document.getElementById('mz-nama')?.value.trim();
    const radius     = parseFloat(document.getElementById('mz-radius')?.value) || null;
    const wilayah    = document.getElementById('mz-wilayah')?.value.trim()    || null;
    const keterangan = document.getElementById('mz-keterangan')?.value.trim() || null;

    if (!nama) { showToast('Nama zonasi wajib diisi', 'error'); return; }

    const payload = { nama_zonasi: nama, radius_meter: radius, wilayah, keterangan };
    showLoading();
    try {
      if (_adminZonasiEditId !== null) {
        const updated = await updateZonasi(_adminZonasiEditId, payload);
        _adminZonasiList = _adminZonasiList.map(z =>
          z.zonasi_id === _adminZonasiEditId ? { ...z, ...updated } : z
        );
        showToast('Zonasi berhasil diperbarui ✅', 'success');
      } else {
        // Refetch setelah create agar ID dari DB tersedia
        await createZonasi(payload);
        _adminZonasiList = await fetchZonasi();
        showToast('Zonasi berhasil ditambahkan ✅', 'success');
      }
      closeZ();
      _renderZonasiRows();
    } catch (err) {
      showToast('Gagal menyimpan zonasi: ' + err.message, 'error');
    } finally {
      hideLoading();
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
   OPERATOR DASHBOARD
══════════════════════════════════════════════════════════════════ */

/* ── localStorage persistence helpers ── */
const LS_ROMBEL    = 'zj_op_rombel';
const LS_BIAYA     = 'zj_op_biaya';
const LS_FASILITAS = 'zj_op_fasilitas';

function lsLoad(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (_) { return fallback; }
}
function lsSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
}

// State rombel & biaya — persisted in localStorage
let _opRombel = lsLoad(LS_ROMBEL, [
  { id:1, kelas:'Kelas X IPA',    kuota:120, pendaftar:85 },
  { id:2, kelas:'Kelas X IPS',    kuota:120, pendaftar:94 },
  { id:3, kelas:'Kelas X Bahasa', kuota:80,  pendaftar:60 },
]);
let _opBiaya = lsLoad(LS_BIAYA, { gedung:5000000, seragam:800000, buku:600000, spp:200000, komite:50000, catatan:'Estimasi biaya. Siswa penerima KIP/PIP dapat keringanan.' });
let _opFasilitas = lsLoad(LS_FASILITAS, [
  { id:1, nama:'Ruang Kelas',         jumlah:30, kondisi:'Baik', ket:'—' },
  { id:2, nama:'Laboratorium IPA',    jumlah:2,  kondisi:'Baik', ket:'—' },
  { id:3, nama:'Perpustakaan',        jumlah:1,  kondisi:'Baik', ket:'—' },
]);
let _opEditRombelId  = null;
let _opEditFasId     = null;
let _opMySchool      = null; // sekolah afiliasi operator

async function initOperatorDashboard(user) {
  const nameEl = document.getElementById('op-user-name');
  if (nameEl) nameEl.textContent = user?.username || 'Operator';

  // ── Muat sekolah afiliasi dari API ──────────────────────────────
  const userId = user?.user_id ?? user?.id ?? null;
  if (userId) {
    try {
      const rawSchool = await getMySchool(userId);
      if (rawSchool) {
        _opMySchool = normalize(rawSchool);
      } else {
        showToast('Sekolah afiliasi tidak ditemukan. Hubungi admin.', 'error', 6000);
        _opMySchool = null;
      }
    } catch (err) {
      console.warn('[Operator] Gagal memuat sekolah dari API:', err.message);
      // Fallback: ambil dari state yang sudah dimuat
      _opMySchool = getSchools()[0] || null;
    }
  } else {
    // Tidak ada user_id (mis. data lama di localStorage) — fallback
    _opMySchool = getSchools()[0] || null;
  }

  if (!_opMySchool) {
    _opMySchool = {
      nama:'—', status:'N', akreditasi:'-',
      kecamatan:'', kabupaten:'', alamat:'',
      kuota:0, pendaftar:0, lat:0, lng:0,
    };
  }

  // Update label sidebar
  const lbl = document.getElementById('op-school-label');
  if (lbl) lbl.textContent = _opMySchool.nama;

  // Sidebar nav
  document.querySelectorAll('#page-operator .dash-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#page-operator .dash-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('#page-operator .dash-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('op-panel-' + btn.dataset.opPanel)?.classList.add('active');
    });
  });

  // Kembali ke Home
  document.getElementById('op-back-home')?.addEventListener('click', () => navigateTo('home'));

  // Logout
  document.getElementById('op-logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('user_session');
    clearPageSession();
    navigateTo('login');
    showToast('Berhasil keluar', 'info');
  });

  // Edit profil sekolah
  document.getElementById('op-btn-edit-profil')?.addEventListener('click', () => {
    _adminEditId = _opMySchool?.id ?? null;
    fillModalSekolah(_opMySchool || {});
    document.getElementById('modal-sekolah-title').textContent = 'Edit Profil Sekolah';
    openModal('modal-sekolah');
  });

  bindModalSekolahOp();
  bindModalRombel();
  bindModalBiaya();
  bindModalFasilitas();
  bindModalHapus();

  renderOpProfil();
  renderOpKuota();
  renderOpBiaya();
  renderOpFasilitas();
}

/* Profil */
function renderOpProfil() {
  const s   = _opMySchool;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };

  set('op-school-name',   s.nama);
  set('op-school-kec',    s.kecamatan || '—');
  set('op-school-kab',    s.kabkota   || '—');
  set('op-school-alamat', s.alamat    || '—');

  const jEl = document.getElementById('op-school-jenjang');
  if (jEl) { const n = s.nama || ''; const lbl = n.match(/^(SD|SDN|MI|SMP|SMPN|MTS|SMA|SMAN|MA|SMK|SMKN)/i)?.[0] || '—'; jEl.textContent = lbl; jEl.className = 'jenjang-pill ' + jenjangCls(n); }

  const stEl = document.getElementById('op-school-status');
  if (stEl) { stEl.textContent = s.status === 'N' ? 'Negeri' : 'Swasta'; stEl.className = 'status-pill status-aktif'; }

  const akEl = document.getElementById('op-school-akred');
  if (akEl) { akEl.textContent = 'Akreditasi ' + (s.akreditasi || '—'); akEl.className = 'akred-pill'; }

  const kuota     = s.kuota     ?? 0;
  const pendaftar = s.pendaftar ?? 0;
  const sisa      = Math.max(0, kuota - pendaftar);
  const persen    = kuota > 0 ? Math.round(pendaftar / kuota * 100) : 0;

  set('op-stat-kuota',    kuota.toLocaleString());
  set('op-stat-pendaftar',pendaftar.toLocaleString());
  set('op-stat-sisa',     sisa.toLocaleString());
  set('op-stat-persen',   persen + '%');
  set('op-progress-label',persen + '%');

  const fill = document.getElementById('op-progress-fill');
  if (fill) fill.style.width = Math.min(100, persen) + '%';

  // Warna stat terisi
  const pc = document.getElementById('op-stat-persen-card');
  if (pc) {
    pc.className = 'op-stat-card ' +
      (persen >= 100 ? 'op-stat--red' : persen >= 80 ? 'op-stat--amber' : 'op-stat--green');
  }
}

/* Kuota / Rombel */
function renderOpKuota() {
  const tbody = document.getElementById('op-tbody-kuota');
  if (!tbody) return;

  if (!_opRombel.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="td-empty">Belum ada data rombel</td></tr>';
  } else {
    tbody.innerHTML = _opRombel.map((r, i) => {
      const sisa   = Math.max(0, r.kuota - r.pendaftar);
      const pct    = r.kuota > 0 ? Math.round(r.pendaftar / r.kuota * 100) : 0;
      const stCls  = pct >= 100 ? 'status-rusak' : pct >= 80 ? 'status-cukup' : 'status-aktif';
      const stTxt  = pct >= 100 ? 'Penuh' : pct >= 80 ? 'Terbatas' : 'Tersedia';
      return `<tr>
        <td>${i + 1}</td>
        <td style="font-weight:600">${r.kelas}</td>
        <td>${r.kuota}</td>
        <td>${r.pendaftar}</td>
        <td style="font-weight:600;color:${sisa < 10 ? '#c62828' : '#2e7d32'}">${sisa}</td>
        <td><span class="status-pill ${stCls}">${stTxt}</span></td>
        <td class="aksi-col">
          <button class="btn-edit"  data-rid="${r.id}">Edit</button>
          <button class="btn-hapus" data-rid="${r.id}" data-nama="${r.kelas}">Hapus</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-edit[data-rid]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = _opRombel.find(x => x.id === Number(btn.dataset.rid));
        if (!r) return;
        _opEditRombelId = r.id;
        document.getElementById('mr-kelas').value     = r.kelas;
        document.getElementById('mr-kuota').value     = r.kuota;
        document.getElementById('mr-pendaftar').value = r.pendaftar;
        document.getElementById('modal-rombel-title').textContent = 'Edit Rombel';
        openModal('modal-rombel');
      });
    });
    tbody.querySelectorAll('.btn-hapus[data-rid]').forEach(btn => {
      btn.addEventListener('click', () => {
        showModalHapus(btn.dataset.nama, () => {
          _opRombel = _opRombel.filter(x => x.id !== Number(btn.dataset.rid));
          lsSave(LS_ROMBEL, _opRombel);
          renderOpKuota();
          showToast('Rombel berhasil dihapus', 'success');
        });
      });
    });
  }

  // Summary
  const totalK = _opRombel.reduce((a, r) => a + r.kuota,     0);
  const totalP = _opRombel.reduce((a, r) => a + r.pendaftar, 0);
  const sumEl  = document.getElementById('op-kuota-summary');
  if (sumEl) sumEl.textContent = `Total: ${totalK.toLocaleString()} kuota, ${totalP.toLocaleString()} pendaftar, sisa ${Math.max(0, totalK - totalP).toLocaleString()}`;
}

/* Biaya */
function renderOpBiaya() {
  const b   = _opBiaya;
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = fRupiah(v); };
  set('ob-gedung',  b.gedung);
  set('ob-seragam', b.seragam);
  set('ob-buku',    b.buku);
  set('ob-total-masuk', b.gedung + b.seragam + b.buku);
  set('ob-spp',     b.spp);
  set('ob-komite',  b.komite);
  set('ob-total-rutin', b.spp + b.komite);
  const cEl = document.getElementById('ob-catatan'); if (cEl) cEl.textContent = b.catatan || '—';
}

/* Fasilitas */
function renderOpFasilitas() {
  const tbody = document.getElementById('op-tbody-fasilitas');
  if (!tbody) return;
  tbody.innerHTML = _opFasilitas.map((f, i) => {
    const cCls = f.kondisi === 'Baik' ? 'status-baik' : f.kondisi === 'Cukup' ? 'status-cukup' : 'status-rusak';
    return `<tr>
      <td>${i + 1}</td>
      <td style="font-weight:600">${f.nama}</td>
      <td>${f.jumlah}</td>
      <td><span class="status-pill ${cCls}">${f.kondisi}</span></td>
      <td>${f.ket || '—'}</td>
      <td class="aksi-col">
        <button class="btn-edit"  data-fid="${f.id}">Edit</button>
        <button class="btn-hapus" data-fid="${f.id}" data-nama="${f.nama}">Hapus</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="td-empty">Belum ada fasilitas</td></tr>';

  tbody.querySelectorAll('.btn-edit[data-fid]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = _opFasilitas.find(x => x.id === Number(btn.dataset.fid));
      if (!f) return;
      _opEditFasId = f.id;
      document.getElementById('mfas-nama').value    = f.nama;
      document.getElementById('mfas-jumlah').value  = f.jumlah;
      document.getElementById('mfas-kondisi').value = f.kondisi;
      document.getElementById('mfas-ket').value     = f.ket || '';
      document.getElementById('modal-fasilitas-title').textContent = 'Edit Fasilitas';
      openModal('modal-fasilitas');
    });
  });
  tbody.querySelectorAll('.btn-hapus[data-fid]').forEach(btn => {
    btn.addEventListener('click', () => {
      showModalHapus(btn.dataset.nama, () => {
        _opFasilitas = _opFasilitas.filter(x => x.id !== Number(btn.dataset.fid));
        lsSave(LS_FASILITAS, _opFasilitas);
        renderOpFasilitas();
        showToast('Fasilitas berhasil dihapus', 'success');
      });
    });
  });
}

/* ── Bind modals (Operator) ──────────────────────── */
function bindModalSekolahOp() {
  // Modal sekolah digunakan bersama dengan admin.
  // bindModalSekolah() sudah di-bind di initAdminDashboard.
  // Untuk operator, cukup pastikan tidak di-bind dua kali.
  if (!document.getElementById('modal-sekolah').dataset.bound) {
    bindModalSekolah();
    document.getElementById('modal-sekolah').dataset.bound = 'true';
  }
  // Setelah simpan, _opMySchool diperbarui di dalam bindModalSekolah
  // (lihat bagian "if (_opMySchool && String(_adminEditId) === String(_opMySchool.id))")
}

function bindModalRombel() {
  const closeR = () => { closeModal('modal-rombel'); _opEditRombelId = null; };
  document.getElementById('modal-rombel-close')?.addEventListener('click', closeR);
  document.getElementById('modal-rombel-batal')?.addEventListener('click', closeR);
  document.getElementById('modal-rombel')?.addEventListener('click', e => { if (e.target.id === 'modal-rombel') closeR(); });

  document.getElementById('op-btn-tambah-rombel')?.addEventListener('click', () => {
    _opEditRombelId = null;
    ['mr-kelas','mr-kuota','mr-pendaftar'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('modal-rombel-title').textContent = 'Tambah Rombel';
    openModal('modal-rombel');
  });

  document.getElementById('modal-rombel-simpan')?.addEventListener('click', () => {
    const kelas     = document.getElementById('mr-kelas')?.value.trim();
    const kuota     = parseInt(document.getElementById('mr-kuota')?.value) || 0;
    const pendaftar = parseInt(document.getElementById('mr-pendaftar')?.value) || 0;
    if (!kelas || kuota <= 0) { showToast('Nama kelas dan kuota wajib diisi', 'error'); return; }

    if (_opEditRombelId !== null) {
      _opRombel = _opRombel.map(r => r.id === _opEditRombelId ? { ...r, kelas, kuota, pendaftar } : r);
      showToast('Rombel berhasil diperbarui ✅', 'success');
    } else {
      _opRombel.push({ id: Date.now(), kelas, kuota, pendaftar });
      showToast('Rombel berhasil ditambahkan ✅', 'success');
    }
    lsSave(LS_ROMBEL, _opRombel);
    closeR();
    renderOpKuota();
  });
}

function bindModalBiaya() {
  const closeB = () => closeModal('modal-biaya');
  document.getElementById('modal-biaya-close')?.addEventListener('click', closeB);
  document.getElementById('modal-biaya-batal')?.addEventListener('click', closeB);
  document.getElementById('modal-biaya')?.addEventListener('click', e => { if (e.target.id === 'modal-biaya') closeB(); });

  document.getElementById('op-btn-edit-biaya')?.addEventListener('click', () => {
    document.getElementById('mb-gedung').value  = _opBiaya.gedung;
    document.getElementById('mb-seragam').value = _opBiaya.seragam;
    document.getElementById('mb-buku').value    = _opBiaya.buku;
    document.getElementById('mb-spp').value     = _opBiaya.spp;
    document.getElementById('mb-komite').value  = _opBiaya.komite;
    document.getElementById('mb-catatan').value = _opBiaya.catatan;
    openModal('modal-biaya');
  });

  document.getElementById('modal-biaya-simpan')?.addEventListener('click', () => {
    _opBiaya = {
      gedung:  parseInt(document.getElementById('mb-gedung').value)  || 0,
      seragam: parseInt(document.getElementById('mb-seragam').value) || 0,
      buku:    parseInt(document.getElementById('mb-buku').value)    || 0,
      spp:     parseInt(document.getElementById('mb-spp').value)     || 0,
      komite:  parseInt(document.getElementById('mb-komite').value)  || 0,
      catatan: document.getElementById('mb-catatan').value.trim(),
    };
    lsSave(LS_BIAYA, _opBiaya);
    closeB();
    renderOpBiaya();
    showToast('Data biaya berhasil diperbarui ✅', 'success');
  });
}

function bindModalFasilitas() {
  const closeF = () => { closeModal('modal-fasilitas'); _opEditFasId = null; };
  document.getElementById('modal-fasilitas-close')?.addEventListener('click', closeF);
  document.getElementById('modal-fasilitas-batal')?.addEventListener('click', closeF);
  document.getElementById('modal-fasilitas')?.addEventListener('click', e => { if (e.target.id === 'modal-fasilitas') closeF(); });

  document.getElementById('op-btn-tambah-fasilitas')?.addEventListener('click', () => {
    _opEditFasId = null;
    ['mfas-nama','mfas-ket'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('mfas-jumlah').value  = 1;
    document.getElementById('mfas-kondisi').value = 'Baik';
    document.getElementById('modal-fasilitas-title').textContent = 'Tambah Fasilitas';
    openModal('modal-fasilitas');
  });

  document.getElementById('modal-fasilitas-simpan')?.addEventListener('click', () => {
    const nama    = document.getElementById('mfas-nama')?.value.trim();
    const jumlah  = parseInt(document.getElementById('mfas-jumlah')?.value) || 1;
    const kondisi = document.getElementById('mfas-kondisi')?.value || 'Baik';
    const ket     = document.getElementById('mfas-ket')?.value.trim() || '—';
    if (!nama) { showToast('Nama fasilitas wajib diisi', 'error'); return; }

    if (_opEditFasId !== null) {
      _opFasilitas = _opFasilitas.map(f => f.id === _opEditFasId ? { ...f, nama, jumlah, kondisi, ket } : f);
      showToast('Fasilitas berhasil diperbarui ✅', 'success');
    } else {
      _opFasilitas.push({ id: Date.now(), nama, jumlah, kondisi, ket });
      showToast('Fasilitas berhasil ditambahkan ✅', 'success');
    }
    lsSave(LS_FASILITAS, _opFasilitas);
    closeF();
    renderOpFasilitas();
  });
}

// 21-04-2026
document.addEventListener('change', function(event) {
  // Pastikan elemen yang memicu event adalah dropdown role
  if (event.target && event.target.id === 'reg-role') {
    const role = event.target.value;
    
    // Tampilkan log di console (F12) untuk memastikan script berjalan
    //console.log("Dropdown role diubah menjadi:", role); 

    const extraAdmin = document.getElementById('extra-admin');
    const extraOperator = document.getElementById('extra-operator');

    // Manipulasi style.display secara langsung agar menang dari inline CSS
    if (extraAdmin) {
      extraAdmin.style.display = (role === 'admin') ? 'block' : 'none';
    } else {
      console.warn("Elemen #extra-admin tidak ditemukan di HTML!");
    }

    if (extraOperator) {
      extraOperator.style.display = (role === 'sekolah') ? 'block' : 'none';
    } else {
      console.warn("Elemen #extra-operator tidak ditemukan di HTML!");
    }
  }
});