// ====== SwipeSort — aplikasi penyortir galeri ala Slidebox ======
import { db, uid } from './db.js';

// ---------- State ----------
const state = {
  photos: [], // semua record foto
  albums: [],
  cursor: 0, // posisi di dalam inbox
  undoStack: [], // { photoId, prevStatus, prevAlbumId, prevCursor }
  currentAlbumId: null, // untuk layar detail album
};

const urlCache = new Map(); // photoId -> objectURL

// ---------- Util DOM ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function photoURL(photo) {
  if (!urlCache.has(photo.id)) {
    urlCache.set(photo.id, URL.createObjectURL(photo.blob));
  }
  return urlCache.get(photo.id);
}

function revokeURL(photoId) {
  const url = urlCache.get(photoId);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(photoId);
  }
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

// ---------- Turunan state ----------
const inbox = () => state.photos.filter((p) => p.status === 'inbox');
const trashed = () => state.photos.filter((p) => p.status === 'trash');
const sortedCount = () => state.photos.filter((p) => p.status === 'kept').length;
const albumPhotos = (albumId) => state.photos.filter((p) => p.status === 'kept' && p.albumId === albumId);
const findPhoto = (id) => state.photos.find((p) => p.id === id);
const findAlbum = (id) => state.albums.find((a) => a.id === id);

function clampCursor() {
  const n = inbox().length;
  if (n === 0) state.cursor = 0;
  else state.cursor = Math.min(Math.max(0, state.cursor), n - 1);
}

// ---------- Navigasi layar ----------
function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $(`#screen-${name}`).classList.add('active');
  document.body.classList.toggle('on-home', name === 'home');
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.nav === name));
  if (name === 'sort') renderSort();
  if (name === 'trash') renderTrash();
  if (name === 'albums') renderAlbumList();
  if (name === 'home') renderHome();
}

// ---------- Beranda ----------
function renderHome() {
  const total = state.photos.length;
  const hasData = total > 0;
  $('#home-stats').classList.toggle('hidden', !hasData);
  $('#stat-total').textContent = total;
  $('#stat-sorted').textContent = sortedCount();
  $('#stat-trash').textContent = trashed().length;
}

// ---------- Impor ----------
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
    status: 'inbox',
    albumId: null,
    sortedAt: null,
  }));
  await db.addPhotos(records);
  state.photos.push(...records);
  toast(`📥 ${records.length} foto diimpor`);
  showScreen('sort');
}

// ---------- Aksi sortir ----------
async function applyAction(photo, { status, albumId = null }) {
  state.undoStack.push({
    photoId: photo.id,
    prevStatus: photo.status,
    prevAlbumId: photo.albumId,
    prevCursor: state.cursor,
  });
  photo.status = status;
  photo.albumId = albumId;
  photo.sortedAt = Date.now();
  await db.putPhoto(photo);
  clampCursor();
  updateBadges();
  $('#btn-undo').disabled = false;
}

async function undo() {
  const entry = state.undoStack.pop();
  if (!entry) return;
  const photo = findPhoto(entry.photoId);
  if (photo) {
    photo.status = entry.prevStatus;
    photo.albumId = entry.prevAlbumId;
    await db.putPhoto(photo);
  }
  state.cursor = entry.prevCursor;
  clampCursor();
  $('#btn-undo').disabled = state.undoStack.length === 0;
  toast('↩️ Diurungkan');
  renderSort();
}

// ---------- Render layar sortir ----------
function renderSort() {
  clampCursor();
  const queue = inbox();
  const total = state.photos.length;
  const done = total - queue.length;

  $('#progress-current').textContent = queue.length ? done + state.cursor + 1 : done;
  $('#progress-total').textContent = total;
  $('#progress-fill').style.width = total ? `${(done / total) * 100}%` : '0%';
  $('#btn-undo').disabled = state.undoStack.length === 0;

  renderAlbumTabs();
  renderCardStack();
  updateBadges();
}

