// Runs in the sandboxed preload context, which can only require 'electron' (no local modules),
// so the channel names are repeated here; test/ipc.test.ts checks they match src/ipc.ts.
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('steamManager', {
  status: () => ipcRenderer.invoke('steam-manager:status'),
  shortcuts: () => ipcRenderer.invoke('steam-manager:shortcuts'),
  integrations: () => ipcRenderer.invoke('steam-manager:integrations'),
  apps: (all: boolean) => ipcRenderer.invoke('steam-manager:apps', all),
  games: (request: unknown) => ipcRenderer.invoke('steam-manager:games', request),
  setExcluded: (keys: string[], excluded: boolean) => ipcRenderer.invoke('steam-manager:set-excluded', keys, excluded),
  sync: (request: unknown) => ipcRenderer.invoke('steam-manager:sync', request),
  settings: () => ipcRenderer.invoke('steam-manager:settings'),
  updateSettings: (patch: unknown) => ipcRenderer.invoke('steam-manager:update-settings', patch),
  resetSettings: () => ipcRenderer.invoke('steam-manager:reset-settings'),
  lists: () => ipcRenderer.invoke('steam-manager:lists'),
  setLists: (patch: unknown) => ipcRenderer.invoke('steam-manager:set-lists', patch),
  apiKeyStatus: () => ipcRenderer.invoke('steam-manager:api-key-status'),
  setApiKey: (key: string) => ipcRenderer.invoke('steam-manager:set-api-key', key),
  testApiKey: (key?: string) => ipcRenderer.invoke('steam-manager:test-api-key', key),
  steamAccounts: () => ipcRenderer.invoke('steam-manager:steam-accounts'),
  about: () => ipcRenderer.invoke('steam-manager:about'),
  openConfigFolder: () => ipcRenderer.invoke('steam-manager:open-config-folder'),
  artwork: (appIds: number[]) => ipcRenderer.invoke('steam-manager:artwork', appIds),
  downloadArtwork: (request: unknown) => ipcRenderer.invoke('steam-manager:download-artwork', request),
  loadArtworkOptions: (request: unknown) => ipcRenderer.invoke('steam-manager:load-artwork-options', request),
  chooseArtwork: (pick: unknown) => ipcRenderer.invoke('steam-manager:choose-artwork', pick),
});
