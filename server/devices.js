// Remembers the SalesKit laptops that talk to the server: who is signed in, from which branch, which laptop,
// and when it was last seen. Requests that are not from SalesKit (internet scanners) are only counted.
const fs = require('node:fs');
const path = require('node:path');

// Clients check in every 2 minutes, so anything seen within 5 minutes counts as online.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;

// SalesKit 1.0.1 and older do not send a computer name; they are known by IP address.
function deviceKey(address, client = {}) {
  const ip = String(address || '').replace(/^::ffff:/, '');
  return client.name ? `name:${client.name.toLowerCase()}` : `ip:${ip}`;
}

function createDeviceRegistry(filePath) {
  let devices = {};
  let rejected = {};
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
    if (saved.devices) {
      devices = saved.devices;
      rejected = saved.rejected || {};
    } else {
      // Older file: one flat list. Drop entries that were only ever refused (scanners).
      devices = Object.fromEntries(Object.entries(saved).filter(([, device]) => device && (device.name || device.authorized)));
    }
  } catch {}

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ devices, rejected }, null, 2), 'utf8');
      } catch {}
    }, 2000);
  }

  // Returns true when this is a SalesKit laptop the server has not seen before.
  // user: the signed-in account ({ username, displayName, branch }) or null.
  // dataVersion: the server's data version at the time of the request.
  // denied: 'token' (wrong app key) or 'login' (not signed in), from the API.
  function record({ address, client = {}, user = null, denied = null, path: pathname, status, dataVersion = null }) {
    const ip = String(address || '').replace(/^::ffff:/, '');
    const now = new Date().toISOString();

    // Refused and no SalesKit identity: an internet scanner or other stray request.
    if (!client.name && denied === 'token') {
      const entry = rejected[ip] || { address: ip, firstSeen: now, requests: 0 };
      Object.assign(entry, { lastSeen: now, lastPath: pathname, requests: entry.requests + 1 });
      rejected[ip] = entry;
      scheduleSave();
      return false;
    }

    const key = deviceKey(address, client);
    const isNew = !devices[key];
    const device = devices[key] || { key, firstSeen: now, requests: 0 };
    Object.assign(device, {
      name: client.name || device.name || '',
      user: client.user || device.user || '',
      version: client.version || device.version || '',
      make: client.make || device.make || '',
      model: client.model || device.model || '',
      address: ip,
      lastSeen: now,
      lastPath: pathname,
      lastStatus: status,
      authorized: denied !== 'token',
      needsLogin: denied === 'login',
      requests: device.requests + 1
    });
    if (user) {
      device.account = { username: user.username, displayName: user.displayName, branch: user.branch };
      if (pathname === '/api/login') device.lastLogin = now;
    }
    // A successful data download is a refresh: remember when, and which data version it got.
    // (304: the laptop already had this data.)
    if (pathname === '/api/initial-data' && (status === 200 || status === 304)) {
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

  function rejectedList() {
    return Object.values(rejected).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  }

  function forget(key) {
    delete devices[key];
    scheduleSave();
  }

  function clearRejected() {
    rejected = {};
    scheduleSave();
  }

  return { record, list, rejectedList, forget, clearRejected };
}

module.exports = { createDeviceRegistry, deviceKey };