function renderAlbumTabs() {
  const wrap = $('#album-tabs');
  wrap.innerHTML = '';
  state.albums.forEach((album) => {
    const btn = document.createElement('button');
    btn.className = 'album-tab';
    btn.textContent = `📁 ${album.name}`;
    btn.addEventListener('click', () => sortIntoAlbum(album));
    wrap.appendChild(btn);
  });
  const add = document.createElement('button');
  add.className = 'album-tab add';
  add.textContent = '+ Album';
  add.addEventListener('click', async () => {
    const album = await promptNewAlbum();
    if (album && inbox().length) sortIntoAlbum(album);
  });
  wrap.appendChild(add);
}

async function promptNewAlbum() {
  const name = (prompt('Nama album baru:') || '').trim();
  if (!name) return null;
  const existing = state.albums.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const album = { id: uid(), name, createdAt: Date.now() };
  await db.putAlbum(album);
  state.albums.push(album);
  return album;
}

function currentPhoto() {
  return inbox()[state.cursor] || null;
}

async function sortIntoAlbum(album) {
  const photo = currentPhoto();
  if (!photo) return;
  flashTab(album.id);
  await applyAction(photo, { status: 'kept', albumId: album.id });
  toast(`📁 Masuk ke “${album.name}”`);
  renderSort();
}

function flashTab(albumId) {
  const idx = state.albums.findIndex((a) => a.id === albumId);
  const tab = $('#album-tabs').children[idx];
  if (tab) {
    tab.classList.add('flash');
    setTimeout(() => tab.classList.remove('flash'), 350);
  }
}

async function trashCurrent() {
  const photo = currentPhoto();
  if (!photo) return;
  await animateCardOut(0, -window.innerHeight);
  await applyAction(photo, { status: 'trash' });
  toast('🗑️ Dibuang ke Trash');
  renderSort();
}

async function keepCurrent() {
  const photo = currentPhoto();
  if (!photo) return;
  await animateCardOut(-window.innerWidth, 0);
  await applyAction(photo, { status: 'kept' });
  renderSort();
}

function goPrev() {
  if (state.cursor > 0) {
    state.cursor--;
    renderSort();
  }
}

function goNext() {
  if (state.cursor < inbox().length - 1) {
    state.cursor++;
    renderSort();
  }
}

// ---------- Kartu & gesture ----------
function renderCardStack() {
  const stack = $('#card-stack');
  stack.innerHTML = '';
  const queue = inbox();
  const empty = queue.length === 0;
  $('#empty-state').classList.toggle('hidden', !empty);
  stack.classList.toggle('hidden', empty);
  if (empty) return;

  const current = queue[state.cursor];
  const next = queue[state.cursor + 1] || queue[state.cursor - 1];

  if (next && next !== current) {
    stack.appendChild(buildCard(next, true));
  }
  const topCard = buildCard(current, false);
  stack.appendChild(topCard);
  attachGestures(topCard);
}

