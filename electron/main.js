const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, net, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ImageCache } = require('./image-cache');
const { createSnapshotCache } = require('./snapshot-cache');
const { getConfig } = require('./app-config');
const { startAutoUpdates, getUpdateStatus, installUpdateNow, noticeLatestVersion } = require('./updater');
const { createUpdateResume } = require('./update-resume');
const { createLogoCache } = require('./logo-cache');
const { createDataLoader } = require('./data-loader');
const { createActivityReporter } = require('./activity');
const { getDeviceInfo } = require('./device-info');

// SalesKit is a client: it loads its data from the SalesKit Server, which does the Google Sheets sync.

protocol.registerSchemesAsPrivileged([{
  scheme: 'saleskit-image',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

let mainWindow;
let imageCache;
let snapshotCache;
let dataLoader;
let updateResume;
let logoCache;
let activityReporter;

function reportSyncProgress(progress) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:progress', progress);
  }
}

// Tells the server which laptop is asking, for its Devices list.
const CLIENT_HEADERS = {
  'X-SalesKit-Client': os.hostname(),
  'X-SalesKit-User': os.userInfo().username,
  'X-SalesKit-Version': app.getVersion(),
  // The server may send the duplicate benchmark table once (see data-loader.js).
  'X-SalesKit-Features': 'dedupe, branch-modes',
  'Accept-Encoding': 'gzip'
};

// The address that answered last time is tried first.
let workingServerUrl = '';
// Fingerprint of the data the window shows: the server's per-branch ETag, or its data version (older servers).
let loadedDataVersion = null;

// Signed-in user for this run of SalesKit ({ key, user }). Users log in every time SalesKit opens; it is only
// kept across the restart that installs an update (see update-resume.js).
let session = null;
let onLoginPage = true;

// withMeta: return { status, etag, body } instead of the body; a 304 (Not Modified) is then not an error.
async function requestServer(pathname, { timeoutMs = 8000, method = 'GET', body, headers: extraHeaders = {}, withMeta = false } = {}) {
  const { serverUrls, serverToken } = getConfig();
  if (!serverUrls.length) throw new Error('SalesKit has no server address. Add it to electron/embedded-config.json and rebuild.');
  const device = await getDeviceInfo();
  const headers = { Accept: 'application/json', ...CLIENT_HEADERS, 'X-SalesKit-Make': device.make, 'X-SalesKit-Model': device.model };
  if (serverToken) headers.Authorization = `Bearer ${serverToken}`;
  if (session) headers['X-SalesKit-Session'] = session.key;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  Object.assign(headers, extraHeaders);
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
    if (withMeta && response.status === 304) return { status: 304, etag: response.headers.get('etag'), body: null };
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      // The session ended (server restarted, password changed, or signed out by the administrator).
      if (result.code === 'login_required' && pathname !== '/api/login' && !onLoginPage) showLogin('Please log in again.');
      throw Object.assign(new Error(result.error || `SalesKit Server returned HTTP ${response.status}.`), { code: result.code, status: response.status });
    }
    return withMeta ? { status: response.status, etag: response.headers.get('etag'), body: result } : result;
  }
  throw Object.assign(new Error(`SalesKit Server is not reachable (${ordered.join(', ')}): ${networkError.message}`), { code: 'unreachable' });
}

