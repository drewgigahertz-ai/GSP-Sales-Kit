// App Check tests (moved over from the App Checker app): find the apps the admin asked for on this laptop, open
// each one (or its sample file from the demo folder), check it starts and keeps responding, then close it again.
// Windows only. Used by app-check.js.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A keyword can hold alternatives split by |, for example "assassin|mirage".
function matches(name, keyword) {
  return String(keyword || '').toLowerCase().split('|').map((k) => k.trim()).filter(Boolean)
    .some((k) => String(name).toLowerCase().includes(k));
}

const SKIP_NAME = /uninstall|settings|migrate|license|recap|help|manual|reset|readme|website/i;

function walk(dir, test, out = [], depth = 8) {
  if (depth < 0) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, test, out, depth - 1);
    else if (test(e.name)) out.push(full);
  }
  return out;
}

// Start Menu shortcuts, and shortcuts or .exe files sitting on the desktops. `readLink` is shell.readShortcutLink.
function listApps(readLink, desktopDirs) {
  const found = new Map();
  const add = (name, exe) => {
    if (SKIP_NAME.test(name) || !exe || !exe.toLowerCase().endsWith('.exe')) return;
    const key = exe.toLowerCase();
    if (!found.has(key) && fs.existsSync(exe)) found.set(key, { name, exe });
  };
  const fromLink = (file) => {
    try { add(path.basename(file, path.extname(file)), readLink(file).target); } catch { /* unreadable shortcut */ }
  };
  for (const dir of desktopDirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const low = n.toLowerCase();
      if (low.endsWith('.exe')) add(path.parse(n).name, path.join(dir, n));
      else if (low.endsWith('.lnk')) fromLink(path.join(dir, n));
    }
  }
  const startMenus = [
    path.join(process.env.ProgramData || '', 'Microsoft/Windows/Start Menu/Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft/Windows/Start Menu/Programs')
  ];
  for (const root of startMenus) for (const lnk of walk(root, (n) => n.toLowerCase().endsWith('.lnk'))) fromLink(lnk);
  return [...found.values()];
}

const IGNORED_FILE = /^~|\.(bak|dwl|dwl2|blend1|blend2)$/i;

// Looks inside the demo folder, in this order:
//  1. a matching file sitting directly in it (like the Premiere project)
//  2. a folder whose name has the keyword, searched down through its subfolders
//  3. anything with the right extension anywhere inside (last resort)
function findDemoFile(demoRoot, keyword, exts) {
  let entries = [];
  try { entries = fs.readdirSync(demoRoot, { withFileTypes: true }); } catch { return { error: `Demo folder not found: ${demoRoot}` }; }
  const okExt = (f) => exts.includes(path.extname(f).toLowerCase());

  const direct = entries.filter((e) => e.isFile() && okExt(e.name) && !IGNORED_FILE.test(e.name)).map((e) => e.name);
  const best = direct.find((n) => matches(n, keyword)) || (direct.length === 1 ? direct[0] : null);
  if (best) return { file: path.join(demoRoot, best) };

  const inFolder = (dir) => walk(dir, (n) => okExt(n) && !IGNORED_FILE.test(n), [], 6).sort()[0];
  for (const d of entries.filter((e) => e.isDirectory() && matches(e.name, keyword))) {
    const hit = inFolder(path.join(demoRoot, d.name));
    if (hit) return { file: hit };
  }
  for (const d of entries.filter((e) => e.isDirectory() && !/download/i.test(e.name))) {
    const hit = inFolder(path.join(demoRoot, d.name));
    if (hit) return { file: hit };
  }
  return { error: `No ${exts.join(' / ')} file found for "${keyword}" inside ${demoRoot}` };
}

// ---------- Finding sample files anywhere on the laptop (when the admin set no demo folder) ----------

// Folders never worth searching: Windows, programs, app data, recycle bin, code and game libraries.
const SKIP_DIR = /^(windows|program files( \(x86\))?|programdata|appdata|\$recycle\.bin|system volume information|recovery|perflogs|msocache|\$windows\.~\w+|intel|amd|nvidia|drivers|node_modules|\.git|steamapps|epic games|xboxgames|windowsapps)$/i;
const SEARCH_LIMITS = { entries: 80000, ms: 20000 };

