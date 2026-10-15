// GigaHertz SalesKit Server: syncs Google Sheets into SQLite and shares the data with SalesKit clients on the LAN.
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, net, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const database = require('../electron/database');
const { DEFAULT_SPREADSHEET_ID, fetchSpreadsheetData } = require('../electron/sheets-sync');
const { createLocalApi } = require('../electron/local-api');
const { createDeviceRegistry, deviceKey } = require('./devices');
const { createActivityLog } = require('./activity');
const { createBackupStore } = require('./backups');
const { createUserStore } = require('./users');
const { hasFullAccess, filterDataForBranch, withHomeBranch } = require('./branch-filter');
const { createClientReleaseWatcher } = require('./client-release');
const { createCompressedData } = require('./compressed-data');
const { version: APP_VERSION } = require('../package.json');

const APP_NAME = 'GigaHertz SalesKit Server';
const DEFAULT_PORT = 3000;
const MAX_LOG_ENTRIES = 300;
const startHidden = process.argv.includes('--hidden');

// Keep the server's settings and database apart from the SalesKit client's.
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));

// On first run the server adopts the token the clients were built with.
let embedded = {};
try {
  embedded = require('../electron/embedded-config.json');
} catch {}

let settings;
let mainWindow = null;
let tray = null;
let api = null;
let apiError = '';
let activeSync = null;
let syncProgress = null;
let syncTimer = null;
let nextSyncAt = null;
let quitting = false;
let trayHintShown = false;
let devices;
let backups;
let users;
let devicesPushTimer = null;
let headerLogo = '';
let clientRelease;
let activity;
const logs = [];

// ---------- Settings ----------

function settingsPath() {
  return path.join(app.getPath('userData'), 'server-settings.json');
}

// Reuse the Google key the SalesKit app was set up with before the server existed.
function legacyServiceAccountPath() {
  const candidates = [process.env.GOOGLE_APPLICATION_CREDENTIALS];
  for (const folder of ['saleskit-desktop', 'GigaHertz SalesKit']) {
    try {
      const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), folder, 'settings.json'), 'utf8'));
      candidates.push(saved.serviceAccountPath);
    } catch {}
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || '';
}

function loadSettings() {
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {}

  const loaded = {
    serviceAccountPath: saved?.serviceAccountPath || legacyServiceAccountPath(),
    spreadsheetId: saved?.spreadsheetId || process.env.SALESKIT_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID,
    syncIntervalMinutes: Number(saved?.syncIntervalMinutes) || 15,
    port: Number(saved?.port) || DEFAULT_PORT,
    token: saved?.token || embedded.serverToken || crypto.randomBytes(24).toString('hex'),
    autoStart: saved?.autoStart !== false,
    lastSync: saved?.lastSync || null,
    dataVersion: Number(saved?.dataVersion) || 1,
    dataUpdatedAt: saved?.dataUpdatedAt || null,
    allowWithoutLogin: saved?.allowWithoutLogin !== false
  };
  if (!saved) writeSettings(loaded);
  return loaded;
}

function writeSettings(value = settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(value, null, 2), 'utf8');
}

// ---------- Activity log & state ----------

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function log(level, message) {
  const entry = { time: new Date().toISOString(), level, message };
  logs.push(entry);
  if (logs.length > MAX_LOG_ENTRIES) logs.shift();
  send('server:log', entry);
}

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.'))
    .map((item) => item.address);
}

function maskToken(token) {
  return token.length > 10 ? `${token.slice(0, 4)}••••••••${token.slice(-4)}` : '••••••••';
}

