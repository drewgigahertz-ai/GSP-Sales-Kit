// App Check: the admin tests the branch laptops' apps (AutoCAD, Blender, Premiere...) from a web page on this server.
// - Web page: http://SERVER:3000/app-check, signed in with a SalesKit account of a full-access branch (HO / ALL).
// - Laptops (Gigahertz Sales Tools 1.0.30+, electron/app-check.js) check in every 5 seconds on /api/app-check/poll,
//   get the list of apps when the admin pressed "Run test", and send each step and the results back.
// Everything is kept in <userData>/app-check: settings.json (apps to test, demo folder), laptops.json, runs.jsonl
// (every result) and results.csv (one row per test, for Excel).
const fs = require('node:fs');
const path = require('node:path');

const ONLINE_MS = 20 * 1000;
const DEFAULT_TARGETS = [
  { name: 'AutoCAD', keyword: 'autocad', mode: 'file', exts: ['.dwg'], wait: 120 },
  { name: 'Blender', keyword: 'blender', mode: 'file', exts: ['.blend'], wait: 90 },
  { name: 'Premiere Pro', keyword: 'premiere', mode: 'file', exts: ['.prproj'], wait: 180 },
  { name: "Assassin's Creed", keyword: 'assassin|mirage', mode: 'launch', exts: [], wait: 90 }
];

