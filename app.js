// app.js - screens, navigation and user actions for Pinpoint Diary.

import * as auth from './auth.js';
import * as db from './db.js';
import { encryptJSON, decryptJSON } from './crypto.js';
import { getWeather, getPlaceName } from './api.js';
import { getPosition, processPhoto } from './device.js';
import { cleanText, formatDate, computeStats, filterMoments, roundCoord } from './utils.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const PUBLIC_ROUTES = ['login', 'register'];
const AUTO_LOCK_MS = 5 * 60 * 1000; // lock after 5 minutes in the background

let moments = []; // decrypted moments for the signed-in user, newest first
let map = null;
let markerLayer = null;
let deferredInstallPrompt = null;
let hiddenAt = 0;
let inAppNavigations = 0;

// The add/edit form's working state
const form = {
  editingId: null,
  photo: null, // { photo, thumb } data URLs
  photoChanged: false,
  location: null, // { lat, lon, accuracy }
  placeName: null,
  weather: null,
  locPromise: null,
  original: null,
};

// ------------------------------------------------------------------ helpers
/** Small DOM builder. Text is always set with textContent (prevents XSS). */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

let toastTimer;
function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function setBusy(button, busy, busyText) {
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function go(path) {
  location.hash = `#/${path}`;
}

function goBack() {
  if (inAppNavigations > 1) history.back();
  else go('timeline');
}

function newId() {
  return `${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;
}

// ------------------------------------------------------------------ settings
const settings = {
  get theme() { return localStorage.getItem('pd-theme') || 'system'; },
  get textSize() { return localStorage.getItem('pd-textsize') || '1'; },
  get precision() { return localStorage.getItem('pd-precision') || 'exact'; },
};

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.style.setProperty('--text-scale', settings.textSize);
}

// ------------------------------------------------------------------ data
async function loadMoments() {
  const session = auth.currentUser();
  const records = await db.getMomentsForUser(session.email);
  const results = await Promise.all(records.map(async (r) => {
    try {
      const data = await decryptJSON(session.key, r.enc);
      const thumb = r.thumbEnc ? await decryptJSON(session.key, r.thumbEnc) : null;
      return { id: r.id, createdAt: r.createdAt, ...data, thumb };
    } catch (err) {
      console.error('Could not decrypt moment', r.id, err);
      return null;
    }
  }));
  moments = results.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

async function persistMoment(m, photoRecord) {
  const session = auth.currentUser();
  const { id, createdAt, thumb, ...details } = m;
  const record = {
    id,
    userEmail: session.email,
    createdAt,
    enc: await encryptJSON(session.key, details),
    thumbEnc: thumb ? await encryptJSON(session.key, thumb) : null,
  };
  await db.saveMoment(record, photoRecord);
}

/** Looks up place name and weather. Each part can fail without breaking the other. */
async function lookUpPlaceAndWeather(lat, lon) {
  const [place, weather] = await Promise.allSettled([getPlaceName(lat, lon), getWeather(lat, lon)]);
  return {
    placeName: place.status === 'fulfilled' ? place.value : null,
    weather: weather.status === 'fulfilled' ? weather.value : null,
    ok: place.status === 'fulfilled' && weather.status === 'fulfilled',
  };
}

/** Moments saved offline get their place + weather filled in once we're online. */
let syncing = false;
async function syncPendingMoments() {
  if (syncing || !navigator.onLine || !auth.currentUser()) return;
  const pending = moments.filter((m) => m.needsEnrich && typeof m.lat === 'number');
  if (!pending.length) return;
  syncing = true;
  let updated = 0;
  try {
    for (const m of pending) {
      const info = await lookUpPlaceAndWeather(m.lat, m.lon);
      if (!info.placeName && !info.weather) continue;
      m.placeName = m.placeName || info.placeName;
      // Note: weather is "now", not when the photo was taken - we label it that way.
      m.weather = m.weather || (info.weather ? { ...info.weather, late: true } : null);
      m.needsEnrich = !(m.placeName && m.weather);
      await persistMoment(m);
      updated++;
    }
  } finally {
    syncing = false;
  }
  if (updated) {
    toast(`Added place and weather to ${updated} offline moment${updated > 1 ? 's' : ''}.`);
    refreshCurrentScreen();
  }
}

// ------------------------------------------------------------------ router
function parseRoute() {
  const [name = 'timeline', param] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'timeline', param: param ? decodeURIComponent(param) : null };
}

async function router() {
  inAppNavigations++;
  const { name, param } = parseRoute();
  const loggedIn = !!auth.currentUser();

  if (!loggedIn && !PUBLIC_ROUTES.includes(name)) return go('login');
  if (loggedIn && PUBLIC_ROUTES.includes(name)) return go('timeline');

  const screens = {
    login: showLogin,
    register: showRegister,
    timeline: showTimeline,
    add: () => showEdit(null),
    edit: () => showEdit(param),
    moment: () => showDetail(param),
    map: () => showMap(param),
    profile: showProfile,
  };
  const handler = screens[name];
  if (!handler) return go('timeline');
  await handler();
  highlightTab(name);
}

function refreshCurrentScreen() {
  const { name, param } = parseRoute();
  if (name === 'timeline') renderTimeline();
  if (name === 'moment') showDetail(param);
  if (name === 'map') renderMarkers();
  if (name === 'profile') renderStats();
}

function showScreen(id, title) {
  $$('.screen').forEach((s) => { s.hidden = s.id !== id; });
  const isAuth = id === 'screen-login' || id === 'screen-register';
  $('#tabbar').hidden = isAuth;
  document.body.classList.toggle('has-tabbar', !isAuth);
  document.title = `${title} - Pinpoint Diary`;
  // Move focus to the screen heading so screen-reader users hear the new screen.
  const heading = document.querySelector(`#${id} h1`);
  if (heading) heading.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function highlightTab(name) {
  const tab = name === 'moment' || name === 'edit' ? 'timeline' : name;
  $$('#tabbar a').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

// ------------------------------------------------------------------ auth screens
function showLogin() {
  showScreen('screen-login', 'Log in');
  const last = localStorage.getItem('pd-last-email');
  if (last && !$('#login-email').value) $('#login-email').value = last;
}

function showRegister() {
  showScreen('screen-register', 'Create account');
}

async function afterSignIn() {
  await loadMoments();
  go('timeline');
  syncPendingMoments();
}

function wireAuthForms() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    const errorBox = $('#login-error');
    errorBox.textContent = '';
    setBusy(btn, true, 'Unlocking…');
    try {
      await auth.login($('#login-email').value, $('#login-password').value);
      $('#login-password').value = '';
      await afterSignIn();
    } catch (err) {
      errorBox.textContent = err.message;
    } finally {
      setBusy(btn, false);
    }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    const errorBox = $('#register-error');
    errorBox.textContent = '';
    const pw = $('#reg-password').value;
    if (pw !== $('#reg-confirm').value) {
      errorBox.textContent = 'The two passwords do not match.';
      return;
    }
    if (!$('#reg-consent').checked) {
      errorBox.textContent = 'Please tick the box to confirm you have read the privacy notes.';
      return;
    }
    setBusy(btn, true, 'Creating…');
    try {
      await auth.register($('#reg-email').value, pw);
      e.target.reset();
      toast('Account created. Welcome!');
      await afterSignIn();
    } catch (err) {
      errorBox.textContent = err.message;
    } finally {
      setBusy(btn, false);
    }
  });

  $$('.show-pw').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.getAttribute('aria-controls'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-pressed', String(show));
    });
  });
}

