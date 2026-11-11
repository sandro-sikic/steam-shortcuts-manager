import { ARTWORK_KINDS } from '../artwork/kinds.js';
import { coverHue, initials } from './cover.js';
import type { ApiKeyStatus, AppInfo, ArtworkChoice, ArtworkEntry, ArtworkKind, ArtworkResult, GameInfo, GamesReport, Lists, ShortcutInfo, SteamManagerApi, SyncItemInfo, SyncReport, SyncRequest } from '../ipc.js';
import { applySettings, DEFAULT_SETTINGS } from '../settingsModel.js';

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

const IMAGE_SIZE: Record<ArtworkKind, [number, number]> = { poster: [600, 900], wide: [920, 430], hero: [1920, 620], logo: [800, 310], icon: [256, 256] };

/** A generated stand-in for a SteamGridDB image: coloured by the title, labelled with it. */
function demoImage(kind: ArtworkKind, title: string, variant = 0): string {
  const [width, height] = IMAGE_SIZE[kind];
  const hue = coverHue(title) + variant * 47;
  const name = (kind === 'icon' ? initials(title) : title).replace(/[<>&]/g, '');
  const label = variant === 0 ? name : `${name} ${variant + 1}`;
  const background = kind === 'logo' ? '' : `<rect width='${width}' height='${height}' fill='url(#g)'/>`;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} ${height}'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${hue} 60% 45%)'/><stop offset='1' stop-color='hsl(${hue + 40} 55% 20%)'/></linearGradient></defs>` +
    `${background}<text x='50%' y='54%' text-anchor='middle' font-family='sans-serif' font-weight='700' font-size='${Math.round(Math.min(width, height) / 5)}' fill='white'>${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * A stand-in for the Electron bridge with in-memory example data, so the UI can be developed in a
 * plain browser (`npm run ui:dev`). It is installed only when the real bridge is missing.
 * Downloading artwork takes `delayMs` so that progress can be seen.
 */
export function createDemoBridge({ delayMs = 350 }: { delayMs?: number } = {}): SteamManagerApi {
  const appIdOf = (game: DemoGame): number => 1000 + DEMO_GAMES.indexOf(game);
  const excluded = new Set<string>();
  /** What is "downloaded" per shortcut ID: the selected image of each kind, whether every option was listed, and the user's picks. */
  interface DemoArt {
    title: string;
    kinds: Set<ArtworkKind>;
    listed: boolean;
    picks: Partial<Record<ArtworkKind, number | null>>;
  }
  const art = new Map<number, DemoArt>([
    [appIdOf(DEMO_GAMES[0] as DemoGame), { title: 'Fortnite', kinds: new Set(ARTWORK_KINDS), listed: false, picks: {} }],
    [appIdOf(DEMO_GAMES[2] as DemoGame), { title: 'Hades', kinds: new Set<ArtworkKind>(['poster', 'hero']), listed: false, picks: {} }],
  ]);
  const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));
  const imageId = (kind: ArtworkKind, index: number): number => (ARTWORK_KINDS.indexOf(kind) + 1) * 1000 + index;
  /** The options of one kind: every fourth is marked adult, and hidden unless the setting allows it. */
  const choiceOf = (entry: DemoArt, kind: ArtworkKind): ArtworkChoice => {
    const all = Array.from({ length: settings.artwork.options }, (_, index) => index).filter((index) => settings.artwork.nsfw || index % 4 !== 3);
    const [width, height] = IMAGE_SIZE[kind];
    const options = all.map((index) => {
      const url = demoImage(kind, entry.title, index);
      return { id: imageId(kind, index), style: index % 2 === 0 ? 'alternate' : 'material', width, height, nsfw: index % 4 === 3, thumbUrl: url, fullUrl: url };
    });
    const pick = entry.picks[kind];
    const picked = options.find((option) => option.id === pick);
    return { options, selected: pick === null ? null : (picked ?? options[0])?.id };
  };
  const entryOf = (entry?: DemoArt): ArtworkEntry => {
    const result: ArtworkEntry = { items: [], choices: {}, pending: !entry || entry.kinds.size < ARTWORK_KINDS.length, optionsReady: entry?.listed === true };
    if (!entry) return result;
    for (const kind of ARTWORK_KINDS) {
      const choice = entry.listed ? choiceOf(entry, kind) : undefined;
      if (choice) result.choices[kind] = choice;
      if (choice?.selected === null || !entry.kinds.has(kind)) continue;
      const index = choice?.options.findIndex((option) => option.id === choice.selected) ?? 0;
      result.items.push({ kind, url: demoImage(kind, entry.title, Math.max(index, 0)) });
    }
    return result;
  };
  const fill = async ({ appId, title, force }: { appId: number; title: string; force: boolean }, listed: boolean): Promise<ArtworkResult> => {
    if (apiKey === '') throw new Error('Add a SteamGridDB API key in Settings to download artwork.');
    await pause();
    const entry = art.get(appId) ?? { title, kinds: new Set<ArtworkKind>(), listed: false, picks: {} };
    const outcomes = ARTWORK_KINDS.map((kind) => ({ kind, status: entry.kinds.has(kind) && !force ? ('exists' as const) : ('saved' as const) }));
    for (const kind of ARTWORK_KINDS) entry.kinds.add(kind);
    entry.listed ||= listed;
    art.set(appId, entry);
    return { outcomes, entry: entryOf(entry) };
  };
  let settings = structuredClone(DEFAULT_SETTINGS);
  let allow: string[] = [];
  let deny: string[] = ['Some Tool'];
  let apiKey = '';
  const keyStatus = (): ApiKeyStatus => ({ set: apiKey !== '', source: apiKey === '' ? 'none' : 'saved', secureStorage: true });
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
    integrations: async () =>
      [
        { id: 'epic', label: 'Epic Games' },
        { id: 'gog', label: 'GOG Galaxy' },
        { id: 'heroic', label: 'Heroic Games Launcher' },
        { id: 'os', label: 'Installed Apps' },
      ].map((integration) => ({ ...integration, enabled: !settings.launchers.disabled.includes(integration.id) })),
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
    settings: async () => structuredClone(settings),
    updateSettings: async (patch) => {
      settings = applySettings(settings, patch);
      return structuredClone(settings);
    },
    resetSettings: async () => {
      settings = structuredClone(DEFAULT_SETTINGS);
      return structuredClone(settings);
    },
    lists: async (): Promise<Lists> => ({ allow: [...allow], deny: [...deny], exclude: [...excluded].sort() }),
    setLists: async (patch) => {
      allow = patch.allow ?? allow;
      deny = patch.deny ?? deny;
      if (patch.exclude) {
        excluded.clear();
        for (const key of patch.exclude) excluded.add(key);
      }
      return { allow: [...allow], deny: [...deny], exclude: [...excluded].sort() };
    },
    apiKeyStatus: async () => keyStatus(),
    setApiKey: async (key) => {
      apiKey = key.trim();
      return keyStatus();
    },
    testApiKey: async (key) => {
      const candidate = key?.trim() || apiKey;
      if (!candidate) return { ok: false, message: 'There is no API key to test.' };
      return candidate.length >= 8 ? { ok: true, message: 'The key works.' } : { ok: false, message: 'SteamGridDB rejected this key.' };
    },
    steamAccounts: async () => [
      { accountId: '1', name: 'demo_player', mostRecent: true },
      { accountId: '2', name: '', mostRecent: false },
    ],
    about: async () => ({ version: 'demo', platform: 'demo', configFile: '/demo/steam-manager/config.json', artworkCache: '/demo/steam-manager/artwork-cache', steamRoot: '/demo/Steam', secureStorage: true }),
    openConfigFolder: async () => undefined,
    artwork: async (games) => Object.fromEntries(games.map(({ appId }) => [appId, entryOf(art.get(appId))])),
    downloadArtwork: (request) => fill(request, false),
    loadArtworkOptions: (request) => fill(request, true),
    chooseArtwork: async ({ appId, title, kind, imageId: picked }) => {
      const entry = art.get(appId) ?? { title, kinds: new Set<ArtworkKind>(), listed: false, picks: {} };
      entry.picks[kind] = picked;
      if (picked !== null) entry.kinds.add(kind);
      art.set(appId, entry);
      return { entry: entryOf(entry) };
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
