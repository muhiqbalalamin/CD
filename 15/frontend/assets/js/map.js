/**
 * map.js — Modul Leaflet
 * Fitur:
 *   1. Marker SVG berwarna per jenjang (SD/SMP/SMA/SMK)
 *   2. Ring luar marker = status zona (halaman Zonasi)
 *   3. Legend jenjang di pojok kanan bawah
 *   4. Batas Kabupaten/Kota Jawa Barat (GeoJSON inline)
 *   5. Tooltip nama kabupaten saat hover batas wilayah
 */

import { haversineDistance, classifyDistance, formatDist, detectJenjang, JENJANG_CFG } from './utils.js';
import { getUserLocation, getRadius } from './state.js';

// ── Instances ──────────────────────────────────────────
let _mapPage    = null;
let _zonasiPage = null;

const _mapMarkers    = {};
const _zonasiMarkers = {};
let _zonasiCircle = null;
let _userMarker   = null;

// Cache GeoJSON supaya tidak double-fetch
// let _geoJSONcache = null;

/* ══════════════════════════════════════════════════════
   JENJANG CONFIG (alias dari utils)
══════════════════════════════════════════════════════ */
const J = JENJANG_CFG; // { sd, smp, sma, smk, other }

/* ══════════════════════════════════════════════════════
   ICON FACTORY
   - fill  = warna jenjang
   - ring  = status zona (kosong jika belum ada user loc)
══════════════════════════════════════════════════════ */
function makeSchoolIcon(jenjang, zona = null) {
  const cfg  = J[jenjang] || J.other;
  const fill = cfg.color;

  const ZONA_RING = {
    green:  '#00c853',
    yellow: '#ffd600',
    red:    '#e53935',
  };
  const ring      = zona ? ZONA_RING[zona] : 'none';
  const ringWidth = zona ? 3 : 0;

  // SVG: ring luar (zona) + lingkaran isi (jenjang) + titik putih tengah
  const html = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
    <circle cx="15" cy="15" r="13" fill="none" stroke="${ring}" stroke-width="${ringWidth}"/>
    <circle cx="15" cy="15" r="9"  fill="${fill}" stroke="#fff" stroke-width="2"/>
    <circle cx="15" cy="15" r="3"  fill="rgba(255,255,255,0.7)"/>
  </svg>`;

  return L.divIcon({
    className:   '',
    html,
    iconSize:    [30, 30],
    iconAnchor:  [15, 15],
    popupAnchor: [0, -17],
  });
}

function makeUserIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="user-marker-dot"></div>`,
    iconSize:   [14, 14],
    iconAnchor: [7, 7],
    popupAnchor:[0, -12],
  });
}