function getState() {
  let tables = [];
  try {
    tables = database.listTables();
  } catch {}
  return {
    version: APP_VERSION,
    running: Boolean(api && api.listening),
    apiError,
    port: settings.port,
    addresses: lanAddresses().map((ip) => `http://${ip}:${settings.port}`),
    tokenPreview: maskToken(settings.token),
    serviceAccountPath: settings.serviceAccountPath,
    spreadsheetId: settings.spreadsheetId,
    syncIntervalMinutes: settings.syncIntervalMinutes,
    autoStart: settings.autoStart,
    syncing: Boolean(activeSync),
    syncProgress,
    lastSync: settings.lastSync,
    nextSyncAt,
    database: { path: database.getStatus().path, tables },
    dataVersion: settings.dataVersion,
    dataUpdatedAt: settings.dataUpdatedAt,
    backups: backups ? backups.list() : [],
    onlineDevices: devices ? devices.list().filter((device) => device.online).length : 0,
    rejectedCount: devices ? devices.rejectedList().length : 0,
    userCount: users ? users.list().length : 0,
    allowWithoutLogin: settings.allowWithoutLogin,
    clientRelease: clientRelease ? clientReleaseSummary() : null
  };
}

// The newest SalesKit on GitHub, and how many online laptops already run it.
function clientReleaseSummary() {
  const latest = clientRelease.get();
  const seen = devices ? devices.list().filter((device) => device.online && device.version) : [];
  return {
    ...latest,
    deviceCount: seen.length,
    upToDate: latest.version ? seen.filter((device) => device.version === latest.version).length : 0
  };
}

function bumpDataVersion() {
  settings.dataVersion += 1;
  settings.dataUpdatedAt = new Date().toISOString();
  writeSettings();
}

// Each device with what it is showing now ("Showing now" on the Devices tab).
function devicesWithActivity() {
  return devices.list().map((device) => ({ ...device, showing: activity ? activity.liveFor(device.key) : null }));
}

// Device updates can arrive many times a second; send the list at most once a second.
function pushDevices() {
  if (devicesPushTimer) return;
  devicesPushTimer = setTimeout(() => {
    devicesPushTimer = null;
    send('server:devices', devicesWithActivity());
  }, 1000);
}

// ---------- Logos (from the LOGO sheet, like SalesKit) ----------

// Downloads a logo, keeping a copy so it still shows when the server is offline.
async function fetchLogo(url, cacheName) {
  const cachePath = path.join(app.getPath('userData'), 'logos', cacheName);
  if (/^https?:\/\//i.test(url || '')) {
    try {
      const response = await net.fetch(url, { signal: AbortSignal.timeout(15000) });
      const type = response.headers.get('content-type') || '';
      if (response.ok && type.startsWith('image/')) {
        const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
        if (!image.isEmpty()) {
          fs.mkdirSync(path.dirname(cachePath), { recursive: true });
          fs.writeFileSync(cachePath, image.toPNG());
          return image;
        }
      }
    } catch {}
  }
  const cached = fs.existsSync(cachePath) ? nativeImage.createFromPath(cachePath) : null;
  return cached && !cached.isEmpty() ? cached : null;
}

async function loadLogos() {
  let urls = {};
  try {
    urls = database.getInitialData();
  } catch {}
  const [appLogo, header] = await Promise.all([
    fetchLogo(urls.applicationLogoUrl, 'application.png'),
    fetchLogo(urls.headerLogoUrl, 'header.png')
  ]);
  if (appLogo) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setIcon(appLogo);
    if (tray) tray.setImage(appLogo.resize({ width: 16, height: 16, quality: 'best' }));
  }
  // The header logo is very large; shrink it before handing it to the dashboard.
  headerLogo = header ? header.resize({ height: 96, quality: 'best' }).toDataURL() : '';
  send('server:logos', { header: headerLogo });
}

function pushState() {
  send('server:state', getState());
  updateTrayMenu();
}

// ---------- Network API ----------

