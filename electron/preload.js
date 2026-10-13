const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saleskit', {
  getDatabaseStatus: () => ipcRenderer.invoke('database:status'),
  getInitialData: () => ipcRenderer.invoke('database:initial-data'),
  syncData: (options = {}) => ipcRenderer.invoke('database:sync', options),
  setApplicationIcon: (imageUrl) => ipcRenderer.invoke('application:set-icon', imageUrl),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  },
  saveBanner: (url, suggestedName) => ipcRenderer.invoke('banner:save', url, suggestedName),
  getLoginInfo: () => ipcRenderer.invoke('auth:info'),
  login: (username, password) => ipcRenderer.invoke('auth:login', username, password),
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
  onDataChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('data:changed', listener);
    return () => ipcRenderer.removeListener('data:changed', listener);
  }
});