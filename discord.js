// Discord "Listening to SoundWave" status over Discord's local IPC pipe (no dependency, no token).
const net = require('net');
const path = require('path');

let sock = null, ready = false, connecting = false, clientId = '', want = null, buf = Buffer.alloc(0);

const pipePath = (i) => process.platform === 'win32' ? `\\\\?\\pipe\\discord-ipc-${i}`
  : path.join(process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp', `discord-ipc-${i}`);

function frame(op, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  const head = Buffer.alloc(8); head.writeInt32LE(op, 0); head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function reset() { try { sock?.destroy(); } catch {} sock = null; ready = false; connecting = false; buf = Buffer.alloc(0); }

function connect(i = 0) {
  if (i === 0) { if (connecting || sock) return; connecting = true; }
  if (i > 9) return void (connecting = false); // Discord not running
  const s = net.createConnection(pipePath(i));
  s.once('error', () => { s.destroy(); connect(i + 1); });
  s.once('connect', () => {
    s.removeAllListeners('error'); s.on('error', reset); s.on('close', reset);
    sock = s; connecting = false;
    s.on('data', onData);
    s.write(frame(0, { v: 1, client_id: clientId }));
  });
}

function onData(chunk) {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 8) {
    const op = buf.readInt32LE(0), len = buf.readInt32LE(4);
    if (buf.length < 8 + len) return;
    let msg = {}; try { msg = JSON.parse(buf.subarray(8, 8 + len)); } catch {}
    buf = buf.subarray(8 + len);
    if (op === 2) return reset(); // Discord closed us (wrong application ID…)
    if (op === 3) sock?.write(frame(4, msg)); // ping -> pong
    if (msg.evt === 'READY') { ready = true; flush(); }
  }
}

function flush() {
  if (!ready) return;
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, ...(want && { activity: want }) }, nonce: `${Date.now()}${Math.random()}` }));
}

// id: Discord application ID ('' = off). activity: Discord activity object, or null to clear.
function set(id, activity) {
  id = String(id || '').trim();
  if (id !== clientId) { reset(); clientId = id; }
  want = activity;
  if (!clientId) return;
  ready ? flush() : connect();
}

// Discord started after SoundWave: pick it up.
setInterval(() => { if (clientId && want && !sock) connect(); }, 15000).unref();

module.exports = { set, frame, _state: () => ({ ready, sock: !!sock }) };
