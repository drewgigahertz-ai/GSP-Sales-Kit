// App Check: the admin tests the branch laptops' apps (AutoCAD, Blender, Premiere...) from a web page on this server.
// - Web page: http://SERVER:3000/app-check, signed in with a SalesKit account of a full-access branch (HO / ALL).
// - Laptops (Gigahertz Sales Tools 1.0.30+, electron/app-check.js) check in every 5 seconds on /api/app-check/poll,
//   get the list of apps when the admin pressed "Run test", and send each step and the results back.
// Everything is kept in <userData>/app-check: settings.json (apps to test, demo folder), laptops.json, runs.jsonl
// (every result) and results.csv (one row per test, for Excel).
const fs = require('node:fs');
const path = require('node:path');
const { compareSku } = require('../electron/laptop-sku');

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
  // file (optional): one exact file to open, as a file name ("Price list.xlsx", searched for on each laptop) or a
  // full path ("D:\APPLICATION DEMO\Price list.xlsx"). Its type is added to exts, so laptops before 1.0.33
  // (which do not know file) still open a file of that type.
  const file = mode === 'file' ? text(t.file, 260).replace(/^["']+|["']+$/g, '').trim() : '';
  const fileExt = path.extname(file).toLowerCase();
  const exts = mode === 'file'
    ? [...new Set([...(Array.isArray(t.exts) ? t.exts : String(t.exts || '').split(/[,\s]+/)), fileExt]
      .map((e) => text(e, 12).toLowerCase()).filter(Boolean).map((e) => (e.startsWith('.') ? e : `.${e}`)))]
    : [];
  if (mode === 'file' && !exts.length) return null;
  return { name, keyword, mode, exts, ...(file ? { file } : {}), wait: Math.min(600, Math.max(2, Math.round(Number(t.wait) || 90))) };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// accounts: { login(username, password, address), logout(key), userForSession(key) } (server/users.js).
// canAdmin(user): who may use the web page. log(level, message): the server's activity log.
// getLogoPath(): the header logo file for the page's top bar (the LOGO sheet's, as on Sales Tools), or ''.
// lastAccountFor(computerName): the account last signed in on that laptop ({ username, branch }) from the server's
//   Devices list, or null. Used for the branch while nobody is signed in (sign-in page, or signed out by a restart).
function createAppCheck({ dataDir, accounts, canAdmin, log = () => {}, getLogoPath = () => '', lastAccountFor = () => null, listBranches = () => [], findSku = () => null }) {
  // findSku(sku): that SKU in SalesKit's data ({ sku, brand, model, partNumber }) or null, to compare it with the
  // brand and model Windows reports (laptop-sku.js).
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
    const list = [...laptops.values()].map(({ name, branch, assignedBranch, user, version, make, model, sku, lastSeen }) => ({ name, branch, assignedBranch, user, version, make, model, sku, lastSeen }));
    try { fs.writeFileSync(F.laptops, JSON.stringify(list, null, 1)); } catch { laptopsDirty = true; }
  }
  const saveTimer = setInterval(saveLaptops, 30 * 1000);
  saveTimer.unref?.();

  // seen: false for results sent late (kept on the laptop while the server was unreachable). The branch is kept
  // while nobody is signed in on the laptop; brand and model come from the X-SalesKit-Make / -Model headers.
  function touch(body, user, device = {}, seen = true) {
    const name = text(body.laptop, 80);
    if (!laptops.has(name)) laptops.set(name, { name, branch: '', user: '', version: '', make: '', model: '', sku: '', lastSeen: 0, command: null, current: null });
    const l = laptops.get(name);
    const known = user ? null : lastAccountFor(name);
    const fields = { branch: user ? user.branch : (known && known.branch) || '', user: user ? user.username : '', version: body.version, make: device.make, model: device.model, sku: device.sku };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || text(value) === l[key] || (['branch', 'make', 'model', 'sku'].includes(key) && !text(value))) continue;
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
  // The typed SKU against the laptop Windows reports: { status: none | unknown | nodevice | brand | model | match,
  // brand, model } (brand and model: what SalesKit's data says that SKU is).
  function skuCheckOf(l) {
    let found = null;
    try { found = l.sku ? findSku(l.sku) : null; } catch { /* no database yet */ }
    return compareSku(l.sku, found, { make: l.make, model: l.model });
  }
  // A laptop's branch: the one the admin set on the page, else the signed-in account's, else the account last
  // signed in on it (Devices list). source says which, for the page.
  function branchOf(l) {
    if (l.assignedBranch) return { branch: l.assignedBranch, source: 'set' };
    if (l.branch) return { branch: l.branch, source: 'account' };
    const known = lastAccountFor(l.name);
    return known && known.branch ? { branch: String(known.branch).toUpperCase(), source: 'account' } : { branch: '', source: '' };
  }

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
        // Each app is timed from its first "testing" step to its result (startedAt / ms, server clock).
        const name = text(body.target);
        const before = l.current.targets[name] || {};
        const status = text(body.status, 20);
        const entry = { status, detail: text(body.detail, 300), startedAt: before.startedAt, ms: before.ms };
        if (status === 'testing' && !entry.startedAt) entry.startedAt = Date.now();
        if (!['testing', 'waiting'].includes(status) && entry.startedAt && entry.ms === undefined) entry.ms = Date.now() - entry.startedAt;
        l.current.targets[name] = entry;
      } else if (l.current && body.type === 'finish') {
        l.current.finished = true;
        if (!l.current.ms) l.current.ms = Date.now() - l.current.startedAt;
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
        sku: l.sku || undefined,
        branch: l.assignedBranch || text(body.branch) || branchOf(l).branch,
        user: text(body.user),
        version: text(body.version, 20),
        time: Number.isNaN(Date.parse(body.time)) ? new Date().toISOString() : new Date(body.time).toISOString(),
        stoppedOnLaptop: Boolean(body.stoppedOnLaptop),
        results: body.results.slice(0, 40).map((r) => ({ target: text(r && r.target), app: text(r && r.app, 120), status: text(r && r.status, 20), detail: text(r && r.detail, 300) }))
      };
      // How long it ran: the server timed this test while it ran (results come just before the "finish" step).
      // Results sent late, from a laptop that could not reach the server, have no times.
      const live = l.current && !l.current.finished ? l.current : null;
      if (live && Math.abs(Date.parse(run.time) - Date.now()) < 2 * 60 * 1000) {
        run.startedAt = new Date(live.startedAt).toISOString();
        run.durationMs = Date.now() - live.startedAt;
        for (const r of run.results) {
          const t = live.targets[r.target];
          if (t && t.ms !== undefined) r.ms = t.ms;
        }
      }
      fs.appendFileSync(F.runs, `${JSON.stringify(run)}\n`);
      history.push(run);
      if (history.length > 500) history = history.slice(-500);
      appendCsv(run);
      const brandModel = [run.make, run.model].filter(Boolean).join(' ');
      log(passed(run) ? 'success' : 'warning', `App test on ${[run.branch, brandModel].filter(Boolean).join(' - ') || run.laptop} (${run.laptop}): ${run.results.map((r) => `${r.target} ${r.status}`).join(', ')}`);
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
    if (request.method === 'GET' && route === '/app-check/logo.png') {
      const file = getLogoPath();
      if (!file || !fs.existsSync(file)) return send(response, 404, { error: 'No logo.' });
      response.writeHead(200, { 'Cache-Control': 'max-age=3600', 'Content-Type': 'image/png' });
      response.end(fs.readFileSync(file));
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
    // Every test ever recorded (runs.jsonl), one row per app, so the columns stay the same when the app list changes.
    if (route === '/app-check/api/results.csv' && request.method === 'GET') {
      let runs = [];
      try { runs = fs.readFileSync(F.runs, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch { /* none yet */ }
      const secs = (ms) => (ms === undefined || ms === null ? '' : Math.round(ms / 1000));
      const rows = [['Started', 'Finished', 'Branch', 'Laptop SKU', 'Laptop', 'Computer name', 'Signed in', 'Sales Tools', 'App', 'Status', 'App seconds', 'Detail', 'Test result', 'Test seconds']];
      for (const run of runs) {
        const device = [run.make, run.model].filter(Boolean).join(' ');
        for (const r of run.results) rows.push([run.startedAt ? new Date(run.startedAt).toLocaleString() : '', new Date(run.time).toLocaleString(), run.branch, run.sku || '', device, run.laptop, run.user, run.version, r.target, r.status, secs(r.ms), r.detail, passed(run) ? 'PASS' : 'CHECK', secs(run.durationMs)]);
      }
      response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/csv; charset=utf-8' });
      // The byte-order mark makes Excel read the file as UTF-8.
      response.end(`﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`);
      return;
    }
    if (route === '/app-check/api/state' && request.method === 'GET') {
      const now = Date.now();
      const lastRun = new Map();
      // Each laptop's last test, with every app's result, for the list's app columns.
      for (const run of history) {
        const seen = lastRun.get(run.laptop);
        if (seen && Date.parse(seen.time) > Date.parse(run.time)) continue; // a late result of an older test
        lastRun.set(run.laptop, { time: run.time, pass: passed(run), stoppedOnLaptop: run.stoppedOnLaptop, startedAt: run.startedAt, durationMs: run.durationMs, results: run.results });
      }
      const list = [...laptops.values()]
        .map((l) => ({ l, ...branchOf(l) }))
        .sort((a, b) => (a.branch || '~').localeCompare(b.branch || '~') || a.l.name.localeCompare(b.l.name))
        .map(({ l, branch, source }) => ({ name: l.name, branch, branchSource: source, user: l.user, version: l.version, make: l.make, model: l.model, sku: l.sku || '', skuCheck: skuCheckOf(l), online: now - l.lastSeen < ONLINE_MS, lastSeen: l.lastSeen, current: l.current, waiting: Boolean(l.command), last: lastRun.get(l.name) || null }));
      // Branches to choose from when setting a laptop's branch: SalesKit's branch list, HO, and any in use.
      let branches = [];
      try { branches = listBranches(); } catch { /* no database yet */ }
      branches = [...new Set(['HO', ...branches, ...list.map((l) => l.branch)].filter(Boolean).map((b) => String(b).toUpperCase()))].sort();
      return send(response, 200, { now: Date.now(), me: user.displayName, laptops: list, branches, history: [...history].sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 100), targets, demoFolder, dataDir });
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
    // { laptop, branch }: the admin sets the laptop's branch ('' goes back to the signed-in account's branch).
    if (route === '/app-check/api/branch') {
      const l = laptops.get(text(body.laptop, 80));
      if (!l) return send(response, 404, { error: 'Unknown laptop.' });
      l.assignedBranch = text(body.branch, 40).toUpperCase();
      laptopsDirty = true;
      saveLaptops();
      log('info', `${user.displayName} set the branch of ${l.name} to ${l.assignedBranch || "the signed-in account's"}`);
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
      if (!list.length || list.some((t) => !t)) return send(response, 400, { error: 'Every app needs a name and a keyword, and "Open a demo file" needs a file type or a specific file.' });
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