const text = (value, max = 60) => String(value ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function cleanTarget(t) {
  if (!t || typeof t !== 'object') return null;
  const name = text(t.name);
  const keyword = text(t.keyword, 120).toLowerCase();
  if (!name || !keyword) return null;
  const mode = t.mode === 'file' ? 'file' : 'launch';
  const exts = mode === 'file'
    ? [...new Set((Array.isArray(t.exts) ? t.exts : String(t.exts || '').split(/[,\s]+/))
      .map((e) => text(e, 12).toLowerCase()).filter(Boolean).map((e) => (e.startsWith('.') ? e : `.${e}`)))]
    : [];
  if (mode === 'file' && !exts.length) return null;
  return { name, keyword, mode, exts, wait: Math.min(600, Math.max(2, Math.round(Number(t.wait) || 90))) };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// accounts: { login(username, password, address), logout(key), userForSession(key) } (server/users.js).
// canAdmin(user): who may use the web page. log(level, message): the server's activity log.
function createAppCheck({ dataDir, accounts, canAdmin, log = () => {} }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const F = {
    settings: path.join(dataDir, 'settings.json'),
    laptops: path.join(dataDir, 'laptops.json'),
    runs: path.join(dataDir, 'runs.jsonl'),
    csv: path.join(dataDir, 'results.csv')
  };
  const pagePath = path.join(__dirname, 'app-check.html');

  const settings = readJson(F.settings, {});
  let targets = (Array.isArray(settings.targets) ? settings.targets : DEFAULT_TARGETS).map(cleanTarget).filter(Boolean);
  if (!targets.length) targets = DEFAULT_TARGETS;
  let demoFolder = text(settings.demoFolder, 260);
  const saveSettings = () => fs.writeFileSync(F.settings, JSON.stringify({ targets, demoFolder }, null, 2));

  let history = [];
  try {
    history = fs.readFileSync(F.runs, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)).slice(-500);
  } catch { /* none yet */ }

  // Laptops are saved so the list survives a restart; what each one is doing right now is kept in memory only.
  const laptops = new Map();
  for (const l of readJson(F.laptops, [])) if (l && l.name) laptops.set(l.name, { ...l, command: null, current: null });
  let laptopsDirty = false;
  function saveLaptops() {
    if (!laptopsDirty) return;
    laptopsDirty = false;
    const list = [...laptops.values()].map(({ name, branch, user, version, make, model, lastSeen }) => ({ name, branch, user, version, make, model, lastSeen }));
    try { fs.writeFileSync(F.laptops, JSON.stringify(list, null, 1)); } catch { laptopsDirty = true; }
  }
  const saveTimer = setInterval(saveLaptops, 30 * 1000);
  saveTimer.unref?.();

  // seen: false for results sent late (kept on the laptop while the server was unreachable). The branch is kept
  // while nobody is signed in on the laptop; brand and model come from the X-SalesKit-Make / -Model headers.
  function touch(body, user, device = {}, seen = true) {
    const name = text(body.laptop, 80);
    if (!laptops.has(name)) laptops.set(name, { name, branch: '', user: '', version: '', make: '', model: '', lastSeen: 0, command: null, current: null });
    const l = laptops.get(name);
    const fields = { branch: user ? user.branch : '', user: user ? user.username : '', version: body.version, make: device.make, model: device.model };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || text(value) === l[key] || (['branch', 'make', 'model'].includes(key) && !text(value))) continue;
      l[key] = text(value);
      laptopsDirty = true;
    }
    if (seen) {
      if (!l.lastSeen) laptopsDirty = true;
      l.lastSeen = Date.now();
    }
    return l;
  }
  const running = (l) => Boolean(l.current && !l.current.finished);

  // results.csv: when the list of apps changes, the old file is kept under another name and a new one starts.
  const csvHeader = () => ['Time', 'Laptop', 'Branch', ...targets.map((t) => t.name), 'Overall'].map(csvCell).join(',');
  function appendCsv(run) {
    const head = csvHeader();
    if (fs.existsSync(F.csv) && fs.readFileSync(F.csv, 'utf8').split('\n')[0] !== head) {
      fs.renameSync(F.csv, path.join(dataDir, `results-until-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`));
    }
    if (!fs.existsSync(F.csv)) fs.writeFileSync(F.csv, `${head}\n`);
    const by = Object.fromEntries(run.results.map((r) => [r.target, r.status]));
    const row = [new Date(run.time).toLocaleString(), run.laptop, run.branch, ...targets.map((t) => by[t.name] || 'no result'), passed(run) ? 'PASS' : 'CHECK'];
    fs.appendFileSync(F.csv, `${row.map(csvCell).join(',')}\n`);
  }
  const passed = (run) => run.results.length > 0 && run.results.every((r) => r.status === 'ok');

  // ---------- Laptops: POST /api/app-check/<route> (after the app token check) ----------
  // user: the SalesKit account signed in on the laptop, or null on the sign-in page.
  // device: { make, model } of the laptop (electron/device-info.js), e.g. { make: 'Lenovo', model: 'IdeaPad 5 14ALC05' }.
  function handleLaptop(route, body, user, device = {}) {
    if (!body || typeof body !== 'object' || !text(body.laptop)) return { status: 400, body: { error: 'Bad request.' } };
    if (route === 'poll') {
      const l = touch(body, user, device);
      // A laptop busy with a test gets the command on its next check-in after the test.
      if (body.busy || l.command !== 'run') return { status: 200, body: { command: null } };
      l.command = null;
      return { status: 200, body: { command: 'run', targets, demoFolder } };
    }
    if (route === 'event') {
      const l = touch(body, user, device);
      if (body.type === 'start') {
        l.current = { runId: body.runId, startedAt: Date.now(), finished: false, targets: Object.fromEntries((Array.isArray(body.targets) ? body.targets : []).slice(0, 40).map((n) => [text(n), { status: 'waiting', detail: '' }])) };
      } else if (l.current && body.type === 'step' && body.target) {
        l.current.targets[text(body.target)] = { status: text(body.status, 20), detail: text(body.detail, 300) };
      } else if (l.current && body.type === 'finish') {
        l.current.finished = true;
      }
      return { status: 200, body: { ok: true } };
    }
    if (route === 'results') {
      if (!Array.isArray(body.results)) return { status: 400, body: { error: 'Missing results.' } };
      const l = touch(body, user, device, false);
      const run = {
        laptop: l.name,
        make: l.make,
        model: l.model,
        branch: text(body.branch) || l.branch,
        user: text(body.user),
        version: text(body.version, 20),
        time: Number.isNaN(Date.parse(body.time)) ? new Date().toISOString() : new Date(body.time).toISOString(),
        stoppedOnLaptop: Boolean(body.stoppedOnLaptop),
        results: body.results.slice(0, 40).map((r) => ({ target: text(r && r.target), app: text(r && r.app, 120), status: text(r && r.status, 20), detail: text(r && r.detail, 300) }))
      };
      fs.appendFileSync(F.runs, `${JSON.stringify(run)}\n`);
      history.push(run);
      if (history.length > 500) history = history.slice(-500);
      appendCsv(run);
      const device = [run.make, run.model].filter(Boolean).join(' ');
      log(passed(run) ? 'success' : 'warning', `App test on ${[run.branch, device].filter(Boolean).join(' - ') || run.laptop} (${run.laptop}): ${run.results.map((r) => `${r.target} ${r.status}`).join(', ')}`);
      return { status: 200, body: { ok: true } };
    }
    return { status: 404, body: { error: 'Not found.' } };
  }

  // ---------- Web page: /app-check and /app-check/api/* (no app token; the admin signs in) ----------
  function send(response, status, value) {
    response.writeHead(status, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  function readBody(request) {
    return new Promise((resolve) => {
      let raw = '';
      request.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 64 * 1024) request.destroy();
      });
      request.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve(null); } });
      request.on('error', () => resolve(null));
    });
  }

  async function handleAdmin(request, response, url, address) {
    const route = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'GET' && route === '/app-check') {
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
      });
      response.end(fs.readFileSync(pagePath));
      return;
    }
    if (request.method !== 'GET' && request.method !== 'POST') return send(response, 405, { error: 'Not allowed.' });

    if (route === '/app-check/api/login' && request.method === 'POST') {
      const body = await readBody(request);
      try {
        const result = accounts.login(body && body.username, body && body.password, address.replace(/^::ffff:/, ''));
        if (!canAdmin(result.user)) {
          accounts.logout(result.sessionKey);
          return send(response, 403, { error: 'Only head office accounts (HO / ALL) can use App tests.' });
        }
        log('info', `${result.user.displayName} opened App tests`);
        return send(response, 200, { sessionKey: result.sessionKey, user: { username: result.user.username, displayName: result.user.displayName } });
      } catch (error) {
        return send(response, error.code === 'locked' ? 429 : 401, { error: error.message });
      }
    }

    const user = accounts.userForSession(request.headers['x-saleskit-session']);
    if (!user || !canAdmin(user)) return send(response, 401, { error: 'Please sign in.', code: 'login_required' });

    if (route === '/app-check/api/logout' && request.method === 'POST') {
      accounts.logout(request.headers['x-saleskit-session']);
      return send(response, 200, { ok: true });
    }
    if (route === '/app-check/api/state' && request.method === 'GET') {
      const now = Date.now();
      const list = [...laptops.values()]
        .sort((a, b) => (a.branch || '~').localeCompare(b.branch || '~') || a.name.localeCompare(b.name))
        .map((l) => ({ name: l.name, branch: l.branch, user: l.user, version: l.version, make: l.make, model: l.model, online: now - l.lastSeen < ONLINE_MS, lastSeen: l.lastSeen, current: l.current, waiting: Boolean(l.command) }));
      return send(response, 200, { me: user.displayName, laptops: list, history: history.slice(-100).reverse(), targets, demoFolder, dataDir });
    }
    if (request.method !== 'POST') return send(response, 404, { error: 'Not found.' });
    const body = await readBody(request);
    if (!body) return send(response, 400, { error: 'Bad request.' });

    if (route === '/app-check/api/run') {
      const names = (Array.isArray(body.laptops) ? body.laptops : []).map((n) => text(n, 80));
      const started = names.filter((n) => laptops.has(n) && !running(laptops.get(n)));
      for (const n of started) laptops.get(n).command = 'run';
      if (started.length) log('info', `${user.displayName} started an app test on ${started.length === 1 ? started[0] : `${started.length} laptops`}`);
      return send(response, started.length ? 200 : 404, started.length ? { ok: true, started: started.length } : { error: 'Unknown laptop.' });
    }
    if (route === '/app-check/api/cancel') {
      const l = laptops.get(text(body.laptop, 80));
      if (l) l.command = null;
      return send(response, 200, { ok: true });
    }
    if (route === '/app-check/api/forget') {
      if (laptops.delete(text(body.laptop, 80))) {
        laptopsDirty = true;
        saveLaptops();
      }
      return send(response, 200, { ok: true });
    }
    if (route === '/app-check/api/targets') {
      const list = Array.isArray(body.targets) ? body.targets.slice(0, 40).map(cleanTarget) : [];
      if (!list.length || list.some((t) => !t)) return send(response, 400, { error: 'Every app needs a name and a keyword, and "Open a demo file" needs at least one file type.' });
      if (new Set(list.map((t) => t.name.toLowerCase())).size !== list.length) return send(response, 400, { error: 'Two apps have the same name.' });
      targets = list;
      demoFolder = text(body.demoFolder, 260).replace(/^["']+|["']+$/g, '');
      saveSettings();
      log('info', `${user.displayName} changed the apps to test`);
      return send(response, 200, { ok: true, targets, demoFolder });
    }
    if (route === '/app-check/api/clear') {
      for (const file of [F.runs, F.csv]) fs.rmSync(file, { force: true });
      history = [];
      for (const l of laptops.values()) l.current = null;
      log('warning', `${user.displayName} cleared the app test history`);
      return send(response, 200, { ok: true });
    }
    return send(response, 404, { error: 'Not found.' });
  }

  return {
    handleLaptop,
    handleAdmin,
    stop() {
      clearInterval(saveTimer);
      saveLaptops();
    }
  };
}

module.exports = { createAppCheck };
