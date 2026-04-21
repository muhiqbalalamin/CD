/**
 * main.js — Entry Point & Orkestrator
 * Mengelola routing halaman, 2-step zonasi flow,
 * dan menghubungkan semua modul.
 */
import { fetchSekolah, registerUser,  loginUser }   from './api.js';
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
import { filterSchools, paginate, debounce } from './utils.js';

// ── Pagination state ──
let _homePageNum   = 1;
let _mapPageNum    = 1;
let _zonasiPageNum = 1;
let _mapInitDone   = false;
let _zonasiInitDone= false;
let _mapFilterKat  = '';
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

  toggleSearchBar(!isAuth && (page === 'map' || page === 'zonasi'));

  if (page === 'map' && !_mapInitDone) {
    _mapInitDone = true;
    setTimeout(() => { initMapPage(); renderMapPage(); invalidateMaps(); }, 50);
  }
  if (page === 'map' || page === 'zonasi') {
    setTimeout(invalidateMaps, 120);
  }
}

/* ══════════════════════════════════════════════════
   ZONASI: 2-STEP FLOW
══════════════════════════════════════════════════ */

/** Tampilkan Step 1 (form input), sembunyikan Step 2 (peta) */
function showZonasiInputStep() {
  document.getElementById('zonasi-input-step').classList.remove('hidden');
  document.getElementById('zonasi-result-step').classList.add('hidden');
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
  const { items, page, total } = paginate(getSchools(), _homePageNum, 5);
  renderHomeTable(items, page, total);
}

function renderMapPage() {
  const schools  = getSchools();
  const filtered = filterSchools(schools, { kat: _mapFilterKat });
  const { items, page, total } = paginate(filtered, _mapPageNum, 8);
  renderMapMarkers(filtered);
  renderFlatList('map-list','map-page-info','map-prev','map-next',
    items, page, total,
    s => flyToOnMap(s),
    s => highlightMapMarker(s.id),
    () => {}
  );
}

