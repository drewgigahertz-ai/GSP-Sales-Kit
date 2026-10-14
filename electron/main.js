const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, net, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ImageCache } = require('./image-cache');
const { createSnapshotCache } = require('./snapshot-cache');
const { getConfig } = require('./app-config');
const { startAutoUpdates, getUpdateStatus, installUpdateNow } = require('./updater');
const { getDeviceInfo } = require('./device-info');

// SalesKit is a client: it loads its data from the SalesKit Server, which does the Google Sheets sync.

protocol.registerSchemesAsPrivileged([{
  scheme: 'saleskit-image',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

let mainWindow;
let imageCache;
let snapshotCache;

function reportSyncProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:progress', progress);
  }
}

// Tells the server which laptop is asking, for its Devices list.
const CLIENT_HEADERS = {
  'X-SalesKit-Client': os.hostname(),
  'X-SalesKit-User': os.userInfo().username,
  'X-SalesKit-Version': app.getVersion()
};

// The address that answered last time is tried first.
let workingServerUrl = '';
let loadedDataVersion = null;

// Signed-in user for this run of SalesKit ({ key, user }). Never saved: users log in every time SalesKit opens.
let session = null;
let onLoginPage = true;

async function requestServer(pathname, { timeoutMs = 8000, method = 'GET', body } = {}) {
  const { serverUrls, serverToken } = getConfig();
  if (!serverUrls.length) throw new Error('SalesKit has no server address. Add it to electron/embedded-config.json and rebuild.');
  const device = await getDeviceInfo();
  const headers = { Accept: 'application/json', ...CLIENT_HEADERS, 'X-SalesKit-Make': device.make, 'X-SalesKit-Model': device.model };
  if (serverToken) headers.Authorization = `Bearer ${serverToken}`;
  if (session) headers['X-SalesKit-Session'] = session.key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ordered = workingServerUrl && serverUrls.includes(workingServerUrl)
    ? [workingServerUrl, ...serverUrls.filter((url) => url !== workingServerUrl)]
    : serverUrls;

  let networkError;
  for (const serverUrl of ordered) {
    let response;
    try {
      response = await fetch(`${serverUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      // Unreachable at this address; try the next one.
      networkError = error;
      continue;
    }
    workingServerUrl = serverUrl;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      // The session ended (server restarted, password changed, or signed out by the administrator).
      if (result.code === 'login_required' && pathname !== '/api/login' && !onLoginPage) showLogin('Please log in again.');
      throw Object.assign(new Error(result.error || `SalesKit Server returned HTTP ${response.status}.`), { code: result.code, status: response.status });
    }
    return result;
  }
  throw Object.assign(new Error(`SalesKit Server is not reachable (${ordered.join(', ')}): ${networkError.message}`), { code: 'unreachable' });
}

async function getRemoteSnapshot() {
  try {
    const { dataVersion } = await requestServer('/api/version').catch(() => ({ dataVersion: null }));
    const data = await requestServer('/api/initial-data', { timeoutMs: 60000 });
    loadedDataVersion = dataVersion;
    if (snapshotCache) snapshotCache.save(data);
    return { data, offline: false };
  } catch (error) {
    if (error.code === 'login_required') throw error;
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
  add(data.applicationLogoUrl);
  add(data.headerLogoUrl);
  Object.values(data.appsDataList || []).forEach((app) => add(app.icon));
  Object.values(data.appUkspData?.applications || []).forEach((app) => add(app.icon));
  (data.ukspBannerData?.skus || []).forEach((laptop) => {
    Object.values(laptop.features || {}).forEach(add);
  });
  return [...urls];
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

// Every 2 minutes, ask the server whether its data changed since we loaded it; the window then reloads quietly.
const DATA_CHECK_INTERVAL_MS = 2 * 60 * 1000;

function startDataChangeChecks() {
  setInterval(async () => {
    if (!session) return;
    try {
      const { dataVersion } = await requestServer('/api/version');
      if (loadedDataVersion !== null && dataVersion !== null && dataVersion !== loadedDataVersion &&
          mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('data:changed', dataVersion);
      }
    } catch {}
  }, DATA_CHECK_INTERVAL_MS);
}

// ---------- Login ----------

let loginMessage = '';

function showLogin(message = '') {
  session = null;
  loadedDataVersion = null;
  loginMessage = message;
  onLoginPage = true;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(path.join(__dirname, 'login.html'));
}

function showSalesKit() {
  onLoginPage = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadFile(path.join(__dirname, '..', 'saleskit.html'), { query: { page: 'saleskit' } });
  }
}

ipcMain.handle('auth:info', async () => {
  const message = loginMessage;
  loginMessage = '';
  const saved = snapshotCache && snapshotCache.load();
  // The GigaHertz header logo from the last saved data, if its image is in the local cache.
  const logo = saved && saved.headerLogoUrl ? await imageCache.resolve(saved.headerLogoUrl) : '';
  return {
    version: app.getVersion(),
    message,
    offlineAvailable: Boolean(saved),
    logo: String(logo || '').startsWith('saleskit-image://') ? logo : ''
  };
});

// Returns { ok: true, user } or { ok: false, error, unreachable }.
ipcMain.handle('auth:login', async (_event, username, password) => {
  try {
    const result = await requestServer('/api/login', { method: 'POST', body: { username: String(username || ''), password: String(password || '') } });
    session = { key: result.sessionKey, user: result.user };
    // The page keeps its own copy of the data; drop it so a shared laptop never shows the previous user's branches.
    await mainWindow.webContents.executeJavaScript("localStorage.removeItem('ghz_cached_sheet_data')").catch(() => {});
    showSalesKit();
    return { ok: true, user: result.user };
  } catch (error) {
    return { ok: false, error: error.code === 'unreachable' ? 'The SalesKit server cannot be reached. Check your internet connection.' : error.message, unreachable: error.code === 'unreachable' };
  }
});

// Only offered while the server cannot be reached: SalesKit opens with the last saved data.
ipcMain.handle('auth:offline', () => {
  if (!snapshotCache || !snapshotCache.load()) return false;
  showSalesKit();
  return true;
});

ipcMain.handle('auth:user', () => (session ? session.user : null));

ipcMain.handle('auth:logout', async () => {
  if (session) await requestServer('/api/logout', { method: 'POST', body: {} }).catch(() => {});
  showLogin('You signed out.');
  return true;
});

ipcMain.handle('database:status', () => requestServer('/api/status'));
ipcMain.handle('database:initial-data', async () => imageCache.mapPayload((await getRemoteSnapshot()).data));
ipcMain.handle('application:set-icon', async (event, imageUrl) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Only the main SalesKit window can update the application icon.');
  }
  if (typeof imageUrl !== 'string' || !/^https:\/\//i.test(imageUrl)) {
    throw new Error('The application logo must be an HTTPS image URL.');
  }

  const response = await net.fetch(imageUrl);
  if (!response.ok) throw new Error(`Application logo request failed with HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) {
    throw new Error('The application logo URL did not return an image.');
  }
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  if (!imageBuffer.length || imageBuffer.length > 10 * 1024 * 1024) {
    throw new Error('The application logo image is empty or larger than 10 MB.');
  }
  const icon = nativeImage.createFromBuffer(imageBuffer);
  if (icon.isEmpty()) throw new Error('Electron could not decode the application logo image.');
  mainWindow.setIcon(icon);
  return true;
});
ipcMain.handle('database:sync', () => performRemoteSync());
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('update:status', () => getUpdateStatus());
ipcMain.handle('update:install', () => installUpdateNow());

const BANNER_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

async function readBannerImage(url) {
  const dataMatch = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(url);
  if (dataMatch) return { contentType: dataMatch[1].toLowerCase(), buffer: Buffer.from(dataMatch[2], 'base64') };
  if (!/^(https?|saleskit-image):\/\//i.test(url)) throw new Error('This banner cannot be downloaded.');
  const response = url.startsWith('saleskit-image://') ? await imageCache.serve(url) : await net.fetch(url);
  if (!response.ok) throw new Error(`Banner download failed with HTTP ${response.status}.`);
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  return { contentType, buffer: Buffer.from(await response.arrayBuffer()) };
}

ipcMain.handle('banner:save', async (_event, url, suggestedName = 'banner') => {
  if (typeof url !== 'string') throw new Error('This banner cannot be downloaded.');
  const { contentType, buffer } = await readBannerImage(url);
  const extension = BANNER_IMAGE_TYPES[contentType] || 'png';
  const safeName = String(suggestedName).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'banner';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save banner',
    defaultPath: path.join(app.getPath('downloads'), `${safeName}.${extension}`),
    filters: [{ name: 'Images', extensions: [extension] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  fs.writeFileSync(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#d5d9e0',
      symbolColor: '#334155',
      height: 36
    },
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
  mainWindow.loadFile(path.join(__dirname, 'login.html'));
}

app.whenReady().then(() => {
  snapshotCache = createSnapshotCache(path.join(app.getPath('userData'), 'saleskit-data-cache.json'));
  imageCache = new ImageCache(path.join(app.getPath('userData'), 'image-cache'));
  protocol.handle('saleskit-image', ({ url }) => imageCache.serve(url));

  Menu.setApplicationMenu(null);
  getDeviceInfo();
  createWindow();
  startAutoUpdates((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
  });
  startDataChangeChecks();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});