// The laptop's own fixed drives other than C: (D:, E:...). Network, USB and CD drives are left out.
function otherFixedDrives() {
  return new Promise((resolve) => {
    if (!IS_WIN) return resolve([]);
    const cmd = "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID }";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 10000, windowsHide: true }, (_error, out) => {
      resolve(String(out || '').split(/\r?\n/).map((d) => d.trim()).filter((d) => /^[D-Z]:$/i.test(d)).map((d) => `${d}\\`));
    });
  });
}

// Lists every file with one of `exts` under the usual places on this laptop, without blocking SalesKit (async)
// and within a time and size limit. places: { desktop, documents, downloads, home }.
async function collectSampleFiles(exts, places) {
  const wanted = new Set(exts.map((e) => e.toLowerCase()));
  const found = [];
  const seen = new Set();
  const started = Date.now();
  let visited = 0;
  const overLimit = () => visited > SEARCH_LIMITS.entries || Date.now() - started > SEARCH_LIMITS.ms;

  async function search(dir, depth) {
    if (depth < 0 || overLimit()) return;
    const key = dir.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      visited += 1;
      if (overLimit()) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR.test(entry.name) && !entry.name.startsWith('.')) await search(full, depth - 1);
      } else if (entry.isFile() && wanted.has(path.extname(entry.name).toLowerCase()) && !IGNORED_FILE.test(entry.name)) {
        found.push(full);
      }
    }
  }

  const publicDir = process.env.PUBLIC || 'C:\\Users\\Public';
  const userPlaces = [
    places.desktop, path.join(publicDir, 'Desktop'), places.documents, places.downloads,
    process.env.OneDrive, path.join(publicDir, 'Documents')
  ].filter(Boolean);
  for (const dir of userPlaces) await search(dir, 6);
  // Folders made straight on C: (like C:\Projects) and the other drives; C:\Users is covered above.
  for (const drive of ['C:\\', ...(await otherFixedDrives())]) {
    let entries = [];
    try { entries = await fs.promises.readdir(drive, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIR.test(entry.name) || /^users$/i.test(entry.name)) continue;
      await search(path.join(drive, entry.name), 4);
    }
  }

  const files = await Promise.all(found.map(async (file) => {
    try { return { file, mtime: (await fs.promises.stat(file)).mtimeMs }; } catch { return null; }
  }));
  return files.filter(Boolean);
}

// The best of the collected files for one app: first anything in an APPLICATION DEMO folder (the stores' own demo
// files), then files whose name or folder has the app's keyword, then "demo" / "sample" names, then the newest.
// (So D:\APPLICATION DEMO\AUTOCAD 3D House\house.dwg wins over AutoCAD's own D:\AutoCAD 2027\Sample\Tower.dwg.)
function pickSampleFile(files, keyword, exts) {
  const okExt = new Set(exts.map((e) => e.toLowerCase()));
  const score = ({ file }) => (/application demo/i.test(file) ? 4 : 0) + (matches(file, keyword) ? 2 : 0) + (/demo|sample/i.test(file) ? 1 : 0);
  const best = files.filter((f) => okExt.has(path.extname(f.file).toLowerCase()))
    .sort((a, b) => score(b) - score(a) || b.mtime - a.mtime)[0];
  return best ? { file: best.file } : { error: `No ${exts.join(' / ')} file on this laptop to open.` };
}

// AutoCAD leaves lock files next to a drawing when it is closed by force. Returns a function that deletes the
// ones that were not there before the test.
function lockFileCleanup(file) {
  const base = file.slice(0, -path.extname(file).length);
  const locks = path.extname(file).toLowerCase() === '.dwg' ? [`${base}.dwl`, `${base}.dwl2`] : [];
  const before = new Set(locks.filter((f) => fs.existsSync(f)));
  return async () => {
    await sleep(2000);
    for (const lock of locks) if (!before.has(lock)) fs.rm(lock, { force: true }, () => {});
  };
}

// Windows with a title, and whether each one is responding.
function windowList() {
  return new Promise((resolve) => {
    const cmd = 'Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object Id,ProcessName,MainWindowTitle,Responding | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 20000, windowsHide: true }, (_error, out) => {
      try { const list = JSON.parse(out); resolve(Array.isArray(list) ? list : [list]); } catch { resolve([]); }
    });
  });
}

const kill = (pid) => { if (pid) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); };

// Waits while checking every second whether the test was stopped. Returns true when stopped.
async function waitUnlessStopped(ms, isStopped) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (isStopped()) return true;
    await sleep(Math.min(1000, end - Date.now()));
  }
  return isStopped();
}

const STOPPED = { status: 'stopped', detail: 'Stopped on the laptop. The app was closed.' };

