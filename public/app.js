import { configured, ensureSession, userId, createRoom, joinRoom, getPieces, claimPiece, releasePiece, uploadPhoto, photoUrl, RoomChannel } from './supabase.js';
import { PuzzleGame, colorFor, dimensions, initialPositions } from './game.js';

const $ = id => document.getElementById(id);
const savedName = localStorage.getItem('rangkai-name') || '';
$('createName').value = savedName;
$('joinName').value = savedName;

let game = null, channel = null, currentRoom = null, currentName = '', activePlayers = 1;
let selectedPreset = 'coast';
let selectedFile = null;
let toastTimer;

function toast(message) {
  const el = $('gameToast'); el.textContent = message; el.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}
function errorIn(id, error) { const el = $(id); el.textContent = error.message || String(error); el.classList.remove('hidden'); }
function setBusy(id, busy, label) { const button = $(id); button.disabled = busy; button.style.opacity = busy ? '.6' : '1'; button.innerHTML = busy ? 'Getting things ready…' : label; }
function isRoomPath() { return location.pathname.match(/^\/room\/([a-f0-9-]{36})\/?$/i)?.[1] || null; }
function setName(name) { currentName = name.trim().slice(0, 24); localStorage.setItem('rangkai-name', currentName); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image(); image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not open that picture. Try another one.'));
    image.src = src;
  });
}

async function preparePhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Please choose a JPG, PNG, or WEBP.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Your photo needs to be under 10 MB.');
  const source = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale), height = Math.round(source.height * scale);
  if (width < 200 || height < 200) throw new Error('Your photo needs to be at least 200 × 200 pixels.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(source, 0, 0, width, height); source.close();
  let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
  if (blob?.size > 2_800_000) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .62));
  if (!blob) throw new Error('Could not process that photo.');
  if (blob.size > 2_800_000) throw new Error('This photo is too large after processing. Try another one.');
  return { blob, width, height };
}

function fileDataUrl(blob) { return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); }); }

function showHome() {
  game?.destroy(); channel?.close(); game = null; channel = null; currentRoom = null;
  document.body.classList.remove('game-active');
  $('roomView').classList.add('hidden'); $('homeView').classList.remove('hidden');
  $('connectionBadge').classList.toggle('hidden', configured);
  if (!configured) $('connectionBadge').innerHTML = '<span></span> Local demo';
}

async function openRoom(id, name) {
  setName(name);
  await ensureSession();
  const room = await joinRoom(id, currentName);
  const imageSource = await photoUrl(room);
  if (!imageSource) throw new Error('The puzzle picture is not available yet.');
  const [image, pieces] = await Promise.all([loadImage(imageSource), getPieces(id)]);
  if (pieces.length !== room.cols * room.rows) throw new Error('Some puzzle pieces are missing. Please try again.');
  currentRoom = room;
  $('homeView').classList.add('hidden'); $('roomView').classList.remove('hidden'); document.body.classList.add('game-active');
  $('puzzleSidebar').classList.remove('preview-open');
  $('previewToggle').setAttribute('aria-expanded', 'false');
  $('roomTitle').textContent = room.title;
  $('roomSubtitle').textContent = configured ? 'Piece it together live.' : 'Local demo · open this link in another tab to play together.';
  $('pieceCountText').textContent = `${pieces.length} pieces`;
  $('previewImage').src = imageSource;
  game?.destroy(); channel?.close();
  game = new PuzzleGame($('gameCanvas'), room, image, pieces, {
    claim: index => claimPiece(id, index),
    release: async (index, x, y, placed) => {
      const piece = await releasePiece(id, index, x, y, placed);
      channel?.demoPiece(piece);
      return piece;
    },
    cursorInterval: () => activePlayers <= 2 ? 100 : activePlayers === 3 ? 170 : 250,
    cursorMove: (x, y) => channel?.broadcast('movement', { user: userId(), x, y }),
    dragMove: (index, px, py, x, y) => channel?.broadcast('movement', { user: userId(), x, y, index, px, py }),
    dragEnd: index => channel?.broadcast('drag-end', { user: userId(), index }),
    cursorLeave: () => channel?.broadcast('cursor-leave', { user: userId() }),
    placed: () => { if (game.pieces.every(piece => piece.placed)) toast('Puzzle complete! Nice work, everyone ✦'); },
    progress: (done, total) => updateProgress(done, total),
    toast
  });
  updateProgress(pieces.filter(piece => piece.placed).length, pieces.length);
  const person = { name: currentName, color: colorFor(userId()) };
  channel = new RoomChannel(id, person, {
    status: status => { $('connectionBadge').classList.remove('hidden'); $('connectionBadge').innerHTML = `<span></span> ${escapeText(status)}`; },
    presence: presence => updatePlayers(presence),
    broadcast: (event, payload) => handleBroadcast(event, payload),
    piece: piece => game?.applyPiece(piece),
    resync: async () => { try { game?.syncPieces(await getPieces(id)); } catch { /* retry on next reconnect */ } }
  });
  updatePlayers(channel.presence);
  $('connectionBadge').classList.remove('hidden');
  $('connectionBadge').innerHTML = `<span></span> ${configured ? 'Connecting…' : 'Local demo'}`;
}

function escapeText(value) { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; }

function updateProgress(done, total) { $('progressText').textContent = `${Math.round(done / total * 100)}% done`; }