function renderZonasiPage() {
  const schools  = getSchools();
  const filtered = filterSchools(schools, { kat: _zonFilterKat });
  const { items, page, total } = paginate(filtered, _zonasiPageNum, 8);
  renderZonasiMarkers(filtered);
  renderFlatList('zon-list','zon-page-info','zon-prev','zon-next',
    items, page, total,
    s => flyToOnZonasi(s),
    s => highlightZonasiMarker(s.id),
    s => unhighlightZonasiMarker(s.id)
  );
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
      const username = document.getElementById('reg-user').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-pass').value;
      const role = document.getElementById('reg-role').value;

      // Ambil data tambahan
      const adminCode = document.getElementById('reg-admin-code')?.value || null;
      const operatorCode = document.getElementById('reg-op-code')?.value || null;
      const npsn = document.getElementById('reg-school-id')?.value.trim() || null;

      try {
        showLoading();
        console.log("NPSN (frontend):", `"${npsn}"`, npsn.length);
        await registerUser(username, email, password, role, adminCode, operatorCode, npsn);
        hideLoading();
        showToast('Registrasi berhasil! Silakan login.', 'success');
        navigateTo('login'); 
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-pass').value;

      try {
        showLoading();
        const user = await loginUser(email, password);
        hideLoading();
        showToast(`Selamat datang, ${user.username} 👋`, 'success');
        
        // Logika pengalihan berdasarkan Role ***belum***
        /*if (user.role === 'admin') {
          window.location.href = '/admin-dashboard.html'; 
        } else if (user.role === 'sekolah') {
          window.location.href = '/school-manage.html';
        } else {
          navigateTo('home');
          updateUIForLoggedInUser(user);
        }*/
        // Routing berdasarkan role
        updateUIForLoggedInUser();
        if (user.role === 'admin') {
          navigateTo('admin');
          initAdminDashboard(user);
        } else if (user.role === 'sekolah') {
          navigateTo('operator');
          initOperatorDashboard(user);
        } else {
          navigateTo('home');
        }
      } catch (err) {
        hideLoading();
        console.error("Login error");
        showToast(err.message, 'error');
        // Kosongkan password
        document.getElementById('login-pass').value = '';
        // Fokus kembali ke password
        document.getElementById('login-pass').focus();
      }
    });
  }

  document.addEventListener('click', e => {
    if (e.target.classList.contains('keluar-link')) {
      e.preventDefault();
      localStorage.removeItem('user_session');
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

  // Home pagination
  document.getElementById('home-prev').addEventListener('click', () => { _homePageNum--; renderHomePage(); });
  document.getElementById('home-next').addEventListener('click', () => { _homePageNum++; renderHomePage(); });

  // Map pagination & filter
  document.getElementById('map-prev').addEventListener('click', () => { _mapPageNum--; renderMapPage(); });
  document.getElementById('map-next').addEventListener('click', () => { _mapPageNum++; renderMapPage(); });
  document.getElementById('map-apply').addEventListener('click', () => {
    _mapFilterKat = document.getElementById('map-kat').value;
    _mapPageNum = 1; renderMapPage();
    showToast('Filter diterapkan', 'success');
  });
  document.getElementById('map-clear').addEventListener('click', () => {
    _mapFilterKat = ''; document.getElementById('map-kat').value = '';
    _mapPageNum = 1; renderMapPage();
  });

  // Zonasi pagination & filter
  document.getElementById('zon-prev').addEventListener('click', () => { _zonasiPageNum--; renderZonasiPage(); });
  document.getElementById('zon-next').addEventListener('click', () => { _zonasiPageNum++; renderZonasiPage(); });
  document.getElementById('zon-apply').addEventListener('click', () => {
    _zonFilterKat = document.getElementById('zon-kat').value;
    _zonasiPageNum = 1; renderZonasiPage();
    showToast('Filter diterapkan', 'success');
  });
  document.getElementById('zon-clear').addEventListener('click', () => {
    _zonFilterKat = ''; document.getElementById('zon-kat').value = '';
    _zonasiPageNum = 1; renderZonasiPage();
  });

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
        _mapFilterKat = q; _mapPageNum = 1; renderMapPage();
      }
    }, 300)
  );

  // Carousel dummy
  document.getElementById('berita-prev')?.addEventListener('click', () => {});
  document.getElementById('berita-next')?.addEventListener('click', () => {});

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
  initTabs();
  bindKoordinatSubmit();
  bindKotaSearch();
  bindEvents();
  bindAuthEvents();
  updateUIForLoggedInUser();

  // ── Restore halaman terakhir atau arahkan berdasarkan status login ──
  const userJson   = localStorage.getItem('user_session');
  const lastPage   = restorePageSession(); // null jika expired / tidak ada

  if (!userJson) {
    // Belum login → selalu ke login
    clearPageSession();
    navigateTo('login');
  } else {
    // Sudah login
    const user = JSON.parse(userJson);

    if (lastPage && lastPage !== 'login' && lastPage !== 'register') {
      // Restore halaman terakhir (masih dalam 30 menit)
      navigateTo(lastPage);
      if (lastPage === 'admin')    initAdminDashboard(user);
      if (lastPage === 'operator') initOperatorDashboard(user);
    } else {
      // Tidak ada sesi tersimpan atau expired → arahkan sesuai role
      if (user.role === 'admin') {
        navigateTo('admin');
        initAdminDashboard(user);
      } else if (user.role === 'sekolah') {
        navigateTo('operator');
        initOperatorDashboard(user);
      } else {
        navigateTo('home');
      }
    }
  }

  showZonasiInputStep();
}

