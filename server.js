const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { apply, initial, view, rollover } = require('./queue');

const PORT = process.env.PORT || 3000;
// The queues and history start over each day at midnight in the office's time zone (Render runs on UTC).
const TIMEZONE = process.env.TIMEZONE || 'Asia/Manila';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date()); // YYYY-MM-DD
// localhost only by default; HOST=0.0.0.0 for the LAN. Render (sets RENDER) must listen publicly.
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = path.join(__dirname, 'public');
const STATE_FILE = path.join(__dirname, 'state.json');
// Render's free disk is wiped on every restart, so in the cloud state lives in Upstash Redis instead.
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const STATE_KEY = 'queue-state';
// Required whenever the server is reachable from other machines; the display stays public (read-only).
const PASSWORD = process.env.CONTROL_PASSWORD || '';
const LOCAL_ONLY = HOST === '127.0.0.1' || HOST === 'localhost';

// shortcut: one shared password, no rate limiting; fine for one office, add accounts if more people need access.
function allowed(req) {
  if (!PASSWORD) return LOCAL_ONLY; // fail closed: public server without a password accepts no actions
  const given = Buffer.from(String(req.headers['x-control-password'] || ''));
  const want = Buffer.from(PASSWORD);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };

// Upstash REST: POST a Redis command as a JSON array, get back { result }.
async function redis(command) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  return (await res.json()).result;
}

async function loadState() {
  if (UPSTASH_URL) {
    // A failed read throws and stops startup: starting empty would overwrite the real queue on the next click.
    const saved = await redis(['GET', STATE_KEY]);
    return saved ? JSON.parse(saved) : initial();
  }
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return initial(); }
}

// Saves run one after another so an older snapshot can never land after a newer one.
let saving = Promise.resolve();
function saveState() {
  const snapshot = JSON.stringify(state);
  saving = saving.then(() => (UPSTASH_URL ? redis(['SET', STATE_KEY, snapshot]) : fs.promises.writeFile(STATE_FILE, snapshot)))
    // The in-memory state is still right and the next save writes the full snapshot, so log and carry on.
    .catch((e) => console.error('Saving state failed:', e.message));
  return saving;
}

let state;

// Checked on every request, so the first poll after midnight starts the new day.
function newDay() {
  const next = rollover(state, today());
  if (next !== state) { state = next; saveState(); }
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  newDay();

  if (url.pathname === '/state' && req.method === 'GET') return json(res, 200, view(state));
  if (url.pathname === '/history' && req.method === 'GET') return json(res, 200, { day: state.day, entries: state.history ?? [] });

  if (url.pathname === '/action' && req.method === 'POST') {
    if (!allowed(req)) {
      return json(res, 401, { error: PASSWORD ? 'wrong password' : 'set CONTROL_PASSWORD on the server to enable controls' });
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1000) req.destroy(); });
    req.on('end', () => {
      // Times come from the server clock, not the browser's.
      try { state = apply(state, JSON.parse(body), Date.now()); }
      catch (e) { return json(res, 400, { error: e.message }); }
      json(res, 200, view(state));
      saveState();
    });
    return;
  }

  const file = path.join(PUBLIC, path.normalize(url.pathname === '/' ? '/control.html' : decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

loadState().then((loaded) => {
  state = loaded;
  newDay(); // also fails fast on a bad TIMEZONE
  server.listen(PORT, HOST, () => {
    if (!LOCAL_ONLY && !PASSWORD) console.warn('CONTROL_PASSWORD is not set: controls are disabled until it is.');
    console.log(`State: ${UPSTASH_URL ? 'Upstash Redis' : STATE_FILE} · day ${state.day} (${TIMEZONE})`);
    console.log(`Control: http://localhost:${PORT}/control.html`);
    console.log(`Display: http://localhost:${PORT}/display.html`);
  });
}).catch((e) => {
  console.error('Could not load the queue state, not starting:', e.message);
  process.exit(1);
});
