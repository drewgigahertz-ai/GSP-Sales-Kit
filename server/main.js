// GigaHertz SalesKit Server: syncs Google Sheets into SQLite and shares the data with SalesKit clients on the LAN.
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, ipcMain, nativeImage, net, safeStorage, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const database = require('../electron/database');
const { DEFAULT_SPREADSHEET_ID, DEFAULT_PRICING_SPREADSHEET_ID, fetchSpreadsheetData, fetchSheetValues, fetchPriceMatrixValues, fetchRangesValues, fetchSheetTitles } = require('../electron/sheets-sync');
const { RECO_DB_SHEET, RECO_DB_RANGE } = require('../electron/reco-db');
const { LAPTOP_DATABASE_SHEET, LAPTOP_DATABASE_RANGE } = require('../electron/laptop-database');
const { createRecoWatch } = require('./reco-watch');
const { DEFAULT_PRICE_MATRIX_SPREADSHEET_ID } = require('../electron/price-matrix');
const { createLocalApi } = require('../electron/local-api');
const { createDeviceRegistry, deviceKey } = require('./devices');
const { createActivityLog } = require('./activity');
const { createBackupStore } = require('./backups');
const { createUserStore } = require('./users');
const { hasFullAccess, filterDataForBranch, withHomeBranch } = require('./branch-filter');
const { createClientReleaseWatcher } = require('./client-release');
const { createCompressedData } = require('./compressed-data');
const { createPriceWatch } = require('./price-watch');
const { createServerUpdater } = require('./updater');
const { buildDataHealth } = require('./data-health');
const { createAppCheck } = require('./app-check');
const { createWebAdmin } = require('./web-admin');
const { skuChoices, skuKey } = require('../electron/laptop-sku');
const { readInventoryCsv } = require('../electron/inventory-csv');
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
// Branch stock from the inventory CSV on Z: (electron/inventory-csv.js): read on every sync and every hour.
let inventoryTimer = null;
// The last read: { ok, file, asOf, laptops, branches, checkedAt } or { ok: false, error, checkedAt } (dashboard).
let inventoryStatus = null;
const INVENTORY_CHECK_MS = 60 * 60 * 1000;
let nextSyncAt = null;
let quitting = false;
let trayHintShown = false;
let devices;
let backups;
let users;
let devicesPushTimer = null;
let headerLogo = '';
// The web version of this window (server/web-admin.js), at /server on the API port.
let webAdmin = null;
let clientRelease;
let serverUpdater;
// Data health tab: sheet problems found in the synced data (server/data-health.js), checked after each sync.
let dataHealth = null;
let activity;
let priceWatch;
// App tests on the branch laptops, run from the /app-check web page (server/app-check.js).
let appCheck = null;
// SalesKit's SKUs by SKU, for App Tests' comparison (rebuilt when the data version changes).
let skuIndex = { version: null, bySku: new Map() };
// App Tests' Laptop SKU index (made again when the data changes): SKU → { sku, brand, model, partNumber, segment }.
function currentSkuIndex() {
  if (skuIndex.version !== settings.dataVersion) {
    skuIndex = { version: settings.dataVersion, bySku: new Map(skuChoices(database.getInitialData()).map((c) => [skuKey(c.sku), c])) };
  }
  return skuIndex;
}
// Laptops listening on /api/events for price changes.
const priceListeners = new Set();
// The same laptops, told when the Reco Table's sheets changed and were synced (server/reco-watch.js).
const dataListeners = new Set();
let recoWatch = null;
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
    // NEW PRICING's own spreadsheet; blank = the NEW PRICING tab of the main spreadsheet.
    pricingSpreadsheetId: typeof saved?.pricingSpreadsheetId === 'string' ? saved.pricingSpreadsheetId : DEFAULT_PRICING_SPREADSHEET_ID,
    // NEW PRICING MATRIX V3's spreadsheet, where prices are edited: all prices come from it (see price-matrix.js);
    // blank = NEW PRICING above.
    priceMatrixSpreadsheetId: typeof saved?.priceMatrixSpreadsheetId === 'string' ? saved.priceMatrixSpreadsheetId : DEFAULT_PRICE_MATRIX_SPREADSHEET_ID,
    syncIntervalMinutes: Number(saved?.syncIntervalMinutes) || 15,
    port: Number(saved?.port) || DEFAULT_PORT,
    token: saved?.token || embedded.serverToken || crypto.randomBytes(24).toString('hex'),
    autoStart: saved?.autoStart !== false,
    lastSync: saved?.lastSync || null,
    dataVersion: Number(saved?.dataVersion) || 1,
    dataUpdatedAt: saved?.dataUpdatedAt || null,
    allowWithoutLogin: saved?.allowWithoutLogin !== false,
    // Where "Stock Status - YYYYMMDD.csv" is uploaded (the folder or one folder down); blank = no inventory CSV.
    inventoryFolder: typeof saved?.inventoryFolder === 'string' ? saved.inventoryFolder : 'Z:\\'
  };
  if (!saved) writeSettings(loaded);
  return loaded;
}

