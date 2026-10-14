const fs = require('node:fs');
const { safeStorage } = require('electron');

// When SalesKit restarts itself to install an update, the user stays signed in: the session is kept
// (encrypted for this Windows account) for the restart only, and deleted as soon as it is read.
const MAX_AGE_MS = 10 * 60 * 1000;

function createUpdateResume(filePath) {
  function save(session) {
    if (!session || !safeStorage.isEncryptionAvailable()) return;
    const payload = JSON.stringify({ key: session.key, user: session.user, savedAt: Date.now() });
    fs.writeFileSync(filePath, safeStorage.encryptString(payload));
  }

  // Returns the saved session ({ key, user }) once, or null.
  function take() {
    if (!fs.existsSync(filePath)) return null;
    try {
      const buffer = fs.readFileSync(filePath);
      fs.rmSync(filePath, { force: true });
      if (!safeStorage.isEncryptionAvailable()) return null;
      const saved = JSON.parse(safeStorage.decryptString(buffer));
      if (!saved.key || !saved.user || Date.now() - saved.savedAt > MAX_AGE_MS) return null;
      return { key: saved.key, user: saved.user };
    } catch {
      fs.rmSync(filePath, { force: true });
      return null;
    }
  }

  return { save, take };
}

module.exports = { createUpdateResume };
