// ====== SwipeSort — penyortir galeri ala Slidebox ======
// Dua mode data dengan UI yang sama:
//  - native : di dalam APK Android; foto dibaca langsung dari galeri (MediaStore)
//             lewat jembatan window.NativeGallery. Keputusan (buang/pindah)
//             disimpan dulu, lalu diterapkan sekaligus lewat dialog sistem.
//  - web    : di browser; foto diimpor manual, disimpan di IndexedDB,
//             dikelompokkan per bulan dari tanggal berkas.
import { db, uid } from './db.js';

const native = window.NativeGallery || null;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ---------- State ----------
const state = {
  mode: native ? 'native' : 'web',
  permission: false,
  months: [], // {key:'2024-05', label:'Mei 2024', count}
  albums: [], // {name, count, coverUrl}
  customAlbums: [], // album buatan pengguna (record db.albums)
  webPhotos: [], // mode web: semua record foto
  decisions: new Map(), // photoKey -> {action:'keep'|'trash'|'move', album, monthKey, name, takenAt}
  month: null, // {key,label}
  photos: [], // foto bulan aktif: {key, name, takenAt, url(w)->string}
  cursor: 0,
  undoStack: [], // {photoKey, prev:decision|null, cursor}
  currentAlbumName: null,
  committing: false,
  faces: new Map(), // photoKey -> {key, faces, scannedAt}
  scanning: false,
  scanTotal: 0,
  scanDone: 0,
};

const urlCache = new Map();

// ---------- Util ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

