const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('salesKitServer', {
  getState: () => ipcRenderer.invoke('server:get-state'),
  getLogs: () => ipcRenderer.invoke('server:get-logs'),
  syncNow: () => ipcRenderer.invoke('server:sync-now'),
  chooseKey: () => ipcRenderer.invoke('server:choose-key'),
  updateSettings: (changes) => ipcRenderer.invoke('server:update-settings', changes),
  copyToken: () => ipcRenderer.invoke('server:copy-token'),
  copyText: (text) => ipcRenderer.invoke('server:copy-text', text),
  copyClientConfig: (address) => ipcRenderer.invoke('server:copy-client-config', address),
  newToken: () => ipcRenderer.invoke('server:new-token'),
  getTableData: (table, options) => ipcRenderer.invoke('server:table-data', table, options),
  getDevices: () => ipcRenderer.invoke('server:get-devices'),
  forgetDevice: (key) => ipcRenderer.invoke('server:forget-device', key),
  backupNow: () => ipcRenderer.invoke('server:backup-now'),
  restoreBackup: (name) => ipcRenderer.invoke('server:restore-backup', name),
  openBackupsFolder: () => ipcRenderer.invoke('server:open-backups-folder'),
  onState: (callback) => subscribe('server:state', callback),
  onDevices: (callback) => subscribe('server:devices', callback),
  getLogos: () => ipcRenderer.invoke('server:get-logos'),
  onLogos: (callback) => subscribe('server:logos', callback),
  onLog: (callback) => subscribe('server:log', callback),
  onSyncProgress: (callback) => subscribe('server:sync-progress', callback)
});
