// App Check: lets the admin test this laptop's apps (AutoCAD, Blender, Premiere...) from the App Tests web page on
// the SalesKit Server (server/app-check.js). Every 5 seconds SalesKit tells the server it is here
// (POST /api/app-check/poll); when the admin pressed "Run test", the reply carries the list of apps to test. SalesKit
// then runs them one by one (app-check-tests.js), sends each step live, and sends the results at the end. Results
// the server did not receive are kept on this laptop and sent on a later check-in. While a test runs the window
// shows a notice with a Stop button (app-check-notice.js). Older SalesKit Servers answer 404; nothing happens then.
//
// Scheduled checks (1.0.43): the server sends this laptop's schedule on a check-in (app-check-schedule.js) and it is
// kept on the laptop, because the laptop may be offline when a check is due. Within a check's window, SalesKit turns
// Wi-Fi on when it is off (wifi.js), reports the banner on screen and the desktop ("Daily check") and tests the apps
// when the check includes them, but only once nobody has used the laptop for the set minutes; using the laptop
// stops an app test, which is tried again later in the window. Wi-Fi is turned off again when it was off before,
// once the laptop is idle. A check that could not run in its window is reported as not checked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listApps, listDesktop, testTarget, collectSampleFiles } = require('./app-check-tests');
const { wifiState, setWifi } = require('./wifi');
// The desktop is read again at most once a minute, and sent only when it changed (or the server asks for it).
const DESKTOP_READ_MS = 60 * 1000;

const POLL_MS = 5000;
// Scheduled checks: looked at every 30 seconds; the server must answer within 2 minutes of Wi-Fi coming on; a check
// that could not reach the server is tried again after 10 minutes; Wi-Fi goes off after 1 idle minute.
const SCHEDULE_TICK_MS = 30 * 1000;
const ONLINE_WAIT_MS = 2 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const WIFI_OFF_IDLE_S = 60;

