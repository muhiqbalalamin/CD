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

      const jenjang = detectJenjang(school.nama);
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

// 18-04-2026
export function updateUIForLoggedInUser() {
  const userJson = localStorage.getItem('user_session');
  const authGroup = document.querySelector('.navbar-right'); 
  const navCenter = document.querySelector('.navbar-center');

  if (!authGroup) return;

  // Hapus menu role lama
  document.querySelectorAll('.role-specific-link').forEach(el => el.remove());

  // 🔴 BELUM LOGIN
  if (!userJson) {
    authGroup.innerHTML = `
    <div class="auth-buttons">
      <button class="btn btn-outline" data-page="login">Masuk</button>
      <button class="btn btn-outline" data-page="register">Daftar</button> 
    </div>
    `;
    return;
  }

  // 🟢 SUDAH LOGIN
  const user = JSON.parse(userJson);

  authGroup.innerHTML = `
    <div class="user-menu">
      <span class="user-welcome">Halo, ${user.username}</span>
      <a href="#" class="nav-link profile-link" data-page="profile">Profil</a>
      <button id="logout-btn" class="logout-btn-ui">Keluar</button>
    </div>
  `;

  // Role menu
  if (user.role === 'admin') {
    navCenter.insertAdjacentHTML('beforeend',
      `<a class="nav-link role-specific-link" data-page="admin-panel">Dashboard Dinas</a>`
    );
  } else if (user.role === 'it_sekolah') {
    navCenter.insertAdjacentHTML('beforeend',
      `<a class="nav-link role-specific-link" data-page="school-manage">Kelola Sekolah</a>`
    );
  }

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('user_session');
    location.reload();
  });
}