// ------------------------------------------------------------------ timeline
function showTimeline() {
  showScreen('screen-timeline', 'Timeline');
  renderTimeline();
}

function weatherLabel(w) {
  if (!w) return null;
  return `${w.icon} ${w.tempC}°C ${w.text}${w.late ? ' (added later)' : ''}`;
}

function renderTimeline() {
  const list = $('#moment-list');
  const shown = filterMoments(moments, $('#search').value);
  const frag = document.createDocumentFragment();

  for (const m of shown) {
    const thumb = m.thumb
      ? el('img', { src: m.thumb, alt: '', width: 72, height: 72, loading: 'lazy', decoding: 'async' })
      : el('div', { class: 'thumb-placeholder', 'aria-hidden': 'true', text: m.mood || '📍' });
    const meta = [m.placeName || (m.needsEnrich ? 'Place pending…' : null), formatDate(m.createdAt)]
      .filter(Boolean).join(' · ');
    frag.append(el('li', {}, [
      el('a', { href: `#/moment/${encodeURIComponent(m.id)}`, class: 'moment-card' }, [
        thumb,
        el('div', { class: 'moment-info' }, [
          el('h2', { class: 'moment-title', text: m.title }),
          el('p', { class: 'muted small', text: meta }),
          m.weather ? el('p', { class: 'chip', text: weatherLabel(m.weather) }) : null,
        ]),
        el('span', { class: 'mood', 'aria-label': `Mood ${m.mood}`, text: m.mood || '' }),
      ]),
    ]));
  }
  list.replaceChildren(frag);
  $('#timeline-empty').hidden = moments.length > 0;
  const q = $('#search').value.trim();
  $('#timeline-count').textContent = moments.length
    ? q ? `${shown.length} of ${moments.length} moments match "${q}"` : `${moments.length} moment${moments.length === 1 ? '' : 's'}`
    : '';
}

