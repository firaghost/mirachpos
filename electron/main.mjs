import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { openKvDb } from './sqlite.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater')?.autoUpdater || null;
} catch {
  autoUpdater = null;
}

const isDev = !app.isPackaged;
const DEV_SERVER_URL = process.env.MIRACHPOS_DEV_URL || 'http://localhost:5173';
const API_ORIGIN = process.env.MIRACHPOS_API_ORIGIN || (isDev ? 'http://127.0.0.1:3001' : 'https://apa.mirachpos.com');

let mainWindow = null;

const updaterState = {
  status: 'idle',
  info: null,
  progress: null,
  error: null,
};

const broadcastUpdaterState = () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('mirachpos.updater.state', updaterState);
  } catch {
    // ignore
  }
};

const setUpdaterState = (patch) => {
  try {
    Object.assign(updaterState, patch || {});
    broadcastUpdaterState();
  } catch {
    // ignore
  }
};

// Ensure renderer/preload can resolve the same API base consistently.
// In dev this points to local API; in packaged mode default is hosted API unless overridden.
if (!process.env.MIRACHPOS_API_BASE) {
  process.env.MIRACHPOS_API_BASE = API_ORIGIN;
}

let apiProc = null;

const startApiServerIfNeeded = async () => {
  if (isDev) return;
  if (apiProc) return;

  const apiUrl = new URL(API_ORIGIN);
  const host = String(apiUrl.hostname || '').toLowerCase();
  const isLocalHost = host === '127.0.0.1' || host === 'localhost';
  if (!isLocalHost) return;
  const port = String(apiUrl.port || '3001');

  const resBase = process.resourcesPath;
  const serverEntry = path.join(resBase, 'server', 'index.mjs');

  try {
    if (!fs.existsSync(serverEntry)) return;
  } catch {
    return;
  }

  apiProc = spawn(process.execPath, [serverEntry], {
    stdio: 'ignore',
    windowsHide: true,
    env: {
      ...process.env,
      PORT: port,
      MIRACHPOS_DATA_DIR: app.getPath('userData'),
    },
  });

  apiProc.on('exit', () => {
    apiProc = null;
  });
};

const db = openKvDb(app.getPath('userData'));

const createMainWindow = async () => {
  const devIcon = path.join(__dirname, '..', 'public', 'mirach.png');
  const prodIcon = path.join(app.getAppPath(), 'dist', 'mirach.png');
  const iconPath = isDev ? devIcon : prodIcon;

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0b1220',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    await win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  return win;
};