let toastTimer = null;
function toast(msg, actionLabel, actionFn) {
  const el = $('#toast');
  el.innerHTML = '';
  el.append(document.createTextNode(msg));
  if (actionLabel) {
    const b = document.createElement('button');
    b.textContent = actionLabel;
    b.addEventListener('click', () => {
      el.classList.add('hidden');
      actionFn();
    });
    el.appendChild(b);
  }
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), actionLabel ? 3600 : 2200);
}

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${h}:${mm} ${ampm}`;
}

function monthKeyOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// ---------- Sumber data ----------
function photoUrl(photo, width) {
  if (state.mode === 'native') {
    return width ? `/media/${photo.key}?w=${width}` : `/media/${photo.key}`;
  }
  if (!urlCache.has(photo.key)) {
    const rec = state.webPhotos.find((p) => p.id === photo.key);
    if (!rec) return '';
    urlCache.set(photo.key, URL.createObjectURL(rec.blob));
  }
  return urlCache.get(photo.key);
}

async function loadMonths() {
  if (state.mode === 'native') {
    state.months = state.permission ? JSON.parse(native.listMonths()) : [];
  } else {
    const groups = new Map();
    for (const p of state.webPhotos) {
      const key = monthKeyOf(p.takenAt || p.addedAt);
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    state.months = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, count]) => ({ key, label: monthLabelOf(key), count }));
  }
}

async function loadAlbums() {
  const custom = state.customAlbums.map((a) => ({ name: a.name, count: 0, custom: true }));
  if (state.mode === 'native') {
    const device = state.permission ? JSON.parse(native.listAlbums()) : [];
    const deviceNames = new Set(device.map((a) => a.name));
    state.albums = [...device, ...custom.filter((c) => !deviceNames.has(c.name))];
  } else {
    const counts = new Map();
    for (const p of state.webPhotos) {
      if (p.status === 'kept' && p.albumId) counts.set(p.albumId, (counts.get(p.albumId) || 0) + 1);
    }
    state.albums = state.customAlbums.map((a) => ({
      name: a.name,
      id: a.id,
      count: counts.get(a.id) || 0,
      custom: true,
    }));
  }
}

function monthPhotos(monthKey) {
  if (state.mode === 'native') {
    return JSON.parse(native.listPhotos(monthKey)).map((p) => ({
      key: String(p.id),
      name: p.name,
      takenAt: p.taken,
    }));
  }
  return state.webPhotos
    .filter((p) => monthKeyOf(p.takenAt || p.addedAt) === monthKey)
    .sort((a, b) => (a.takenAt || a.addedAt) - (b.takenAt || b.addedAt))
    .map((p) => ({ key: p.id, name: p.name, takenAt: p.takenAt || p.addedAt }));
}

// ---------- Keputusan ----------
async function setDecision(photo, decision) {
  const prev = state.decisions.get(photo.key) || null;
  state.undoStack.push({ photoKey: photo.key, prev, cursor: state.cursor });
  const record = decision && {
    key: photo.key,
    monthKey: state.month.key,
    name: photo.name,
    takenAt: photo.takenAt,
    ...decision,
  };
  if (record) {
    state.decisions.set(photo.key, record);
    await db.putDecision(record);
  } else {
    state.decisions.delete(photo.key);
    await db.deleteDecision(photo.key);
  }
  updateBadges();
}

async function undo() {
  const entry = state.undoStack.pop();
  if (!entry) return;
  if (entry.prev) {
    state.decisions.set(entry.photoKey, entry.prev);
    await db.putDecision(entry.prev);
  } else {
    state.decisions.delete(entry.photoKey);
    await db.deleteDecision(entry.photoKey);
  }
  state.cursor = entry.cursor;
  updateBadges();
  renderSort();
  toast('↩️ Diurungkan');
}

const trashKeys = () => [...state.decisions.values()].filter((d) => d.action === 'trash');
const pendingMoves = () => [...state.decisions.values()].filter((d) => d.action === 'move');

// ---------- Navigasi layar ----------
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  $$('.org-chips .chip').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'organize') renderOrganize();
  if (name === 'trash') renderTrash();
  if (name === 'albums') renderAlbumList();
  if (name === 'faces') renderFaces();
}

// ---------- Layar Susun ----------
async function renderOrganize() {
  await loadMonths();
  const isNative = state.mode === 'native';
  $('#perm-gate').classList.toggle('hidden', !isNative || state.permission);
  $('#import-gate').classList.toggle('hidden', isNative || state.months.length > 0);
  $('#web-import-more').classList.toggle('hidden', isNative || state.months.length === 0);
  $('#month-section').classList.toggle('hidden', state.months.length === 0);

  const moves = pendingMoves();
  $('#pending-banner').classList.toggle('hidden', !isNative || moves.length === 0);
  $('#pending-text').textContent = `📁 ${moves.length} foto menunggu dipindahkan`;

  // Kartu filter pintar (hanya mode Android dengan izin)
  $('#smart-section').classList.toggle('hidden', !isNative || !state.permission);
  if (isNative && state.permission) {
    const found = faceKeys().length;
    const scanned = state.faces.size;
    $('#smart-faces-meta').textContent = scanned === 0
      ? 'Ketuk untuk memindai wajah di seluruh galeri'
      : `${found} foto dengan orang · ${scanned} foto dipindai`;
  }

  const list = $('#month-list');
  list.innerHTML = '';
  state.months.forEach((m, i) => {
    const decided = monthDecidedCount(m.key);
    const row = document.createElement('button');
    row.className = `month-row mc-${i % 6}`;
    row.innerHTML = `<span>${decided >= m.count ? '<span class="done-mark">✔</span>' : ''}${esc(m.label)}</span><span class="count">${m.count}</span>`;
    row.addEventListener('click', () => openMonth(m));
    list.appendChild(row);
  });
  updateBadges();
}

function monthDecidedCount(monthKey) {
  let n = 0;
  for (const d of state.decisions.values()) if (d.monthKey === monthKey) n++;
  if (state.mode === 'web') {
    for (const p of state.webPhotos) {
      if (monthKeyOf(p.takenAt || p.addedAt) === monthKey && p.status !== 'inbox' && !state.decisions.has(p.id)) n++;
    }
  }
  return n;
}

// ---------- Impor (mode web) ----------
async function importFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    toast('Tidak ada berkas gambar yang dipilih');
    return;
  }
  const now = Date.now();
  const records = files.map((f, i) => ({
    id: uid(),
    name: f.name,
    type: f.type,
    blob: f,
    addedAt: now + i,
    takenAt: f.lastModified || now,
    status: 'inbox',
    albumId: null,
  }));
  await db.addPhotos(records);
  state.webPhotos.push(...records);
  toast(`📥 ${records.length} foto diimpor`);
  renderOrganize();
}

// ---------- Buka bulan & layar sortir ----------
function openMonth(month) {
  state.month = month;
  state.photos = monthPhotos(month.key);
  state.undoStack = [];
  // Mulai dari foto pertama yang belum diputuskan
  const firstUndecided = state.photos.findIndex((p) => !isDecided(p));
  state.cursor = firstUndecided === -1 ? 0 : firstUndecided;
  showScreen('sort');
  renderSort();
}

function isDecided(photo) {
  if (state.decisions.has(photo.key)) return true;
  if (state.mode === 'web') {
    const rec = state.webPhotos.find((p) => p.id === photo.key);
    return rec && rec.status !== 'inbox';
  }
  return false;
}

function currentPhoto() {
  return state.photos[state.cursor] || null;
}

function renderSort() {
  const total = state.photos.length;
  if (total === 0) {
    showScreen('organize');
    return;
  }
  state.cursor = Math.min(Math.max(0, state.cursor), total - 1);
  const photo = currentPhoto();

  $('#sort-month-label').textContent = state.month.label.toUpperCase();
  $('#sp-pos').textContent = state.cursor + 1;
  $('#sp-total').textContent = total;
  $('#sp-date').textContent = fmtDate(photo.takenAt);

  renderDecisionBadge(photo);
  renderAlbumChips();
  renderCardStack();
  updateBadges();
}

function decisionLabel(d) {
  if (!d) return null;
  if (d.action === 'trash') return '🗑 Akan dibuang';
  if (d.action === 'move') return `📁 → ${d.album}`;
  if (d.action === 'keep') return '✓ Disimpan';
  return null;
}

function renderDecisionBadge(photo) {
  let label = decisionLabel(state.decisions.get(photo.key));
  if (!label && state.mode === 'web') {
    const rec = state.webPhotos.find((p) => p.id === photo.key);
    if (rec && rec.status === 'trash') label = '🗑 Akan dibuang';
    else if (rec && rec.status === 'kept' && rec.albumId) {
      const a = state.customAlbums.find((x) => x.id === rec.albumId);
      label = `📁 → ${a ? a.name : 'album'}`;
    } else if (rec && rec.status === 'kept') label = '✓ Disimpan';
  }
  const badge = $('#decision-badge');
  badge.textContent = label || '';
  badge.classList.toggle('hidden', !label);
}

async function renderAlbumChips() {
  await loadAlbums();
  const wrap = $('#album-tabs');
  wrap.innerHTML = '';
  state.albums.forEach((album) => {
    const btn = document.createElement('button');
    btn.className = 'sb-album';
    btn.innerHTML = `<span class="dl">⬇</span><span class="nm">${esc(album.name)}</span>`;
    btn.addEventListener('click', () => moveCurrentTo(album));
    wrap.appendChild(btn);
  });
  const add = document.createElement('button');
  add.className = 'sb-album add';
  add.innerHTML = '<span class="dl">＋</span><span class="nm">Album baru</span>';
  add.addEventListener('click', async () => {
    const album = await promptNewAlbum();
    if (album) moveCurrentTo(album);
  });
  wrap.appendChild(add);
}

async function promptNewAlbum() {
  const name = (prompt('Nama album baru:') || '').trim();
  if (!name) return null;
  const existing = state.albums.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const record = { id: uid(), name, createdAt: Date.now() };
  await db.putAlbum(record);
  state.customAlbums.push(record);
  return { name, id: record.id, count: 0, custom: true };
}

// ---------- Aksi sortir ----------
async function advanceAfterAction() {
  if (state.cursor < state.photos.length - 1) {
    state.cursor++;
    renderSort();
  } else {
    renderSort();
    showSummary();
  }
}

async function actKeep(animate) {
  const photo = currentPhoto();
  if (!photo) return;
  if (animate) await animateCardOut(-window.innerWidth, 0);
  if (state.mode === 'web') {
    await webApply(photo.key, 'kept', null);
    state.undoStack.push({ photoKey: photo.key, prev: null, cursor: state.cursor, webPrev: true });
  } else {
    await setDecision(photo, { action: 'keep' });
  }
  advanceAfterAction();
}

async function actTrash(animate) {
  const photo = currentPhoto();
  if (!photo) return;
  if (animate) await animateCardOut(0, -window.innerHeight);
  await setDecision(photo, { action: 'trash' });
  if (state.mode === 'web') await webApply(photo.key, 'trash', null);
  toast('🗑 Ditandai untuk dibuang', 'URUNGKAN', undo);
  advanceAfterAction();
}

async function moveCurrentTo(album) {
  const photo = currentPhoto();
  if (!photo) return;
  await setDecision(photo, { action: 'move', album: album.name, albumId: album.id || null });
  if (state.mode === 'web') await webApply(photo.key, 'kept', album.id);
  toast(`📁 → “${album.name}”`, 'URUNGKAN', undo);
  advanceAfterAction();
}

// Mode web: keputusan langsung diterapkan ke record foto
async function webApply(photoKey, status, albumId) {
  const rec = state.webPhotos.find((p) => p.id === photoKey);
  if (!rec) return;
  rec.status = status;
  rec.albumId = albumId;
  await db.putPhoto(rec);
}

function goPrev() {
  if (state.cursor > 0) {
    state.cursor--;
    renderSort();
  }
}

function goNext() {
  if (state.cursor < state.photos.length - 1) {
    state.cursor++;
    renderSort();
  }
}

// ---------- Ringkasan bulan ----------
function showSummary() {
  const monthKey = state.month.key;
  let keep = 0;
  let trash = 0;
  let move = 0;
  for (const d of state.decisions.values()) {
    if (d.monthKey !== monthKey) continue;
    if (d.action === 'keep') keep++;
    else if (d.action === 'trash') trash++;
    else if (d.action === 'move') move++;
  }
  if (state.mode === 'web') {
    for (const p of state.webPhotos) {
      if (monthKeyOf(p.takenAt || p.addedAt) !== monthKey || state.decisions.has(p.id)) continue;
      if (p.status === 'trash') trash++;
      else if (p.status === 'kept' && p.albumId) move++;
      else if (p.status === 'kept') keep++;
    }
  }
  $('#summary-body').innerHTML =
    `<b>${esc(state.month.label)}</b> sudah ditinjau semua.<br/>` +
    `✓ Disimpan: <b>${keep}</b> &nbsp;·&nbsp; 📁 Dipindahkan: <b>${move}</b> &nbsp;·&nbsp; 🗑 Dibuang: <b>${trash}</b>`;
  $('#btn-summary-apply').classList.toggle('hidden', !(state.mode === 'native' && move > 0));
  $('#btn-summary-trash').classList.toggle('hidden', trash === 0);
  $('#summary-overlay').classList.remove('hidden');
}

// ---------- Komit (mode native) ----------
function applyMoves() {
  if (state.committing) return;
  const moves = pendingMoves();
  if (!moves.length) return;
  state.committing = true;
  toast('📁 Meminta izin sistem…');
  native.commitMoves(JSON.stringify(moves.map((d) => ({ id: d.key, album: d.album }))));
}

function emptyTrashNative() {
  if (state.committing) return;
  const items = trashKeys();
  if (!items.length) return;
  state.committing = true;
  toast('🗑 Meminta izin sistem…');
  native.commitDeletes(JSON.stringify(items.map((d) => d.key)));
}

window.addEventListener('ng-moves-done', async (e) => {
  state.committing = false;
  const { ok, moved = [], failed = 0 } = e.detail || {};
  if (!ok) {
    toast('Perpindahan dibatalkan');
    return;
  }
  await db.deleteDecisions(moved.map(String));
  moved.forEach((id) => state.decisions.delete(String(id)));
  toast(failed ? `📁 ${moved.length} dipindahkan, ${failed} gagal` : `📁 ${moved.length} foto dipindahkan`);
  if ($('#screen-faces').classList.contains('active')) renderFaces();
  else renderOrganize();
});

window.addEventListener('ng-deletes-done', async (e) => {
  state.committing = false;
  const { ok, deleted = [] } = e.detail || {};
  if (!ok) {
    toast('Penghapusan dibatalkan');
    return;
  }
  await db.deleteDecisions(deleted.map(String));
  deleted.forEach((id) => state.decisions.delete(String(id)));
  toast(`🧹 ${deleted.length} foto dihapus dari galeri`);
  renderTrash();
  updateBadges();
});

window.addEventListener('ng-permission', (e) => {
  state.permission = !!(e.detail && e.detail.granted);
  if (!state.permission) toast('Izin galeri ditolak');
  renderOrganize();
});

// ---------- Deteksi wajah ----------
const faceKeys = () => [...state.faces.values()].filter((f) => f.faces > 0).map((f) => f.key);

function unscannedIds() {
  const all = JSON.parse(native.listAllIds());
  return all.map(String).filter((id) => !state.faces.has(id));
}

function renderFaces() {
  const found = faceKeys();
  const scanned = state.faces.size;
  const pending = state.mode === 'native' && state.permission ? unscannedIds().length : 0;

  $('#faces-count').textContent = found.length;
  $('#faces-intro').classList.toggle('hidden', state.scanning || scanned > 0);
  $('#faces-progress').classList.toggle('hidden', !state.scanning);
  $('#faces-empty-msg').classList.toggle('hidden', state.scanning || scanned === 0 || found.length > 0);
  $('#faces-footer').classList.toggle('hidden', state.scanning || found.length === 0);
  $('#btn-rescan').classList.toggle('hidden', state.scanning || scanned === 0);
  $('#btn-rescan').textContent = pending > 0 ? `Pindai ${pending} foto baru` : 'Semua sudah dipindai';
  $('#btn-rescan').disabled = pending === 0;
  $('#faces-scan-note').textContent = pending > 0 ? `${pending} foto akan dipindai` : '';

  const grid = $('#faces-grid');
  grid.innerHTML = '';
  if (state.scanning) return;
  // Terbaru dulu supaya grid terasa hidup
  [...found].reverse().forEach((key) => {
    const cell = document.createElement('div');
    cell.className = 'grid-item';
    const img = document.createElement('img');
    img.src = photoUrl({ key }, 300);
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(photoUrl({ key })));
    const mark = document.createElement('span');
    mark.className = 'face-mark';
    mark.textContent = `👤${state.faces.get(key).faces}`;
    cell.append(img, mark);
    grid.appendChild(cell);
  });
}

function startFaceScan() {
  if (state.mode !== 'native') {
    toast('Deteksi wajah hanya tersedia di aplikasi Android');
    return;
  }
  if (state.scanning) return;
  const ids = unscannedIds();
  if (!ids.length) {
    toast('Semua foto sudah dipindai');
    renderFaces();
    return;
  }
  state.scanning = true;
  state.scanTotal = ids.length;
  state.scanDone = 0;
  $('#faces-progress-text').textContent = `Memindai… 0 / ${ids.length}`;
  $('#faces-progress-fill').style.width = '0%';
  $('#faces-progress-found').textContent = faceKeys().length;
  renderFaces();
  native.scanFaces(JSON.stringify(ids));
}

window.addEventListener('ng-face-batch', async (e) => {
  const results = (e.detail && e.detail.results) || [];
  const now = Date.now();
  const records = results.map((r) => ({ key: String(r.id), faces: r.faces, scannedAt: now }));
  records.forEach((r) => state.faces.set(r.key, r));
  await db.putFaces(records);
  state.scanDone += records.length;
  $('#faces-progress-text').textContent = `Memindai… ${state.scanDone} / ${state.scanTotal}`;
  $('#faces-progress-fill').style.width = `${(state.scanDone / Math.max(1, state.scanTotal)) * 100}%`;
  $('#faces-progress-found').textContent = faceKeys().length;
});

window.addEventListener('ng-face-done', (e) => {
  state.scanning = false;
  const cancelled = e.detail && e.detail.cancelled;
  toast(cancelled ? '⏸ Pemindaian dihentikan' : `✅ Selesai — ${faceKeys().length} foto dengan orang`);
  renderFaces();
  renderOrganize();
});

// Sheet pemilih album tujuan, lalu pindahkan SEMUA foto berwajah sekaligus
async function openAlbumPicker() {
  const keys = faceKeys();
  if (!keys.length) return;
  await loadAlbums();
  $('#album-picker-title').textContent = `Pindahkan ${keys.length} foto ke…`;
  const list = $('#album-picker-list');
  list.innerHTML = '';
  state.albums.forEach((album) => {
    const btn = document.createElement('button');
    btn.className = 'sheet-album';
    btn.innerHTML = `<span>📁 ${esc(album.name)}</span><span class="cnt">${album.count} foto</span>`;
    btn.addEventListener('click', () => {
      $('#album-picker').classList.add('hidden');
      moveAllFacesTo(album.name);
    });
    list.appendChild(btn);
  });
  const add = document.createElement('button');
  add.className = 'sheet-album';
  add.innerHTML = '<span>＋ Album baru…</span>';
  add.addEventListener('click', async () => {
    const album = await promptNewAlbum();
    if (album) {
      $('#album-picker').classList.add('hidden');
      moveAllFacesTo(album.name);
    }
  });
  list.appendChild(add);
  $('#album-picker').classList.remove('hidden');
}

function moveAllFacesTo(albumName) {
  if (state.committing) return;
  const keys = faceKeys();
  if (!keys.length) return;
  state.committing = true;
  toast(`📁 Memindahkan ${keys.length} foto ke “${albumName}”…`);
  native.commitMoves(JSON.stringify(keys.map((id) => ({ id, album: albumName }))));
}

// ---------- Kartu & gesture ----------
function renderCardStack() {
  const stack = $('#card-stack');
  stack.innerHTML = '';
  const photo = currentPhoto();
  if (!photo) return;
  const next = state.photos[state.cursor + 1];
  if (next) stack.appendChild(buildCard(next, true));
  const topCard = buildCard(photo, false);
  stack.appendChild(topCard);
  attachGestures(topCard);
}

function buildCard(photo, isUnder) {
  const card = document.createElement('div');
  card.className = 'photo-card' + (isUnder ? ' under' : '');
  const img = document.createElement('img');
  img.src = photoUrl(photo, 1080);
  img.alt = photo.name || '';
  img.draggable = false;
  card.appendChild(img);
  return card;
}

let animatingOut = false;
function animateCardOut(dx, dy) {
  return new Promise((resolve) => {
    const card = $('#card-stack .photo-card:not(.under)');
    if (!card || animatingOut) return resolve();
    animatingOut = true;
    card.classList.add('animating');
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 30}deg)`;
    card.style.opacity = '0';
    setTimeout(() => {
      animatingOut = false;
      resolve();
    }, 260);
  });
}