boot();

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
  document.getElementById('admin-logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('user_session');
    clearPageSession();
    navigateTo('login');
    showToast('Berhasil keluar', 'info');
  });

  bindModalSekolah();
  bindModalHapus();
  renderAdminTable();
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
        showModalHapus(btn.dataset.nama, () => {
          setSchools(getSchools().filter(x => String(x.id) !== btn.dataset.aid));
          renderAdminTable();
          showToast('Data sekolah berhasil dihapus', 'success');
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
  set('mf-npsn', s.npsn || '');
  set('mf-nama', s.nama || '');
  // jenjang: deteksi dari nama
  const n = (s.nama || '').toUpperCase();
  let j = '';
  if (/SMK/.test(n)) j = 'SMK'; else if (/SMA|SMAN/.test(n)) j = 'SMA';
  else if (/SMP|SMPN/.test(n)) j = 'SMP'; else if (/SD|SDN/.test(n)) j = 'SD';
  set('mf-jenjang', j);
  set('mf-status', s.status || 'N');
  set('mf-akreditasi', s.akreditasi || '-');
  set('mf-kecamatan', s.kecamatan || '');
  set('mf-kabkota', '');
  set('mf-alamat', s.alamat || '');
  set('mf-kuota', s.kuota ?? '');
  set('mf-pendaftar', s.pendaftar ?? '');
  set('mf-biaya', s.biaya ?? '');
  set('mf-spp', s.spp ?? '');
  set('mf-lat', s.lat ?? '');
  set('mf-lng', s.lng ?? '');
}

function readModalSekolah() {
  const g = id => document.getElementById(id)?.value?.trim() ?? '';
  const gn = id => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? null : v; };
  return {
    npsn:      g('mf-npsn'),
    nama:      g('mf-nama'),
    status:    g('mf-status'),
    akreditasi:g('mf-akreditasi'),
    kecamatan: g('mf-kecamatan'),
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

  document.getElementById('modal-sekolah-simpan')?.addEventListener('click', () => {
    const data = readModalSekolah();
    if (!data.nama) { showToast('Nama sekolah wajib diisi', 'error'); return; }

    if (_adminEditId !== null) {
      setSchools(getSchools().map(s => String(s.id) === String(_adminEditId) ? { ...s, ...data } : s));
      showToast('Data sekolah berhasil diperbarui ✅', 'success');
    } else {
      data.id = Date.now();
      setSchools([...getSchools(), data]);
      showToast('Sekolah baru berhasil ditambahkan ✅', 'success');
    }
    close();
    renderAdminTable();
  });
}

/* ══════════════════════════════════════════════════════════════════
   OPERATOR DASHBOARD
══════════════════════════════════════════════════════════════════ */

// State rombel & biaya (frontend-only simulasi)
let _opRombel = [
  { id:1, kelas:'Kelas X IPA',    kuota:120, pendaftar:85 },
  { id:2, kelas:'Kelas X IPS',    kuota:120, pendaftar:94 },
  { id:3, kelas:'Kelas X Bahasa', kuota:80,  pendaftar:60 },
];
let _opBiaya = { gedung:5000000, seragam:800000, buku:600000, spp:200000, komite:50000, catatan:'Estimasi biaya. Siswa penerima KIP/PIP dapat keringanan.' };
let _opFasilitas = [
  { id:1, nama:'Ruang Kelas',         jumlah:30, kondisi:'Baik', ket:'—' },
  { id:2, nama:'Laboratorium IPA',    jumlah:2,  kondisi:'Baik', ket:'—' },
  { id:3, nama:'Perpustakaan',        jumlah:1,  kondisi:'Baik', ket:'—' },
];
let _opEditRombelId  = null;
let _opEditFasId     = null;
let _opMySchool      = null; // sekolah afiliasi operator

function initOperatorDashboard(user) {
  const nameEl = document.getElementById('op-user-name');
  if (nameEl) nameEl.textContent = user?.username || 'Operator';

  // Tentukan sekolah afiliasi (simulasi: ambil sekolah pertama dari data)
  _opMySchool = getSchools()[0] || {
    nama:'SMAN 1 Bandung', status:'N', akreditasi:'A',
    kecamatan:'Coblong', alamat:'Jl. Ir. H. Juanda No.93',
    kuota:480, pendaftar:312, lat:-6.8951, lng:107.6139,
  };

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
  document.getElementById('op-back-home')?.addEventListener('click', () => {
    navigateTo('home');
  });

  // Logout
  document.getElementById('op-logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('user_session');
    clearPageSession();
    navigateTo('login');
    showToast('Berhasil keluar', 'info');
  });

  // Edit profil
  document.getElementById('op-btn-edit-profil')?.addEventListener('click', () => {
    _adminEditId = _opMySchool.id;
    fillModalSekolah(_opMySchool);
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
        renderOpFasilitas();
        showToast('Fasilitas berhasil dihapus', 'success');
      });
    });
  });
}

/* ── Bind modals (Operator) ──────────────────────── */
function bindModalSekolahOp() {
  // Operator pakai modal-sekolah yang sama (sudah di-bind di bindModalSekolah),
  // tapi simpannya update _opMySchool
  document.getElementById('modal-sekolah-simpan')?.addEventListener('click', () => {
    if (_adminEditId !== null && _opMySchool && String(_adminEditId) === String(_opMySchool.id)) {
      _opMySchool = { ..._opMySchool, ...readModalSekolah() };
      renderOpProfil();
    }
  }, { capture: false });
  // Bind sekali — hindari duplikat jika admin juga bind
  if (!document.getElementById('modal-sekolah').dataset.bound) {
    bindModalSekolah();
    document.getElementById('modal-sekolah').dataset.bound = 'true';
  }
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
    console.log("Dropdown role diubah menjadi:", role); 

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