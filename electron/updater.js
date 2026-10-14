const { app, powerMonitor } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
// When the server announces a newer release, ask GitHub at most this often.
const ANNOUNCED_CHECK_MIN_GAP_MS = 5 * 60 * 1000;
// A downloaded update installs by itself once nobody has used the laptop for this long.
const IDLE_INSTALL_SECONDS = 10 * 60;
const IDLE_POLL_MS = 60 * 1000;

// Latest update state, shown in the window: { state: 'idle' | 'downloading' | 'ready', version, percent }.
let status = { state: 'idle' };
let sendStatus = () => {};
let beforeInstall = () => {};
let lastCheckAt = 0;
let idleTimer = null;

function setStatus(next) {
  status = next;
  sendStatus(status);
  if (status.state === 'ready') watchForIdle();
}

// True when version a (like "1.0.6") is newer than b.
function isNewer(a, b) {
  const parts = (value) => String(value || '').split(/[.+-]/).slice(0, 3).map((part) => parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i += 1) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

function check() {
  if (status.state !== 'idle') return;
  lastCheckAt = Date.now();
  autoUpdater.checkForUpdates().catch((error) => console.error('Update check failed:', error.message));
}

// Downloads new GitHub releases in the background. The window offers "Update now"; if nobody clicks it,
// the update installs after 10 minutes without use, or when the app is closed.
// options.onBeforeInstall runs right before SalesKit closes to install.
function startAutoUpdates(onStatus, options = {}) {
  if (typeof onStatus === 'function') sendStatus = onStatus;
  if (typeof options.onBeforeInstall === 'function') beforeInstall = options.onBeforeInstall;
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (progress) => {
    if (status.state === 'downloading') setStatus({ ...status, percent: Math.round(progress.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => setStatus({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (error) => {
    console.error('Auto-update failed:', error.message);
    // Keep a finished download installable; otherwise go back to idle and try again at the next check.
    if (status.state !== 'ready') setStatus({ state: 'idle' });
  });

  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

// The SalesKit Server names the newest release in its 2-minute check; start downloading it right away.
function noticeLatestVersion(latestVersion) {
  if (!app.isPackaged || !isNewer(latestVersion, app.getVersion())) return;
  if (Date.now() - lastCheckAt < ANNOUNCED_CHECK_MIN_GAP_MS) return;
  check();
}

function watchForIdle() {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    if (status.state !== 'ready') return;
    // Keyboard and mouse idle time for the whole laptop, so a salesperson using SalesKit is never interrupted.
    if (powerMonitor.getSystemIdleTime() >= IDLE_INSTALL_SECONDS) installUpdateNow();
  }, IDLE_POLL_MS);
}

function getUpdateStatus() {
  return status;
}

// Closes SalesKit, installs the downloaded update without prompts, and opens SalesKit again.
function installUpdateNow() {
  if (status.state !== 'ready') return false;
  clearInterval(idleTimer);
  idleTimer = null;
  try {
    beforeInstall();
  } catch (error) {
    console.error('Preparing for the update failed:', error.message);
  }
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

module.exports = { startAutoUpdates, getUpdateStatus, installUpdateNow, noticeLatestVersion, isNewer };
