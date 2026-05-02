/**
 * state.js — Single source of truth
 * Menyimpan seluruh state aplikasi frontend.
 */

const _state = {
  schools: [],
  userLocation: null,  // { lat, lng }
  radius: 5,           // km
  filterKat: '',
  filterBiaya: '',
  filterNama: '',
  filterAkreditasi: '',
  currentPage: 'home',
};

const _listeners = {};

export function subscribe(key, cb) {
  if (!_listeners[key]) _listeners[key] = [];
  _listeners[key].push(cb);
}

function notify(key) {
  (_listeners[key] || []).forEach(cb => cb(_state[key]));
}

export const getSchools      = () => _state.schools;
export const getUserLocation = () => _state.userLocation;
export const getRadius       = () => _state.radius;
export const getFilterKat    = () => _state.filterKat;
export const getFilterAkreditasi = () => _state.filterAkreditasi;
export const getFilterBiaya  = () => _state.filterBiaya;

export function setSchools(v)      { _state.schools = v;      notify('schools'); }
export function setUserLocation(v) { _state.userLocation = v; notify('userLocation'); }
export function setRadius(v)       { _state.radius = v;       notify('radius'); }
export function setFilterKat(v)    { _state.filterKat = v; }
export function setFilterBiaya(v)  { _state.filterBiaya = v; }
export function setFilterAkreditasi(v) { _state.filterAkreditasi = v; notify('schools'); }
