// SalesKit Server updates itself from the same GitHub releases as SalesKit, through its own "server" channel
// (server.yml beside SalesKit's latest.yml). A new version downloads in the background; it installs when
// "Restart and update" is clicked, by itself at night (11 PM–5 AM, when no sync is running), or when the server
// is quit. The installer runs silently and starts the server again; settings and data in AppData are kept.
const { app } = require('electron');

const CHANNEL = 'server';
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const NIGHT_POLL_MS = 60 * 1000;
const NIGHT_START_HOUR = 23;
const NIGHT_END_HOUR = 5;

function isNight(date = new Date()) {
  const hour = date.getHours();
  return hour >= NIGHT_START_HOUR || hour < NIGHT_END_HOUR;
}

// onStatus(status): the Updates tab and tray follow it. canInstall(): false while a restart would cut something
// short (a sync). beforeInstall(): runs right before the server closes to install. log(level, message).
function createServerUpdater({ onStatus = () => {}, canInstall = () => true, beforeInstall = () => {}, log = () => {} } = {}) {
  // state: 'disabled' (not installed: npm start) | 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  let status = { state: 'disabled', current: app.getVersion(), version: null, percent: 0, checkedAt: null, error: '' };
  let autoUpdater = null;
  let timers = [];

  function setStatus(changes) {
    status = { ...status, ...changes };
    onStatus(status);
  }

  function checkNow() {
    if (!autoUpdater || ['checking', 'downloading', 'ready'].includes(status.state)) return status;
    setStatus({ state: 'checking', error: '' });
    autoUpdater.checkForUpdates().catch(() => {}); // reported through the 'error' event
    return status;
  }

  function installNow(reason = 'Restart and update') {
    if (!autoUpdater || status.state !== 'ready') return false;
    log('info', `Installing SalesKit Server ${status.version} (${reason}). The server restarts in a moment.`);
    try { beforeInstall(); } catch {}
    // Silent install, then start the server again.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  }

  function start() {
    if (!app.isPackaged) {
      setStatus({ state: 'disabled' });
      return;
    }
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.channel = CHANNEL;
    // Setting a channel allows downgrades; never go back to an older server.
    autoUpdater.allowDowngrade = false;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;

    autoUpdater.on('update-not-available', (info) => setStatus({
      state: 'idle', version: info && info.version, checkedAt: new Date().toISOString(), error: ''
    }));
    autoUpdater.on('update-available', (info) => {
      log('info', `SalesKit Server ${info.version} is available. Downloading…`);
      setStatus({ state: 'downloading', version: info.version, percent: 0, checkedAt: new Date().toISOString(), error: '' });
    });
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent || 0);
      if (status.state === 'downloading' && percent !== status.percent) setStatus({ percent });
    });
    autoUpdater.on('update-downloaded', (info) => {
      log('success', `SalesKit Server ${info.version} is ready. It installs tonight, or click Restart and update.`);
      setStatus({ state: 'ready', version: info.version, percent: 100 });
    });
    autoUpdater.on('error', (error) => {
      // A finished download stays installable; otherwise show the error and try again at the next check.
      if (status.state === 'ready') return;
      const message = /server\.yml/i.test(error.message || '')
        ? 'The newest GitHub release has no server update.'
        : (error.message || String(error)).split('\n')[0];
      setStatus({ state: 'error', error: message, checkedAt: new Date().toISOString() });
    });

    setStatus({ state: 'idle' });
    checkNow();
    timers = [
      setInterval(checkNow, CHECK_INTERVAL_MS),
      setInterval(() => {
        if (status.state === 'ready' && isNight() && canInstall()) installNow('night-time install');
      }, NIGHT_POLL_MS)
    ];
  }

  function stop() {
    timers.forEach(clearInterval);
    timers = [];
  }

  return { start, stop, checkNow, installNow, get: () => status };
}

module.exports = { createServerUpdater };
