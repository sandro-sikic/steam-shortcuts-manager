import type { AppInfo, GameInfo, GamesReport, ShortcutInfo, SteamManagerApi, SyncItemInfo, SyncReport, SyncRequest } from '../ipc.js';

interface DemoGame {
  store: string;
  id: string;
  title: string;
  weak?: boolean;
}

/** Example games "found" on the demo computer, grouped by launcher. */
const DEMO_GAMES: DemoGame[] = [
  { store: 'Epic Games', id: 'fn', title: 'Fortnite' },
  { store: 'Epic Games', id: 'rl', title: 'Rocket League' },
  { store: 'GOG Galaxy', id: 'hades', title: 'Hades' },
  { store: 'GOG Galaxy', id: 'cp77', title: 'Cyberpunk 2077' },
  { store: 'Heroic (Epic Games)', id: 'control', title: 'Control' },
  { store: 'Installed Apps', id: 'stardew', title: 'Stardew Valley' },
  { store: 'Installed Apps', id: 'unity', title: 'Tiny Unity Game', weak: true },
];

const keyOf = (game: DemoGame): string => `${game.store}:${game.id}`;

/**
 * A stand-in for the Electron bridge with in-memory example data, so the UI can be developed in a
 * plain browser (`npm run ui:dev`). It is installed only when the real bridge is missing.
 */
export function createDemoBridge(): SteamManagerApi {
  const appIdOf = (game: DemoGame): number => 1000 + DEMO_GAMES.indexOf(game);
  const excluded = new Set<string>();
  let shortcuts: ShortcutInfo[] = [
    { appId: appIdOf(DEMO_GAMES[0] as DemoGame), title: 'Fortnite', tags: ['Epic Games'], managed: true },
    { appId: appIdOf(DEMO_GAMES[2] as DemoGame), title: 'Hades', tags: ['GOG Galaxy'], managed: true },
    { appId: 2, title: 'My Own Game', tags: [], managed: false },
    { appId: 3, title: 'Old Game', tags: ['Epic Games'], managed: true },
  ];
  const inSteam = (game: DemoGame): boolean => shortcuts.some((shortcut) => shortcut.appId === appIdOf(game));
  const listed = (includeMaybe: boolean): DemoGame[] => DEMO_GAMES.filter((game) => includeMaybe || !game.weak);

  return {
    status: async () => ({ platform: 'demo', steamRunning: false, steamRoot: '/demo/Steam', accountId: '1' }),
    shortcuts: async () => shortcuts.map((shortcut) => ({ ...shortcut })),
    integrations: async () => [
      { id: 'epic', label: 'Epic Games' },
      { id: 'gog', label: 'GOG Galaxy' },
      { id: 'heroic', label: 'Heroic Games Launcher' },
      { id: 'os', label: 'Installed Apps' },
    ],
    apps: async (all): Promise<AppInfo[]> => {
      const found: AppInfo[] = DEMO_GAMES.map(({ title }) => ({ id: title.toLowerCase(), name: title, verdict: 'game', reason: 'freedesktop-game' }));
      return all ? [...found, { id: 'editor', name: 'Text Editor', verdict: 'no', reason: 'categorized as Utility' }] : found;
    },
    games: async ({ includeMaybe }): Promise<GamesReport> => ({
      games: listed(includeMaybe).map(
        (game): GameInfo => ({ key: keyOf(game), store: game.store, id: game.id, title: game.title, appId: appIdOf(game), weak: game.weak === true, inSteam: inSteam(game), excluded: excluded.has(keyOf(game)) }),
      ),
      duplicates: [{ title: 'Control', store: 'Installed Apps', of: 'Control [Heroic (Epic Games)]' }],
      warnings: [],
    }),
    setExcluded: async (keys, switchedOff) => {
      for (const key of keys) {
        if (switchedOff) excluded.add(key);
        else excluded.delete(key);
      }
    },
    sync: async (request: SyncRequest): Promise<SyncReport> => {
      const games = listed(request.includeMaybe);
      const item = (game: DemoGame): SyncItemInfo => ({ appId: appIdOf(game), title: game.title, store: game.store });
      const wanted = games.filter((game) => !excluded.has(keyOf(game)));
      const added = wanted.filter((game) => !inSteam(game));
      const unchanged = wanted.filter(inSteam);
      const known = new Set(DEMO_GAMES.map(appIdOf));
      const gone = shortcuts.filter((s) => s.managed && (games.some((game) => excluded.has(keyOf(game)) && appIdOf(game) === s.appId) || (request.prune && !known.has(s.appId))));
      const removed = gone.map((s): SyncItemInfo => ({ appId: s.appId, title: s.title, store: s.tags[0] as string }));

      const prefix = request.dryRun ? '[dry run] ' : '';
      const log: string[] = [];
      if (added.length > 0) log.push(`${prefix}Added:`, ...added.map((game) => `  ${game.title} [${game.store}]`));
      if (removed.length > 0) log.push(`${prefix}Removed:`, ...removed.map((r) => `  ${r.title} [${r.store}]`));
      log.push(`${prefix}${added.length} added, 0 updated, ${removed.length} removed, ${unchanged.length} unchanged`);

      if (!request.dryRun) {
        const goneIds = new Set(gone.map((s) => s.appId));
        shortcuts = [
          ...shortcuts.filter((s) => !goneIds.has(s.appId)),
          ...added.map((game): ShortcutInfo => ({ appId: appIdOf(game), title: game.title, tags: [game.store], managed: true })),
        ];
      }
      return { log, added: added.map(item), updated: [], removed, unchanged: unchanged.map(item), skipped: [] };
    },
  };
}

export function installDemoBridge(): void {
  window.steamManager = createDemoBridge();
}
