// Remembers the SalesKit laptops that talk to the server: who they are, from where, and when last seen.
const fs = require('node:fs');
const path = require('node:path');

// Clients check in every 2 minutes, so anything seen within 5 minutes counts as online.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function createDeviceRegistry(filePath) {
  let devices = {};
  try {
    devices = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
  } catch {}

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify(devices, null, 2), 'utf8');
      } catch {}
    }, 2000);
  }

  // Returns true when this is a device the server has not seen before.
  // dataVersion: the server's data version at the time of the request.
  function record({ address, client = {}, path: pathname, status, dataVersion = null }) {
    const ip = String(address || '').replace(/^::ffff:/, '');
    const key = client.name ? `name:${client.name.toLowerCase()}` : `ip:${ip}`;
    const now = new Date().toISOString();
    const isNew = !devices[key];
    const device = devices[key] || { key, firstSeen: now, requests: 0 };
    Object.assign(device, {
      name: client.name || device.name || '',
      user: client.user || device.user || '',
      version: client.version || device.version || '',
      address: ip,
      lastSeen: now,
      lastPath: pathname,
      lastStatus: status,
      authorized: status !== 401,
      requests: device.requests + 1
    });
    // A successful data download is a refresh: remember when, and which data version it got.
    if (pathname === '/api/initial-data' && status === 200) {
      device.lastRefresh = now;
      device.lastRefreshVersion = dataVersion;
    }
    devices[key] = device;
    scheduleSave();
    return isNew;
  }

  function list() {
    const now = Date.now();
    return Object.values(devices)
      .map((device) => ({ ...device, online: now - new Date(device.lastSeen).getTime() < ONLINE_WINDOW_MS }))
      .sort((a, b) => (b.online - a.online) || b.lastSeen.localeCompare(a.lastSeen));
  }

  function forget(key) {
    delete devices[key];
    scheduleSave();
  }

  return { record, list, forget };
}

module.exports = { createDeviceRegistry };
