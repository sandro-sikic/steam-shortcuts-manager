import { vi } from 'vitest';
import type { AboutInfo, ApiKeyStatus, GameInfo, GamesReport, IntegrationInfo, Lists, ShortcutInfo, StatusInfo, SteamAccountInfo, SteamManagerApi, SyncReport } from '../../src/ipc.js';
import { applySettings, DEFAULT_SETTINGS, type Settings } from '../../src/settingsModel.js';

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
  { id: 'epic', label: 'Epic Games', enabled: true },
  { id: 'gog', label: 'GOG Galaxy', enabled: true },
];

export const settings: Settings = structuredClone(DEFAULT_SETTINGS);
export const lists: Lists = { allow: ['Some Game'], deny: ['Some Tool'], exclude: ['Epic Games:rl', 'GOG Galaxy:hades'] };
export const keyStatus: ApiKeyStatus = { set: false, source: 'none', secureStorage: true };
export const accounts: SteamAccountInfo[] = [
  { accountId: '42', name: 'player_one', mostRecent: true },
  { accountId: '7', name: '', mostRecent: false },
];
export const about: AboutInfo = { version: '1.2.3', platform: 'linux', configFile: '/home/me/.config/steam-manager/config.json', artworkCache: '/home/me/.config/steam-manager/artwork-cache', steamRoot: '/home/me/.steam/steam', secureStorage: true };

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
    settings: vi.fn(async () => structuredClone(settings)),
    updateSettings: vi.fn(async (patch: object) => applySettings(settings, patch)),
    resetSettings: vi.fn(async () => structuredClone(DEFAULT_SETTINGS)),
    lists: vi.fn(async () => structuredClone(lists)),
    setLists: vi.fn(async (patch: Partial<Lists>) => ({ ...structuredClone(lists), ...patch })),
    apiKeyStatus: vi.fn(async () => keyStatus),
    setApiKey: vi.fn(async () => keyStatus),
    testApiKey: vi.fn(async () => ({ ok: true, message: 'The key works.' })),
    steamAccounts: vi.fn(async () => accounts),
    about: vi.fn(async () => about),
    openConfigFolder: vi.fn(async () => undefined),
    artwork: vi.fn(async () => ({})),
    downloadArtwork: vi.fn(async () => ({ outcomes: [], items: [], pending: false })),
    ...overrides,
  };
  window.steamManager = mock as unknown as SteamManagerApi;
  return mock;
}