function buildCard(photo, isUnder) {
  const card = document.createElement('div');
  card.className = 'photo-card' + (isUnder ? ' under' : '');
  const img = document.createElement('img');
  img.src = photoURL(photo);
  img.alt = photo.name;
  img.draggable = false;
  const label = document.createElement('div');
  label.className = 'card-label';
  label.textContent = photo.name;
  card.append(img, label);
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
      const photo = currentPhoto();
      await animateCardOut(dx, -window.innerHeight);
      if (photo) {
        await applyAction(photo, { status: 'trash' });
        toast('🗑️ Dibuang ke Trash');
      }
      renderSort();
      return;
    }
    if (!isVertical && dx < -SWIPE_THRESHOLD) {
      const photo = currentPhoto();
      await animateCardOut(-window.innerWidth, dy);
      if (photo) await applyAction(photo, { status: 'kept' });
      renderSort();
      return;
    }
    if (!isVertical && dx > SWIPE_THRESHOLD) {
      if (state.cursor > 0) {
        goPrev();
      } else {
        springBack(card);
      }
      return;
    }
    // Ketukan tanpa geser = pratinjau ukuran penuh
    if (!moved) {
      const photo = currentPhoto();
      if (photo) openLightbox(photoURL(photo));
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

// ---------- Trash ----------
function renderTrash() {
  const grid = $('#trash-grid');
  grid.innerHTML = '';
  const items = trashed();
  $('#trash-count').textContent = items.length;
  $('#trash-empty-msg').classList.toggle('hidden', items.length > 0);
  $('#btn-empty-trash').disabled = items.length === 0;

  items.forEach((photo) => {
    const cell = document.createElement('div');
    cell.className = 'grid-item';
    const img = document.createElement('img');
    img.src = photoURL(photo);
    img.alt = photo.name;
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(photoURL(photo)));
    const restore = document.createElement('button');
    restore.className = 'grid-action';
    restore.title = 'Kembalikan';
    restore.textContent = '↩️';
    restore.addEventListener('click', async (e) => {
      e.stopPropagation();
      photo.status = 'inbox';
      photo.albumId = null;
      await db.putPhoto(photo);
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
  const items = trashed();
  if (!items.length) return;
  const ok = confirm(`Hapus permanen ${items.length} foto dari Trash? Tindakan ini tidak bisa diurungkan.`);
  if (!ok) return;
  const ids = items.map((p) => p.id);
  await db.deletePhotos(ids);
  ids.forEach(revokeURL);
  state.photos = state.photos.filter((p) => !ids.includes(p.id));
  state.undoStack = state.undoStack.filter((u) => !ids.includes(u.photoId));
  toast(`🧹 ${ids.length} foto dihapus permanen`);
  renderTrash();
}

// ---------- Album ----------
function renderAlbumList() {
  const wrap = $('#album-list');
  wrap.innerHTML = '';

  const rows = [
    { id: null, name: 'Tersimpan (tanpa album)', icon: '✅', photos: albumPhotos(null) },
    ...state.albums.map((a) => ({ id: a.id, name: a.name, icon: '📁', photos: albumPhotos(a.id) })),
  ];

  rows.forEach((row) => {
    const el = document.createElement('div');
    el.className = 'album-row';
    const cover = document.createElement('div');
    cover.className = 'album-cover';
    if (row.photos.length) {
      const img = document.createElement('img');
      img.src = photoURL(row.photos[row.photos.length - 1]);
      img.alt = '';
      cover.appendChild(img);
    } else {
      cover.textContent = row.icon;
    }
    const info = document.createElement('div');
    info.className = 'album-info';
    info.innerHTML = `<div class="name">${escapeHTML(row.name)}</div><div class="meta">${row.photos.length} foto</div>`;
    el.append(cover, info);
    el.addEventListener('click', () => openAlbumDetail(row.id, row.name));
    wrap.appendChild(el);
  });
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function openAlbumDetail(albumId, name) {
  state.currentAlbumId = albumId;
  $('#album-detail-name').textContent = albumId === null ? '✅ Tersimpan' : `📁 ${name}`;
  $('#btn-delete-album').classList.toggle('hidden', albumId === null);
  renderAlbumDetail();
  $$('.screen').forEach((s) => s.classList.remove('active'));
  $('#screen-album-detail').classList.add('active');
}

function renderAlbumDetail() {
  const grid = $('#album-detail-grid');
  grid.innerHTML = '';
  const items = albumPhotos(state.currentAlbumId);
  $('#album-empty-msg').classList.toggle('hidden', items.length > 0);

  items.forEach((photo) => {
    const cell = document.createElement('div');
    cell.className = 'grid-item';
    const img = document.createElement('img');
    img.src = photoURL(photo);
    img.alt = photo.name;
    img.loading = 'lazy';
    img.addEventListener('click', () => openLightbox(photoURL(photo)));
    const remove = document.createElement('button');
    remove.className = 'grid-action';
    remove.title = 'Kembalikan ke antrean sortir';
    remove.textContent = '↩️';
    remove.addEventListener('click', async (e) => {
      e.stopPropagation();
      photo.status = 'inbox';
      photo.albumId = null;
      await db.putPhoto(photo);
      toast('↩️ Dikembalikan ke antrean');
      renderAlbumDetail();
      updateBadges();
    });
    cell.append(img, remove);
    grid.appendChild(cell);
  });
}

async function deleteCurrentAlbum() {
  const album = findAlbum(state.currentAlbumId);
  if (!album) return;
  const members = albumPhotos(album.id);
  const ok = confirm(`Hapus album “${album.name}”? ${members.length} foto di dalamnya tetap tersimpan (tanpa album).`);
  if (!ok) return;
  for (const photo of members) {
    photo.albumId = null;
    await db.putPhoto(photo);
  }
  await db.deleteAlbum(album.id);
  state.albums = state.albums.filter((a) => a.id !== album.id);
  toast(`🗑️ Album “${album.name}” dihapus`);
  showScreen('albums');
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
  const n = trashed().length;
  const badge = $('#nav-trash-badge');
  badge.textContent = n;
  badge.classList.toggle('hidden', n === 0);
}

// ---------- Event global ----------
function bindEvents() {
  const fileInput = $('#file-input');
  $('#btn-import').addEventListener('click', () => fileInput.click());
  $('#btn-empty-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    importFiles(fileInput.files);
    fileInput.value = '';
  });

  $('#btn-resume').addEventListener('click', () => showScreen('sort'));
  $('#btn-back-home').addEventListener('click', () => showScreen('home'));

  $('#btn-trash').addEventListener('click', trashCurrent);
  $('#btn-keep').addEventListener('click', keepCurrent);
  $('#btn-prev').addEventListener('click', goPrev);
  $('#btn-next').addEventListener('click', goNext);
  $('#btn-undo').addEventListener('click', undo);

  $('#btn-empty-trash').addEventListener('click', emptyTrash);
  $('#btn-new-album').addEventListener('click', async () => {
    await promptNewAlbum();
    renderAlbumList();
  });
  $('#btn-delete-album').addEventListener('click', deleteCurrentAlbum);

  $$('.btn-back').forEach((b) =>
    b.addEventListener('click', () => {
      const parent = b.closest('.screen');
      showScreen(parent.id === 'screen-album-detail' ? 'albums' : 'sort');
    })
  );

  $$('.nav-btn').forEach((b) => b.addEventListener('click', () => showScreen(b.dataset.nav)));

  $('#lightbox-close').addEventListener('click', closeLightbox);
  $('#lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLightbox();
  });

  // Tarik & letakkan
  document.body.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dragover');
  });
  document.body.addEventListener('dragleave', () => document.body.classList.remove('dragover'));
  document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
  });

  // Pintasan keyboard
  document.addEventListener('keydown', (e) => {
    if (!$('#screen-sort').classList.contains('active')) {
      if (e.key === 'Escape') closeLightbox();
      return;
    }
    if (e.key === 'Escape') return closeLightbox();
    if (e.target instanceof HTMLInputElement) return;
    switch (e.key) {
      case 'ArrowLeft': goPrev(); break;
      case 'ArrowRight': goNext(); break;
      case 'ArrowUp':
      case 'Delete':
      case 'Backspace': trashCurrent(); break;
      case ' ': e.preventDefault(); keepCurrent(); break;
      case 'z':
      case 'Z': undo(); break;
      default: {
        // Angka 1-9 = sortir ke album ke-n
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= state.albums.length) sortIntoAlbum(state.albums[n - 1]);
      }
    }
  });
}

// ---------- Inisialisasi ----------
async function init() {
  bindEvents();
  try {
    const [photos, albums] = await Promise.all([db.getAllPhotos(), db.getAllAlbums()]);
    state.photos = photos.sort((a, b) => a.addedAt - b.addedAt);
    state.albums = albums.sort((a, b) => a.createdAt - b.createdAt);
  } catch (err) {
    console.error('Gagal memuat basis data', err);
    toast('⚠️ Gagal memuat data tersimpan');
  }
  updateBadges();
  showScreen('home');

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
