const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saleskit', {
  getDatabaseStatus: () => ipcRenderer.invoke('database:status'),
  getInitialData: () => ipcRenderer.invoke('database:initial-data'),
  getSavedData: () => ipcRenderer.invoke('database:saved-data'),
  syncData: (options = {}) => ipcRenderer.invoke('database:sync', options),
  setApplicationIcon: (imageUrl) => ipcRenderer.invoke('application:set-icon', imageUrl),
  getCachedLogos: () => ipcRenderer.invoke('logos:cached'),
  cacheImage: (url) => ipcRenderer.invoke('images:cache', url),
  reportActivity: (activity) => ipcRenderer.invoke('activity:report', activity),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  },
  saveBanner: (url, suggestedName) => ipcRenderer.invoke('banner:save', url, suggestedName),
  saveFiles: (files) => ipcRenderer.invoke('files:save', files),
  getLoginInfo: () => ipcRenderer.invoke('auth:info'),
  login: (username, password, remember) => ipcRenderer.invoke('auth:login', username, password, remember),
  autoLogin: () => ipcRenderer.invoke('auth:auto-login'),
  setOpenAtStartup: (on) => ipcRenderer.invoke('auth:open-at-startup', on),
  getZoom: () => ipcRenderer.invoke('zoom:get'),
  changeZoom: (how) => ipcRenderer.invoke('zoom:change', how),
  onZoomChanged: (callback) => {
    const listener = (_event, factor) => callback(factor);
    ipcRenderer.on('zoom:changed', listener);
    return () => ipcRenderer.removeListener('zoom:changed', listener);
  },
  continueOffline: () => ipcRenderer.invoke('auth:offline'),
  getCurrentUser: () => ipcRenderer.invoke('auth:user'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  // [{ id, at, changes: [{ kind, itemCode, branch, promoTitle, before, after }] }] (see electron/price-stream.js).
  getPriceChanges: () => ipcRenderer.invoke('prices:history'),
  onPriceChanges: (callback) => {
    const listener = (_event, events) => callback(events);
    ipcRenderer.on('prices:changed', listener);
    return () => ipcRenderer.removeListener('prices:changed', listener);
  },
  // Laptop SKU: { sku, required } (required: a branch account is signed in and no SKU is saved yet).
  getLaptopSku: () => ipcRenderer.invoke('laptopsku:get'),
  setLaptopSku: (sku) => ipcRenderer.invoke('laptopsku:set', sku),
  getLaptopSkuChoices: () => ipcRenderer.invoke('laptopsku:choices'),
  // App test from the App Check Server's admin page: { running, stopping, targets: [{ name, status, detail }] }.
  getAppCheckState: () => ipcRenderer.invoke('appcheck:state'),
  stopAppCheck: () => ipcRenderer.invoke('appcheck:stop'),
  onAppCheckState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('appcheck:state', listener);
    return () => ipcRenderer.removeListener('appcheck:state', listener);
  },
  onDataChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('data:changed', listener);
    return () => ipcRenderer.removeListener('data:changed', listener);
  }
});