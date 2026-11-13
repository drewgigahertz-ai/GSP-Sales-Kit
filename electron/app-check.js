// App Check: lets the admin test this laptop's apps (AutoCAD, Blender, Premiere...) from the App Tests web page on
// the SalesKit Server (server/app-check.js). Every 5 seconds SalesKit tells the server it is here
// (POST /api/app-check/poll); when the admin pressed "Run test", the reply carries the list of apps to test. SalesKit
// then runs them one by one (app-check-tests.js), sends each step live, and sends the results at the end. Results
// the server did not receive are kept on this laptop and sent on a later check-in. While a test runs the window
// shows a notice with a Stop button (app-check-notice.js). Older SalesKit Servers answer 404; nothing happens then.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listApps, listDesktop, testTarget, collectSampleFiles } = require('./app-check-tests');
// The desktop is read again at most once a minute, and sent only when it changed (or the server asks for it).
const DESKTOP_READ_MS = 60 * 1000;

const POLL_MS = 5000;

// request(route, body, timeoutMs): POSTs to /api/app-check/<route> on the SalesKit Server (same addresses, token
// and sign-in as the rest of SalesKit) and resolves to the reply, or rejects.
// places: this laptop's { desktop, documents, downloads } folders (app.getPath).
function createAppCheck({ request, getUser, getWindow, readShortcutLink, userDataDir, places, version }) {
  const pendingPath = path.join(userDataDir, 'app-check-pending.json');
  const laptop = os.hostname();
  let state = { running: false };
  let stopRequested = false;
  // Who stopped the test: 'laptop' (Stop test on the card) or 'admin' (Cancel test on the App Tests page).
  let stoppedBy = '';
  const stoppedText = () => (stoppedBy === 'admin' ? 'Stopped by head office' : 'Stopped on the laptop');

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
    stoppedBy = '';
    const runId = Date.now();
    const list = (Array.isArray(targets) ? targets : []).filter((t) => t && t.name);
    const user = getUser();
    // The folder the admin chose for the sample files, or '' to look for them anywhere on this laptop.
    const demoRoot = String(demoFolder || '').trim().replace(/^["']+|["']+$/g, '');
    let sampleFiles = null;
    const isStopped = () => stopRequested;
    const steps = Object.fromEntries(list.map((t) => [t.name, { status: 'waiting', detail: '' }]));
    const show = () => setState({ running: true, stopping: stopRequested, stoppedBy, targets: list.map((t) => ({ name: t.name, ...steps[t.name] })) });
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
          results.push({ target: target.name, app: '', status: 'stopped', detail: `${stoppedText()} before this app was tested.` });
          step(target.name, 'stopped', 'Not tested');
          continue;
        }
        step(target.name, 'testing', 'Looking for the app...');
        // One search of the laptop for every file type in the list, the first time an app needs a sample file
        // (not for an app whose specific file is given as a full path).
        const fullPath = /^[a-z]:[\\/]|^\\\\/i.test(String(target.file || '').trim());
        if (!demoRoot && target.mode === 'file' && !fullPath && !sampleFiles) {
          step(target.name, 'testing', 'Looking for sample files on this laptop...');
          const exts = [...new Set(list.filter((t) => t.mode === 'file')
            .flatMap((t) => [...(t.exts || []), path.extname(String(t.file || '')).toLowerCase()]).filter(Boolean))];
          sampleFiles = await collectSampleFiles(exts, places);
        }
        const result = await testTarget(target, { apps, demoRoot, sampleFiles: sampleFiles || [], isStopped, onStep: (detail) => step(target.name, 'testing', detail) });
        results.push({ target: target.name, app: result.app, status: result.status, detail: result.detail });
        step(target.name, result.status, result.detail);
      }
      const payload = {
        laptop,
        branch: user ? user.branch || '' : '',
        user: user ? user.username || '' : '',
        version,
        time: new Date().toISOString(),
        stoppedOnLaptop: stopRequested && stoppedBy !== 'admin',
        stoppedByAdmin: stopRequested && stoppedBy === 'admin',
        results
      };
      if (!(await post('results', payload))) writePending([...readPending(), payload]);
    } finally {
      await post('event', { laptop, type: 'finish', runId }, 5000);
      setState({ running: false });
    }
  }

  // What is on the desktop, for App Tests' desktop check: the list when it changed since it was last sent.
  let desktop = { list: null, readAt: 0, sent: '', wanted: false };
  function desktopToSend() {
    if (!desktop.list || Date.now() - desktop.readAt > DESKTOP_READ_MS) {
      try {
        desktop.list = listDesktop(readShortcutLink, [places.desktop, path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')].filter(Boolean));
      } catch { desktop.list = []; }
      desktop.readAt = Date.now();
    }
    const signature = JSON.stringify(desktop.list);
    return desktop.wanted || signature !== desktop.sent ? { list: desktop.list, signature } : null;
  }

  async function poll() {
    // Keeps checking in during a test, so the web page shows the laptop online; commands wait until it ends.
    // (The server knows the signed-in user and branch from the session.)
    const desk = desktopToSend();
    const reply = await post('poll', { laptop, version, busy: state.running, ...(desk ? { desktop: desk.list } : {}) }, 5000);
    if (!reply) return;
    if (desk) desktop.sent = desk.signature;
    desktop.wanted = Boolean(reply.needDesktop);
    // During a test the only command is "stop" (Cancel test on the App Tests page).
    if (state.running) {
      if (reply.command === 'stop') stop('admin');
      return;
    }
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

  // by: 'laptop' (the card's Stop test) or 'admin' (the App Tests page).
  function stop(by = 'laptop') {
    if (!state.running || stopRequested) return;
    stopRequested = true;
    stoppedBy = by;
    setState({ ...state, stopping: true, stoppedBy });
  }

  return {
    getState: () => state,
    stop: () => stop('laptop')
  };
}

module.exports = { createAppCheck };