// ------------------------------------------------------------------ add / edit
function resetForm() {
  Object.assign(form, {
    editingId: null, photo: null, photoChanged: false, location: null,
    placeName: null, weather: null, locPromise: null, original: null,
  });
  $('#moment-form').reset();
  $('#moment-error').textContent = '';
  $('#note-count').textContent = '0 / 1000';
  renderPhotoPreview();
  renderLocStatus('');
}

function renderPhotoPreview() {
  const img = $('#photo-preview');
  if (form.photo) {
    img.src = form.photo.photo;
    img.hidden = false;
    $('#photo-remove').hidden = false;
    $('#photo-label').textContent = '📷 Change photo';
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    $('#photo-remove').hidden = true;
    $('#photo-label').textContent = '📷 Take or choose photo';
  }
}

function renderLocStatus(state, message) {
  const box = $('#loc-status');
  $('#loc-retry').hidden = state !== 'error';
  if (state === 'loading') {
    box.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), ` ${message || 'Finding your location…'}`);
  } else if (state === 'done') {
    const parts = [];
    parts.push(el('p', { class: 'loc-place', text: `📍 ${form.placeName || `${roundCoord(form.location.lat, 4)}, ${roundCoord(form.location.lon, 4)}`}` }));
    if (form.weather) parts.push(el('p', { class: 'chip', text: weatherLabel(form.weather) }));
    if (message) parts.push(el('p', { class: 'hint', text: message }));
    box.replaceChildren(...parts);
  } else if (state === 'error') {
    box.replaceChildren(el('p', { class: 'warn', text: message }));
  } else {
    box.replaceChildren();
  }
}

async function captureLocation() {
  renderLocStatus('loading');
  try {
    const pos = await getPosition();
    if (settings.precision === 'approx') {
      pos.lat = roundCoord(pos.lat, 2); // ~1 km
      pos.lon = roundCoord(pos.lon, 2);
    }
    form.location = pos;
    if (!navigator.onLine) {
      renderLocStatus('done', 'Offline: place and weather will be added when you reconnect.');
      return;
    }
    renderLocStatus('loading', 'Looking up place and weather…');
    const info = await lookUpPlaceAndWeather(pos.lat, pos.lon);
    form.placeName = info.placeName;
    form.weather = info.weather;
    renderLocStatus('done', info.ok ? '' : 'Some details could not be loaded. They will be retried later.');
  } catch (err) {
    form.location = null;
    renderLocStatus('error', err.message);
  }
}

function startLocationCapture() {
  form.locPromise = captureLocation();
  return form.locPromise;
}