async function startApi() {
  await stopApi();
  apiError = '';
  // One full data object per data version; each branch's (compressed) copy is made from it.
  let fullData = null;
  let fullDataVersion = null;
  const payloads = createCompressedData({
    getDataVersion: () => settings.dataVersion,
    scopeOf: (user) => (!user || hasFullAccess(user.branch) ? 'ALL' : String(user.branch).trim().toUpperCase()),
    build: (scope, { branchModes } = {}) => {
      if (fullDataVersion !== settings.dataVersion || !fullData) {
        fullData = database.getInitialData();
        fullDataVersion = settings.dataVersion;
      }
      if (scope === 'ALL') return fullData;
      // 1.0.11+ locks the branch inside the app; older SalesKit only gets its own branch's stock.
      return branchModes ? withHomeBranch(fullData, scope) : filterDataForBranch(fullData, scope);
    }
  });
  const server = createLocalApi({
    database,
    token: settings.token,
    getDataVersion: () => settings.dataVersion,
    getInitialPayload: (user, options) => payloads.get(user, options),
    onActivity: ({ user, address, client, activity: report }) => {
      if (activity && activity.record(deviceKey(address, client), user, report)) pushDevices();
    },
    getLatestClientVersion: () => clientRelease.get().version,
    accounts: {
      login: (username, password, address) => users.login(username, password, address),
      logout: (key) => users.logout(key),
      userForSession: (key) => users.userForSession(key),
      allowWithoutLogin: () => settings.allowWithoutLogin,
      // Branch-locked users only receive their own branch's stock. (Older SalesKit without login
      // still gets everything while the transition switch is on.)
      prepareInitialData: (data, user) => (user ? filterDataForBranch(data, user.branch) : data),
      canBrowseTables: (user) => !user || hasFullAccess(user.branch)
    },
    onRequest: (request) => {
      const { method, path: pathname, status, address, client, user, denied } = request;
      const ip = address.replace(/^::ffff:/, '');
      const who = user
        ? `${user.displayName} (${user.branch}) on ${client.name || ip}`
        : client.name ? `${client.name} (${ip})` : ip;
      if (devices.record({ ...request, dataVersion: settings.dataVersion })) log('info', `New device: ${who}`);
      pushDevices();
      if (pathname === '/api/login') {
        if (status === 200) log('success', `${who} signed in`);
        else if (status === 429) log('warning', `Login locked for 15 minutes on ${client.name || ip} (too many wrong passwords)`);
        else if (denied !== 'token') log('warning', `Failed login on ${client.name || ip}`);
      }
      if (denied === 'token') log('warning', `Rejected ${who}: wrong or missing token`);
      else if (denied === 'login') {
        if (pathname !== '/api/version') log('warning', `${who} needs to log in (older SalesKit or signed out)`);
      }
      // Clients poll /api/version every few minutes; keep those out of the activity log.
      else if (pathname !== '/api/version' && pathname !== '/api/login' && pathname !== '/api/activity') {
        log(status < 400 ? 'request' : 'error', `${who} ${method} ${pathname} → ${status}`);
      }
    }
  });
  server.on('error', (error) => {
    apiError = error.code === 'EADDRINUSE'
      ? `Port ${settings.port} is already in use. Close the other program or choose another port.`
      : error.message;
    log('error', `Could not share data: ${apiError}`);
    pushState();
  });
  server.listen(settings.port, '0.0.0.0', () => {
    log('success', `Sharing data with SalesKit clients on port ${settings.port}`);
    pushState();
  });
  api = server;
}

function stopApi() {
  if (!api) return Promise.resolve();
  const server = api;
  api = null;
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}

// ---------- Google Sheets sync ----------

function syncNow(reason = 'manual') {
  if (activeSync) return activeSync;
  activeSync = runSync(reason).finally(() => {
    activeSync = null;
    syncProgress = null;
    pushState();
  });
  pushState();
  return activeSync;
}

