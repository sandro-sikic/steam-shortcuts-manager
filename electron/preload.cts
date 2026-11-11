// Runs in the sandboxed preload context, which can only require 'electron' (no local modules),
// so the channel names are repeated here; test/ipc.test.ts checks they match src/ipc.ts.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('steamManager', {
  status: () => ipcRenderer.invoke('steam-manager:status'),
  shortcuts: () => ipcRenderer.invoke('steam-manager:shortcuts'),
  integrations: () => ipcRenderer.invoke('steam-manager:integrations'),
  apps: (all: boolean) => ipcRenderer.invoke('steam-manager:apps', all),
  sync: (request: unknown) => ipcRenderer.invoke('steam-manager:sync', request),
});
