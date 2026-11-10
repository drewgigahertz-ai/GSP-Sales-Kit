// App Check: lets the admin test this laptop's apps (AutoCAD, Blender, Premiere...) from the App Check Server's
// admin page. Every 5 seconds SalesKit tells the App Check Server it is here; when the admin presses "Run test",
// the reply carries the list of apps to test. SalesKit then runs them one by one (app-check-tests.js), sends each
// step live, and sends the results at the end. Results the server did not receive are kept on this laptop and sent
// on a later check-in. While a test runs the window shows a notice with a Stop button (app-check-notice.js).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listApps, testTarget } = require('./app-check-tests');

const POLL_MS = 5000;

function createAppCheck({ getConfig, getUser, getWindow, readShortcutLink, userDataDir, desktopDir, version }) {
  const pendingPath = path.join(userDataDir, 'app-check-pending.json');
  const laptop = os.hostname();
  let workingUrl = '';
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

  // Tries the address that answered last first. Returns the reply, or null when no address answered.
  async function post(route, payload, timeoutMs = 10000) {
    const { appCheckUrls, appCheckToken } = getConfig();
    const urls = workingUrl && appCheckUrls.includes(workingUrl) ? [workingUrl, ...appCheckUrls.filter((u) => u !== workingUrl)] : appCheckUrls;
    for (const url of urls) {
      try {
        const response = await fetch(url + route, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-token': appCheckToken },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs)
        });
        workingUrl = url;
        if (!response.ok) return null;
        return await response.json().catch(() => ({}));
      } catch { /* not reachable at this address; try the next one */ }
    }
    return null;
  }

  async function sendPending() {
    const pending = readPending();
    if (!pending.length) return;
    const left = [];
    for (const payload of pending) if (left.length || !(await post('/results', payload))) left.push(payload);
    writePending(left);
  }

  async function runTest({ targets, demoFolder }) {
    stopRequested = false;
    const runId = Date.now();
    const list = (Array.isArray(targets) ? targets : []).filter((t) => t && t.name);
    const user = getUser();
    const demoRoot = String(demoFolder || '').trim().replace(/^["']+|["']+$/g, '') || path.join(desktopDir, 'APPLICATION DEMO');
    const isStopped = () => stopRequested;
    const steps = Object.fromEntries(list.map((t) => [t.name, { status: 'waiting', detail: '' }]));
    const show = () => setState({ running: true, stopping: stopRequested, targets: list.map((t) => ({ name: t.name, ...steps[t.name] })) });
    const step = (target, status, detail) => {
      steps[target] = { status, detail };
      show();
      post('/event', { laptop, type: 'step', runId, target, status, detail }, 5000);
    };

    show();
    await post('/event', { laptop, type: 'start', runId, targets: list.map((t) => t.name) }, 5000);
    const desktops = [desktopDir, path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')];
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
        const result = await testTarget(target, { apps, demoRoot, isStopped, onStep: (detail) => step(target.name, 'testing', detail) });
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
      if (!(await post('/results', payload))) writePending([...readPending(), payload]);
    } finally {
      await post('/event', { laptop, type: 'finish', runId }, 5000);
      setState({ running: false });
    }
  }

  async function poll() {
    const { appCheckUrls } = getConfig();
    if (!appCheckUrls.length) return;
    const user = getUser();
    // Keeps checking in during a test, so the admin page shows the laptop online; commands wait until it ends.
    const reply = await post('/agent/poll', {
      laptop,
      branch: user ? user.branch || '' : '',
      user: user ? user.username || '' : '',
      version,
      busy: state.running
    }, 5000);
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
