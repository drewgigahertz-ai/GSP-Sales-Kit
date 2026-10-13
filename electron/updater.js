const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

// Downloads new GitHub releases in the background; they install silently when the app is closed.
function startAutoUpdates() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', (info) => {
    console.log(`SalesKit ${info.version} downloaded; it will install when the app closes.`);
  });
  autoUpdater.on('error', (error) => console.error('Auto-update failed:', error.message));

  const check = () => autoUpdater.checkForUpdates().catch((error) => {
    console.error('Update check failed:', error.message);
  });
  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

module.exports = { startAutoUpdates };