function updatePlayers(presence) {
  const entries = Object.entries(presence).filter(([, values]) => values?.length).map(([id, values]) => ({ id, ...values[0] }));
  if (!entries.some(item => item.id === userId())) entries.unshift({ id: userId(), name: currentName, color: colorFor(userId()) });
  activePlayers = entries.length;
  $('playerCount').textContent = `${entries.length} online`;
  $('toolbarPlayerCount').textContent = `${entries.length} online`;
  const list = $('players'); list.replaceChildren();
  for (const player of entries) {
    const row = document.createElement('div'); row.className = 'player-row';
    const avatar = document.createElement('span'); avatar.className = 'player-avatar'; avatar.style.background = colorFor(player.id); avatar.textContent = (player.name || '?').slice(0, 1).toUpperCase();
    const label = document.createElement('span'); label.textContent = player.name || 'Player';
    const detail = document.createElement('small'); detail.textContent = player.id === userId() ? 'You' : 'Online';
    row.append(avatar, label, detail); list.append(row);
  }
  for (const id of game?.remoteCursors.keys() || []) if (!entries.some(item => item.id === id)) game.removeCursor(id);
  channel && (channel.knownPlayers = Object.fromEntries(entries.map(item => [item.id, item])));
}

function handleBroadcast(event, payload) {
  if (!payload || payload.user === userId() || !game) return;
  if (event === 'cursor-leave') { game.removeCursor(payload.user); return; }
  if (event === 'drag-end') { game.stopRemoteDrag(payload.index); return; }
  if (event !== 'movement') return;
  if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
  const person = channel?.knownPlayers?.[payload.user];
  if (!person) return;
  game.setCursor(payload.user, payload.x, payload.y, person.name || 'Player', colorFor(payload.user));
  if (Number.isInteger(payload.index) && Number.isFinite(payload.px) && Number.isFinite(payload.py)) game.remoteDrag(payload.index, payload.px, payload.py, payload.user);
}

async function createFromForm(event) {
  event.preventDefault(); $('createError').classList.add('hidden');
  const name = $('createName').value.trim(), title = $('createTitle').value.trim();
  if (!name || !title) return;
  setBusy('createSubmit', true);
  try {
    setName(name); await ensureSession();
    let width = 1200, height = 800, imagePath = null, demoImage = null;
    if (selectedFile) {
      const photo = await preparePhoto(selectedFile); width = photo.width; height = photo.height;
      if (configured) imagePath = await uploadPhoto(photo.blob);
      else demoImage = await fileDataUrl(photo.blob);
    }
    const wanted = Number(document.querySelector('input[name=difficulty]:checked').value);
    const size = dimensions(width, height, wanted);
    const positions = initialPositions(size);
    const room = await createRoom({ title, name, preset: selectedFile ? null : selectedPreset, imagePath, demoImage, width, height, ...size, positions });
    $('createDialog').close();
    history.pushState({}, '', `/room/${room.id}`);
    await openRoom(room.id, name);
  } catch (error) { errorIn('createError', error); }
  finally { setBusy('createSubmit', false, 'Create puzzle <span>↗</span>'); }
}

async function joinFromForm(event) {
  event.preventDefault(); $('joinError').classList.add('hidden'); setBusy('joinSubmit', true);
  try { await openRoom(isRoomPath(), $('joinName').value.trim()); $('joinDialog').close(); }
  catch (error) { errorIn('joinError', error); }
  finally { setBusy('joinSubmit', false, 'Join the puzzle <span>↗</span>'); }
}

async function invite() {
  try { await navigator.clipboard.writeText(location.href); toast('Invite link copied!'); }
  catch { prompt('Copy this link:', location.href); }
}

$('startBtn').addEventListener('click', () => $('createDialog').showModal());
$('newPuzzleBtn').addEventListener('click', () => $('createDialog').showModal());
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
$('createForm').addEventListener('submit', createFromForm);
$('joinForm').addEventListener('submit', joinFromForm);
$('inviteBtn').addEventListener('click', invite); $('inviteSideBtn').addEventListener('click', invite);
$('zoomInBtn').addEventListener('click', () => game?.zoom(1.2));
$('zoomOutBtn').addEventListener('click', () => game?.zoom(.82));
$('resetViewBtn').addEventListener('click', () => { game?.fit(); game?.render(); });
$('previewToggle').addEventListener('click', () => {
  const open = $('puzzleSidebar').classList.toggle('preview-open');
  $('previewToggle').setAttribute('aria-expanded', String(open));
});
document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
  selectedPreset = button.dataset.preset; selectedFile = null; $('photoInput').value = ''; $('uploadFilename').textContent = 'Choose photo';
  document.querySelectorAll('[data-preset]').forEach(option => option.classList.toggle('selected', option === button));
}));
$('photoInput').addEventListener('change', event => {
  selectedFile = event.target.files?.[0] || null;
  $('uploadFilename').textContent = selectedFile ? selectedFile.name : 'Choose photo';
  document.querySelectorAll('[data-preset]').forEach(option => option.classList.remove('selected'));
});
window.addEventListener('popstate', async () => { const id = isRoomPath(); if (!id) showHome(); else if (currentName) { try { await openRoom(id, currentName); } catch (error) { toast(error.message); } } });
window.addEventListener('beforeunload', () => channel?.close());

const initialRoom = isRoomPath();
if (initialRoom) {
  if (savedName) openRoom(initialRoom, savedName).catch(error => { $('joinDialog').showModal(); errorIn('joinError', error); });
  else $('joinDialog').showModal();
} else showHome();
