import { app, BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, systemDeps } from '../src/api.js';
import { configDir } from '../src/config.js';
import { registerIpc } from '../src/ipc.js';
import { createSecretStore, type Encryptor } from '../src/secrets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** `npm run dev` passes --dev to load the Vite dev server instead of the built UI. */
const dev = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:5173';

/**
 * The OS keychain. On Linux without a keyring Electron falls back to "basic_text", which is not
 * encryption, so that counts as unavailable and the key is not stored.
 */
const encryptor: Encryptor = {
  isAvailable: async () =>
    (await safeStorage.isAsyncEncryptionAvailable()) && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
  encrypt: (plain) => safeStorage.encryptStringAsync(plain),
  decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result,
};

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
  const deps = systemDeps();
  registerIpc(
    ipcMain,
    createApi({
      ...deps,
      secrets: createSecretStore(configDir(deps.platform, deps.home, deps.env), encryptor),
      version: app.getVersion(),
      openPath: async (folder) => {
        const error = await shell.openPath(folder);
        if (error) throw new Error(error);
      },
    }),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
