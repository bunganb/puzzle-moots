const config = window.PUZZLE_CONFIG || {};
const SESSION_KEY = 'rangkai-session';
const DEMO_PREFIX = 'rangkai-demo-room-';

export const configured = Boolean(config.url && config.key);
export const presets = { coast: '/assets/coast.svg', garden: '/assets/garden.svg', city: '/assets/city.svg' };

function fail(message, details) {
  const error = new Error(message || details || 'Something went wrong. Please try again.');
  error.details = details;
  throw error;
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
}

let session = readSession();
let refreshPromise = null;

async function api(path, options = {}, authenticated = true) {
  const headers = { apikey: config.key, ...options.headers };
  if (authenticated) {
    await ensureSession();
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  const response = await fetch(config.url + path, { ...options, headers });
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : await response.text();
  if (!response.ok) fail(data?.message || data?.msg || data?.error_description || 'Permintaan gagal.', data?.details || data?.hint);
  return data;
}

export async function ensureSession() {
  if (!configured) {
    let id = sessionStorage.getItem('rangkai-demo-id');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('rangkai-demo-id', id); }
    session = { user: { id }, access_token: 'demo' };
    return session;
  }
  if (session?.access_token && session?.expires_at > Date.now() / 1000 + 90) return session;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      if (session?.refresh_token) {
        const refreshed = await api('/auth/v1/token?grant_type=refresh_token', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session.refresh_token })
        }, false);
        session = { ...refreshed, expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in };
      } else {
        const created = await api('/auth/v1/signup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} })
        }, false);
        if (!created.access_token) fail('Aktifkan Anonymous Sign-Ins di Supabase Auth.');
        session = { ...created, expires_at: Math.floor(Date.now() / 1000) + created.expires_in };
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch (error) {
      session = null;
      localStorage.removeItem(SESSION_KEY);
      throw error;
    } finally { refreshPromise = null; }
  })();
  return refreshPromise;
}

export function userId() { return session?.user?.id; }

async function rpc(name, payload) {
  return api(`/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
}

export async function createRoom(data) {
  if (!configured) {
    const id = crypto.randomUUID();
    const room = { id, title: data.title, preset: data.preset, demo_image: data.demoImage || null, image_path: null, image_width: data.width, image_height: data.height, cols: data.cols, rows: data.rows, board_width: data.boardWidth, board_height: data.boardHeight, owner_id: userId() };
    const pieces = Array.from({ length: data.cols * data.rows }, (_, i) => initialPiece(room, i, data.positions[i]));
    localStorage.setItem(DEMO_PREFIX + id, JSON.stringify({ room, pieces }));
    return room;
  }
  return rpc('create_puzzle_room', {
    p_title: data.title, p_name: data.name, p_preset: data.preset || null,
    p_image_path: data.imagePath || null, p_width: data.width, p_height: data.height,
    p_cols: data.cols, p_rows: data.rows, p_board_width: data.boardWidth, p_board_height: data.boardHeight,
    p_positions: data.positions
  });
}

export function initialPiece(room, i, position) {
  return { room_id: room.id, piece_index: i, x: position.x, y: position.y, placed: false, lock_owner: null, lock_until: null, version: 0 };
}

export async function joinRoom(id, name) {
  if (!configured) {
    const saved = JSON.parse(localStorage.getItem(DEMO_PREFIX + id) || 'null');
    if (!saved) fail('Puzzle link not found.');
    return saved.room;
  }
  return rpc('join_puzzle_room', { p_room: id, p_name: name });
}

export async function getPieces(id) {
  if (!configured) return JSON.parse(localStorage.getItem(DEMO_PREFIX + id) || 'null')?.pieces || [];
  return api(`/rest/v1/piece_state?room_id=eq.${encodeURIComponent(id)}&select=*&order=piece_index.asc`);
}

export async function claimPiece(id, index) {
  if (!configured) return true;
  return rpc('claim_puzzle_piece', { p_room: id, p_piece: index });
}

export async function releasePiece(id, index, x, y, placed) {
  if (!configured) {
    const saved = JSON.parse(localStorage.getItem(DEMO_PREFIX + id));
    const piece = saved.pieces[index];
    Object.assign(piece, { x, y, placed, version: piece.version + 1, lock_owner: null, lock_until: null });
    localStorage.setItem(DEMO_PREFIX + id, JSON.stringify(saved));
    return piece;
  }
  return rpc('release_puzzle_piece', { p_room: id, p_piece: index, p_x: Math.round(x * 100) / 100, p_y: Math.round(y * 100) / 100, p_placed: placed });
}

export async function uploadPhoto(blob) {
  if (!configured) fail('Photo uploads need Supabase to be configured.');
  const path = `${userId()}/${crypto.randomUUID()}.webp`;
  await api(`/storage/v1/object/puzzle-images/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'image/webp', 'x-upsert': 'false' }, body: blob
  });
  return path;
}

