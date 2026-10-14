const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');

// Keeps the GigaHertz logos on this laptop so they show the moment SalesKit opens,
// before (or without) the server data: the window icon as a PNG file, and the header and
// application logos from the image cache of the last saved data.
function createLogoCache({ userDataDir, imageCache, snapshotCache }) {
  const windowIconPath = path.join(userDataDir, 'window-icon.png');

  function loadWindowIcon() {
    try {
      const icon = fs.existsSync(windowIconPath) ? nativeImage.createFromPath(windowIconPath) : null;
      return icon && !icon.isEmpty() ? icon : null;
    } catch {
      return null;
    }
  }

  function saveWindowIcon(icon) {
    try {
      fs.writeFileSync(windowIconPath, icon.toPNG());
    } catch (error) {
      console.warn('Could not keep the window icon:', error.message);
    }
  }

  // Cached copies only (saleskit-image:// addresses), never a network address.
  async function cachedLogos() {
    const saved = snapshotCache && snapshotCache.load();
    const local = async (url) => {
      const resolved = url ? await imageCache.resolve(url) : '';
      return String(resolved || '').startsWith('saleskit-image://') ? resolved : '';
    };
    return {
      header: await local(saved && saved.headerLogoUrl),
      application: await local(saved && saved.applicationLogoUrl)
    };
  }

  return { loadWindowIcon, saveWindowIcon, cachedLogos };
}

module.exports = { createLogoCache };
