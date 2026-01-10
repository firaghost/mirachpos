const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mirachpos', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
  config: {
    apiBase: process.env.MIRACHPOS_API_BASE || process.env.MIRACHPOS_API_ORIGIN || '',
  },
  db: {
    get: (key) => ipcRenderer.invoke('mirachpos.db.get', key),
    set: (key, value) => ipcRenderer.invoke('mirachpos.db.set', key, value),
  },
  auth: {
    cacheStaff: (payload) => ipcRenderer.invoke('mirachpos.auth.cacheStaff', payload),
    offlineLogin: (payload) => ipcRenderer.invoke('mirachpos.auth.offlineLogin', payload),
    getLastSession: () => ipcRenderer.invoke('mirachpos.auth.getLastSession'),
    cacheStaffCode: (payload) => ipcRenderer.invoke('mirachpos.auth.cacheStaffCode', payload),
    offlineLoginByCode: (payload) => ipcRenderer.invoke('mirachpos.auth.offlineLoginByCode', payload),
  },
  pos: {
    getState: (scopeKey) => ipcRenderer.invoke('mirachpos.pos.getState', scopeKey),
    setState: (scopeKey, value) => ipcRenderer.invoke('mirachpos.pos.setState', scopeKey, value),
  },
  outbox: {
    enqueue: (payload) => ipcRenderer.invoke('mirachpos.outbox.enqueue', payload),
    listReady: (payload) => ipcRenderer.invoke('mirachpos.outbox.listReady', payload),
    ack: (payload) => ipcRenderer.invoke('mirachpos.outbox.ack', payload),
    bump: (payload) => ipcRenderer.invoke('mirachpos.outbox.bump', payload),
  },
});
