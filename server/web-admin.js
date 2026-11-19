// The SalesKit Server window on the web: http://<server>:<port>/server (same port as the SalesKit API).
// It shows the window's own page (server/index.html + renderer.js) in a browser; server/web-bridge.js stands in
// for the window's Electron bridge (preload.js), calling the same actions over HTTP:
//   GET  /server                     the page (with web-bridge.js loaded before renderer.js)
//   GET  /server/<file>              renderer.js, web-bridge.js and the styles / fonts the page uses
//   POST /server/api/login           { username, password } → { sessionKey, user }: server admins only
//   POST /server/api/logout
//   POST /server/api/call            { channel, args } → { result } (an action of server/main.js; signed in)
//   GET  /server/api/events?session= live updates (state, log, devices, logos, sync progress), Server-Sent Events
// Only accounts ticked "Server admin" in the Users tab may sign in. Sessions are the SalesKit account sessions, so
// disabling an account (or idling) signs it out here too.
const fs = require('node:fs');
const path = require('node:path');

const SERVER_DIR = __dirname;
const ROOT = path.join(__dirname, '..');
// What the page may load besides its own scripts (the window's styles and fonts).
const STATIC_ROOTS = [
  path.join(ROOT, 'node_modules', 'bootstrap', 'dist'),
  path.join(ROOT, 'node_modules', 'bootstrap-icons', 'font'),
  path.join(ROOT, 'node_modules', '@fontsource', 'plus-jakarta-sans')
];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json'
};

function readBody(request, limit = 512 * 1024) {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > limit) request.destroy();
    });
    request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve(null); } });
    request.on('error', () => resolve(null));
  });
}

function send(response, status, value) {
  response.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value === undefined ? null : value));
}

// accounts: server/users.js. actions: Map(channel → (event, ...args) => result) from server/main.js.
// log(level, message): the server's activity log.
function createWebAdmin({ accounts, actions, log = () => {} }) {
  const streams = new Set(); // { response, sessionKey }
  const isAdmin = (user) => Boolean(user && user.serverAdmin && !user.disabled);
  const userOf = (key) => {
    const user = accounts.userForSession(key);
    return isAdmin(user) ? user : null;
  };

  // The window's page, with its paths made web paths and the web bridge loaded first.
  function page() {
    let html = fs.readFileSync(path.join(SERVER_DIR, 'index.html'), 'utf8');
    html = html.replace(/(href|src)="\.\.\/node_modules\//g, '$1="/server/node_modules/');
    html = html.replace('<script src="renderer.js"></script>', '<script src="/server/web-bridge.js"></script>\n  <script src="/server/renderer.js"></script>');
    html = html.replace('<title>', '<title>Web · ');
    return html;
  }

  function serveFile(response, file) {
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(response, 404, { error: 'Not found.' });
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': type.startsWith('font/') ? 'max-age=86400' : 'no-cache' });
    response.end(fs.readFileSync(file));
  }

  function openStream(request, response, sessionKey) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.write('event: hello\ndata: {}\n\n');
    const stream = { response, sessionKey };
    streams.add(stream);
    const keepAlive = setInterval(() => {
      // A stream whose session ended (signed out, disabled, no longer admin) is closed.
      if (!userOf(sessionKey)) { response.end(); return; }
      response.write(': ping\n\n');
    }, 25 * 1000);
    const close = () => { clearInterval(keepAlive); streams.delete(stream); };
    request.on('close', close);
    response.on('error', close);
  }

  async function handle(request, response, url, address) {
    const route = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'GET' && route === '/server') {
      response.writeHead(200, {
        'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
      });
      response.end(page());
      return;
    }
    if (request.method === 'GET' && (route === '/server/renderer.js' || route === '/server/web-bridge.js')) {
      return serveFile(response, path.join(SERVER_DIR, path.basename(route)));
    }
    if (request.method === 'GET' && route.startsWith('/server/node_modules/')) {
      const file = path.normalize(path.join(ROOT, decodeURIComponent(route.slice('/server/'.length))));
      if (!STATIC_ROOTS.some((base) => file.startsWith(base + path.sep))) return send(response, 404, { error: 'Not found.' });
      return serveFile(response, file);
    }
    if (request.method === 'GET' && route === '/server/api/events') {
      const sessionKey = url.searchParams.get('session') || '';
      if (!userOf(sessionKey)) return send(response, 401, { error: 'Please sign in.', code: 'login_required' });
      return openStream(request, response, sessionKey);
    }
    if (request.method !== 'POST') return send(response, 404, { error: 'Not found.' });

    const body = await readBody(request, route === '/server/api/call' ? 2 * 1024 * 1024 : 16 * 1024);
    if (!body) return send(response, 400, { error: 'Bad request.' });
    const ip = String(address || '').replace(/^::ffff:/, '');

    if (route === '/server/api/login') {
      let result;
      try {
        result = accounts.login(body.username, body.password, ip);
      } catch (error) {
        return send(response, error.code === 'locked' ? 429 : 401, { error: error.message });
      }
      const user = accounts.userForSession(result.sessionKey);
      if (!isAdmin(user)) {
        accounts.logout(result.sessionKey);
        log('warning', `${result.user.username} tried to open the server on the web (${ip}) but is not a server admin`);
        return send(response, 403, { error: 'This account is not a server admin. A server admin can allow it in the Users tab.' });
      }
      log('info', `${user.displayName || user.username} opened the server on the web (${ip})`);
      return send(response, 200, { sessionKey: result.sessionKey, user: { username: user.username, displayName: user.displayName } });
    }

    const sessionKey = request.headers['x-saleskit-session'];
    const user = userOf(sessionKey);
    if (!user) return send(response, 401, { error: 'Please sign in again.', code: 'login_required' });

    if (route === '/server/api/logout') {
      accounts.logout(sessionKey);
      return send(response, 200, { ok: true });
    }
    if (route === '/server/api/call') {
      const channel = String(body.channel || '');
      const action = actions.get(channel);
      if (!action) return send(response, 404, { error: 'Unknown action.' });
      try {
        const result = await action({ web: true, user }, ...(Array.isArray(body.args) ? body.args : []));
        return send(response, 200, { result: result === undefined ? null : result });
      } catch (error) {
        return send(response, 400, { error: error.message || 'The server could not do that.' });
      }
    }
    return send(response, 404, { error: 'Not found.' });
  }

  // Live updates to every open web page (the window gets them through IPC).
  function broadcast(channel, payload) {
    if (!streams.size) return;
    const message = `event: ${channel}\ndata: ${JSON.stringify(payload === undefined ? null : payload)}\n\n`;
    for (const stream of streams) {
      try { stream.response.write(message); } catch { streams.delete(stream); }
    }
  }

  // An account that is no longer a server admin: its open pages stop getting updates (and its next call fails).
  function signOut(username) {
    for (const stream of streams) {
      const user = accounts.userForSession(stream.sessionKey);
      if (!user || user.username === username) {
        try { stream.response.end(); } catch { /* already closed */ }
        streams.delete(stream);
      }
    }
  }

  return { handle, broadcast, signOut };
}

module.exports = { createWebAdmin };