async function runSync(reason) {
  const startedAt = Date.now();
  const finish = (result) => {
    settings.lastSync = { at: new Date().toISOString(), durationMs: Date.now() - startedAt, ...result };
    writeSettings();
    return settings.lastSync;
  };

  if (!settings.serviceAccountPath || !fs.existsSync(settings.serviceAccountPath)) {
    log('error', 'Sync skipped: choose the Google service-account key file first.');
    return finish({ ok: false, error: 'Choose the Google service-account key file first.' });
  }

  log('info', reason === 'schedule' ? 'Scheduled sync started' : reason === 'startup' ? 'Startup sync started' : 'Sync started');
  try {
    const sheets = await fetchSpreadsheetData({
      credentialsPath: settings.serviceAccountPath,
      spreadsheetId: settings.spreadsheetId
    }, (progress) => {
      syncProgress = progress;
      send('server:sync-progress', progress);
    });
    syncProgress = { phase: 'sqlite', message: 'Updating the database…' };
    send('server:sync-progress', syncProgress);
    const backup = await backups.snapshot('before-sync');
    let summary;
    try {
      summary = database.replaceSheetsData(sheets);
    } catch (error) {
      backup.discard();
      throw error;
    }
    if (summary.changed) {
      backup.keep();
      bumpDataVersion();
      loadLogos();
    } else {
      backup.discard();
    }
    log('success', summary.changed
      ? `Sync finished: ${summary.updatedCount} rows updated, ${summary.deletedCount} removed`
      : 'Sync finished: no changes');
    return finish({ ok: true, changed: summary.changed, updatedCount: summary.updatedCount, deletedCount: summary.deletedCount });
  } catch (error) {
    log('error', `Sync failed: ${error.message}`);
    return finish({ ok: false, error: error.message });
  }
}

function scheduleSync() {
  clearInterval(syncTimer);
  const intervalMs = settings.syncIntervalMinutes * 60 * 1000;
  nextSyncAt = new Date(Date.now() + intervalMs).toISOString();
  syncTimer = setInterval(() => {
    nextSyncAt = new Date(Date.now() + intervalMs).toISOString();
    syncNow('schedule');
  }, intervalMs);
}

// ---------- Window & tray ----------

