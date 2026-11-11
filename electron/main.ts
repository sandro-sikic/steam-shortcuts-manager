import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, systemDeps } from '../src/api.js';
import { registerIpc } from '../src/ipc.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `npm run dev` passes --dev to load the Vite dev server instead of the built UI. */
const dev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173';

function isAppUrl(url: string): boolean {
  return dev ? url.startsWith(DEV_URL) : url.startsWith('file://');
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 480,
    title: 'Steam Manager',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The UI is local-only: never navigate it away, and open web links in the user's browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });

  if (dev) void window.loadURL(DEV_URL);
  else void window.loadFile(path.join(here, '..', '..', 'dist-ui', 'index.html'));
}

app.whenReady().then(() => {
  registerIpc(ipcMain, createApi(systemDeps()));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
