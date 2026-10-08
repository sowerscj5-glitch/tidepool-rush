// Tidepool Rush game server. No dependencies: just `node server.js`.
// Serves the game page and relays each player's state to everyone else, 20 times a second.
// Each browser runs its own jelly; the server just passes positions, scores and names around.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const OWNER_KEY = process.env.OWNER_KEY || '';   // set this to unlock the secret power codes
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 60;
const TICK_MS = 50;
const MAX_STATE_BYTES = 4096;
const MAX_FRAME_BYTES = 8192;

const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(page);
  } else if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
});

// ---------- minimal WebSocket (RFC 6455) ----------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

class Connection {
  constructor(socket, onText, onClose) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.open = true;
    this.onText = onText; this.onClose = onClose;
    this.fragments = null; this.alive = true;
    socket.on('data', d => this.receive(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }
  sendText(str) { if (this.open) this.socket.write(encodeFrame(0x1, Buffer.from(str))); }
  ping() { if (this.open) this.socket.write(encodeFrame(0x9, Buffer.alloc(0))); }
  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code, 0);
    try { this.socket.write(encodeFrame(0x8, p)); } catch {}
    this.socket.end(); this.finish();
  }
  finish() { if (!this.open) return; this.open = false; this.socket.destroy(); this.onClose(); }
  receive(data) {
    this.buf = Buffer.concat([this.buf, data]);
    if (this.buf.length > MAX_FRAME_BYTES * 2) return this.close(1009);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (!masked || len > MAX_FRAME_BYTES) return this.close(1002);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (opcode === 0x8) return this.close();
      if (opcode === 0x9) { this.socket.write(encodeFrame(0xA, payload)); continue; }
      if (opcode === 0xA) { this.alive = true; continue; }
      if (opcode === 0x1 || opcode === 0x0) {
        if (opcode === 0x1) this.fragments = [payload]; else if (this.fragments) this.fragments.push(payload); else continue;
        if (Buffer.concat(this.fragments).length > MAX_FRAME_BYTES) return this.close(1009);
        if (fin) { const text = Buffer.concat(this.fragments).toString('utf8'); this.fragments = null; this.onText(text); }
      }
    }
  }
}

// ---------- the pool ----------
const players = new Map(); // Connection -> player

function sameKey(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (req.url.split('?')[0] !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return;
  }
  if (players.size >= MAX_PLAYERS) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);

  const player = {
    id: crypto.randomBytes(6).toString('hex'), state: {},
    msgCount: 0, msgWindow: Date.now(), ownerTries: 0, ownerWindow: Date.now()
  };
  const conn = new Connection(socket, text => onMessage(conn, player, text), () => players.delete(conn));
  players.set(conn, player);
  conn.sendText(JSON.stringify({ type: 'welcome', id: player.id }));
});

function onMessage(conn, player, raw) {
  const now = Date.now();
  if (now - player.msgWindow > 1000) { player.msgWindow = now; player.msgCount = 0; }
  if (++player.msgCount > 60) return; // flood guard

  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'presence') {
    const data = msg.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return;
    if (Buffer.byteLength(JSON.stringify(data)) > MAX_STATE_BYTES) return;
    player.state = data;
  } else if (msg.type === 'owner') {
    if (now - player.ownerWindow > 60000) { player.ownerWindow = now; player.ownerTries = 0; }
    const ok = ++player.ownerTries <= 5 && OWNER_KEY.length > 0 && typeof msg.key === 'string' && sameKey(msg.key, OWNER_KEY);
    conn.sendText(JSON.stringify({ type: 'owner', ok }));
  }
}

// Send everyone the whole pool, 20 times a second.
setInterval(() => {
  if (!players.size) return;
  const msg = JSON.stringify({ type: 'peers', peers: [...players.values()].map(p => ({ id: p.id, presence: p.state })) });
  for (const conn of players.keys()) conn.sendText(msg);
}, TICK_MS);

// Drop connections that stopped answering.
setInterval(() => {
  for (const conn of players.keys()) {
    if (!conn.alive) { conn.close(1001); continue; }
    conn.alive = false; conn.ping();
  }
}, 20000);

server.listen(PORT, () => {
  console.log(`Tidepool Rush is running on http://localhost:${PORT}`);
  if (!OWNER_KEY) console.log('No OWNER_KEY set, so the secret power codes are locked for everyone.');
});