const SWIPE_THRESHOLD = 90;

function attachGestures(card) {
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;
  let moved = false;

  card.addEventListener('pointerdown', (e) => {
    if (animatingOut) return;
    dragging = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    dy = 0;
    card.setPointerCapture(e.pointerId);
    card.classList.remove('animating');
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    card.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 30}deg)`;
    const upStrength = Math.min(1, Math.max(0, -dy - 30) / SWIPE_THRESHOLD);
    $('#swipe-hint-up').style.opacity = dy < 0 && Math.abs(dy) > Math.abs(dx) ? upStrength : 0;
  });

  const end = async () => {
    if (!dragging) return;
    dragging = false;
    $('#swipe-hint-up').style.opacity = 0;

    const isVertical = Math.abs(dy) > Math.abs(dx);
    if (isVertical && dy < -SWIPE_THRESHOLD) {
      actTrash(true);
      return;
    }
    if (!isVertical && dx < -SWIPE_THRESHOLD) {
      actKeep(true);
      return;
    }
    if (!isVertical && dx > SWIPE_THRESHOLD) {
      if (state.cursor > 0) goPrev();
      else springBack(card);
      return;
    }
    if (!moved) {
      const photo = currentPhoto();
      if (photo) openLightbox(photoUrl(photo));
    }
    springBack(card);
  };

  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function springBack(card) {
  card.classList.add('animating');
  card.style.transform = 'translate(0, 0) rotate(0)';
  setTimeout(() => card.classList.remove('animating'), 280);
}

// ---------- Sheet bulan ----------
function openMonthSheet() {
  const list = $('#month-sheet-list');
  list.innerHTML = '';
  state.months.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = `sheet-month mc-${i % 6}`;
    btn.innerHTML = `<span>${esc(m.label)}</span><span>${m.count}</span>`;
    btn.addEventListener('click', () => {
      $('#month-sheet').classList.add('hidden');
      openMonth(m);
    });
    list.appendChild(btn);
  });
  $('#month-sheet').classList.remove('hidden');
}

// ---------- Trash ----------
function trashEntries() {
  const entries = trashKeys().map((d) => ({ key: d.key, name: d.name }));
  if (state.mode === 'web') {
    for (const p of state.webPhotos) {
      if (p.status === 'trash' && !state.decisions.has(p.id)) entries.push({ key: p.id, name: p.name });
    }
  }
  return entries;
}

function renderTrash() {
  const grid = $('#trash-grid');
  grid.innerHTML = '';
  const items = trashEntries();
  $('#trash-count').textContent = items.length;
  $('#trash-empty-msg').classList.toggle('hidden', items.length > 0);
  $('#trash-hint').classList.toggle('hidden', items.length === 0);
  $('#btn-empty-trash').disabled = items.length === 0;

  items.forEach((item) => {
    const cell = document.createElement('div');
    cell.className = 'grid-item';
    const img = document.createElement('img');
    img.src = photoUrl({ key: item.key }, 400);
    img.alt = item.name || '';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(photoUrl({ key: item.key })));
    const restore = document.createElement('button');
    restore.className = 'grid-action';
    restore.title = 'Kembalikan';
    restore.textContent = '↩';
    restore.addEventListener('click', async (e) => {
      e.stopPropagation();
      state.decisions.delete(item.key);
      await db.deleteDecision(item.key);
      if (state.mode === 'web') await webApply(item.key, 'inbox', null);
      toast('↩️ Foto dikembalikan');
      renderTrash();
      updateBadges();
    });
    cell.append(img, restore);
    grid.appendChild(cell);
  });
  updateBadges();
}

async function emptyTrash() {
  const items = trashEntries();
  if (!items.length) return;
  if (state.mode === 'native') {
    emptyTrashNative(); // dialog konfirmasi ditampilkan oleh sistem Android
    return;
  }
  const ok = confirm(`Hapus permanen ${items.length} foto? Tindakan ini tidak bisa diurungkan.`);
  if (!ok) return;
  const ids = items.map((i) => i.key);
  await db.deletePhotos(ids);
  await db.deleteDecisions(ids);
  ids.forEach((id) => {
    state.decisions.delete(id);
    const url = urlCache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
  });
  state.webPhotos = state.webPhotos.filter((p) => !ids.includes(p.id));
  toast(`🧹 ${ids.length} foto dihapus permanen`);
  renderTrash();
}

// ---------- Album ----------
async function renderAlbumList() {
  await loadAlbums();
  const wrap = $('#album-list');
  wrap.innerHTML = '';
  if (!state.albums.length) {
    wrap.innerHTML = '<p class="muted center">Belum ada album.</p>';
    return;
  }
  state.albums.forEach((album) => {
    const el = document.createElement('div');
    el.className = 'album-row';
    const cover = document.createElement('div');
    cover.className = 'album-cover';
    if (state.mode === 'native' && album.coverId) {
      const img = document.createElement('img');
      img.src = `/media/${album.coverId}?w=200`;
      img.alt = '';
      cover.appendChild(img);
    } else {
      cover.textContent = '📁';
    }
    const info = document.createElement('div');
    info.className = 'album-info';
    info.innerHTML = `<div class="name">${esc(album.name)}</div><div class="meta">${album.count} foto</div>`;
    el.append(cover, info);
    el.addEventListener('click', () => openAlbumDetail(album));
    wrap.appendChild(el);
  });
}

function openAlbumDetail(album) {
  state.currentAlbumName = album.name;
  $('#album-detail-name').textContent = `📁 ${album.name}`;
  const grid = $('#album-detail-grid');
  grid.innerHTML = '';
  let items = [];
  if (state.mode === 'native') {
    items = JSON.parse(native.listAlbumPhotos(album.name)).map((p) => ({ key: String(p.id), name: p.name }));
  } else {
    items = state.webPhotos
      .filter((p) => p.status === 'kept' && p.albumId === album.id)
      .map((p) => ({ key: p.id, name: p.name }));
  }
  $('#album-empty-msg').classList.toggle('hidden', items.length > 0);
  items.forEach((item) => {
    const cell = document.createElement('div');
    cell.className = 'grid-item';
    const img = document.createElement('img');
    img.src = photoUrl({ key: item.key }, 400);
    img.alt = item.name || '';
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(photoUrl({ key: item.key })));
    cell.appendChild(img);
    grid.appendChild(cell);
  });
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $('#screen-album-detail').classList.add('active');
}

// ---------- Lightbox ----------
function openLightbox(url) {
  $('#lightbox-img').src = url;
  $('#lightbox').classList.remove('hidden');
}

function closeLightbox() {
  $('#lightbox').classList.add('hidden');
  $('#lightbox-img').src = '';
}

// ---------- Lencana ----------
function updateBadges() {
  const n = trashEntries().length;
  const badge = $('#nav-trash-badge');
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}

// ---------- Event global ----------
function bindEvents() {
  const fileInput = $('#file-input');
  $('#btn-import').addEventListener('click', () => fileInput.click());
  $('#btn-import-more').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    importFiles(fileInput.files);
    fileInput.value = '';
  });

  $('#btn-grant').addEventListener('click', () => native && native.requestPermission());
  $('#btn-apply-moves').addEventListener('click', applyMoves);

  $('#smart-faces-card').addEventListener('click', () => showScreen('faces'));
  $('#btn-scan-faces').addEventListener('click', startFaceScan);
  $('#btn-rescan').addEventListener('click', startFaceScan);
  $('#btn-cancel-scan').addEventListener('click', () => native && native.cancelScan());
  $('#btn-move-all-faces').addEventListener('click', openAlbumPicker);
  $('#album-picker').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#album-picker').classList.add('hidden');
  });

  $('#btn-close-sort').addEventListener('click', () => showScreen('organize'));
  $('#btn-month-pill').addEventListener('click', openMonthSheet);
  $('#btn-open-trash').addEventListener('click', () => showScreen('trash'));

  $('#btn-keep').addEventListener('click', () => actKeep(true));
  $('#btn-trash').addEventListener('click', () => actTrash(true));
  $('#btn-help').addEventListener('click', () => $('#help-overlay').classList.remove('hidden'));
  $('#btn-help-close').addEventListener('click', () => $('#help-overlay').classList.add('hidden'));
  $('#btn-share').addEventListener('click', () => {
    const photo = currentPhoto();
    if (!photo) return;
    if (state.mode === 'native') native.share(photo.key);
    else toast('Bagikan hanya tersedia di aplikasi Android');
  });

  $('#btn-empty-trash').addEventListener('click', emptyTrash);
  $('#btn-new-album').addEventListener('click', async () => {
    await promptNewAlbum();
    renderAlbumList();
  });

  $('#btn-summary-close').addEventListener('click', () => {
    $('#summary-overlay').classList.add('hidden');
    showScreen('organize');
  });
  $('#btn-summary-apply').addEventListener('click', () => {
    $('#summary-overlay').classList.add('hidden');
    applyMoves();
    showScreen('organize');
  });
  $('#btn-summary-trash').addEventListener('click', () => {
    $('#summary-overlay').classList.add('hidden');
    showScreen('trash');
  });

  $('#month-sheet').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#month-sheet').classList.add('hidden');
  });
  $('#summary-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#summary-overlay').classList.add('hidden');
  });
  $('#help-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) $('#help-overlay').classList.add('hidden');
  });

  $$('.btn-back').forEach((b) =>
    b.addEventListener('click', () => {
      const parent = b.closest('.screen');
      showScreen(parent.id === 'screen-album-detail' ? 'albums' : 'organize');
    })
  );
  $$('[data-nav]').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.nav)));

  $('#lightbox-close').addEventListener('click', closeLightbox);
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLightbox();
  });

  // Tarik & letakkan (mode web)
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    if (state.mode === 'web' && e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
  });

  // Pintasan keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
      $('#month-sheet').classList.add('hidden');
      $('#help-overlay').classList.add('hidden');
      $('#album-picker').classList.add('hidden');
      return;
    }
    if (!$('#screen-sort').classList.contains('active')) return;
    if (e.target instanceof HTMLInputElement) return;
    switch (e.key) {
      case 'ArrowLeft': goPrev(); break;
      case 'ArrowRight': goNext(); break;
      case 'ArrowUp':
      case 'Delete':
      case 'Backspace': actTrash(true); break;
      case ' ': e.preventDefault(); actKeep(true); break;
      case 'z':
      case 'Z': undo(); break;
      default: {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= state.albums.length) moveCurrentTo(state.albums[n - 1]);
      }
    }
  });
}

// ---------- Inisialisasi ----------
async function init() {
  bindEvents();
  try {
    const [albums, decisions, faces, photos] = await Promise.all([
      db.getAllAlbums(),
      db.getAllDecisions(),
      db.getAllFaces(),
      state.mode === 'web' ? db.getAllPhotos() : Promise.resolve([]),
    ]);
    state.customAlbums = albums.sort((a, b) => a.createdAt - b.createdAt);
    decisions.forEach((d) => state.decisions.set(d.key, d));
    faces.forEach((f) => state.faces.set(f.key, f));
    state.webPhotos = photos.sort((a, b) => (a.takenAt || a.addedAt) - (b.takenAt || b.addedAt));
  } catch (err) {
    console.error('Gagal memuat basis data', err);
    toast('⚠️ Gagal memuat data tersimpan');
  }

  if (state.mode === 'native') {
    state.permission = native.hasPermission();
    if (!state.permission) native.requestPermission();
  }

  showScreen('organize');

  const inAndroidShell = location.hostname === 'appassets.androidx.dev';
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !inAndroidShell) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