async function showEdit(id) {
  resetForm();
  if (id) {
    const m = moments.find((x) => x.id === id);
    if (!m) { toast('That moment no longer exists.'); return go('timeline'); }
    form.editingId = id;
    form.original = m;
    showScreen('screen-edit', 'Edit moment');
    $('#edit-title').textContent = 'Edit moment';
    $('#moment-save').textContent = 'Save changes';
    $('#m-title').value = m.title;
    $('#m-note').value = m.note || '';
    $('#note-count').textContent = `${(m.note || '').length} / 1000`;
    const mood = document.querySelector(`input[name=mood][value="${m.mood}"]`);
    if (mood) mood.checked = true;
    // Keep the original location when editing.
    $('#m-use-location').checked = false;
    $('#m-use-location').closest('label').hidden = true;
    if (typeof m.lat === 'number') {
      form.location = { lat: m.lat, lon: m.lon, accuracy: m.accuracy };
      form.placeName = m.placeName;
      form.weather = m.weather;
      renderLocStatus('done', 'Location from when this moment was saved.');
    } else {
      renderLocStatus('', '');
    }
    if (m.hasPhoto) {
      const rec = await db.getPhoto(id);
      if (rec) {
        const photo = await decryptJSON(auth.currentUser().key, rec.enc);
        form.photo = { photo, thumb: m.thumb };
        renderPhotoPreview();
      }
    }
  } else {
    showScreen('screen-edit', 'New moment');
    $('#edit-title').textContent = 'New moment';
    $('#moment-save').textContent = 'Save moment';
    $('#m-use-location').closest('label').hidden = false;
    $('#m-use-location').checked = localStorage.getItem('pd-use-location') !== 'no';
    if ($('#m-use-location').checked) startLocationCapture();
  }
}

function wireMomentForm() {
  $('#photo-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    $('#photo-label').textContent = 'Processing photo…';
    try {
      form.photo = await processPhoto(file);
      form.photoChanged = true;
    } catch (err) {
      toast(err.message);
    }
    renderPhotoPreview();
  });

  $('#photo-remove').addEventListener('click', () => {
    form.photo = null;
    form.photoChanged = true;
    renderPhotoPreview();
    $('#photo-label').focus();
  });

  $('#m-note').addEventListener('input', (e) => {
    $('#note-count').textContent = `${e.target.value.length} / 1000`;
  });

  $('#m-use-location').addEventListener('change', (e) => {
    localStorage.setItem('pd-use-location', e.target.checked ? 'yes' : 'no');
    if (e.target.checked) startLocationCapture();
    else {
      form.location = null; form.placeName = null; form.weather = null;
      renderLocStatus('');
    }
  });

  $('#loc-retry').addEventListener('click', startLocationCapture);

  $('#moment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = $('#moment-error');
    errorBox.textContent = '';
    const title = cleanText($('#m-title').value, 80);
    if (!title) {
      errorBox.textContent = 'Please give your moment a title.';
      $('#m-title').focus();
      return;
    }
    const btn = $('#moment-save');
    setBusy(btn, true, 'Saving…');
    try {
      // If the location is still loading, wait for it (it has its own timeout).
      if (form.locPromise && !form.editingId) await form.locPromise;

      const now = Date.now();
      const original = form.original || {};
      const loc = form.location;
      const m = {
        id: form.editingId || newId(),
        createdAt: original.createdAt || now,
        updatedAt: now,
        title,
        note: String($('#m-note').value).trim().slice(0, 1000),
        mood: (document.querySelector('input[name=mood]:checked') || {}).value || '🙂',
        lat: loc ? loc.lat : null,
        lon: loc ? loc.lon : null,
        accuracy: loc ? loc.accuracy : null,
        placeName: form.placeName || null,
        weather: form.weather || null,
        hasPhoto: !!form.photo,
        thumb: form.photo ? form.photo.thumb : null,
        needsEnrich: !!loc && (!form.placeName || !form.weather),
      };

      let photoRecord; // undefined = leave the stored photo alone
      if (form.photoChanged || !form.editingId) {
        photoRecord = form.photo
          ? { id: m.id, userEmail: auth.currentUser().email, enc: await encryptJSON(auth.currentUser().key, form.photo.photo) }
          : null;
      }
      await persistMoment(m, photoRecord);

      moments = [m, ...moments.filter((x) => x.id !== m.id)].sort((a, b) => b.createdAt - a.createdAt);
      toast(form.editingId ? 'Changes saved.' : 'Moment saved 📍');
      const wasEditing = !!form.editingId;
      resetForm();
      if (wasEditing) history.back();
      else go(`moment/${encodeURIComponent(m.id)}`);
    } catch (err) {
      console.error(err);
      errorBox.textContent = err.name === 'QuotaExceededError'
        ? 'Your phone is out of storage space for this app. Try deleting some old moments.'
        : `Could not save: ${err.message}`;
    } finally {
      setBusy(btn, false);
    }
  });
}

