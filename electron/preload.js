const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saleskit', {
  getDatabaseStatus: () => ipcRenderer.invoke('database:status'),
  getInitialData: () => ipcRenderer.invoke('database:initial-data'),
  syncData: (options = {}) => ipcRenderer.invoke('database:sync', options),
  onSyncProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  },
  openDatabase: () => ipcRenderer.invoke('database:open'),
  listTables: () => ipcRenderer.invoke('database:tables'),
  getTableData: (tableName, options) => ipcRenderer.invoke('database:table-data', tableName, options)
});