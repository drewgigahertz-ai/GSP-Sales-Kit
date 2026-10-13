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
  onDataChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('data:changed', listener);
    return () => ipcRenderer.removeListener('data:changed', listener);
  }
});