// A small blue dot, drawn in code so the app needs no image files.
function createAppIcon(size = 32) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      const alpha = Math.max(0, Math.min(1, size / 2 - distance));
      const offset = (y * size + x) * 4;
      const ring = distance > size * 0.28;
      pixels[offset] = ring ? 0xe6 : 0xff; // B
      pixels[offset + 1] = ring ? 0x5b : 0xff; // G
      pixels[offset + 2] = ring ? 0x1f : 0xff; // R
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: size, height: size });
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    icon: createAppIcon(64),
    backgroundColor: '#f1f5fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  // Closing the window keeps the server running in the tray.
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!trayHintShown && tray) {
      trayHintShown = true;
      tray.displayBalloon({
        title: APP_NAME,
        content: 'The server is still running. Use the tray icon to open it or quit.'
      });
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const running = Boolean(api && api.listening);
  tray.setToolTip(`${APP_NAME} — ${running ? `running on port ${settings.port}` : 'stopped'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: running ? `Running on port ${settings.port}` : 'Not sharing data', enabled: false },
    { type: 'separator' },
    { label: 'Open dashboard', click: showWindow },
    { label: activeSync ? 'Syncing…' : 'Sync now', enabled: !activeSync, click: () => syncNow() },
    { type: 'separator' },
    { label: 'Quit server', click: () => app.quit() }
  ]));
}

function createTray() {
  tray = new Tray(createAppIcon(16));
  tray.on('click', showWindow);
  updateTrayMenu();
}

function applyAutoStart() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.autoStart, args: ['--hidden'] });
}

// ---------- Database ----------

function openServerDatabase() {
  const databasePath = app.isPackaged
    ? path.join(app.getPath('userData'), 'mydata.db')
    : path.join(__dirname, '..', 'mydata.db');
  const bundledPath = path.join(process.resourcesPath, 'mydata.db');
  if (app.isPackaged && !fs.existsSync(databasePath) && fs.existsSync(bundledPath)) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    fs.copyFileSync(bundledPath, databasePath);
  }
  database.openDatabase(process.env.SALESKIT_DB_PATH || databasePath, { create: true });
  log('info', `Database opened: ${database.getStatus().path}`);
}

// ---------- Dashboard requests ----------

ipcMain.handle('server:get-state', () => getState());
ipcMain.handle('server:get-logs', () => logs);
ipcMain.handle('server:get-logos', () => ({ header: headerLogo }));
ipcMain.handle('server:check-client-release', async () => {
  await clientRelease.checkNow();
  return getState();
});
ipcMain.handle('server:sync-now', async () => {
  await syncNow();
  return getState();
});

ipcMain.handle('server:choose-key', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the Google service-account key',
    properties: ['openFile'],
    filters: [{ name: 'Service-account key', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return getState();

  const keyPath = result.filePaths[0];
  let key;
  try {
    key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } catch {
    throw new Error('That file is not a valid JSON key file.');
  }
  if (key.type !== 'service_account' || !key.client_email) {
    throw new Error('That file is not a Google service-account key.');
  }
  settings.serviceAccountPath = keyPath;
  writeSettings();
  log('info', `Google key set: ${key.client_email}`);
  pushState();
  return getState();
});

ipcMain.handle('server:update-settings', async (_event, changes = {}) => {
  const previous = { ...settings };
  if (changes.spreadsheetId !== undefined) {
    const id = String(changes.spreadsheetId).trim();
    if (!/^[\w-]{20,}$/.test(id)) throw new Error('Enter a valid spreadsheet ID.');
    settings.spreadsheetId = id;
  }
  if (changes.syncIntervalMinutes !== undefined) {
    const minutes = Number(changes.syncIntervalMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Sync interval must be 1–1440 minutes.');
    settings.syncIntervalMinutes = minutes;
  }
  if (changes.port !== undefined) {
    const port = Number(changes.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be between 1024 and 65535.');
    settings.port = port;
  }
  if (changes.autoStart !== undefined) settings.autoStart = Boolean(changes.autoStart);
  if (changes.allowWithoutLogin !== undefined) {
    settings.allowWithoutLogin = Boolean(changes.allowWithoutLogin);
    log('warning', settings.allowWithoutLogin
      ? 'SalesKit without login is allowed again (older versions can connect).'
      : 'Login is now required for every SalesKit laptop.');
  }
  writeSettings();

  if (settings.port !== previous.port) {
    log('warning', `Port changed to ${settings.port}. Clients must be rebuilt with the new address.`);
    await startApi();
  }
  if (settings.syncIntervalMinutes !== previous.syncIntervalMinutes) scheduleSync();
  if (settings.autoStart !== previous.autoStart) applyAutoStart();
  if (settings.spreadsheetId !== previous.spreadsheetId) log('info', 'Spreadsheet ID updated.');
  pushState();
  return getState();
});

ipcMain.handle('server:copy-token', () => {
  clipboard.writeText(settings.token);
  return true;
});

ipcMain.handle('server:copy-text', (_event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

// The JSON for the client's electron/embedded-config.json. Clients try each address in order.
ipcMain.handle('server:copy-client-config', (_event, address) => {
  const addresses = getState().addresses;
  const preferred = typeof address === 'string' && address ? address : addresses[0] || `http://SERVER-IP:${settings.port}`;
  const serverUrls = [...new Set([preferred, ...addresses, `http://${os.hostname()}:${settings.port}`])];
  clipboard.writeText(JSON.stringify({ serverUrl: preferred, serverUrls, serverToken: settings.token }, null, 2));
  return true;
});

// ---------- Data viewer, devices & backups ----------

ipcMain.handle('server:table-data', (_event, tableName, options = {}) => database.getTableData(tableName, options));

ipcMain.handle('server:get-devices', () => devicesWithActivity());
ipcMain.handle('server:get-activity-summary', (_event, days) => (activity ? activity.summary(Number(days) || 30) : null));
ipcMain.handle('server:get-rejected', () => devices.rejectedList());
ipcMain.handle('server:clear-rejected', () => {
  devices.clearRejected();
  pushState();
  return [];
});

