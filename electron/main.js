const { app, BrowserWindow, dialog, ipcMain, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const database = require('./database');
const { DEFAULT_SPREADSHEET_ID, fetchSpreadsheetData } = require('./sheets-sync');
const { createLocalApi } = require('./local-api');
const { ImageCache } = require('./image-cache');
const { createSnapshotCache } = require('./snapshot-cache');

protocol.registerSchemesAsPrivileged([{
  scheme: 'saleskit-image',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

let mainWindow;
let imageCache;
let activeSyncPromise = null;
let localApi;
let sheetsSyncTimer;
let snapshotCache;

function reportSyncProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:progress', progress);
  }
}

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function getSavedCredentialPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (saved.serviceAccountPath && fs.existsSync(saved.serviceAccountPath)) return saved.serviceAccountPath;
  } catch {}

  return '';
}

function serverUrl() {
  return String(process.env.SALESKIT_SERVER_URL || '').replace(/\/+$/, '');
}

async function requestServer(pathname, options = {}) {
  const url = serverUrl();
  if (!url) throw new Error('Set SALESKIT_SERVER_URL to connect to the laptop data server.');
  const headers = { Accept: 'application/json', ...options.headers };
  if (process.env.SALESKIT_SERVER_TOKEN) headers.Authorization = `Bearer ${process.env.SALESKIT_SERVER_TOKEN}`;
  const response = await fetch(`${url}${pathname}`, { ...options, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Laptop server returned HTTP ${response.status}.`);
  return result;
}

function importSheetsSnapshot() {
  if (activeSyncPromise) return activeSyncPromise;
  activeSyncPromise = performSheetsImport().finally(() => {
    activeSyncPromise = null;
  });
  return activeSyncPromise;
}

async function performSheetsImport() {
  if (!database.getStatus().connected) throw new Error('No local SQLite database is open.');
  const credentialsPath = getSavedCredentialPath();
  if (!credentialsPath) throw new Error('Google Sheets credentials are not configured.');

  reportSyncProgress({ phase: 'sheets', completed: 0, total: 0, message: 'Connecting to Google Sheets…' });
  const sheets = await fetchSpreadsheetData({
    credentialsPath,
    spreadsheetId: process.env.SALESKIT_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID
  }, reportSyncProgress);
  reportSyncProgress({ phase: 'sqlite', message: 'Updating the local database…' });
  const databaseSummary = database.replaceSheetsData(sheets);
  return {
    canceled: false,
    changed: databaseSummary.changed,
    database: databaseSummary,
    data: database.getInitialData()
  };
}

async function getRemoteSnapshot() {
  try {
    const data = await requestServer('/api/initial-data');
    if (snapshotCache) snapshotCache.save(data);
    return { data, offline: false };
  } catch (error) {
    const data = snapshotCache && snapshotCache.load();
    if (!data) throw error;
    console.warn('Using the last saved SalesKit data while the server is unavailable:', error.message);
    return { data, offline: true };
  }
}

function imageUrlsFromData(data) {
  const urls = new Set();
  const add = (value) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) urls.add(value);
  };
  Object.values(data.specsMap || {}).forEach((spec) => add(spec.image));
  Object.values(data.skuImageMap || {}).forEach(add);
  Object.values(data.appsLogoMap || {}).forEach(add);
  Object.values(data.appsDataList || []).forEach((app) => add(app.icon));
  Object.values(data.appUkspData?.applications || []).forEach((app) => add(app.icon));
  (data.ukspBannerData?.skus || []).forEach((laptop) => {
    Object.values(laptop.features || {}).forEach(add);
  });
  return [...urls];
}

async function performLocalSync() {
  const sheetsConfigured = Boolean(getSavedCredentialPath());
  const result = !sheetsConfigured
    ? {
        canceled: false,
        sheetsSkipped: true,
        changed: false,
        database: { changeCount: 0, updatedCount: 0, deletedCount: 0 },
        data: database.getInitialData()
      }
    : await importSheetsSnapshot();
  if (result.canceled) return result;
  reportSyncProgress({ phase: 'images', completed: 0, total: 0, message: 'Syncing images…' });
  const imageSummary = await imageCache.sync(database.getImageUrls(), reportSyncProgress);
  return {
    ...result,
    offline: false,
    images: imageSummary,
    data: await imageCache.mapPayload(result.data)
  };
}

async function performRemoteSync() {
  reportSyncProgress({ phase: 'server', message: 'Loading current data…' });
  const snapshot = await getRemoteSnapshot();
  let imageSummary = { total: 0, cached: 0, downloaded: 0, failed: 0 };
  if (!snapshot.offline) {
    reportSyncProgress({ phase: 'images', completed: 0, total: 0, message: 'Syncing images…' });
    imageSummary = await imageCache.sync(imageUrlsFromData(snapshot.data), reportSyncProgress);
  }
  return {
    canceled: false,
    changed: false,
    fromServer: true,
    offline: snapshot.offline,
    database: { changeCount: 0, updatedCount: 0, deletedCount: 0 },
    images: imageSummary,
    data: await imageCache.mapPayload(snapshot.data)
  };
}

function startSheetsSyncSchedule() {
  if (sheetsSyncTimer) return;
  const intervalMinutes = Math.max(1, Number(process.env.SALESKIT_SHEETS_SYNC_INTERVAL_MINUTES) || 15);
  sheetsSyncTimer = setInterval(() => {
    if (!getSavedCredentialPath()) return;
    importSheetsSnapshot().catch((error) => {
      console.error('Scheduled Google Sheets refresh failed:', error.message);
    });
  }, intervalMinutes * 60 * 1000);
}

function startLocalApi() {
  const host = process.env.SALESKIT_SERVER_HOST || '127.0.0.1';
  const port = Number(process.env.SALESKIT_SERVER_PORT) || 3000;
  const token = process.env.SALESKIT_SERVER_TOKEN || '';
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(host.toLowerCase());
  if (!loopback && !token) throw new Error('Set SALESKIT_SERVER_TOKEN before allowing LAN access.');

  localApi = createLocalApi({ database, token });
  localApi.on('error', (error) => console.error('Local data API failed:', error.message));
  localApi.listen(port, host, () => console.log(`SalesKit data API listening at http://${host}:${port}`));
}

ipcMain.handle('database:status', () => serverUrl()
  ? requestServer('/api/status')
  : database.getStatus());
ipcMain.handle('database:initial-data', async () => {
  const data = serverUrl()
    ? (await getRemoteSnapshot()).data
    : database.getInitialData();
  return imageCache.mapPayload(data);
});
ipcMain.handle('database:sync', () => serverUrl() ? performRemoteSync() : performLocalSync());
ipcMain.handle('database:tables', () => serverUrl()
  ? requestServer('/api/tables')
  : database.listTables());
ipcMain.handle('database:table-data', (_event, tableName, options = {}) => {
  if (!serverUrl()) return database.getTableData(tableName, options);
  const params = new URLSearchParams({ table: tableName });
  for (const key of ['limit', 'offset', 'search']) {
    if (options[key] !== undefined) params.set(key, String(options[key]));
  }
  return requestServer(`/api/table-data?${params}`);
});
ipcMain.handle('database:open', async () => {
  if (serverUrl()) throw new Error('Client mode uses the laptop server database and cannot open a local database.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open SQLite database',
    properties: ['openFile'],
    filters: [
      { name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return database.openDatabase(result.filePaths[0]);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: '#f3f5f2',
    title: 'GigaHertz SalesKit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'saleskit.html'), { query: { page: 'saleskit' } });
}

app.whenReady().then(() => {
  snapshotCache = createSnapshotCache(path.join(app.getPath('userData'), 'saleskit-data-cache.json'));
  imageCache = new ImageCache(path.join(app.getPath('userData'), 'image-cache'));
  protocol.handle('saleskit-image', ({ url }) => imageCache.serve(url));

  if (!serverUrl()) {
    const defaultDatabasePath = app.isPackaged
      ? path.join(app.getPath('userData'), 'mydata.db')
      : path.join(app.getAppPath(), 'mydata.db');
    const bundledDatabasePath = path.join(process.resourcesPath, 'mydata.db');

    if (app.isPackaged && !fs.existsSync(defaultDatabasePath) && fs.existsSync(bundledDatabasePath)) {
      fs.mkdirSync(path.dirname(defaultDatabasePath), { recursive: true });
      fs.copyFileSync(bundledDatabasePath, defaultDatabasePath);
    }

    const configuredPath = process.env.SALESKIT_DB_PATH || defaultDatabasePath;
    try {
      database.openDatabase(configuredPath, { create: true });
      startLocalApi();
      startSheetsSyncSchedule();
    } catch (error) {
      console.error('Could not initialize the local data server:', error.message);
    }
  }

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (localApi) localApi.close();
  database.closeDatabase();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});