/* ══════════════════════════════════════════════════════
   POPUP HTML — Rich, data-on-click
══════════════════════════════════════════════════════ */
function makePopup(school, distance, radius) {
  const jenjang = detectJenjang(school.nama, school.jenjang || "");
  const cfg     = J[jenjang] || J.other;
  const zona    = distance !== null ? classifyDistance(distance, radius) : null;

  const ZONA_STYLE = {
    green:  { bg: 'rgba(46,125,50,0.18)',  cl: '#81c784', tx: '✅ Dalam Zona' },
    yellow: { bg: 'rgba(249,168,37,0.18)', cl: '#ffd54f', tx: '⚠️ Dekat Zona' },
    red:    { bg: 'rgba(198,40,40,0.18)',  cl: '#ef9a9a', tx: '❌ Luar Zona'  },
  };
  const zs = zona ? ZONA_STYLE[zona] : null;

  const pendaftar  = school.pendaftar || 0;
  const kuota      = school.kuota || 0;
  const sisaKuota  = kuota - pendaftar;
  const pct        = kuota ? Math.min(100, Math.round((pendaftar / kuota) * 100)) : 0;
  const kuotaColor = sisaKuota < 10 ? '#c62828' : sisaKuota < 50 ? '#e65100' : '#2e7d32';

  const fmt = n => n ? `Rp ${Number(n).toLocaleString('id-ID')}` : '—';
  const statusLabel = school.status === 'N' ? 'Negeri' : school.status === 'S' ? 'Swasta' : (school.status || '');

  const akrColor = { A: '#1565C0', B: '#2e7d32', C: '#e65100' }[school.akreditasi] || '#546e7a';

  const biayaRows = (school.biaya || school.spp) ? `
    <hr class="sp-divider"/>
    <div class="sp-section-label">Biaya Pendidikan</div>
    ${school.biaya ? `<div class="sp-row"><span class="sp-label">Biaya Masuk</span><span class="sp-val">${fmt(school.biaya)}</span></div>` : ''}
    ${school.spp   ? `<div class="sp-row"><span class="sp-label">SPP / Bulan</span><span class="sp-val">${fmt(school.spp)}</span></div>` : ''}
  ` : '';

  const jarakRow = distance !== null ? `
    <hr class="sp-divider"/>
    <div class="sp-row">
      <span class="sp-label">📏 Jarak dari lokasi</span>
      <span class="sp-val" style="color:#1565C0">${formatDist(distance)}</span>
    </div>` : '';

  return `<div class="school-popup">
    <!-- Header band -->
    <div class="sp-header-band">
      <div class="sp-badges">
        <span class="sp-badge" style="background:rgba(255,255,255,0.18);color:#fff">${cfg.label}</span>
        ${statusLabel ? `<span class="sp-badge" style="background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.9)">${statusLabel}</span>` : ''}
        ${school.akreditasi && school.akreditasi !== '-'
          ? `<span class="sp-badge" style="background:rgba(255,255,255,0.14);color:#fff">Akreditasi ${school.akreditasi}</span>` : ''}
        ${zs ? `<span class="sp-badge" style="background:${zs.bg};color:${zs.cl}">${zs.tx}</span>` : ''}
      </div>
      <div class="sp-name">${school.nama}</div>
      <div class="sp-location">📍 ${school.kecamatan || '—'}</div>
      ${school.alamat && school.alamat !== '-' ? `<div class="sp-alamat">${school.alamat}</div>` : ''}
    </div>
    <!-- Body -->
    <div class="sp-body">
      <div>
        <div class="sp-section-label">Kapasitas Penerimaan</div>
        <div class="sp-kuota-block">
          <div class="sp-kuota-numbers">
            <div>
              <div class="sp-kuota-main" style="color:${kuotaColor}">${sisaKuota}</div>
              <div class="sp-kuota-sub">sisa kuota dari ${kuota} total</div>
            </div>
            <div class="sp-kuota-sisa" style="color:${kuotaColor}">${pct}% terisi</div>
          </div>
          <div class="sp-bar-wrap">
            <div class="sp-bar" style="width:${pct}%;background:${kuotaColor}"></div>
          </div>
        </div>
      </div>
      ${biayaRows}
      ${jarakRow}
    </div>
  </div>`;
}

/* ══════════════════════════════════════════════════════
   LEGEND CONTROL
══════════════════════════════════════════════════════ */
function addLegend(mapInst, withZona = false) {
  const ctrl = L.control({ position: 'bottomright' });
  ctrl.onAdd = () => {
    const el = L.DomUtil.create('div', 'map-legend');
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);

    const jRows = [
      ['sd',  J.sd],
      ['smp', J.smp],
      ['sma', J.sma],
      ['smk', J.smk],
    ].map(([, cfg]) => `
      <div class="leg-row">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6" fill="${cfg.color}" stroke="#fff" stroke-width="1.5"/>
          <circle cx="8" cy="8" r="2" fill="rgba(255,255,255,0.7)"/>
        </svg>
        <span>${cfg.label}</span>
      </div>`).join('');

    const zRows = withZona ? `
      <div class="leg-divider"></div>
      <div class="leg-subtitle">Status Zona</div>
      <div class="leg-row"><span class="leg-ring" style="border-color:#00c853"></span><span>Dalam zona</span></div>
      <div class="leg-row"><span class="leg-ring" style="border-color:#ffd600"></span><span>Dekat zona</span></div>
      <div class="leg-row"><span class="leg-ring" style="border-color:#e53935"></span><span>Luar zona</span></div>` : '';

    el.innerHTML = `<div class="leg-title">Jenjang Sekolah</div>${jRows}${zRows}`;
    return el;
  };
  ctrl.addTo(mapInst);
}