export async function photoUrl(room) {
  if (room.demo_image) return room.demo_image;
  if (room.preset) return presets[room.preset];
  if (!configured || !room.image_path) return null;
  const data = await api(`/storage/v1/object/sign/puzzle-images/${room.image_path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 })
  });
  return new URL(data.signedURL || data.signedUrl, config.url).href;
}

export class RoomChannel {
  constructor(roomId, person, handlers) {
    this.roomId = roomId; this.person = person; this.handlers = handlers;
    this.topic = `realtime:room:${roomId}`;
    this.ref = 0; this.joinRef = null; this.closed = false; this.ready = false;
    this.presence = {};
    if (!configured) {
      this.demo = new BroadcastChannel(`rangkai-${roomId}`);
      this.demo.onmessage = event => this.handleDemo(event.data);
      this.presence[userId()] = [{ ...person, user_id: userId() }];
      this.demo.postMessage({ kind: 'hello', user_id: userId(), person });
      this.handlers.presence(this.presence);
      this.ready = true;
    } else this.connect();
  }
  next() { return String(++this.ref); }
  push(event, payload, topic = this.topic, joinRef = this.joinRef) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify([joinRef, this.next(), topic, event, payload]));
  }
  async connect() {
    if (this.closed) return;
    try {
      await ensureSession();
      const wsUrl = config.url.replace(/^http/, 'ws') + `/realtime/v1/websocket?apikey=${encodeURIComponent(config.key)}&vsn=2.0.0&access_token=${encodeURIComponent(session.access_token)}`;
      this.socket = new WebSocket(wsUrl);
      this.socket.onopen = () => {
        this.joinRef = this.next();
        this.socket.send(JSON.stringify([this.joinRef, this.joinRef, this.topic, 'phx_join', {
          config: { private: true, broadcast: { ack: false, self: false }, presence: { enabled: true, key: userId() }, postgres_changes: [{ event: 'UPDATE', schema: 'public', table: 'piece_state', filter: `room_id=eq.${this.roomId}` }] },
          access_token: session.access_token
        }]));
        this.heartbeat = setInterval(() => this.push('heartbeat', {}, 'phoenix', null), 20000);
      };
      this.socket.onmessage = event => this.receive(JSON.parse(event.data));
      this.socket.onclose = () => this.reconnect();
      this.socket.onerror = () => this.handlers.status?.('Connection lost. Trying again…');
    } catch (error) { this.handlers.status?.(error.message); this.reconnect(); }
  }
  reconnect() {
    clearInterval(this.heartbeat); this.ready = false;
    if (this.closed) return;
    this.handlers.status?.('Reconnecting…');
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.connect(), 2500);
  }
  receive(frame) {
    const [joinRef, ref, topic, event, payload] = frame;
    if (event === 'phx_reply' && ref === this.joinRef) {
      if (payload.status !== 'ok') { this.handlers.status?.('Could not join live room. Check the Realtime settings.'); return; }
      this.ready = true;
      this.handlers.status?.('Connected');
      this.push('presence', { type: 'presence', event: 'track', payload: { ...this.person, user_id: userId() } });
      this.handlers.resync?.();
    } else if (event === 'broadcast') this.handlers.broadcast?.(payload.event, payload.payload);
    else if (event === 'postgres_changes') this.handlers.piece?.(payload.data?.record || payload.data?.new || payload.record);
    else if (event === 'presence_state') { this.presence = payload; this.handlers.presence?.(this.presence); }
    else if (event === 'presence_diff') {
      for (const [key, list] of Object.entries(payload.joins || {})) this.presence[key] = [...(this.presence[key] || []), ...list];
      for (const [key, list] of Object.entries(payload.leaves || {})) {
        const refs = new Set(list.map(item => item.phx_ref));
        this.presence[key] = (this.presence[key] || []).filter(item => !refs.has(item.phx_ref));
        if (!this.presence[key].length) delete this.presence[key];
      }
      this.handlers.presence?.(this.presence);
    } else if (event === 'system' && payload.status === 'error') this.handlers.status?.(payload.message || 'Live connection is having trouble.');
  }
  handleDemo(message) {
    if (message.user_id === userId()) return;
    if (message.kind === 'hello') { this.presence[message.user_id] = [message.person]; this.demo.postMessage({ kind: 'hello-back', user_id: userId(), person: this.person }); this.handlers.presence(this.presence); }
    else if (message.kind === 'hello-back') { this.presence[message.user_id] = [message.person]; this.handlers.presence(this.presence); }
    else if (message.kind === 'bye') { delete this.presence[message.user_id]; this.handlers.presence(this.presence); }
    else if (message.kind === 'broadcast') this.handlers.broadcast(message.event, message.payload);
    else if (message.kind === 'piece') this.handlers.piece(message.piece);
  }
  broadcast(event, payload) {
    if (this.demo) this.demo.postMessage({ kind: 'broadcast', event, payload, user_id: userId() });
    else if (this.ready) this.push('broadcast', { event, payload, type: 'broadcast' });
  }
  demoPiece(piece) { this.demo?.postMessage({ kind: 'piece', piece, user_id: userId() }); }
  close() {
    this.closed = true; clearInterval(this.heartbeat); clearTimeout(this.retry);
    if (this.demo) { this.demo.postMessage({ kind: 'bye', user_id: userId() }); this.demo.close(); }
    this.socket?.close();
  }
}
