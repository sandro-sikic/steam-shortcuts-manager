import { vi } from 'vitest';
import type { GameInfo, GamesReport, IntegrationInfo, ShortcutInfo, StatusInfo, SteamManagerApi, SyncReport } from '../../src/ipc.js';

export const okStatus: StatusInfo = { platform: 'linux', steamRunning: false, steamRoot: '/home/me/.steam/steam', accountId: '42' };

export const emptyReport: SyncReport = { log: [], added: [], updated: [], removed: [], unchanged: [], skipped: [] };

const game = (over: Partial<GameInfo> & Pick<GameInfo, 'store' | 'id' | 'title' | 'appId'>): GameInfo => ({
  key: `${over.store}:${over.id}`,
  weak: false,
  inSteam: false,
  excluded: false,
  ...over,
});

/** Epic: one in Steam, one to add. GOG: one in Steam but switched off, one weak guess switched off. */
export const games: GameInfo[] = [
  game({ store: 'Epic Games', id: 'fn', title: 'Fortnite', appId: 1, inSteam: true }),
  game({ store: 'Epic Games', id: 'rl', title: 'Rocket League', appId: 4 }),
  game({ store: 'GOG Galaxy', id: 'hades', title: 'Hades', appId: 5, inSteam: true, excluded: true }),
  game({ store: 'GOG Galaxy', id: 'guess', title: 'Tiny Guess', appId: 6, weak: true, excluded: true }),
];

export const gamesReport: GamesReport = {
  games,
  duplicates: [{ title: 'Control', store: 'Installed Apps', of: 'Control [Heroic (Epic Games)]' }],
  warnings: [],
};

export const shortcuts: ShortcutInfo[] = [
  { appId: 1, title: 'Fortnite', tags: ['Epic Games'], managed: true },
  { appId: 2, title: 'My Own Game', tags: [], managed: false },
  { appId: 3, title: 'Old Game', tags: ['Epic Games'], managed: true },
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
    games: vi.fn(async () => gamesReport),
    setExcluded: vi.fn(async () => undefined),
    sync: vi.fn(async () => emptyReport),
    ...overrides,
  };
  window.steamManager = mock as unknown as SteamManagerApi;
  return mock;
}
