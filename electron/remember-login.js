const fs = require('node:fs');
const { app, safeStorage } = require('electron');

// "Remember me on this laptop": the username and password, encrypted for this Windows account (they cannot be
// read on another laptop or by another Windows user), so SalesKit signs in by itself when it opens. Forgotten on
// Sign out, and when the server no longer accepts them (password changed, user removed).
// "Open when Windows starts": SalesKit is added to the Windows startup apps (on unless turned off on the login page).
function createRememberLogin({ credentialsPath, settingsPath }) {
  function save(username, password) {
    if (!safeStorage.isEncryptionAvailable()) return;
    fs.writeFileSync(credentialsPath, safeStorage.encryptString(JSON.stringify({ username, password })));
  }

  // { username, password } or null.
  function load() {
    if (!fs.existsSync(credentialsPath)) return null;
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const saved = JSON.parse(safeStorage.decryptString(fs.readFileSync(credentialsPath)));
      return saved.username && saved.password ? { username: saved.username, password: saved.password } : null;
    } catch {
      forget();
      return null;
    }
  }

  function forget() {
    fs.rmSync(credentialsPath, { force: true });
  }

  function readSettings() {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      return {};
    }
  }

  // Only the installed app is added to startup (not `npm start`, which would add Electron itself).
  function applyStartup(on) {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on });
  }

  function opensAtStartup() {
    return readSettings().openAtStartup !== false;
  }

  function setOpensAtStartup(on) {
    fs.writeFileSync(settingsPath, JSON.stringify({ ...readSettings(), openAtStartup: Boolean(on) }));
    applyStartup(Boolean(on));
  }

  // At every start: the startup entry follows the setting (on by default), also after an update or reinstall.
  applyStartup(opensAtStartup());

  return { save, load, forget, opensAtStartup, setOpensAtStartup };
}

module.exports = { createRememberLogin };
