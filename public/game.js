const BOARD_X = 420;
const BOARD_Y = 210;
const WORLD_W = 1600;
const WORLD_H = 1100;
const palette = ['#d98973', '#6b83ad', '#6f9b70', '#a383bc', '#d09c56', '#5a9ba2'];

export function colorFor(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function dimensions(width, height, wanted) {
  const ratio = width / height;
  let cols = Math.max(3, Math.round(Math.sqrt(wanted * ratio)));
  let rows = Math.max(3, Math.round(wanted / cols));
  while (cols * rows > 150) rows--;
  const scale = Math.min(760 / width, 560 / height);
  return { cols, rows, boardWidth: Math.round(width * scale), boardHeight: Math.round(height * scale) };
}

function hashEdge(a, b, salt) { return ((a * 173 + b * 397 + salt * 47) % 2) ? 1 : -1; }

function drawEdge(ctx, x0, y0, x1, y1, tab, depth) {
  const dx = x1 - x0, dy = y1 - y0;
  const nx = dy / Math.hypot(dx, dy), ny = -dx / Math.hypot(dx, dy);
  const point = (t, n = 0) => [x0 + dx * t + nx * n, y0 + dy * t + ny * n];
  if (!tab) { ctx.lineTo(x1, y1); return; }
  const d = tab * depth;
  let p = point(.31); ctx.lineTo(...p);
  ctx.bezierCurveTo(...point(.37, 0), ...point(.38, -d * .2), ...point(.38, d * .22));
  ctx.bezierCurveTo(...point(.34, d * .7), ...point(.41, d), ...point(.5, d));
  ctx.bezierCurveTo(...point(.59, d), ...point(.66, d * .7), ...point(.62, d * .22));
  ctx.bezierCurveTo(...point(.62, -d * .2), ...point(.63, 0), ...point(.69, 0));
  ctx.lineTo(x1, y1);
}

function piecePath(ctx, col, row, cols, rows, width, height) {
  const depth = Math.min(width, height) * .23;
  ctx.beginPath(); ctx.moveTo(0, 0);
  drawEdge(ctx, 0, 0, width, 0, row === 0 ? 0 : -hashEdge(row - 1, col, 1), depth);
  drawEdge(ctx, width, 0, width, height, col === cols - 1 ? 0 : hashEdge(row, col, 2), depth);
  drawEdge(ctx, width, height, 0, height, row === rows - 1 ? 0 : hashEdge(row, col, 1), depth);
  drawEdge(ctx, 0, height, 0, 0, col === 0 ? 0 : -hashEdge(row, col - 1, 2), depth);
  ctx.closePath();
}

function createPieceArt(image, room, index) {
  const col = index % room.cols, row = Math.floor(index / room.cols);
  const w = room.board_width / room.cols, h = room.board_height / room.rows;
  const pad = Math.ceil(Math.min(w, h) * .3 + 4), density = 1.5;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + pad * 2) * density);
  canvas.height = Math.ceil((h + pad * 2) * density);
  const ctx = canvas.getContext('2d');
  ctx.scale(density, density); ctx.translate(pad, pad);
  piecePath(ctx, col, row, room.cols, room.rows, w, h);
  ctx.save(); ctx.clip();
  ctx.drawImage(image, -col * w, -row * h, room.board_width, room.board_height);
  ctx.restore();
  ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1.5; ctx.stroke();
  return { canvas, pad, width: w + pad * 2, height: h + pad * 2 };
}