/* ══════════════════════════════════════════════════════
   BATAS WILAYAH — GeoJSON Kabupaten/Kota Jawa Barat
   Data disimpan inline (simplified) agar tidak perlu fetch.
   Koordinat diambil dari data publik OpenStreetMap/BPS.
══════════════════════════════════════════════════════ */
/*function getJabarGeoJSON() {
  // GeoJSON simplified batas kabupaten/kota Jawa Barat
  // Menggunakan bounding polygon per kabupaten (simplified untuk performa)
  return {
    type: 'FeatureCollection',
    features: [
      { type:'Feature', properties:{ name:'Kota Bandung' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.5501,-6.9990],[107.6901,-6.9990],[107.6901,-6.8301],[107.5501,-6.8301],[107.5501,-6.9990]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Bekasi' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.9101,-6.3401],[107.0401,-6.3401],[107.0401,-6.1701],[106.9101,-6.1701],[106.9101,-6.3401]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Bogor' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.7401,-6.6701],[106.8701,-6.6701],[106.8701,-6.5301],[106.7401,-6.5301],[106.7401,-6.6701]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Depok' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.7201,-6.4601],[106.8601,-6.4601],[106.8601,-6.3401],[106.7201,-6.3401],[106.7201,-6.4601]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Cimahi' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.5001,-6.9101],[107.5601,-6.9101],[107.5601,-6.8401],[107.5001,-6.8401],[107.5001,-6.9101]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Tasikmalaya' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.1701,-7.4001],[108.2901,-7.4001],[108.2901,-7.2801],[108.1701,-7.2801],[108.1701,-7.4001]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Cirebon' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.5101,-6.7701],[108.5901,-6.7701],[108.5901,-6.7001],[108.5101,-6.7001],[108.5101,-6.7701]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Sukabumi' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.8901,-6.9601],[106.9601,-6.9601],[106.9601,-6.8901],[106.8901,-6.8901],[106.8901,-6.9601]
        ]]}},
      { type:'Feature', properties:{ name:'Kota Banjar' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.5001,-7.4001],[108.5801,-7.4001],[108.5801,-7.3301],[108.5001,-7.3301],[108.5001,-7.4001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Bandung' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.3001,-7.2001],[107.7001,-7.2001],[107.7001,-6.9001],[107.3001,-6.9001],[107.3001,-7.2001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Bandung Barat' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.3001,-6.9001],[107.5501,-6.9001],[107.5501,-6.7001],[107.3001,-6.7001],[107.3001,-6.9001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Bekasi' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.9101,-6.4501],[107.2601,-6.4501],[107.2601,-6.0801],[106.9101,-6.0801],[106.9101,-6.4501]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Bogor' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.5001,-6.8001],[107.0001,-6.8001],[107.0001,-6.3001],[106.5001,-6.3001],[106.5001,-6.8001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Ciamis' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.1001,-7.5001],[108.5001,-7.5001],[108.5001,-7.1001],[108.1001,-7.1001],[108.1001,-7.5001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Cianjur' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.8001,-7.3001],[107.3001,-7.3001],[107.3001,-6.7001],[106.8001,-6.7001],[106.8001,-7.3001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Cirebon' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.3501,-6.9501],[108.6001,-6.9501],[108.6001,-6.6501],[108.3501,-6.6501],[108.3501,-6.9501]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Garut' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.6001,-7.6001],[108.1001,-7.6001],[108.1001,-7.0001],[107.6001,-7.0001],[107.6001,-7.6001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Indramayu' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.9001,-6.5001],[108.4501,-6.5001],[108.4501,-6.0001],[107.9001,-6.0001],[107.9001,-6.5001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Karawang' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.0001,-6.5001],[107.5001,-6.5001],[107.5001,-6.1001],[107.0001,-6.1001],[107.0001,-6.5001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Kuningan' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.3501,-7.1001],[108.6001,-7.1001],[108.6001,-6.8501],[108.3501,-6.8501],[108.3501,-7.1001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Majalengka' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.1001,-7.0001],[108.4001,-7.0001],[108.4001,-6.6001],[108.1001,-6.6001],[108.1001,-7.0001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Pangandaran' },
        geometry:{ type:'Polygon', coordinates:[[
          [108.4001,-7.8001],[108.8001,-7.8001],[108.8001,-7.5001],[108.4001,-7.5001],[108.4001,-7.8001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Purwakarta' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.3001,-6.7001],[107.6001,-6.7001],[107.6001,-6.4001],[107.3001,-6.4001],[107.3001,-6.7001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Subang' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.5001,-6.7001],[107.9001,-6.7001],[107.9001,-6.2001],[107.5001,-6.2001],[107.5001,-6.7001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Sukabumi' },
        geometry:{ type:'Polygon', coordinates:[[
          [106.3001,-7.3001],[107.0001,-7.3001],[107.0001,-6.7001],[106.3001,-6.7001],[106.3001,-7.3001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Sumedang' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.7001,-7.0001],[108.2001,-7.0001],[108.2001,-6.6001],[107.7001,-6.6001],[107.7001,-7.0001]
        ]]}},
      { type:'Feature', properties:{ name:'Kab. Tasikmalaya' },
        geometry:{ type:'Polygon', coordinates:[[
          [107.9001,-7.6001],[108.3001,-7.6001],[108.3001,-7.1001],[107.9001,-7.1001],[107.9001,-7.6001]
        ]]}},
    ]
  };
}*/