// request(route, body, timeoutMs): POSTs to /api/app-check/<route> on the SalesKit Server (same addresses, token
// and sign-in as the rest of SalesKit) and resolves to the reply, or rejects.
// places: this laptop's { desktop, documents, downloads } folders (app.getPath).
// getIdleSeconds(): seconds since the last mouse or keyboard input. getActivity(): what Sales Tools shows now
// ({ kind, item, code }, activity.js), for the banner check.
function createAppCheck({ request, getUser, getWindow, readShortcutLink, userDataDir, places, version, getIdleSeconds = () => 0, getActivity = () => null }) {
  const pendingPath = path.join(userDataDir, 'app-check-pending.json');
  const schedulePath = path.join(userDataDir, 'app-check-schedule.json');
  const doneTodayPath = path.join(userDataDir, 'app-check-jobs.json');
  const laptop = os.hostname();
  let state = { running: false };
  let stopRequested = false;
  // Who stopped the test: 'laptop' (Stop test on the card) or 'admin' (Cancel test on the App Tests page).
  let stoppedBy = '';
  const stoppedText = () => (stoppedBy === 'admin' ? 'Stopped by head office' : stoppedBy === 'inuse' ? 'Stopped: someone used the laptop' : 'Stopped on the laptop');

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
    for (const item of pending) {
      const isCheck = item && item.route === 'check';
      if (left.length || !(await post(isCheck ? 'check' : 'results', isCheck ? item.payload : item))) left.push(item);
    }
    writePending(left);
  }

  // job: 'daily' or 'apps' for a scheduled check (its results are part of the check). watchInput: stop as soon as
  // someone uses the laptop. Resolves to { results, stoppedBy }.
  async function runTest({ targets, demoFolder, job, watchInput }) {
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
    // A scheduled test stops when someone uses the laptop (the apps it opens do not count as use).
    const watcher = watchInput ? setInterval(() => { if (getIdleSeconds() < 3) stop('inuse'); }, 2000) : null;
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
        ...(job ? { job } : {}),
        results
      };
      if (!(await post('results', payload))) writePending([...readPending(), payload]);
    } finally {
      clearInterval(watcher);
      await post('event', { laptop, type: 'finish', runId }, 5000);
      setState({ running: false });
    }
    return { results, stoppedBy: stopRequested ? stoppedBy : '' };
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
    const reply = await post('poll', { laptop, version, busy: state.running || Boolean(job), scheduleKey: schedule.key || '', ...(desk ? { desktop: desk.list } : {}) }, 5000);
    if (!reply) return;
    if (reply.schedule && typeof reply.schedule === 'object') saveSchedule(reply.schedule);
    if (desk) desktop.sent = desk.signature;
    desktop.wanted = Boolean(reply.needDesktop);
    // During a test the only command is "stop" (Cancel test on the App Tests page).
    if (state.running) {
      if (reply.command === 'stop') stop('admin');
      return;
    }
    await sendPending();
    // Not awaited: the check-ins carry on while the test runs.
    if (reply.command === 'run' && !job) runTest(reply).catch(() => setState({ running: false }));
    // "Run now" on the App Tests page's Schedules tab: the check at once, idle or not.
    if (reply.command === 'check' && reply.job && !job) runJob(reply.job, 'now').catch(() => {});
  }

  // ---------- Scheduled checks ----------
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const writeJson = (file, value) => { try { fs.writeFileSync(file, JSON.stringify(value)); } catch { /* tried again next time */ } };
  // { key, idleMinutes, jobs: [{ id, days, start, end, checks }] } as the server last sent it.
  let schedule = readJson(schedulePath, {});
  // { date, jobs: { daily: { status, reason }, ... }, tries: { daily: { reason, retryAt } }, wifiOff: bool }
  let today = readJson(doneTodayPath, {});
  let job = null; // the check running now: { id, trigger }
  function saveSchedule(next) {
    schedule = { key: String(next.key || ''), idleMinutes: Number(next.idleMinutes) || 5, jobs: Array.isArray(next.jobs) ? next.jobs : [] };
    writeJson(schedulePath, schedule);
  }
  const pad = (n) => String(n).padStart(2, '0');
  const dateOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const minutesOf = (hhmm) => Number(String(hhmm).slice(0, 2)) * 60 + Number(String(hhmm).slice(3, 5));
  function todayState() {
    const date = dateOf(new Date());
    if (today.date !== date) today = { date, jobs: {}, tries: {}, wifiOff: Boolean(today.wifiOff) };
    return today;
  }
  const saveToday = () => writeJson(doneTodayPath, today);

  // Reports that could not be sent wait with the test results (sendPending sends them on a later check-in).
  async function report(payload) {
    if (!(await post('check', payload))) writePending([...readPending(), { route: 'check', payload }]);
  }

  // Wi-Fi on until the server answers. { wifiBefore, turnedOn, online, note }
  async function goOnline() {
    const wifiBefore = await wifiState();
    let turnedOn = false;
    if (wifiBefore === 'off') turnedOn = await setWifi(true);
    const until = Date.now() + ONLINE_WAIT_MS;
    while (Date.now() < until) {
      if (await post('poll', { laptop, version, busy: true, scheduleKey: schedule.key || '' }, 5000)) return { wifiBefore, turnedOn, online: true };
      await new Promise((r) => setTimeout(r, 5000));
    }
    return { wifiBefore, turnedOn, online: false };
  }
  // Wi-Fi back off when this check turned it on: now if nobody uses the laptop, else once it is idle (tick).
  async function restoreWifi(net) {
    if (!net.turnedOn) return;
    if (getIdleSeconds() >= WIFI_OFF_IDLE_S && await setWifi(false)) return;
    todayState().wifiOff = true;
    saveToday();
  }
  const wifiText = (net, off) => (net.wifiBefore === 'on' ? 'Was on, left on'
    : net.wifiBefore === 'off' ? (net.turnedOn ? `Was off: turned on for the check${off ? ', then off' : ''}` : 'Was off: could not turn it on')
      : net.wifiBefore === 'none' ? 'No Wi-Fi (network cable)' : 'Unknown');

  // One check: Wi-Fi on, the apps to test (when the check has them), the report, Wi-Fi back off.
  // trigger: 'schedule' or 'now' ("Run now" on the Schedules tab, which does not count for the day).
  async function runJob(spec, trigger) {
    if (job || state.running) return;
    job = { id: spec.id, trigger };
    const day = todayState();
    const user = getUser();
    const base = { laptop, job: spec.id, trigger, date: day.date, version, user: user ? user.username || '' : '' };
    try {
      const net = await goOnline();
      if (!net.online) {
        const reason = net.wifiBefore === 'off' && !net.turnedOn ? 'Wi-Fi could not be turned on' : 'Could not reach the SalesKit Server';
        day.tries[spec.id] = { reason, retryAt: Date.now() + RETRY_MS };
        saveToday();
        await restoreWifi(net);
        return;
      }
      const start = await post('check', { ...base, phase: 'start' }, 10000);
      let apps;
      let appsNote = '';
      let interrupted = false;
      if ((spec.checks || []).includes('apps')) {
        const targets = start && Array.isArray(start.targets) ? start.targets : [];
        if (!targets.length) appsNote = 'No apps to test';
        else {
          const run = await runTest({ targets, demoFolder: start.demoFolder, job: spec.id, watchInput: trigger === 'schedule' });
          apps = run.results;
          interrupted = run.stoppedBy === 'inuse';
          if (run.stoppedBy === 'admin') appsNote = 'Cancelled from the App Tests page';
          if (run.stoppedBy === 'laptop') appsNote = 'Stopped on the laptop';
        }
      }
      let desktopList;
      if ((spec.checks || []).includes('desktop')) {
        try { desktopList = listDesktop(readShortcutLink, [places.desktop, path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop')].filter(Boolean)); } catch { desktopList = []; }
      }
      const willTurnOff = net.turnedOn;
      await report({
        ...base,
        phase: interrupted ? 'interrupted' : 'done',
        time: new Date().toISOString(),
        reason: interrupted ? 'Someone used the laptop during the app test; tried again later' : undefined,
        wifi: wifiText(net, willTurnOff),
        showing: (spec.checks || []).includes('banner') ? getActivity() : undefined,
        desktop: desktopList,
        apps,
        appsNote
      });
      if (trigger === 'schedule') {
        if (interrupted) day.tries[spec.id] = { reason: 'in use', retryAt: Date.now() + 60 * 1000 };
        else day.jobs[spec.id] = { status: 'done' };
        saveToday();
      }
      await restoreWifi(net);
    } finally {
      job = null;
    }
  }

  // Every 30 seconds: Wi-Fi back off when due, and the scheduled checks whose time has come.
  async function tick() {
    const day = todayState();
    if (day.wifiOff && !job && !state.running && getIdleSeconds() >= WIFI_OFF_IDLE_S) {
      if ((await wifiState()) !== 'on' || await setWifi(false)) { day.wifiOff = false; saveToday(); }
    }
    if (job || state.running) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    for (const spec of schedule.jobs || []) {
      if (!spec || !spec.id || day.jobs[spec.id] || !(spec.days || []).includes(now.getDay())) continue;
      if (minutes < minutesOf(spec.start)) continue;
      const tried = day.tries[spec.id];
      if (minutes >= minutesOf(spec.end)) {
        // The window is over: not checked, and why.
        const reason = !tried ? 'Sales Tools was not open during the check time'
          : tried.reason === 'in use' ? 'The laptop was in use the whole time' : tried.reason;
        day.jobs[spec.id] = { status: 'missed', reason };
        saveToday();
        await report({ laptop, job: spec.id, trigger: 'schedule', date: day.date, phase: 'missed', time: now.toISOString(), reason, version });
        continue;
      }
      if (tried && tried.retryAt && Date.now() < tried.retryAt) continue;
      // Apps are tested only while nobody uses the laptop.
      if ((spec.checks || []).includes('apps') && getIdleSeconds() < (Number(schedule.idleMinutes) || 5) * 60) {
        day.tries[spec.id] = { reason: 'in use' };
        saveToday();
        continue;
      }
      await runJob(spec, 'schedule');
      return; // one check at a time
    }
  }
  let ticking = false;
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try { await tick(); } catch { /* next time */ } finally { ticking = false; }
  }, SCHEDULE_TICK_MS);

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
    stop: () => stop('laptop'),
    // Looks at the schedule now instead of at the next 30-second tick (used by tests).
    checkSchedule: () => tick()
  };
}

module.exports = { createAppCheck };