export class PuzzleGame {
  constructor(canvas, room, image, pieces, callbacks) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.room = room;
    this.image = image; this.callbacks = callbacks;
    this.pieces = pieces.map(piece => ({ ...piece }));
    this.arts = this.pieces.map((_, index) => createPieceArt(image, room, index));
    this.camera = { x: 0, y: 0, scale: 1 }; this.drag = null; this.pan = null;
    this.remoteDrags = new Map(); this.remoteCursors = new Map(); this.pointerLast = 0;
    this.cursorLayer = document.getElementById('cursors');
    this.events = new AbortController();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.boundMove = event => this.pointerMove(event);
    this.boundUp = event => this.pointerUp(event);
    canvas.addEventListener('pointerdown', event => this.pointerDown(event), { signal: this.events.signal });
    canvas.addEventListener('pointermove', this.boundMove, { signal: this.events.signal });
    canvas.addEventListener('pointerup', this.boundUp, { signal: this.events.signal });
    canvas.addEventListener('pointercancel', this.boundUp, { signal: this.events.signal });
    canvas.addEventListener('pointerleave', () => this.callbacks.cursorLeave?.(), { signal: this.events.signal });
    canvas.addEventListener('wheel', event => { event.preventDefault(); this.zoom(event.deltaY < 0 ? 1.11 : .9, event.offsetX, event.offsetY); }, { passive: false, signal: this.events.signal });
    this.resize(); this.frame = requestAnimationFrame(t => this.tick(t));
  }
  destroy() { cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.events.abort(); this.cursorLayer.replaceChildren(); }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.viewW = rect.width; this.viewH = rect.height;
    const density = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(rect.width * density); this.canvas.height = Math.round(rect.height * density);
    this.density = density;
    if (!this.didFit) { this.fit(); this.didFit = true; }
    this.render();
  }
  fit() {
    this.camera.scale = Math.min(this.viewW / WORLD_W, this.viewH / WORLD_H) * .95;
    this.camera.x = (this.viewW - WORLD_W * this.camera.scale) / 2;
    this.camera.y = (this.viewH - WORLD_H * this.camera.scale) / 2;
  }
  zoom(factor, px = this.viewW / 2, py = this.viewH / 2) {
    const previous = this.camera.scale;
    const next = Math.max(.24, Math.min(2.2, previous * factor));
    this.camera.x = px - (px - this.camera.x) * next / previous;
    this.camera.y = py - (py - this.camera.y) * next / previous;
    this.camera.scale = next; this.render();
  }
  world(px, py) { return { x: (px - this.camera.x) / this.camera.scale, y: (py - this.camera.y) / this.camera.scale }; }
  screen(x, y) { return { x: x * this.camera.scale + this.camera.x, y: y * this.camera.scale + this.camera.y }; }
  coords(event) { const rect = this.canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  home(index) { return { x: BOARD_X + (index % this.room.cols) * this.room.board_width / this.room.cols, y: BOARD_Y + Math.floor(index / this.room.cols) * this.room.board_height / this.room.rows }; }
  pick(x, y) {
    const w = this.room.board_width / this.room.cols, h = this.room.board_height / this.room.rows;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const piece = this.pieces[i];
      if (!piece.placed && x >= piece.x - w * .16 && x <= piece.x + w * 1.16 && y >= piece.y - h * .16 && y <= piece.y + h * 1.16) return i;
    }
    return -1;
  }
  async pointerDown(event) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.coords(event), world = this.world(point.x, point.y), index = this.pick(world.x, world.y);
    if (index >= 0) {
      const piece = this.pieces[index];
      const start = { x: piece.x, y: piece.y };
      this.drag = { index, dx: world.x - piece.x, dy: world.y - piece.y, previous: { x: piece.x, y: piece.y }, accepted: false };
      this.canvas.classList.add('dragging');
      try {
        const accepted = await this.callbacks.claim(index);
        if (!this.drag || this.drag.index !== index) {
          if (accepted) await this.callbacks.release(index, start.x, start.y, false).catch(() => {});
          return;
        }
        this.drag.accepted = accepted;
        this.drag.lastClaim = performance.now();
        if (!accepted) { this.pieces[index].x = this.drag.previous.x; this.pieces[index].y = this.drag.previous.y; this.drag = null; this.callbacks.toast?.('Keping ini sedang dipegang temanmu.'); }
      } catch (error) { if (this.drag?.index === index) this.drag = null; this.callbacks.toast?.(error.message); }
    } else this.pan = { x: point.x, y: point.y, cameraX: this.camera.x, cameraY: this.camera.y };
    this.render();
  }
  pointerMove(event) {
    const point = this.coords(event), world = this.world(point.x, point.y), now = performance.now();
    if (this.drag) {
      const piece = this.pieces[this.drag.index];
      piece.x = Math.max(0, Math.min(1540, world.x - this.drag.dx));
      piece.y = Math.max(0, Math.min(1040, world.y - this.drag.dy));
      if (this.drag.accepted && now - (this.drag.lastBroadcast || 0) > (this.callbacks.cursorInterval?.() || 160)) {
        this.callbacks.dragMove?.(this.drag.index, piece.x, piece.y, world.x, world.y);
        this.drag.lastBroadcast = now;
      }
      this.render();
    } else if (this.pan) {
      this.camera.x = this.pan.cameraX + point.x - this.pan.x;
      this.camera.y = this.pan.cameraY + point.y - this.pan.y;
      this.render();
    }
    if (!this.drag && now - this.pointerLast > (this.callbacks.cursorInterval?.() || 160)) {
      this.callbacks.cursorMove?.(world.x, world.y); this.pointerLast = now;
    }
  }
  async pointerUp(event) {
    this.canvas.classList.remove('dragging'); this.pan = null;
    if (!this.drag) return;
    const drag = this.drag; this.drag = null;
    const piece = this.pieces[drag.index];
    if (!drag.accepted) { Object.assign(piece, drag.previous); this.render(); return; }
    const home = this.home(drag.index);
    const distance = Math.hypot(piece.x - home.x, piece.y - home.y);
    const placed = distance < Math.max(24, Math.min(42, this.room.board_width / this.room.cols * .38));
    if (placed) { piece.x = home.x; piece.y = home.y; piece.placed = true; }
    this.callbacks.dragEnd?.(drag.index);
    try {
      const saved = await this.callbacks.release(drag.index, piece.x, piece.y, placed);
      this.applyPiece(saved);
      if (placed) this.callbacks.placed?.();
    } catch (error) { Object.assign(piece, drag.previous); this.callbacks.toast?.(error.message); this.render(); }
  }
  applyPiece(piece) {
    if (!piece) return;
    const current = this.pieces[piece.piece_index];
    if (!current || (this.drag?.index === piece.piece_index)) return;
    if ((piece.version || 0) >= (current.version || 0)) Object.assign(current, piece);
    this.remoteDrags.delete(piece.piece_index);
    this.callbacks.progress?.(this.pieces.filter(item => item.placed).length, this.pieces.length);
    this.render();
  }
  syncPieces(rows) { for (const row of rows) this.applyPiece(row); }
  remoteDrag(index, x, y, user) { if (this.drag?.index !== index && !this.pieces[index]?.placed) this.remoteDrags.set(index, { x, y, user, time: performance.now() }); }
  stopRemoteDrag(index) { this.remoteDrags.delete(index); }
  setCursor(user, x, y, name, color) {
    let cursor = this.remoteCursors.get(user);
    if (!cursor) {
      const element = document.createElement('div'); element.className = 'remote-cursor';
      const pointer = document.createElement('span'); pointer.className = 'pointer'; pointer.textContent = '➤'; pointer.style.color = color;
      const label = document.createElement('span'); label.className = 'cursor-label'; label.textContent = name; label.style.background = color;
      element.append(pointer, label); this.cursorLayer.append(element);
      cursor = { element, x, y, targetX: x, targetY: y, last: performance.now() }; this.remoteCursors.set(user, cursor);
    }
    cursor.targetX = x; cursor.targetY = y; cursor.last = performance.now();
  }
  removeCursor(user) { const cursor = this.remoteCursors.get(user); cursor?.element.remove(); this.remoteCursors.delete(user); }
  tick(time) {
    const dt = Math.min(50, time - (this.lastFrame || time)); this.lastFrame = time;
    if (this.drag?.accepted && !this.drag.renewing && time - this.drag.lastClaim > 8000) {
      const drag = this.drag; drag.renewing = true; drag.lastClaim = time;
      this.callbacks.claim(drag.index).then(ok => {
        if (this.drag !== drag) return;
        drag.renewing = false;
        if (!ok) {
          Object.assign(this.pieces[drag.index], drag.previous);
          this.drag = null; this.callbacks.toast?.('Keping dilepas karena koneksi berubah.'); this.render();
        }
      }).catch(() => { if (this.drag === drag) drag.renewing = false; });
    }
    for (const [id, cursor] of this.remoteCursors) {
      if (time - cursor.last > 2500) { cursor.element.style.opacity = '0'; continue; }
      cursor.element.style.opacity = '1';
      const smoothing = 1 - Math.exp(-dt / 85);
      cursor.x += (cursor.targetX - cursor.x) * smoothing;
      cursor.y += (cursor.targetY - cursor.y) * smoothing;
      const point = this.screen(cursor.x, cursor.y);
      cursor.element.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
    }
    for (const [index, remote] of this.remoteDrags) if (time - remote.time > 1500) this.remoteDrags.delete(index);
    if (this.remoteDrags.size) this.render();
    this.frame = requestAnimationFrame(t => this.tick(t));
  }
  drawPiece(piece, index, remote = false) {
    const art = this.arts[index], ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = remote ? '#385d7355' : '#24463744';
    ctx.shadowBlur = piece.placed ? 2 : remote ? 18 : 10;
    ctx.shadowOffsetY = piece.placed ? 0 : 4;
    ctx.drawImage(art.canvas, piece.x - art.pad, piece.y - art.pad, art.width, art.height);
    ctx.restore();
  }
  render() {
    if (!this.ctx || !this.viewW) return;
    const ctx = this.ctx;
    ctx.setTransform(this.density, 0, 0, this.density, 0, 0);
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.translate(this.camera.x, this.camera.y); ctx.scale(this.camera.scale, this.camera.scale);
    ctx.save(); ctx.shadowColor = '#40625422'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 11;
    ctx.fillStyle = '#fffdf8'; ctx.fillRect(BOARD_X - 10, BOARD_Y - 10, this.room.board_width + 20, this.room.board_height + 20); ctx.restore();
    ctx.save(); ctx.globalAlpha = .17; ctx.drawImage(this.image, BOARD_X, BOARD_Y, this.room.board_width, this.room.board_height); ctx.restore();
    ctx.strokeStyle = '#b2c7b7'; ctx.lineWidth = 2; ctx.strokeRect(BOARD_X, BOARD_Y, this.room.board_width, this.room.board_height);
    for (let i = 0; i < this.pieces.length; i++) if (this.pieces[i].placed) this.drawPiece(this.pieces[i], i);
    for (let i = 0; i < this.pieces.length; i++) {
      if (this.pieces[i].placed || this.drag?.index === i) continue;
      const remote = this.remoteDrags.get(i);
      this.drawPiece(remote ? { x: remote.x, y: remote.y } : this.pieces[i], i, Boolean(remote));
    }
    if (this.drag) this.drawPiece(this.pieces[this.drag.index], this.drag.index);
  }
}
