/**
 * main.js — Entry Point & Orkestrator
 * Mengelola routing halaman, 2-step zonasi flow,
 * dan menghubungkan semua modul.
 */
import { fetchSekolah, registerUser, loginUser }   from './api.js';
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

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (!target) return;
  target.classList.add('active');
  setActiveNav(page);
  
  // Sembunyikan navbar & bottom nav di halaman auth
  const isAuth = AUTH_PAGES.has(page);
  document.querySelector('.navbar').style.display    = isAuth ? 'none' : '';
  document.querySelector('.bottom-nav').style.display = isAuth ? 'none' : '';
  document.getElementById('search-bar-row').style.display = isAuth ? 'none' : '';

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

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('reg-user').value;
      const email = document.getElementById('reg-email').value;
      const password = document.getElementById('reg-pass').value;
      const role = document.getElementById('reg-role').value; // Pastikan ada dropdown role di HTML

      try {
        showLoading();
        await registerUser(username, email, password, role);
        hideLoading();
        showToast('Registrasi berhasil! Silakan login.', 'success');
        navigateTo('login'); // Pindah ke halaman login
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
        navigateTo('home');
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
      localStorage.removeItem('user_session'); // Hapus session
      showToast('Berhasil keluar', 'info');
      
      // Refresh atau arahkan ke home untuk mereset UI
      setTimeout(() => {
        window.location.reload();
      }, 500);
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
  // 18-04-2026
  bindAuthEvents();
  updateUIForLoggedInUser();

  // 16-04-2026
  /*onMapClick((lat, lng) => {
    setUserLocation({ lat, lng });
    setUserMarker(lat, lng);
    updateCircle(lat, lng, getRadius());
  });*/
  
  // Halaman awal = home
  navigateTo('home');
  // Zonasi selalu mulai dari step 1
  showZonasiInputStep();
}

boot();
