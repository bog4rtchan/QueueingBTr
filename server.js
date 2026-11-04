const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { apply, initial, view } = require('./queue');

const PORT = process.env.PORT || 3000;
// localhost only by default; HOST=0.0.0.0 for the LAN. Railway must listen publicly.
const HOST = process.env.HOST || (process.env.RAILWAY_ENVIRONMENT_NAME ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = path.join(__dirname, 'public');
// On Railway, keep state on the attached volume so redeploys don't wipe the numbers.
const STATE_FILE = path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname, 'state.json');
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

let state;
try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { state = initial(); }

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/state' && req.method === 'GET') return json(res, 200, view(state));

  if (url.pathname === '/action' && req.method === 'POST') {
    if (!allowed(req)) {
      return json(res, 401, { error: PASSWORD ? 'wrong password' : 'set CONTROL_PASSWORD on the server to enable controls' });
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1000) req.destroy(); });
    req.on('end', () => {
      try { state = apply(state, JSON.parse(body)); }
      catch (e) { return json(res, 400, { error: e.message }); }
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
      json(res, 200, view(state));
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
}).listen(PORT, HOST, () => {
  if (!LOCAL_ONLY && !PASSWORD) console.warn('CONTROL_PASSWORD is not set: controls are disabled until it is.');
  console.log(`Control: http://localhost:${PORT}/control.html`);
  console.log(`Display: http://localhost:${PORT}/display.html`);
});
