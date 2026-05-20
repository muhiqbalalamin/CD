/**
 * ui.js — Manipulasi DOM & rendering komponen UI
 */

import { formatDist, classifyDistance, detectJenjang, JENJANG_CFG } from './utils.js';
import { getUserLocation, getRadius } from './state.js';
import { haversineDistance } from './utils.js';

/* ── Toast ─────────────────────────────────────── */
let _toastT;
export function showToast(msg, type = 'info', ms = 3000) {
  const el = document.getElementById('toast');
  clearTimeout(_toastT);
  el.textContent = msg;
  el.className = `toast show ${type}`;
  _toastT = setTimeout(() => el.classList.remove('show'), ms);
}

/* ── Loading ────────────────────────────────────── */
export function showLoading() { document.getElementById('loading-overlay').classList.remove('hidden'); }
export function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

/* ── Navbar active link ─────────────────────────── */
export function setActiveNav(page) {
  document.querySelectorAll('.nav-link').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });
  document.querySelectorAll('.bnav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });
}

/* ── Search bar visibility ──────────────────────── */
export function toggleSearchBar(visible) {
  const el = document.getElementById('search-bar-row');
  if (el) el.classList.toggle('hidden', !visible);
}

/* ── Home table ─────────────────────────────────── */
export function renderHomeTable(items, page, total) {
  const tbody = document.getElementById('home-tbody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="td-empty">Tidak ada data</td></tr>';
  } else {
    tbody.innerHTML = items.map((s, i) => `
      <tr>
        <td>${(page - 1) * 5 + i + 1}</td>
        <td>${s.nama}</td>
        <td>${s.akreditasi ?? '-'}</td>
        <td>${s.pendaftar ? s.pendaftar + ' Murid' : '-'}</td>
        <td>${s.alamat ?? '-'}</td>
      </tr>`).join('');
  }
  document.getElementById('home-page-info').textContent = `Page ${page} of ${total}`;
  document.getElementById('home-prev').disabled = page <= 1;
  document.getElementById('home-next').disabled = page >= total;
}

/* ── Flat list (Map & Zonasi) ───────────────────── */
export function renderFlatList(listId, pageInfoId, prevId, nextId, items, page, total, onClickItem, onHover, onOut) {
  const ul = document.getElementById(listId);
  const userLoc = getUserLocation();
  const radius  = getRadius();

  if (!items.length) {
    ul.innerHTML = '<li class="flat-list-empty">Tidak ada sekolah ditemukan</li>';
  } else {
    ul.innerHTML = '';
    items.forEach(school => {
      const dist  = userLoc
        ? haversineDistance(userLoc.lat, userLoc.lng, school.lat, school.lng)
        : null;
      const color = dist !== null ? classifyDistance(dist, radius) : 'default';
      const dotClass = color === 'default' ? '' : `dot-${color}`;

      const jenjang = detectJenjang(school.nama, school.jenjang || "");
      const jCfg    = JENJANG_CFG[jenjang] || JENJANG_CFG.other;

      const sisaKuota = school.kuota - school.pendaftar;
      const kuotaWarna = sisaKuota < 10 ? 'red' : 'green';

      const li = document.createElement('li');
      li.className = 'flat-list-item';
      li.dataset.id = school.id;
      li.innerHTML = `
        <span class="item-jenjang-dot" style="background:${jCfg.color}"></span>
        <div class="item-info">
          <span class="item-name">${school.nama}</span>
          <span class="item-jenjang-badge" style="background:${jCfg.color}1a;color:${jCfg.color}">${jCfg.label}</span>
        </div>
        <div class="item-meta">
          <span class="quota-info" style="color:${kuotaWarna}">
            Sisa Kuota: ${sisaKuota} (Total: ${school.kuota})
          </span>
        </div>
        ${dist !== null ? `<span class="item-dist item-dist--${color}">${formatDist(dist)}</span>` : ''}
      `;
      li.addEventListener('click',      () => onClickItem?.(school));
      li.addEventListener('mouseenter', () => onHover?.(school));
      li.addEventListener('mouseleave', () => onOut?.(school));
      ul.appendChild(li);
    });
  }

  document.getElementById(pageInfoId).textContent = `Page ${page} of ${total}`;
  document.getElementById(prevId).disabled = page <= 1;
  document.getElementById(nextId).disabled = page >= total;
}

export function updateUIForLoggedInUser() {
  const userJson  = localStorage.getItem('user_session');
  const authGroup = document.querySelector('.navbar-right');
  if (!authGroup) return;

  if (!userJson) {
    // Belum login: tampilkan tombol Masuk & Daftar
    authGroup.innerHTML = `
      <div class="auth-buttons">
        <button class="btn-nav-auth" data-page="login">Masuk</button>
        <button class="btn-nav-auth btn-nav-auth--outline" data-page="register">Daftar</button>
      </div>`;
    return;
  }

  // Sudah login: HANYA tampilkan icon profil (tidak ada teks, tidak ada Keluar)
  authGroup.innerHTML = `
    <button class="user-btn" data-page="profile" title="Profil Saya">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
        <circle cx="13" cy="9" r="5" stroke="white" stroke-width="2"/>
        <path d="M3 23c0-5.523 4.477-10 10-10s10 4.477 10 10"
          stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>`;
}