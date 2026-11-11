import type { AppInfo, ShortcutInfo, SteamManagerApi, SyncItemInfo, SyncReport, SyncRequest } from '../ipc.js';

/** Example games the demo "finds" on sync. */
const DEMO_GAMES = [
  { title: 'Hades', store: 'GOG Galaxy' },
  { title: 'Stardew Valley', store: 'Installed Apps' },
  { title: 'Valorant', store: 'Riot Games' },
];

/**
 * A stand-in for the Electron bridge with in-memory example data, so the UI can be developed in a
 * plain browser (`npm run ui:dev`). It is installed only when the real bridge is missing.
 */
export function createDemoBridge(): SteamManagerApi {
  let nextId = 100;
  let shortcuts: ShortcutInfo[] = [
    { appId: 1, title: 'Fortnite', tags: ['Epic Games'], managed: true },
    { appId: 2, title: 'My Own Game', tags: [], managed: false },
  ];

  return {
    status: async () => ({ platform: 'demo', steamRunning: false, steamRoot: '/demo/Steam', accountId: '1' }),
    shortcuts: async () => shortcuts.map((shortcut) => ({ ...shortcut })),
    integrations: async () => [
      { id: 'epic', label: 'Epic Games' },
      { id: 'gog', label: 'GOG Galaxy' },
      { id: 'os', label: 'Installed Apps' },
    ],
    apps: async (all): Promise<AppInfo[]> => {
      const found: AppInfo[] = DEMO_GAMES.map(({ title }) => ({ id: title.toLowerCase(), name: title, verdict: 'game', reason: 'freedesktop-game' }));
      return all ? [...found, { id: 'editor', name: 'Text Editor', verdict: 'no', reason: 'categorized as Utility' }] : found;
    },
    sync: async (request: SyncRequest): Promise<SyncReport> => {
      const known = new Set(shortcuts.map((shortcut) => shortcut.title));
      const toAdd = DEMO_GAMES.filter((game) => !known.has(game.title));
      const item = (game: { title: string; store: string }): SyncItemInfo => ({ appId: nextId, title: game.title, store: game.store });
      const added = toAdd.map(item);
      const prefix = request.dryRun ? '[dry run] ' : '';
      const log = added.length > 0 ? [`${prefix}Added:`, ...toAdd.map((game) => `  ${game.title} [${game.store}]`)] : [];
      log.push(`${prefix}${added.length} added, 0 updated, 0 removed, ${shortcuts.filter((s) => s.managed).length} unchanged`);
      if (!request.dryRun) {
        shortcuts = [...shortcuts, ...toAdd.map((game) => ({ appId: nextId++, title: game.title, tags: [game.store], managed: true }))];
      }
      return { log, added, updated: [], removed: [], unchanged: [], skipped: [] };
    },
  };
}

export function installDemoBridge(): void {
  window.steamManager = createDemoBridge();
}
