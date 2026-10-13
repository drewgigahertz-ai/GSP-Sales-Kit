const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

// Latest update state, shown in the window: { state: 'idle' | 'downloading' | 'ready', version, percent }.
let status = { state: 'idle' };
let sendStatus = () => {};

function setStatus(next) {
  status = next;
  sendStatus(status);
}

// Downloads new GitHub releases in the background. The window offers "Update now";
// otherwise the update installs silently when the app is closed.
function startAutoUpdates(onStatus) {
  if (typeof onStatus === 'function') sendStatus = onStatus;
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

  const check = () => {
    if (status.state !== 'idle') return;
    autoUpdater.checkForUpdates().catch((error) => console.error('Update check failed:', error.message));
  };
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

function getUpdateStatus() {
  return status;
}

// Closes SalesKit, installs the downloaded update without prompts, and opens SalesKit again.
function installUpdateNow() {
  if (status.state !== 'ready') return false;
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return true;
}

module.exports = { startAutoUpdates, getUpdateStatus, installUpdateNow };
