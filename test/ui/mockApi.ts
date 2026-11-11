import { vi } from 'vitest';
import type { IntegrationInfo, ShortcutInfo, StatusInfo, SteamManagerApi, SyncReport } from '../../src/ipc.js';

export const okStatus: StatusInfo = { platform: 'linux', steamRunning: false, steamRoot: '/home/me/.steam/steam', accountId: '42' };

export const emptyReport: SyncReport = { log: [], added: [], updated: [], removed: [], unchanged: [], skipped: [] };

export const shortcuts: ShortcutInfo[] = [
  { appId: 1, title: 'Fortnite', tags: ['Epic Games'], managed: true },
  { appId: 2, title: 'My Own Game', tags: [], managed: false },
];

export const integrations: IntegrationInfo[] = [
  { id: 'epic', label: 'Epic Games' },
  { id: 'gog', label: 'GOG Galaxy' },
];

export type MockApi = { [K in keyof SteamManagerApi]: ReturnType<typeof vi.fn> };

/** Installs a fake `window.steamManager` (what the Electron preload script provides). */
export function installApi(overrides: Partial<MockApi> = {}): MockApi {
  const mock: MockApi = {
    status: vi.fn(async () => okStatus),
    shortcuts: vi.fn(async () => shortcuts),
    integrations: vi.fn(async () => integrations),
    apps: vi.fn(async () => []),
    sync: vi.fn(async () => emptyReport),
    ...overrides,
  };
  window.steamManager = mock as unknown as SteamManagerApi;
  return mock;
}