async function getRemoteSnapshot() {
  try {
    const { dataVersion, latestClientVersion } = await requestServer('/api/version').catch(() => ({ dataVersion: null }));
    noticeLatestVersion(latestClientVersion);
    // Downloads only when this account's data changed since the saved copy (see data-loader.js).
    const { data, tag } = await dataLoader.load();
    loadedDataVersion = tag || dataVersion;
    return { data, offline: false };
  } catch (error) {
    if (error.code === 'login_required') throw error;
    const data = dataLoader.savedDataFor(session && session.user);
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
  add(data.bannerLogoUrl);
  Object.values(data.appsDataList || []).forEach((app) => add(app.icon));
  Object.values(data.appUkspData?.applications || []).forEach((app) => add(app.icon));
  (data.ukspBannerData?.skus || []).forEach((laptop) => {
    Object.values(laptop.features || {}).forEach(add);
    Object.values(laptop.featureBanners || {}).forEach((banners) => banners.forEach((banner) => add(banner.url)));
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
// The same answer names the newest SalesKit release, so a new version starts downloading within minutes.
const DATA_CHECK_INTERVAL_MS = 2 * 60 * 1000;

function startDataChangeChecks() {
  setInterval(async () => {
    if (!session) return;
    try {
      const { dataVersion, dataTag, latestClientVersion } = await requestServer('/api/version');
      noticeLatestVersion(latestClientVersion);
      // Newer servers fingerprint each branch's data, so a change at another branch is ignored here.
      const current = dataTag !== undefined ? dataTag : dataVersion;
      if (loadedDataVersion !== null && current !== null && current !== loadedDataVersion &&
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
  return {
    version: app.getVersion(),
    message,
    offlineAvailable: dataLoader.hasSaved(),
    // The GigaHertz header logo from the last saved data, if its image is in the local cache.
    logo: (await logoCache.cachedLogos()).header
  };
});

// Returns { ok: true, user } or { ok: false, error, unreachable }.
ipcMain.handle('auth:login', async (_event, username, password) => {
  try {
    const result = await requestServer('/api/login', { method: 'POST', body: { username: String(username || ''), password: String(password || '') } });
    session = { key: result.sessionKey, user: result.user };
    if (activityReporter) activityReporter.reset();
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
  if (!dataLoader.hasSaved()) return false;
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
// The saved data, shown while the current data loads; null when this account may not see it.
ipcMain.handle('database:saved-data', async () => {
  const data = dataLoader.savedDataFor(session && session.user);
  return data ? imageCache.mapPayload(data) : null;
});
ipcMain.handle('application:set-icon', async (event, imageUrl) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('Only the main SalesKit window can update the application icon.');
  }
  if (typeof imageUrl !== 'string' || !/^(https|saleskit-image):\/\//i.test(imageUrl)) {
    throw new Error('The application logo must be an HTTPS image URL.');
  }

  // A logo saved on this laptop is read from the image cache (no download, works offline).
  const response = imageUrl.startsWith('saleskit-image://') ? await imageCache.serve(imageUrl) : await net.fetch(imageUrl);
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
  logoCache.saveWindowIcon(icon);
  return true;
});
ipcMain.handle('database:sync', () => performRemoteSync());
ipcMain.handle('logos:cached', () => logoCache.cachedLogos());
// What the window shows, for the server's Devices tab ("Showing now").
ipcMain.handle('activity:report', (event, activity) => {
  if (activityReporter && mainWindow && event.sender === mainWindow.webContents) activityReporter.set(activity);
  return true;
});
// Banner page pictures are saved on this laptop when first shown (not all at startup), then work offline.
ipcMain.handle('images:cache', async (_event, url) => {
  if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return '';
  const cached = await imageCache.resolve(url);
  if (String(cached).startsWith('saleskit-image://')) return cached;
  await imageCache.sync([url]);
  return imageCache.resolve(url);
});
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
    // The logo from last time, until the page applies the current one.
    icon: logoCache.loadWindowIcon() || undefined,
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
  if (session) showSalesKit();
  else mainWindow.loadFile(path.join(__dirname, 'login.html'));
}

// One SalesKit at a time: a second start brings the open window to the front instead (two copies would
// fight over the same saved data and browser cache).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
  snapshotCache = createSnapshotCache(path.join(app.getPath('userData'), 'saleskit-data-cache.json'));
  imageCache = new ImageCache(path.join(app.getPath('userData'), 'image-cache'));
  dataLoader = createDataLoader({
    requestServer,
    snapshotCache,
    metaPath: path.join(app.getPath('userData'), 'saleskit-data-cache.meta.json'),
    getUser: () => (session ? session.user : null)
  });
  // Logo addresses come from the small meta file, so the large saved data is not read for them.
  logoCache = createLogoCache({ userDataDir: app.getPath('userData'), imageCache, snapshotCache: { load: () => dataLoader.loadMeta() } });
  updateResume = createUpdateResume(path.join(app.getPath('userData'), 'update-resume.bin'));
  // Restarted to install an update: open SalesKit signed in as before. (If the server no longer
  // knows the session, the first data request shows the login screen.)
  session = updateResume.take();
  protocol.handle('saleskit-image', ({ url }) => imageCache.serve(url));

  Menu.setApplicationMenu(null);
  getDeviceInfo();
  createWindow();
  startAutoUpdates((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
  }, { onBeforeInstall: () => updateResume.save(session) });
  startDataChangeChecks();
  activityReporter = createActivityReporter({
    send: (report) => requestServer('/api/activity', { method: 'POST', body: report, timeoutMs: 5000 }),
    getWindow: () => mainWindow,
    isSignedIn: () => Boolean(session) && !onLoginPage
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});