import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { CHANNELS, registerIpc, type SteamManagerApi } from '../src/ipc.js';

function fakeApi(): { [K in keyof SteamManagerApi]: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn(async () => 'status'),
    shortcuts: vi.fn(async () => 'shortcuts'),
    integrations: vi.fn(async () => 'integrations'),
    apps: vi.fn(async () => 'apps'),
    sync: vi.fn(async () => 'sync'),
    games: vi.fn(async () => 'games'),
    setExcluded: vi.fn(async () => 'setExcluded'),
    settings: vi.fn(async () => 'settings'),
    updateSettings: vi.fn(async () => 'updateSettings'),
    resetSettings: vi.fn(async () => 'resetSettings'),
    lists: vi.fn(async () => 'lists'),
    setLists: vi.fn(async () => 'setLists'),
    apiKeyStatus: vi.fn(async () => 'apiKeyStatus'),
    setApiKey: vi.fn(async () => 'setApiKey'),
    testApiKey: vi.fn(async () => 'testApiKey'),
    steamAccounts: vi.fn(async () => 'steamAccounts'),
    about: vi.fn(async () => 'about'),
    openConfigFolder: vi.fn(async () => 'openConfigFolder'),
    artwork: vi.fn(async () => 'artwork'),
    downloadArtwork: vi.fn(async () => 'downloadArtwork'),
  };
}

describe('registerIpc', () => {
  it('handles every channel by calling the matching API method with the renderer arguments', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const api = fakeApi();
    registerIpc({ handle: (channel, listener) => void handlers.set(channel, listener) }, api as unknown as SteamManagerApi);

    expect([...handlers.keys()].sort()).toEqual(Object.values(CHANNELS).sort());
    for (const method of Object.keys(CHANNELS) as (keyof SteamManagerApi)[]) {
      const result = await handlers.get(CHANNELS[method])?.({ sender: 'ignored' }, 'arg1', 'arg2');
      expect(result).toBe(method);
      expect(api[method]).toHaveBeenCalledWith('arg1', 'arg2');
    }
  });

  it('uses unique, namespaced channel names', () => {
    const names = Object.values(CHANNELS);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => name.startsWith('steam-manager:'))).toBe(true);
  });
});

describe('preload script', () => {
  it('exposes every API method on the channel the main process handles', async () => {
    const preload = await readFile(new URL('../electron/preload.cts', import.meta.url), 'utf8');
    expect(preload).toContain("contextBridge.exposeInMainWorld('steamManager'");
    for (const [method, channel] of Object.entries(CHANNELS)) {
      expect(preload).toContain(`${method}: `);
      expect(preload).toContain(`ipcRenderer.invoke('${channel}'`);
    }
  });
});