// ------------------------------------------------------------------ detail
async function showDetail(id) {
  const m = moments.find((x) => x.id === id);
  if (!m) { toast('That moment no longer exists.'); return go('timeline'); }
  showScreen('screen-detail', m.title);
  $('#detail-title').textContent = m.title;
  const body = $('#detail-body');

  const photoSlot = el('div', { class: 'detail-photo' });
  if (m.hasPhoto) {
    if (m.thumb) photoSlot.append(el('img', { src: m.thumb, alt: `Photo: ${m.title}`, class: 'blur-up' }));
    // Load the full-size photo after the screen is shown (faster first paint).
    db.getPhoto(id).then(async (rec) => {
      if (!rec) return;
      const full = await decryptJSON(auth.currentUser().key, rec.enc);
      photoSlot.replaceChildren(el('img', { src: full, alt: `Photo: ${m.title}` }));
    }).catch((err) => console.error('Photo load failed', err));
  }

  const rows = [
    ['When', formatDate(m.createdAt)],
    ['Mood', m.mood],
    ['Place', m.placeName || (m.needsEnrich ? 'Will be added when online' : null)],
    ['Weather', weatherLabel(m.weather)],
    ['Coordinates', typeof m.lat === 'number'
      ? `${roundCoord(m.lat, 5)}, ${roundCoord(m.lon, 5)}${m.accuracy ? ` (±${m.accuracy} m)` : ''}` : null],
  ].filter(([, v]) => v);

  // Bug fix: replaceChildren(null) inserts the text "null", so empty parts are filtered out.
  body.replaceChildren(...[
    photoSlot,
    m.note ? el('p', { class: 'detail-note', text: m.note }) : null,
    el('dl', { class: 'detail-meta' }, rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
  ].filter(Boolean));
  $('#detail-map').hidden = typeof m.lat !== 'number';
  $('#detail-map').onclick = () => go(`map/${encodeURIComponent(id)}`);
  $('#detail-edit').onclick = () => go(`edit/${encodeURIComponent(id)}`);
  $('#detail-delete').onclick = async () => {
    if (!window.confirm(`Delete "${m.title}"? This cannot be undone.`)) return;
    await db.deleteMoment(id);
    moments = moments.filter((x) => x.id !== id);
    toast('Moment deleted.');
    go('timeline');
  };
}

// ------------------------------------------------------------------ map
function showMap(focusId) {
  showScreen('screen-map', 'Map');
  if (typeof L === 'undefined') {
    $('#map-note').textContent = 'The map could not be loaded.';
    return;
  }
  if (!map) {
    L.Icon.Default.imagePath = './'; // marker images sit next to index.html
    map = L.map('map', { zoomControl: true, attributionControl: true }).setView([56.462, -2.970], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
  }
  // The map container was hidden, so Leaflet must re-measure it.
  setTimeout(() => {
    map.invalidateSize();
    renderMarkers(focusId);
  }, 50);
}

function renderMarkers(focusId) {
  if (!map) return;
  markerLayer.clearLayers();
  const located = moments.filter((m) => typeof m.lat === 'number');
  const bounds = [];
  let focusMarker = null;
  for (const m of located) {
    const popup = el('div', { class: 'popup' }, [
      m.thumb ? el('img', { src: m.thumb, alt: '', width: 120 }) : null,
      el('strong', { text: m.title }),
      el('br'),
      el('span', { text: formatDate(m.createdAt) }),
      el('br'),
      el('a', { href: `#/moment/${encodeURIComponent(m.id)}`, text: 'Open moment' }),
    ]);
    const marker = L.marker([m.lat, m.lon], { title: m.title, alt: m.title, keyboard: true })
      .bindPopup(popup)
      .addTo(markerLayer);
    bounds.push([m.lat, m.lon]);
    if (m.id === focusId) focusMarker = marker;
  }
  if (focusMarker) {
    map.setView(focusMarker.getLatLng(), 16);
    focusMarker.openPopup();
  } else if (bounds.length === 1) {
    map.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }
  const notes = [];
  notes.push(located.length ? `${located.length} moment${located.length === 1 ? '' : 's'} on the map.` : 'No moments with a location yet.');
  if (!navigator.onLine) notes.push('Offline: only map areas you have viewed before will appear.');
  $('#map-note').textContent = notes.join(' ');
}

// ------------------------------------------------------------------ profile
function showProfile() {
  showScreen('screen-profile', 'Profile');
  $('#profile-email').textContent = auth.currentUser().email;
  document.querySelector(`input[name=theme][value="${settings.theme}"]`).checked = true;
  document.querySelector(`input[name=textsize][value="${settings.textSize}"]`).checked = true;
  document.querySelector(`input[name=precision][value="${settings.precision}"]`).checked = true;
  renderStats();
  renderInstallBox();
}

function renderStats() {
  const s = computeStats(moments);
  const items = [['Moments', s.count], ['Places', s.places], ['Photos', s.photos], ['Km between pins', s.km]];
  $('#stats').replaceChildren(...items.map(([k, v]) =>
    el('div', { class: 'stat' }, [el('dt', { text: k }), el('dd', { text: String(v) })])));
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function renderInstallBox() {
  const box = $('#install-box');
  if (isStandalone()) { box.hidden = true; return; }
  box.hidden = false;
  if (deferredInstallPrompt) {
    $('#install-text').textContent = 'Add Pinpoint Diary to your home screen so it opens like an app and works offline.';
    $('#install-btn').hidden = false;
  } else if (isIOS()) {
    $('#install-text').textContent = 'On iPhone: tap the Share button (square with an arrow) in Safari, then "Add to Home Screen".';
    $('#install-btn').hidden = true;
  } else {
    $('#install-text').textContent = 'Use your browser menu and choose "Install app" or "Add to Home screen".';
    $('#install-btn').hidden = true;
  }
}

async function exportData() {
  const session = auth.currentUser();
  const full = [];
  for (const m of moments) {
    let photo = null;
    if (m.hasPhoto) {
      const rec = await db.getPhoto(m.id);
      if (rec) photo = await decryptJSON(session.key, rec.enc);
    }
    const { thumb, ...rest } = m;
    full.push({ ...rest, createdAtISO: new Date(m.createdAt).toISOString(), photo });
  }
  const blob = new Blob([JSON.stringify({ app: 'Pinpoint Diary', exportedAt: new Date().toISOString(), account: session.email, moments: full }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `pinpoint-diary-export-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Export ready.');
}

function wireProfile() {
  $$('input[name=theme]').forEach((r) => r.addEventListener('change', () => {
    localStorage.setItem('pd-theme', r.value); applySettings();
  }));
  $$('input[name=textsize]').forEach((r) => r.addEventListener('change', () => {
    localStorage.setItem('pd-textsize', r.value); applySettings();
  }));
  $$('input[name=precision]').forEach((r) => r.addEventListener('change', () => {
    localStorage.setItem('pd-precision', r.value);
    toast(r.value === 'approx' ? 'New moments will use an approximate location.' : 'New moments will use your exact location.');
  }));
  $('#export-btn').addEventListener('click', () => exportData().catch((e) => toast(`Export failed: ${e.message}`)));
  $('#logout-btn').addEventListener('click', () => lock('Logged out.'));
  $('#delete-account-btn').addEventListener('click', async () => {
    if (!window.confirm('Delete your account and ALL moments and photos on this phone? This cannot be undone.')) return;
    await auth.deleteAccount();
    moments = [];
    toast('Account and data deleted.');
    go('login');
  });
  $('#install-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderInstallBox();
  });
}

// ------------------------------------------------------------------ app-wide
function lock(message) {
  auth.logout();
  moments = [];
  resetForm();
  if (markerLayer) markerLayer.clearLayers();
  $('#moment-list').replaceChildren();
  if (message) toast(message);
  go('login');
}

function updateOnlineStatus() {
  $('#offline-banner').hidden = navigator.onLine;
  if (navigator.onLine) syncPendingMoments();
}

function init() {
  applySettings();
  wireAuthForms();
  wireMomentForm();
  wireProfile();

  $$('[data-action=back]').forEach((b) => b.addEventListener('click', goBack));

  let searchTimer;
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderTimeline, 150); // debounce typing
  });

  window.addEventListener('hashchange', router);
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // Auto-lock: if the app was in the background for 5+ minutes, ask for the password again.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && auth.currentUser() && Date.now() - hiddenAt > AUTO_LOCK_MS) {
      lock('Locked to keep your diary private.');
    }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    if (parseRoute().name === 'profile') renderInstallBox();
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error(e.reason);
    toast('Something went wrong. Please try again.');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  }

  router();
}

init();