// Launch, wait, judge, close. OK = still running after the wait.
async function launchTest(exe, waitSeconds, isStopped) {
  let outcome = null;
  let child;
  try {
    child = spawn(exe, [], { stdio: 'ignore', cwd: path.dirname(exe), windowsHide: false });
  } catch (error) {
    return { status: 'failed', detail: error.message };
  }
  child.on('error', (error) => { outcome = outcome || { status: 'failed', detail: error.message }; });
  child.on('exit', (code, signal) => {
    outcome = outcome || (code === 0
      ? { status: 'exited', detail: 'Closed by itself with code 0. May be a launcher that opens another process.' }
      : { status: 'crashed', detail: signal ? `Ended by the system (${signal}).` : `Exited with code ${code}` });
  });
  try {
    const end = Date.now() + waitSeconds * 1000;
    while (Date.now() < end && !outcome) {
      if (await waitUnlessStopped(Math.min(1000, end - Date.now()), isStopped)) return STOPPED;
    }
    return outcome || { status: 'ok', detail: `Still running after ${waitSeconds}s. The app was closed again.` };
  } finally {
    kill(child.pid);
  }
}

// Open the sample file in the app. OK = the file name shows up in the app's window and the window keeps responding.
async function openFileTest(exe, file, waitSeconds, onStep, isStopped) {
  const base = path.parse(file).name.toLowerCase();
  const cleanUpLocks = lockFileCleanup(file);
  let spawnError = null;
  const child = spawn(exe, [file], { stdio: 'ignore', cwd: path.dirname(exe) });
  child.on('error', (error) => { spawnError = error.message; });
  let pid = null;
  try {
    onStep(`Opening ${path.basename(file)}`);
    const end = Date.now() + waitSeconds * 1000;
    let win = null;
    while (Date.now() < end && !win) {
      if (await waitUnlessStopped(3000, isStopped)) return STOPPED;
      if (spawnError) return { status: 'failed', detail: spawnError };
      win = (await windowList()).find((w) => String(w.MainWindowTitle).toLowerCase().includes(base));
      if (!win) onStep(`Waiting for "${path.basename(file)}" to appear in the app window (${Math.max(0, Math.round((end - Date.now()) / 1000))}s left)`);
    }
    if (!win) return { status: 'failed', detail: `The app did not show "${base}" within ${waitSeconds}s. A pop-up may be blocking it, or it is still loading. File: ${file}` };
    pid = win.Id;
    onStep('File opened. Checking the app keeps responding...');
    if (await waitUnlessStopped(8000, isStopped)) return STOPPED;
    const again = (await windowList()).find((w) => w.Id === pid);
    if (!again) return { status: 'crashed', detail: `The app closed by itself after opening ${file}.` };
    if (again.Responding === false) return { status: 'failed', detail: `The app opened ${file} but stopped responding.` };
    return { status: 'ok', detail: `Opened ${file} and it kept responding. The app was closed again.` };
  } finally {
    kill(pid);
    kill(child.pid);
    cleanUpLocks();
  }
}

// One app from the admin's list: { name, keyword, mode: 'file' | 'launch', exts, wait }.
// demoRoot: the folder the admin chose, or '' to pick from sampleFiles (collectSampleFiles: the whole laptop).
async function testTarget(target, { apps, demoRoot, sampleFiles = [], onStep, isStopped }) {
  if (!IS_WIN) return { app: '', status: 'failed', detail: 'App tests only run on Windows.' };
  const found = apps.find((a) => matches(a.name, target.keyword));
  if (!found) return { app: '', status: 'not_installed', detail: `No app matching "${target.keyword}" was found on this laptop` };
  const wait = Math.min(600, Math.max(2, Number(target.wait) || 90));
  let result;
  if (target.mode === 'file') {
    const exts = (target.exts || []).map((e) => String(e).toLowerCase());
    const demo = demoRoot ? findDemoFile(demoRoot, target.keyword, exts) : pickSampleFile(sampleFiles, target.keyword, exts);
    result = demo.error ? { status: 'missing', detail: demo.error } : await openFileTest(found.exe, demo.file, wait, onStep, isStopped);
  } else {
    onStep(`Launching, waiting ${wait}s...`);
    result = await launchTest(found.exe, wait, isStopped);
  }
  return { app: found.name, ...result };
}

module.exports = { listApps, testTarget, collectSampleFiles, pickSampleFile, lockFileCleanup };
