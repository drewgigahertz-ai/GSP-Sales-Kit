// App Check: lets the admin test this laptop's apps (AutoCAD, Blender, Premiere...) from the App Tests web page on
// the SalesKit Server (server/app-check.js). Every 5 seconds SalesKit tells the server it is here
// (POST /api/app-check/poll); when the admin pressed "Run test", the reply carries the list of apps to test. SalesKit
// then runs them one by one (app-check-tests.js), sends each step live, and sends the results at the end. Results
// the server did not receive are kept on this laptop and sent on a later check-in. While a test runs the window
// shows a notice with a Stop button (app-check-notice.js). Older SalesKit Servers answer 404; nothing happens then.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listApps, testTarget, collectSampleFiles } = require('./app-check-tests');

const POLL_MS = 5000;

// request(route, body, timeoutMs): POSTs to /api/app-check/<route> on the SalesKit Server (same addresses, token
// and sign-in as the rest of SalesKit) and resolves to the reply, or rejects.
// places: this laptop's { desktop, documents, downloads } folders (app.getPath).
// download(pathname, file, onProgress(got, total)): saves a file from the SalesKit Server (same addresses and token).
function createAppCheck({ request, download, getUser, getWindow, readShortcutLink, userDataDir, places, version }) {
  const pendingPath = path.join(userDataDir, 'app-check-pending.json');
  // Demo files the admin uploaded, downloaded once each: app-check-files/<id>/<file name>.
  const filesDir = path.join(userDataDir, 'app-check-files');

  async function sha256(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  }

  // The uploaded file for an app on this laptop: { file } (downloaded now if not yet), or { error }.
  async function uploadedFile({ id, name, size }, onStep) {
    if (!/^[a-f0-9]{64}$/.test(String(id)) || !download) return { error: 'This SalesKit cannot download the uploaded file.' };
    const dest = path.join(filesDir, id, path.basename(String(name)));
    try {
      if (fs.statSync(dest).size === Number(size)) return { file: dest };
    } catch { /* not downloaded yet */ }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    let shown = -1;
    try {
      onStep(`Downloading ${name} from the server...`);
      await download(`/api/app-check/file/${id}`, part, (got, total) => {
        const percent = total ? Math.floor((got / total) * 10) * 10 : -1;
        if (percent !== shown && percent >= 0) {
          shown = percent;
          onStep(`Downloading ${name}... ${percent}%`);
        }
      });
      if (await sha256(part) !== id) throw new Error('the download was damaged; it will be downloaded again next time');
      fs.rmSync(dest, { force: true });
      fs.renameSync(part, dest);
      return { file: dest };
    } catch (error) {
      fs.rm(part, { force: true }, () => {});
      return { error: `Could not download ${name} from the server: ${error.message || error}` };
    }
  }

  // Downloaded files the admin no longer uses are deleted after a test.
  function removeOldUploads(keep) {
    let names = [];
    try { names = fs.readdirSync(filesDir); } catch { return; }
    for (const name of names) if (!keep.has(name)) fs.rm(path.join(filesDir, name), { recursive: true, force: true }, () => {});
  }
  const laptop = os.hostname();
  let state = { running: false };
  let stopRequested = false;

  function readPending() {
    try { return JSON.parse(fs.readFileSync(pendingPath, 'utf8')); } catch { return []; }
  }
  function writePending(list) {
    try {
      if (list.length) fs.writeFileSync(pendingPath, JSON.stringify(list.slice(-50)));
      else fs.rmSync(pendingPath, { force: true });
    } catch { /* not important enough to stop the test */ }
  }

  function setState(next) {
    state = next;
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('appcheck:state', state);
  }

  // The server's reply, or null when it could not be reached or refused.
  async function post(route, payload, timeoutMs = 10000) {
    try {
      return (await request(route, payload, timeoutMs)) || {};
    } catch {
      return null;
    }
  }

  async function sendPending() {
    const pending = readPending();
    if (!pending.length) return;
    const left = [];
    for (const payload of pending) if (left.length || !(await post('results', payload))) left.push(payload);
    writePending(left);
  }

  async function runTest({ targets, demoFolder }) {
    stopRequested = false;
    const runId = Date.now();
    const list = (Array.isArray(targets) ? targets : []).filter((t) => t && t.name);
    const user = getUser();
    // The folder the admin chose for the sample files, or '' to look for them anywhere on this laptop.
    const demoRoot = String(demoFolder || '').trim().replace(/^["']+|["']+$/g, '');
    let sampleFiles = null;
    const isStopped = () => stopRequested;
    const steps = Object.fromEntries(list.map((t) => [t.name, { status: 'waiting', detail: '' }]));
    const show = () => setState({ running: true, stopping: stopRequested, targets: list.map((t) => ({ name: t.name, ...steps[t.name] })) });
    const step = (target, status, detail) => {
      steps[target] = { status, detail };
      show();
      post('event', { laptop, type: 'step', runId, target, status, detail }, 5000);
    };

    show();
    await post('event', { laptop, type: 'start', runId, targets: list.map((t) => t.name) }, 5000);
    const desktops = [places.desktop, path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
    const apps = listApps(readShortcutLink, desktops);
    const results = [];
    try {
      for (const target of list) {
        if (stopRequested) {
          results.push({ target: target.name, app: '', status: 'stopped', detail: 'Stopped on the laptop before this app was tested.' });
          step(target.name, 'stopped', 'Not tested');
          continue;
        }
        step(target.name, 'testing', 'Looking for the app...');
        // One search of the laptop for every file type in the list, the first time an app needs a sample file
        // (not for an app whose specific file is given as a full path).
        const fullPath = /^[a-z]:[\\/]|^\\\\/i.test(String(target.file || '').trim());
        if (!demoRoot && target.mode === 'file' && !target.upload && !fullPath && !sampleFiles) {
          step(target.name, 'testing', 'Looking for sample files on this laptop...');
          const exts = [...new Set(list.filter((t) => t.mode === 'file')
            .flatMap((t) => [...(t.exts || []), path.extname(String(t.file || '')).toLowerCase()]).filter(Boolean))];
          sampleFiles = await collectSampleFiles(exts, places);
        }
        const onStep = (detail) => step(target.name, 'testing', detail);
        // An uploaded file: downloaded from the server, then opened from where it was saved (full path).
        let result;
        const got = target.mode === 'file' && target.upload ? await uploadedFile(target.upload, onStep) : null;
        if (got && got.error) result = { app: '', status: 'missing', detail: got.error };
        else result = await testTarget(got ? { ...target, file: got.file } : target, { apps, demoRoot, sampleFiles: sampleFiles || [], isStopped, onStep });
        results.push({ target: target.name, app: result.app, status: result.status, detail: result.detail });
        step(target.name, result.status, result.detail);
      }
      const payload = {
        laptop,
        branch: user ? user.branch || '' : '',
        user: user ? user.username || '' : '',
        version,
        time: new Date().toISOString(),
        stoppedOnLaptop: stopRequested,
        results
      };
      if (!(await post('results', payload))) writePending([...readPending(), payload]);
    } finally {
      removeOldUploads(new Set(list.map((t) => t.upload && t.upload.id).filter(Boolean)));
      await post('event', { laptop, type: 'finish', runId }, 5000);
      setState({ running: false });
    }
  }

  async function poll() {
    // Keeps checking in during a test, so the web page shows the laptop online; commands wait until it ends.
    // (The server knows the signed-in user and branch from the session.)
    const reply = await post('poll', { laptop, version, busy: state.running }, 5000);
    if (!reply || state.running) return;
    await sendPending();
    // Not awaited: the check-ins carry on while the test runs.
    if (reply.command === 'run') runTest(reply).catch(() => setState({ running: false }));
  }

  let polling = false;
  setInterval(async () => {
    if (polling) return;
    polling = true;
    try { await poll(); } catch { /* try again next time */ } finally { polling = false; }
  }, POLL_MS);

  return {
    getState: () => state,
    stop() {
      if (!state.running) return;
      stopRequested = true;
      setState({ ...state, stopping: true });
    }
  };
}

module.exports = { createAppCheck };