function writeSettings(value = settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(value, null, 2), 'utf8');
}

// ---------- Activity log & state ----------

// Live updates for the window and for the web version's open pages (server/web-admin.js).
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  if (webAdmin) webAdmin.broadcast(channel, payload);
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
    pricingSpreadsheetId: settings.pricingSpreadsheetId,
    priceMatrixSpreadsheetId: settings.priceMatrixSpreadsheetId,
    priceChangeCount: priceWatch ? priceWatch.count() : 0,
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
    clientRelease: clientRelease ? clientReleaseSummary() : null,
    serverUpdate: serverUpdater ? serverUpdater.get() : null,
    dataHealth: dataHealth ? { total: dataHealth.total, checkedAt: dataHealth.checkedAt } : null,
    inventoryFolder: settings.inventoryFolder,
    inventory: inventoryStatus
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

// Where the prices came from at the last sync and price check: the matrix, or NEW PRICING when the matrix could not
// be read ({ source, error }); shown on the Data health tab.
let priceSource = { sync: null, watch: null };

function noticePriceSource(kind, source, error = '') {
  const previous = priceSource[kind];
  priceSource[kind] = { source, error };
  if (previous && previous.source === source && previous.error === error) return;
  if (source === 'matrix') {
    if (previous && previous.source !== 'matrix') log('success', `Prices (${kind === 'sync' ? 'sync' : 'price check'}): reading the price matrix again`);
  } else if (settings.priceMatrixSpreadsheetId) {
    log('warning', `Prices (${kind === 'sync' ? 'sync' : 'price check'}): price matrix not read (${error}); using NEW PRICING`);
  }
}

function checkDataHealth() {
  try {
    dataHealth = buildDataHealth(database.getRows, { priceSource: settings.priceMatrixSpreadsheetId ? priceSource : null });
    if (dataHealth.total) log('warning', `Data health: ${dataHealth.total} sheet problem${dataHealth.total === 1 ? '' : 's'} to fix (see the Data health tab).`);
  } catch (error) {
    log('error', `Data health check failed: ${error.message}`);
  }
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
// Logos from the LOGO sheet. When they cannot be downloaded (e.g. Windows started the server before the
// internet was connected), the last downloaded copy is used, and on a new server the logos built into the app.
// The download is tried again after every sync until it works (logosDownloaded).
let logosDownloaded = false;

async function fetchLogo(url, cacheName, bundledName) {
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
          return { image, downloaded: true };
        }
      }
    } catch {}
  }
  for (const file of [cachePath, path.join(__dirname, 'assets', bundledName)]) {
    const saved = fs.existsSync(file) ? nativeImage.createFromPath(file) : null;
    if (saved && !saved.isEmpty()) return { image: saved, downloaded: false };
  }
  return { image: null, downloaded: false };
}