const wireAutoUpdater = () => {
  try {
    if (!autoUpdater || isDev) return;

    try {
      autoUpdater.autoDownload = false;
    } catch {
      // ignore
    }

    autoUpdater.on('checking-for-update', () => {
      setUpdaterState({ status: 'checking', error: null, progress: null });
    });

    autoUpdater.on('update-available', (info) => {
      setUpdaterState({ status: 'available', info: info || null, error: null, progress: null });
    });

    autoUpdater.on('update-not-available', (info) => {
      setUpdaterState({ status: 'not-available', info: info || null, error: null, progress: null });
    });

    autoUpdater.on('download-progress', (progress) => {
      setUpdaterState({ status: 'downloading', progress: progress || null, error: null });
    });

    autoUpdater.on('update-downloaded', (info) => {
      setUpdaterState({ status: 'downloaded', info: info || null, error: null, progress: null });
    });

    autoUpdater.on('error', (err) => {
      const msg = (() => {
        try {
          return String(err?.message || err || '');
        } catch {
          return '';
        }
      })();
      setUpdaterState({ status: 'error', error: msg || 'Update failed', progress: null });
    });

    ipcMain.handle('mirachpos.updater.getState', async () => {
      return updaterState;
    });
    ipcMain.handle('mirachpos.updater.check', async () => {
      try {
        if (!autoUpdater) return { ok: false };
        await autoUpdater.checkForUpdates();
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
    ipcMain.handle('mirachpos.updater.download', async () => {
      try {
        if (!autoUpdater) return { ok: false };
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
    ipcMain.handle('mirachpos.updater.quitAndInstall', async () => {
      try {
        if (!autoUpdater) return { ok: false };
        autoUpdater.quitAndInstall();
        return { ok: true };
      } catch {
        return { ok: false };
      }
    });
  } catch {
    // ignore
  }
};

app.whenReady().then(async () => {
  await startApiServerIfNeeded();

  wireAutoUpdater();

  ipcMain.handle('mirachpos.db.get', async (_evt, key) => {
    return db.get(String(key || ''));
  });
  ipcMain.handle('mirachpos.db.set', async (_evt, key, value) => {
    return db.set(String(key || ''), value);
  });

  ipcMain.handle('mirachpos.auth.cacheStaff', async (_evt, payload) => {
    return db.cacheStaffCredentials ? db.cacheStaffCredentials(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.auth.offlineLogin', async (_evt, payload) => {
    return db.offlineLogin ? db.offlineLogin(payload) : { ok: false, error: 'offline_not_supported' };
  });
  ipcMain.handle('mirachpos.auth.getLastSession', async () => {
    return db.getLastSession ? db.getLastSession() : null;
  });

  ipcMain.handle('mirachpos.auth.cacheStaffCode', async (_evt, payload) => {
    return db.cacheStaffCodeCredentials ? db.cacheStaffCodeCredentials(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.auth.offlineLoginByCode', async (_evt, payload) => {
    return db.offlineLoginByCode ? db.offlineLoginByCode(payload) : { ok: false, error: 'offline_not_supported' };
  });

  ipcMain.handle('mirachpos.pos.getState', async (_evt, scopeKey) => {
    return db.getPosState ? db.getPosState(String(scopeKey || '')) : null;
  });
  ipcMain.handle('mirachpos.pos.setState', async (_evt, scopeKey, value) => {
    return db.setPosState ? db.setPosState(String(scopeKey || ''), value) : false;
  });

  ipcMain.handle('mirachpos.pos.upsertTables', async (_evt, payload) => {
    return db.posUpsertRestaurantTables ? db.posUpsertRestaurantTables(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.pos.listTables', async (_evt, payload) => {
    return db.posListRestaurantTables ? db.posListRestaurantTables(payload) : [];
  });

  ipcMain.handle('mirachpos.pos.upsertProducts', async (_evt, payload) => {
    return db.posUpsertProducts ? db.posUpsertProducts(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.pos.listProducts', async (_evt, payload) => {
    return db.posListProducts ? db.posListProducts(payload) : [];
  });

  ipcMain.handle('mirachpos.pos.upsertOrderBundle', async (_evt, payload) => {
    return db.posUpsertOrderBundle ? db.posUpsertOrderBundle(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.pos.getOrderBundle', async (_evt, payload) => {
    return db.posGetOrderBundle ? db.posGetOrderBundle(payload) : null;
  });
  ipcMain.handle('mirachpos.pos.listOrders', async (_evt, payload) => {
    return db.posListOrders ? db.posListOrders(payload) : [];
  });

  ipcMain.handle('mirachpos.outbox.enqueue', async (_evt, payload) => {
    return db.outboxEnqueue ? db.outboxEnqueue(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.outbox.listReady', async (_evt, payload) => {
    return db.outboxListReady ? db.outboxListReady(payload) : [];
  });
  ipcMain.handle('mirachpos.outbox.stats', async (_evt, payload) => {
    return db.outboxStats ? db.outboxStats(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.outbox.ack', async (_evt, payload) => {
    return db.outboxAck ? db.outboxAck(payload) : { ok: false };
  });
  ipcMain.handle('mirachpos.outbox.bump', async (_evt, payload) => {
    return db.outboxBumpAttempt ? db.outboxBumpAttempt(payload) : { ok: false };
  });

  mainWindow = await createMainWindow();
  broadcastUpdaterState();

  if (!isDev && autoUpdater) {
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // ignore
    }
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    if (apiProc && !apiProc.killed) apiProc.kill();
  } catch {
    // ignore
  }
});