/* ── Tambahkan layer batas wilayah ke peta ── */
/*function addBoundaryLayer(mapInst) {
  const geoData = getJabarGeoJSON();

  const layer = L.geoJSON(geoData, {
    style: () => ({
      color:       '#1565C0',
      weight:      1.8,
      opacity:     0.8,
      fillColor:   '#1565C0',
      fillOpacity: 0.05,
      dashArray:   '4 3',
    }),
    onEachFeature(feature, lyr) {
      const nama = feature.properties?.name || '';

      // Tooltip nama kabupaten/kota
      lyr.bindTooltip(nama, {
        sticky:    true,
        direction: 'top',
        className: 'boundary-tooltip',
        opacity:   0.95,
      });

      // Hover highlight
      lyr.on({
        mouseover(e) {
          e.target.setStyle({ weight: 3, fillOpacity: 0.15 });
          e.target.bringToFront();
        },
        mouseout(e) {
          layer.resetStyle(e.target);
        },
      });
    },
  });

  layer.addTo(mapInst);
  layer.bringToBack(); // pastikan di bawah marker
  return layer;
}*/

/* ══════════════════════════════════════════════════════
   INIT MAP PAGE
══════════════════════════════════════════════════════ */
export function initMapPage() {
  if (_mapPage) return;

  _mapPage = L.map('map-view', {
    center: [-6.9147, 107.6098],
    zoom:   9,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(_mapPage);

  //addBoundaryLayer(_mapPage);
  addLegend(_mapPage, false);
}

export function renderMapMarkers(schools) {
  if (!_mapPage) return;
  Object.values(_mapMarkers).forEach(m => _mapPage.removeLayer(m));
  Object.keys(_mapMarkers).forEach(k => delete _mapMarkers[k]);

  schools.forEach(school => {
    const jenjang = detectJenjang(school.nama, school.jenjang || "");
    const marker  = L.marker([school.lat, school.lng], {
      icon:  makeSchoolIcon(jenjang, null),
      title: school.nama,
    });

    // Lazy popup: data di-render hanya saat marker diklik
    let popupReady = false;
    marker.on('click', function () {
      if (!popupReady) {
        popupReady = true;
        marker.bindPopup(makePopup(school, null, 0), { maxWidth: 300 }).openPopup();
      }
    });

    marker.addTo(_mapPage);
    _mapMarkers[school.id] = marker;
  });
}

export function flyToOnMap(school) {
  _mapPage?.flyTo([school.lat, school.lng], 15, { animate: true });
  setTimeout(() => _mapMarkers[school.id]?.openPopup(), 700);
}

export function highlightMapMarker(id) {
  _mapMarkers[id]?.openPopup();
}

/* ══════════════════════════════════════════════════════
   INIT ZONASI PAGE
══════════════════════════════════════════════════════ */
export function initZonasiPage() {
  if (_zonasiPage) return;

  _zonasiPage = L.map('zonasi-view', {
    center: [-6.9147, 107.6098],
    zoom:   9,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(_zonasiPage);

  // addBoundaryLayer(_zonasiPage); // layer batas wilayah (dinonaktifkan)
  addLegend(_zonasiPage, true); // tampilkan legend zona juga
}

export function renderZonasiMarkers(schools) {
  if (!_zonasiPage) return;
  Object.values(_zonasiMarkers).forEach(m => _zonasiPage.removeLayer(m));
  Object.keys(_zonasiMarkers).forEach(k => delete _zonasiMarkers[k]);

  const userLoc = getUserLocation();
  const radius  = getRadius();

  schools.forEach(school => {
    const dist    = userLoc
      ? haversineDistance(userLoc.lat, userLoc.lng, school.lat, school.lng)
      : null;
    const zona    = dist !== null ? classifyDistance(dist, radius) : null;
    const jenjang = detectJenjang(school.nama, school.jenjang || "");

    const marker = L.marker([school.lat, school.lng], {
      icon:  makeSchoolIcon(jenjang, zona),
      title: school.nama,
    });
    marker.bindPopup(makePopup(school, dist, radius));
    marker.addTo(_zonasiPage);
    _zonasiMarkers[school.id] = marker;
  });
}

export function setUserMarker(lat, lng) {
  if (_userMarker) {
    _userMarker.setLatLng([lat, lng]);
  } else {
    _userMarker = L.marker([lat, lng], {
      icon: makeUserIcon(),
      zIndexOffset: 9999,
    })
      .addTo(_zonasiPage)
      .bindPopup('<b>📍 Lokasi Saya</b>');
  }
  _zonasiPage.setView([lat, lng], 12, { animate: true });
}

export function updateCircle(lat, lng, radiusKm) {
  if (_zonasiCircle) {
    _zonasiCircle.setLatLng([lat, lng]);
    _zonasiCircle.setRadius(radiusKm * 1000); 
  } else {
    _zonasiCircle = L.circle([lat, lng], {
      radius: radiusKm * 1000,
      color: '#1565C0', 
      weight: 1,
      fillOpacity: 0.1,
      interactive: false 
    }).addTo(_zonasiPage);
  }
}

export function flyToOnZonasi(school) {
  _zonasiPage?.flyTo([school.lat, school.lng], 15, { animate: true });
  setTimeout(() => _zonasiMarkers[school.id]?.openPopup(), 700);
}

export function highlightZonasiMarker(id) { _zonasiMarkers[id]?.openPopup(); }
export function unhighlightZonasiMarker(id) { _zonasiMarkers[id]?.closePopup(); }

export function invalidateMaps() {
  _mapPage?.invalidateSize();
  _zonasiPage?.invalidateSize();
}

export function onMapClick(callback) {
  _zonasiPage.on('click', (e) => {
    const { lat, lng } = e.latlng;
    callback(lat, lng);
  });
}