async function loadLogos() {
  let urls = {};
  try {
    urls = database.getInitialData();
  } catch {}
  const [appResult, headerResult] = await Promise.all([
    fetchLogo(urls.applicationLogoUrl, 'application.png', 'app-logo.png'),
    fetchLogo(urls.headerLogoUrl, 'header.png', 'header-logo.png')
  ]);
  logosDownloaded = appResult.downloaded && headerResult.downloaded;
  const appLogo = appResult.image;
  const header = headerResult.image;
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
  // One full data object per data version and day (Banner promos start and end on their dates); each
  // branch's (compressed) copy is made from it. Unchanged data keeps its fingerprint, so laptops download
  // again only when a promo really started or ended.
  let fullData = null;
  let fullDataVersion = null;
  const dataDay = () => `${settings.dataVersion}|${new Date().toDateString()}`;
  const payloads = createCompressedData({
    getDataVersion: dataDay,
    scopeOf: (user) => (!user || hasFullAccess(user.branch) ? 'ALL' : String(user.branch).trim().toUpperCase()),
    build: (scope, { branchModes } = {}) => {
      if (fullDataVersion !== dataDay() || !fullData) {
        fullData = database.getInitialData();
        fullDataVersion = dataDay();
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
    appCheck,
    webAdmin,
    dataChanges: {
      subscribe: (listener) => {
        dataListeners.add(listener);
        return () => dataListeners.delete(listener);
      }
    },
    priceChanges: {
      latestId: () => (priceWatch ? priceWatch.latestId() : 0),
      since: (id) => (priceWatch ? priceWatch.since(id) : []),
      subscribe: (listener) => {
        priceListeners.add(listener);
        return () => priceListeners.delete(listener);
      }
    },
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
      // Laptops check in for app tests every 5 seconds; app-check.js logs the tests themselves.
      if (pathname.startsWith('/api/app-check/') && !denied) return;
      if (denied === 'token') log('warning', `Rejected ${who}: wrong or missing token`);
      else if (denied === 'login') {
        if (pathname !== '/api/version') log('warning', `${who} needs to log in (older SalesKit or signed out)`);
      }
      // Clients poll /api/version every few minutes; keep those out of the activity log.
      else if (!['/api/version', '/api/login', '/api/activity', '/api/events', '/api/price-changes'].includes(pathname)) {
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

  log('info', reason === 'schedule' ? 'Scheduled sync started'
    : reason === 'startup' ? 'Startup sync started'
      : reason === 'prices' ? 'Price change: updating the data' : 'Sync started');
  try {
    const sheets = await fetchSpreadsheetData({
      credentialsPath: settings.serviceAccountPath,
      spreadsheetId: settings.spreadsheetId,
      pricingSpreadsheetId: settings.pricingSpreadsheetId,
      priceMatrixSpreadsheetId: settings.priceMatrixSpreadsheetId
    }, (progress) => {
      if (progress.phase === 'price-source') {
        noticePriceSource('sync', progress.source, progress.error);
        return;
      }
      if (progress.phase === 'warning') {
        log('warning', progress.message);
        return;
      }
      syncProgress = progress;
      send('server:sync-progress', progress);
    });
    const inventory = readInventory();
    if (inventory) sheets.inventory_stock = inventory;
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
    } else {
      backup.discard();
    }
    if (summary.changed || !logosDownloaded) loadLogos();
    log('success', summary.changed
      ? `Sync finished: ${summary.updatedCount} rows updated, ${summary.deletedCount} removed`
      : 'Sync finished: no changes');
    checkDataHealth();
    return finish({ ok: true, changed: summary.changed, updatedCount: summary.updatedCount, deletedCount: summary.deletedCount });
  } catch (error) {
    log('error', `Sync failed: ${error.message}`);
    return finish({ ok: false, error: error.message });
  }
}

// A price change in NEW PRICING: the data is synced at once (after a sync already running, which may have read
// the sheet before the change), then every listening laptop is told, so it reloads and shows what changed.
function announcePriceChange(event) {
  const synced = activeSync ? activeSync.then(() => syncNow('prices')) : syncNow('prices');
  synced.catch(() => {}).finally(() => {
    for (const listener of priceListeners) {
      try {
        listener(event);
      } catch {}
    }
  });
}

// The every-minute NEW PRICING check behind the price-change notices (see PRICE_NOTICES in electron/main.js).
const PRICE_WATCH = true;

// The Reco Table live: its sheets are checked every 30 seconds; a change is synced at once and the laptops are told
// to reload their data (no notice is shown). Laptops before 1.0.37 still get it at their 2-minute data check.
const RECO_WATCH = true;
const RECO_SHEETS = ['RECO TABLE', RECO_DB_SHEET, LAPTOP_DATABASE_SHEET];
const RECO_RANGES = { 'RECO TABLE': 'A:ZZ', [RECO_DB_SHEET]: RECO_DB_RANGE, [LAPTOP_DATABASE_SHEET]: LAPTOP_DATABASE_RANGE };
let recoTitles = { at: 0, titles: [] };

function startRecoWatch() {
  recoWatch = createRecoWatch({
    readSheets: async () => {
      if (!settings.serviceAccountPath || !fs.existsSync(settings.serviceAccountPath)) return {};
      const connection = { credentialsPath: settings.serviceAccountPath, spreadsheetId: settings.spreadsheetId };
      // The tab names are looked up every 30 minutes (a tab that is not there would fail the whole read).
      if (Date.now() - recoTitles.at > 30 * 60 * 1000) recoTitles = { at: Date.now(), titles: await fetchSheetTitles(connection) };
      const present = RECO_SHEETS.map((name) => [name, recoTitles.titles.find((title) => title.trim().toUpperCase() === name)]).filter(([, title]) => title);
      if (!present.length) return {};
      const values = await fetchRangesValues(connection, present.map(([name, title]) => `'${title.replace(/'/g, "''")}'!${RECO_RANGES[name]}`));
      return Object.fromEntries(present.map(([name], index) => [name, values[index]]));
    },
    onChange: async (sheets) => {
      await (activeSync ? activeSync.then(() => syncNow('reco')) : syncNow('reco')).catch(() => {});
      const event = { at: new Date().toISOString(), sheets, dataVersion: settings.dataVersion };
      for (const listener of dataListeners) {
        try { listener(event); } catch {}
      }
    },
    log
  });
  recoWatch.start();
}

function startPriceWatch() {
  priceWatch = createPriceWatch({
    filePath: path.join(app.getPath('userData'), 'price-changes.json'),
    readValues: async () => {
      if (!settings.serviceAccountPath || !fs.existsSync(settings.serviceAccountPath)) return [];
      // The price matrix itself (changes get the minute they were made); NEW PRICING when it cannot be read.
      if (settings.priceMatrixSpreadsheetId) {
        try {
          const values = await fetchPriceMatrixValues({ credentialsPath: settings.serviceAccountPath, spreadsheetId: settings.priceMatrixSpreadsheetId });
          noticePriceSource('watch', 'matrix');
          return values;
        } catch (error) {
          noticePriceSource('watch', 'new-pricing', error.message);
        }
      }
      return fetchSheetValues({ credentialsPath: settings.serviceAccountPath, spreadsheetId: settings.pricingSpreadsheetId || settings.spreadsheetId }, 'NEW PRICING');
    },
    onChange: announcePriceChange,
    log
  });
  priceWatch.start();
}

// The newest inventory CSV as the inventory_stock collection, or null when it cannot be read (logged once per
// new problem; the last stock read stays). No folder set: an empty one (LAPTOP DB's stock is used again).
function readInventory() {
  if (!settings.inventoryFolder) {
    inventoryStatus = null;
    return { collection: 'inventory_stock', columns: ['item_key', 'item', 'stock', 'as_of', 'file'], rows: [] };
  }
  const checkedAt = new Date().toISOString();
  try {
    const { collection, summary } = readInventoryCsv(settings.inventoryFolder);
    if (!inventoryStatus || !inventoryStatus.ok || inventoryStatus.file !== summary.file || inventoryStatus.modified !== summary.modified) {
      log('success', `Inventory: ${summary.file} read (stock as of ${summary.asOf}, ${summary.laptops} laptops with stock)`);
    }
    inventoryStatus = { ok: true, ...summary, checkedAt };
    return collection;
  } catch (error) {
    if (!inventoryStatus || inventoryStatus.ok || inventoryStatus.error !== error.message) {
      log('warning', `Inventory CSV not read: ${error.message}; the last stock read stays.`);
    }
    inventoryStatus = { ...(inventoryStatus && inventoryStatus.ok ? { lastFile: inventoryStatus.file, lastAsOf: inventoryStatus.asOf } : inventoryStatus || {}), ok: false, error: error.message, checkedAt };
    return null;
  }
}

// Every hour (between syncs): a new CSV updates the stock right away, without a whole sync.
async function checkInventory() {
  if (activeSync) return;
  const fileOf = (status) => (status && status.ok ? `${status.file}|${status.modified}` : '');
  const before = fileOf(inventoryStatus);
  const collection = readInventory();
  pushState();
  if (!collection || (before && before === fileOf(inventoryStatus))) return;
  try {
    const summary = database.replaceSheetsData({ inventory_stock: collection });
    if (!summary.changed) return;
    bumpDataVersion();
    log('success', 'Inventory: branch stock updated');
    const event = { at: new Date().toISOString(), sheets: ['INVENTORY'], dataVersion: settings.dataVersion };
    for (const listener of dataListeners) {
      try { listener(event); } catch {}
    }
    pushState();
  } catch (error) {
    log('error', `Inventory: could not save the stock: ${error.message}`);
  }
}

function scheduleInventoryCheck() {
  clearInterval(inventoryTimer);
  inventoryTimer = setInterval(() => { checkInventory().catch(() => {}); }, INVENTORY_CHECK_MS);
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
    ...(serverUpdater && serverUpdater.get().state === 'ready'
      ? [{ label: `Restart and update to ${serverUpdater.get().version}`, enabled: !activeSync, click: () => serverUpdater.installNow() }]
      : []),
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
// Each action is registered once, for this window (IPC) and for the web version (/server, server/web-admin.js),
// so both always do the same thing. Actions get (event, ...args); the web passes { web: true, user } as event.
const adminActions = new Map();
function handle(channel, action) {
  adminActions.set(channel, action);
  ipcMain.handle(channel, action);
}

handle('server:get-state', () => getState());
handle('server:get-logs', () => logs);
handle('server:get-logos', () => ({ header: headerLogo }));
handle('server:check-client-release', async () => {
  await clientRelease.checkNow();
  return getState();
});
// Data health tab: the last report, or a fresh check.
handle('server:data-health', (_event, recheck) => {
  if (recheck || !dataHealth) {
    checkDataHealth();
    pushState();
  }
  return dataHealth;
});
// Updates tab: look for a new server version now, or install the downloaded one.
handle('server:check-server-update', () => {
  serverUpdater.checkNow();
  return getState();
});
handle('server:install-server-update', () => {
  if (activeSync) return { ok: false, error: 'A sync is running. Try again when it finishes.' };
  return { ok: serverUpdater.installNow() };
});
// Price changes tab: every kept change, and deleting chosen ones (laptops' Price changes lists read them from here).
handle('server:price-changes', async () => (priceWatch ? priceWatch.all() : []));

handle('server:delete-price-changes', async (_event, items = []) => {
  const removed = priceWatch ? priceWatch.remove(items) : 0;
  log('info', `Deleted ${removed} price change${removed === 1 ? '' : 's'}`);
  pushState();
  return priceWatch ? priceWatch.all() : [];
});

// Clears the price-change history on every laptop (their Price changes list reads it from here).
handle('server:clear-price-changes', async () => {
  if (priceWatch) priceWatch.clear();
  log('info', 'Price-change history cleared');
  pushState();
  return getState();
});

handle('server:sync-now', async () => {
  await syncNow();
  return getState();
});

handle('server:choose-key', async () => {
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

// Web version: the key file's contents, chosen on the admin's computer, saved on this server.
handle('server:set-key-file', async (_event, text) => {
  let key;
  try {
    key = JSON.parse(String(text || ''));
  } catch {
    throw new Error('That file is not a valid JSON key file.');
  }
  if (key.type !== 'service_account' || !key.client_email || !key.private_key) {
    throw new Error('That file is not a Google service-account key.');
  }
  const keyPath = path.join(app.getPath('userData'), 'google-service-account.json');
  fs.writeFileSync(keyPath, JSON.stringify(key, null, 2));
  settings.serviceAccountPath = keyPath;
  writeSettings();
  log('info', `Google key set from the web: ${key.client_email}`);
  pushState();
  return getState();
});

// A pasted Google Sheets link or a bare ID → the ID.
function spreadsheetIdFrom(value) {
  const text = String(value || '').trim();
  const match = text.match(/\/spreadsheets\/d\/([\w-]+)/);
  return match ? match[1] : text;
}

handle('server:update-settings', async (_event, changes = {}) => {
  const previous = { ...settings };
  if (changes.spreadsheetId !== undefined) {
    const id = spreadsheetIdFrom(changes.spreadsheetId);
    if (!/^[\w-]{20,}$/.test(id)) throw new Error('Enter a valid spreadsheet ID.');
    settings.spreadsheetId = id;
  }
  if (changes.pricingSpreadsheetId !== undefined) {
    const id = spreadsheetIdFrom(changes.pricingSpreadsheetId);
    if (id && !/^[\w-]{20,}$/.test(id)) throw new Error('Enter a valid pricing spreadsheet link or ID, or leave it blank.');
    settings.pricingSpreadsheetId = id;
  }
  if (changes.priceMatrixSpreadsheetId !== undefined) {
    const id = spreadsheetIdFrom(changes.priceMatrixSpreadsheetId);
    if (id && !/^[\w-]{20,}$/.test(id)) throw new Error('Enter a valid price matrix spreadsheet link or ID, or leave it blank.');
    settings.priceMatrixSpreadsheetId = id;
  }
  if (changes.inventoryFolder !== undefined) {
    settings.inventoryFolder = String(changes.inventoryFolder || '').trim().slice(0, 300);
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
  if (settings.pricingSpreadsheetId !== previous.pricingSpreadsheetId) log('info', 'Pricing spreadsheet updated.');
  if (settings.priceMatrixSpreadsheetId !== previous.priceMatrixSpreadsheetId) log('info', 'Price matrix spreadsheet updated.');
  if (settings.inventoryFolder !== previous.inventoryFolder) {
    log('info', settings.inventoryFolder ? `Inventory folder: ${settings.inventoryFolder}` : 'Inventory CSV turned off: LAPTOP DB stock is used again.');
    checkInventory().catch(() => {});
  }
  pushState();
  return getState();
});

handle('server:copy-token', () => {
  clipboard.writeText(settings.token);
  return true;
});

handle('server:copy-text', (_event, text) => {
  clipboard.writeText(String(text || ''));
  return true;
});

// The JSON for the client's electron/embedded-config.json. Clients try each address in order.
function clientConfigText(address) {
  const addresses = getState().addresses;
  const preferred = typeof address === 'string' && address ? address : addresses[0] || `http://SERVER-IP:${settings.port}`;
  const serverUrls = [...new Set([preferred, ...addresses, `http://${os.hostname()}:${settings.port}`])];
  return JSON.stringify({ serverUrl: preferred, serverUrls, serverToken: settings.token }, null, 2);
}
handle('server:copy-client-config', (_event, address) => {
  clipboard.writeText(clientConfigText(address));
  return true;
});
// Web version: the copy buttons copy on the admin's own computer, so they get the text instead.
handle('server:get-token', () => settings.token);
handle('server:client-config-text', (_event, address) => clientConfigText(address));

// ---------- Data viewer, devices & backups ----------

handle('server:table-data', (_event, tableName, options = {}) => database.getTableData(tableName, options));

handle('server:get-devices', () => devicesWithActivity());
handle('server:get-activity-summary', (_event, days) => (activity ? activity.summary(Number(days) || 30) : null));
handle('server:get-rejected', () => devices.rejectedList());
handle('server:clear-rejected', () => {
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

handle('server:get-users', () => users.list());
handle('server:get-branches', () => database.listBranches());
handle('server:create-user', (_event, details) => userAction(() => {
  const user = users.create(details || {});
  log('success', `User added: ${user.displayName} (${user.username}, ${user.branch})`);
  return users.list();
}));
handle('server:update-user', (_event, username, changes) => userAction(() => {
  const user = users.update(username, changes || {});
  if (changes && changes.disabled !== undefined) log('warning', `User ${user.username} ${user.disabled ? 'disabled and signed out' : 'enabled'}`);
  if (changes && changes.serverAdmin !== undefined) {
    log('warning', `${user.username} ${user.serverAdmin ? 'can now open this server on the web (server admin)' : 'is no longer a server admin'}`);
    if (!user.serverAdmin && webAdmin) webAdmin.signOut(user.username);
  }
  return users.list();
}));
// Users tab: a user's current password (null when it was set before copies were kept; reset it to view it).
handle('server:reveal-password', (_event, username) => users.revealPassword(username));
handle('server:set-user-password', (_event, username, password) => userAction(() => {
  users.setPassword(username, password);
  log('info', `Password changed for ${username}; their SalesKit asks them to log in again`);
  return users.list();
}));
handle('server:sign-out-user', (_event, username) => userAction(() => {
  users.signOut(String(username));
  log('info', `${username} was signed out`);
  return users.list();
}));
handle('server:remove-user', (_event, username) => userAction(() => {
  users.remove(username);
  log('warning', `User removed: ${username}`);
  return users.list();
}));

handle('server:forget-device', (_event, key) => {
  devices.forget(String(key));
  return devicesWithActivity();
});

handle('server:backup-now', async () => {
  const name = await backups.create('manual');
  log('success', `Backup saved: ${name}`);
  pushState();
  return getState();
});

handle('server:restore-backup', async (_event, name) => {
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

handle('server:open-backups-folder', () => {
  const folder = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(folder, { recursive: true });
  return shell.openPath(folder);
});
// Web version: a folder on the server cannot be opened from a browser, so its path is shown instead.
handle('server:backups-folder-path', () => path.join(app.getPath('userData'), 'backups'));

handle('server:new-token', async () => {
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
    serverUpdater = createServerUpdater({
      onStatus: () => pushState(),
      canInstall: () => !activeSync,
      log
    });
    Menu.setApplicationMenu(null);
    createWindow();
    createTray();
    applyAutoStart();

    try {
      openServerDatabase();
      users = createUserStore(database, {
        legacyFile: path.join(app.getPath('userData'), 'users.json'),
        // Viewable password copies (Users tab), encrypted by Windows for the account the server runs under.
        secrets: {
          encrypt: (text) => (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : null),
          decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64'))
        }
      });
      // This window on the web (/server), for accounts ticked "Server admin" in the Users tab.
      webAdmin = createWebAdmin({ accounts: users, actions: adminActions, log });
      appCheck = createAppCheck({
        dataDir: path.join(app.getPath('userData'), 'app-check'),
        accounts: users,
        canAdmin: (user) => Boolean(user) && !user.disabled && hasFullAccess(user.branch),
        log,
        // The Sales Tools header logo: downloaded from the LOGO sheet (loadLogos), or the one built into the server.
        // The branch of the account last signed in on a laptop (Devices list), for laptops on the sign-in page.
        lastAccountFor: (name) => {
          const device = devices.list().find((d) => String(d.name).toLowerCase() === String(name).toLowerCase());
          return device && device.account ? device.account : null;
        },
        listBranches: () => database.listBranches(),
        // What the laptop shows now (Devices → "Showing now"): { text, since, idle, banner } or null.
        showingFor: (name) => (activity ? activity.liveFor(deviceKey('', { name })) : null),
        // A Laptop SKU in SalesKit's data (made again when the data changes), to compare with the laptop's model.
        findSku: (sku) => currentSkuIndex().bySku.get(skuKey(sku)) || null,
        // LAPTOP DB's SEGMENT 2 values, for choosing which apps each segment is tested on.
        listSegments: () => [...new Set([...currentSkuIndex().bySku.values()].map((c) => c.segment).filter(Boolean))],
        getLogoPath: () => [path.join(app.getPath('userData'), 'logos', 'header.png'), path.join(__dirname, 'assets', 'header-logo.png')].find((file) => fs.existsSync(file)) || ''
      });
      backups = createBackupStore(path.join(app.getPath('userData'), 'backups'), database);
      startApi();
      loadLogos();
      checkDataHealth();
    } catch (error) {
      apiError = error.message;
      log('error', `Could not start the server: ${error.message}`);
    }
    scheduleSync();
    scheduleInventoryCheck();
    if (settings.serviceAccountPath) syncNow('startup');
    if (PRICE_WATCH) startPriceWatch();
    if (RECO_WATCH) startRecoWatch();
    serverUpdater.start();
    pushState();
  });

  app.on('before-quit', () => {
    quitting = true;
    clearInterval(syncTimer);
    if (priceWatch) priceWatch.stop();
    if (recoWatch) recoWatch.stop();
    if (clientRelease) clientRelease.stop();
    if (serverUpdater) serverUpdater.stop();
    if (activity) activity.close();
    if (appCheck) appCheck.stop();
    stopApi();
    database.closeDatabase();
  });
  // Keep running in the tray when the window is closed.
  app.on('window-all-closed', () => {});
}