// ---------- Users ----------

function userAction(action) {
  const result = action();
  pushState();
  return result === undefined ? users.list() : result;
}

ipcMain.handle('server:get-users', () => users.list());
ipcMain.handle('server:get-branches', () => database.listBranches());
ipcMain.handle('server:create-user', (_event, details) => userAction(() => {
  const user = users.create(details || {});
  log('success', `User added: ${user.displayName} (${user.username}, ${user.branch})`);
  return users.list();
}));
ipcMain.handle('server:update-user', (_event, username, changes) => userAction(() => {
  const user = users.update(username, changes || {});
  if (changes && changes.disabled !== undefined) log('warning', `User ${user.username} ${user.disabled ? 'disabled and signed out' : 'enabled'}`);
  return users.list();
}));
ipcMain.handle('server:set-user-password', (_event, username, password) => userAction(() => {
  users.setPassword(username, password);
  log('info', `Password changed for ${username}; their SalesKit asks them to log in again`);
  return users.list();
}));
ipcMain.handle('server:sign-out-user', (_event, username) => userAction(() => {
  users.signOut(String(username));
  log('info', `${username} was signed out`);
  return users.list();
}));
ipcMain.handle('server:remove-user', (_event, username) => userAction(() => {
  users.remove(username);
  log('warning', `User removed: ${username}`);
  return users.list();
}));

ipcMain.handle('server:forget-device', (_event, key) => {
  devices.forget(String(key));
  return devicesWithActivity();
});

ipcMain.handle('server:backup-now', async () => {
  const name = await backups.create('manual');
  log('success', `Backup saved: ${name}`);
  pushState();
  return getState();
});

ipcMain.handle('server:restore-backup', async (_event, name) => {
  if (activeSync) throw new Error('Wait for the current sync to finish.');
  const source = backups.filePath(name);
  const databasePath = database.getStatus().path;
  await backups.create('before-restore');
  database.closeDatabase();
  try {
    fs.copyFileSync(source, databasePath);
  } finally {
    database.openDatabase(databasePath);
  }
  users.reload();
  bumpDataVersion();
  log('warning', `Database restored from ${name}. Clients will reload it automatically.`);
  pushState();
  return getState();
});

ipcMain.handle('server:open-backups-folder', () => {
  const folder = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(folder, { recursive: true });
  return shell.openPath(folder);
});

ipcMain.handle('server:new-token', async () => {
  settings.token = crypto.randomBytes(24).toString('hex');
  writeSettings();
  log('warning', 'New token created. Existing clients are locked out until they are rebuilt with it.');
  await startApi();
  return getState();
});

// ---------- Startup ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    settings = loadSettings();
    devices = createDeviceRegistry(path.join(app.getPath('userData'), 'devices.json'));
    try {
      activity = createActivityLog(path.join(app.getPath('userData'), 'activity.db'));
    } catch (error) {
      log('error', `Could not open the activity history: ${error.message}`);
    }
    clientRelease = createClientReleaseWatcher({
      fetchImpl: net.fetch,
      onChange: (latest) => {
        log('info', `Newest SalesKit release: v${latest.version}. Open laptops will start updating.`);
        pushState();
      }
    });
    clientRelease.start();
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    applyAutoStart();

    try {
      openServerDatabase();
      users = createUserStore(database, { legacyFile: path.join(app.getPath('userData'), 'users.json') });
      backups = createBackupStore(path.join(app.getPath('userData'), 'backups'), database);
      startApi();
      loadLogos();
    } catch (error) {
      apiError = error.message;
      log('error', `Could not start the server: ${error.message}`);
    }
    scheduleSync();
    if (settings.serviceAccountPath) syncNow('startup');
    pushState();
  });

  app.on('before-quit', () => {
    quitting = true;
    clearInterval(syncTimer);
    if (clientRelease) clientRelease.stop();
    if (activity) activity.close();
    stopApi();
    database.closeDatabase();
  });
  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => {});
}
