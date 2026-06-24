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

const UPDATE_CHECK_INTERVAL_MS = 360 * 60 * 1000;
let updateCheckInterval = null;

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
  const devIcon = path.join(__dirname, '..', 'public', 'app.icon.png');
  const prodIcon = path.join(app.getAppPath(), 'dist', 'app.icon.png');
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
      // Prevent blackout after long inactivity
      backgroundThrottling: false,
      // Disable offscreen rendering to avoid GPU issues
      offscreen: false,
    },
  });

  // Prevent blackout: disable background throttling on the webContents
  win.webContents.setBackgroundThrottling(false);

  // Handle renderer crashes and reload failures
  win.webContents.on('did-fail-load', (_event, _errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      console.log('[Electron] Main frame failed to load, reloading...');
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.reload();
        }
      }, 1000);
    }
  });

  // Handle renderer process crashes
  win.webContents.on('render-process-gone', (_event, details) => {
    console.log('[Electron] Renderer process gone:', details?.reason);
    // Recreate the window if renderer crashes
    if (!win.isDestroyed()) {
      console.log('[Electron] Recreating window after crash...');
      win.destroy();
      setTimeout(() => {
        createMainWindow().then((newWin) => {
          mainWindow = newWin;
          broadcastUpdaterState();
        }).catch((err) => {
          console.error('[Electron] Failed to recreate window:', err);
        });
      }, 500);
    }
  });

  // Handle unresponsive renderer (can happen during long inactivity)
  win.on('unresponsive', () => {
    console.log('[Electron] Window became unresponsive');
    // Force reload to recover
    setTimeout(() => {
      if (!win.isDestroyed() && win.isEnabled()) {
        win.reload();
      }
    }, 3000);
  });

  win.on('responsive', () => {
    console.log('[Electron] Window became responsive again');
  });

  // Prevent suspend/hibernate from causing black screen
  const { powerSaveBlocker } = await import('electron');
  const blockerId = powerSaveBlocker.start('prevent-app-suspension');
  win.on('closed', () => {
    try {
      powerSaveBlocker.stop(blockerId);
    } catch {
      // ignore
    }
  });

  if (isDev) {
    const loadWithRetry = async (retries = 5) => {
      try {
        await win.loadURL(DEV_SERVER_URL);
      } catch (err) {
        if (retries > 0) {
          console.log(`[Electron] Failed to load ${DEV_SERVER_URL}, retrying in 1s...`);
          await new Promise(r => setTimeout(r, 1000));
          return loadWithRetry(retries - 1);
        } else {
          console.error(`[Electron] Could not load ${DEV_SERVER_URL}:`, err);
        }
      }
    };
    await loadWithRetry();
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  return win;
};

const listPrintersSafe = (win) => {
  try {
    if (!win || win.isDestroyed()) return [];
    return win.webContents.getPrintersAsync ? win.webContents.getPrintersAsync() : [];
  } catch {
    return [];
  }
};

const printHtmlToDevice = async ({ html, deviceName, silent }) => {
  const target = mainWindow;
  if (!target || target.isDestroyed()) throw new Error('no_window');
  const content = typeof html === 'string' ? html : '';
  const name = typeof deviceName === 'string' ? deviceName.trim() : '';
  if (!content.trim()) throw new Error('html_required');
  if (!name) throw new Error('device_required');

  const printWin = new BrowserWindow({
    width: 420,
    height: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await printWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const printers = await listPrintersSafe(target);
    const exists = Array.isArray(printers) && printers.some((p) => String(p?.name || '').trim() === name);
    if (!exists) throw new Error('printer_not_found');

    const ok = await printWin.webContents.print({
      silent: silent !== false,
      printBackground: true,
      deviceName: name,
    });
    if (!ok) throw new Error('print_failed');
    return { ok: true };
  } finally {
    try {
      if (!printWin.isDestroyed()) printWin.destroy();
    } catch {
      // ignore
    }
  }
};

const wireAutoUpdater = () => {
  try {
    if (!autoUpdater || isDev) return;

    // Production hardening:
    // GitHubProvider can fall back to parsing GitHub HTML/Atom feeds which sometimes results
    // in 406/404 responses in the wild. Using a generic feed URL to GitHub's "latest" download
    // makes update checks deterministic as long as the release contains latest.yml.
    try {
      autoUpdater.setFeedURL({
        provider: 'generic',
        url: 'https://github.com/firaghost/mirachpos-releases/releases/latest/download',
      });
    } catch {
      // ignore
    }

    try {
      autoUpdater.autoDownload = true;
    } catch {
      // ignore
    }

    try {
      autoUpdater.autoInstallOnAppQuit = true;
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

    autoUpdater.on('before-quit-for-update', () => {
      setUpdaterState({ status: 'installing', error: null });
    });

    autoUpdater.on('error', (err) => {
      const msg = (() => {
        try {
          const raw = String(err?.message || err || '');
          // Keep production UX clean: remove stack traces / huge request dumps.
          const firstLine = raw.split('\n')[0] || raw;
          if (firstLine.toLowerCase().includes('latest.yml')) return 'Update files are missing on the server. Please try again later.';
          if (firstLine.toLowerCase().includes('unable to find latest version')) return 'Unable to check for updates right now. Please try again later.';
          return firstLine || 'Update failed';
        } catch {
          return 'Update failed';
        }
      })();
      setUpdaterState({ status: 'error', error: msg, progress: null });
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
        setUpdaterState({ status: 'installing', error: null });
        autoUpdater.quitAndInstall(true, true);
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

  ipcMain.handle('mirachpos.printers.list', async () => {
    try {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return [];
      const printers = await listPrintersSafe(win);
      if (!Array.isArray(printers)) return [];
      return printers.map((p) => ({
        name: String(p?.name || '').trim(),
        isDefault: Boolean(p?.isDefault),
        status: String(p?.status || '').trim(),
      })).filter((p) => p.name);
    } catch {
      return [];
    }
  });

  ipcMain.handle('mirachpos.printers.printHtml', async (_evt, payload) => {
    const html = payload && typeof payload === 'object' ? payload.html : '';
    const deviceName = payload && typeof payload === 'object' ? payload.deviceName : '';
    const silent = payload && typeof payload === 'object' ? payload.silent : true;
    return await printHtmlToDevice({ html, deviceName, silent });
  });

  mainWindow = await createMainWindow();
  broadcastUpdaterState();

  if (!isDev && autoUpdater) {
    try {
      await autoUpdater.checkForUpdates();
    } catch {
      // ignore
    }

    try {
      if (!updateCheckInterval) {
        updateCheckInterval = setInterval(async () => {
          try {
            if (!autoUpdater) return;
            await autoUpdater.checkForUpdates();
          } catch {
            // ignore
          }
        }, UPDATE_CHECK_INTERVAL_MS);
      }
    } catch {
      // ignore
    }
  }

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow();
      broadcastUpdaterState();
    } else {
      // Restore and focus existing window (prevents black screen after long inactivity)
      const existingWin = BrowserWindow.getAllWindows()[0];
      if (existingWin) {
        if (existingWin.isMinimized()) {
          existingWin.restore();
        }
        existingWin.focus();
        // Force reload if window was in background for long time
        try {
          if (!existingWin.webContents.isLoading()) {
            existingWin.webContents.executeJavaScript('document.visibilityState').catch(() => null);
          }
        } catch {
          // ignore
        }
      }
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
