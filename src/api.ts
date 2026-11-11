import os from 'node:os';
import { configDir, configFile, loadConfig, updateConfig } from './config.js';
import { mkdir } from 'node:fs/promises';
import { ARTWORK_KINDS } from './artwork/kinds.js';
import { artworkCacheDir, fillCache, isPending, readCache, readCachedArtwork } from './artwork/cache.js';
import { artworkUrl, ARTWORK_SCHEME, cacheArtworkUrl, listArtwork, readArtworkFile, type ArtworkResponse } from './artwork/files.js';
import { SteamGridDbClient } from './artwork/steamgriddb.js';
import { loadSettings, resetSettings, updateSettings } from './settings.js';
import { SECURE_STORAGE_UNAVAILABLE, type SecretStore } from './secrets.js';
import { openUser, resolveGames, runSync, scanApps, scanIntegrations, knownGames, type AppContext } from './app.js';
import { dedupeGames, gameKey, type KnownGames } from './dedupe.js';
import { availableIntegrations, integrations } from './integrations/index.js';
import type { AboutInfo, ApiKeyStatus, ApiKeyTest, AppInfo, ArtworkEntry, ArtworkGame, ArtworkItem, ArtworkRequest, ArtworkResult, GamesReport, GamesRequest, IntegrationInfo, Lists, Settings, SettingsPatch, ShortcutInfo, SteamAccountInfo, SteamManagerApi, StatusInfo, SyncReport, SyncRequest } from './ipc.js';
import { findSteamRoot, listAccounts } from './steam/locate.js';
import { defaultRunner, isSteamRunning } from './steam/running.js';
import { computeAppId, isManaged, MANAGED_TAG, quote, shortcutAppId, shortcutTags, shortcutTitle } from './steam/shortcuts.js';
import type { SyncGame } from './steam/sync.js';
import { loadShortcuts } from './steam/store.js';
import type { VdfMap } from './vdf/types.js';

/** Everything with side effects; the `log` is supplied per call. */
export type ApiDeps = Omit<AppContext, 'log'> & {
  /** Encrypted storage for the SteamGridDB key (the desktop app provides it). */
  secrets?: SecretStore;
  /** The app version to show in settings. */
  version?: string;
  /** Opens a folder in the file manager (the desktop app provides it). */
  openPath?: (folder: string) => Promise<void>;
};

const API_KEY = 'steamgriddb';

/** The real machine: used by the Electron app. */
export function systemDeps(): ApiDeps {
  return {
    platform: process.platform,
    home: os.homedir(),
    env: process.env,
    runner: defaultRunner,
    fetchFn: fetch,
    integrations,
  };
}

/** Validates a sync request that came from the (untrusted) renderer. */
export function parseSyncRequest(value: unknown): SyncRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid sync request');
  const request = value as Record<string, unknown>;
  const only = request['only'];
  if (only !== undefined && (!Array.isArray(only) || only.some((id) => typeof id !== 'string'))) {
    throw new Error('Invalid sync request: "only" must be a list of integration ids');
  }
  return {
    dryRun: request['dryRun'] !== false,
    prune: request['prune'] === true,
    includeMaybe: request['includeMaybe'] === true,
    artwork: request['artwork'] !== false,
    only: only === undefined || only.length === 0 ? undefined : (only as string[]),
  };
}

/** Validates a games request that came from the (untrusted) renderer. */
export function parseGamesRequest(value: unknown): GamesRequest {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid games request');
  return { includeMaybe: (value as Record<string, unknown>)['includeMaybe'] === true };
}

/** Validates an artwork download request that came from the (untrusted) renderer. */
export function parseArtworkRequest(value: unknown): ArtworkRequest {
  const request = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const { appId, title } = request;
  if (typeof appId !== 'number' || !Number.isInteger(appId) || appId < 0) throw new Error('Invalid artwork request: appId must be a whole number');
  if (typeof title !== 'string' || title.trim() === '') throw new Error('Invalid artwork request: title is required');
  return { appId, title: title.trim(), force: request['force'] === true };
}

/**
 * Answers requests for `steam-manager-art://grid/<file>` (Steam's grid folder) and
 * `steam-manager-art://cache/<game>/<file>` (the app's artwork cache). Used by the desktop app so the
 * page can show images without any file access.
 */
export function createArtworkServer(deps: ApiDeps): (url: string) => Promise<ArtworkResponse> {
  return async (url) => {
    let host: string;
    let parts: string[];
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== `${ARTWORK_SCHEME}:`) return { status: 400 };
      host = parsed.hostname;
      parts = parsed.pathname.split('/').slice(1).map(decodeURIComponent);
    } catch {
      return { status: 400 };
    }
    if (host === 'cache' && parts.length === 2) {
      return readCachedArtwork(artworkCacheDir(configDir(deps.platform, deps.home, deps.env)), parts[0] as string, parts[1] as string);
    }
    if (host !== 'grid' || parts.length !== 1) return { status: 400 };
    try {
      const { gridDir } = await openUser({ ...deps, log: console.debug }, {});
      return await readArtworkFile(gridDir, parts[0] as string);
    } catch {
      return { status: 404 };
    }
  };
}

/** The CLI's commands as data, for UIs. Never throws for "Steam not found" in `status`; `sync` reports errors in the result. */
export function createApi(deps: ApiDeps): SteamManagerApi {
  /** Read-only calls log nothing the UI needs; anything unexpected goes to the console. */
  const context = (log: (message: string) => void = console.debug): AppContext => ({ ...deps, log });
  const dir = (): string => configDir(deps.platform, deps.home, deps.env);

  /** The key to download artwork with: the one saved in the app, else the environment variable. */
  async function apiKey(): Promise<string | undefined> {
    return (await deps.secrets?.get(API_KEY)) || deps.env['STEAMGRIDDB_API_KEY'] || undefined;
  }

  /** What each game has: the image in Steam's grid folder if there is one, else the app's cached copy. */
  async function artwork(games: ArtworkGame[]): Promise<Record<number, ArtworkEntry>> {
    if (!Array.isArray(games) || games.some((game) => !Number.isInteger(game?.appId) || typeof game.title !== 'string')) throw new Error('Invalid games');
    let grid: Awaited<ReturnType<typeof listArtwork>> = [];
    try {
      grid = await listArtwork((await openUser(context(), {})).gridDir, new Set(games.map((game) => game.appId)));
    } catch {
      // without Steam there is only the cache
    }
    const cacheRoot = artworkCacheDir(dir());
    const now = Date.now();
    const found: Record<number, ArtworkEntry> = {};
    for (const { appId, title } of games) {
      const items = new Map<ArtworkItem['kind'], ArtworkItem>();
      const cached = await readCache(cacheRoot, title);
      for (const [kind, { file, version }] of cached?.files ?? []) items.set(kind, { kind, url: cacheArtworkUrl(cached?.key as string, file, version) });
      for (const file of grid.filter((candidate) => candidate.appId === appId)) items.set(file.kind, { kind: file.kind, url: artworkUrl(file.file, file.version) });
      found[appId] = { items: ARTWORK_KINDS.filter((kind) => items.has(kind)).map((kind) => items.get(kind) as ArtworkItem), pending: isPending(cached, now) };
    }
    return found;
  }

  async function apiKeyStatus(): Promise<ApiKeyStatus> {
    const saved = await deps.secrets?.get(API_KEY);
    const fromEnv = deps.env['STEAMGRIDDB_API_KEY'];
    return {
      set: Boolean(saved || fromEnv),
      source: saved ? 'saved' : fromEnv ? 'environment' : 'none',
      secureStorage: (await deps.secrets?.available()) === true,
    };
  }

  return {
    async status(): Promise<StatusInfo> {
      const info: StatusInfo = { platform: deps.platform, steamRunning: await isSteamRunning(deps.platform, deps.runner) };
      try {
        const { root: steamRoot, accountId } = await openUser(context(), {});
        return { ...info, steamRoot, accountId };
      } catch (error) {
        return { ...info, error: (error as Error).message };
      }
    },

    async shortcuts(): Promise<ShortcutInfo[]> {
      const user = await openUser(context(), {});
      return (await loadShortcuts(user.configDir)).map((entry) => ({
        appId: shortcutAppId(entry),
        title: shortcutTitle(entry),
        tags: shortcutTags(entry).filter((tag) => tag !== MANAGED_TAG),
        managed: isManaged(entry),
      }));
    },

    async integrations(): Promise<IntegrationInfo[]> {
      const { launchers } = await loadSettings(dir());
      return availableIntegrations(deps.platform, deps.integrations).map(({ id, label }) => ({ id, label, enabled: !launchers.disabled.includes(id) }));
    },

    async apps(all: boolean): Promise<AppInfo[]> {
      const found = await scanApps(context(), all === true);
      return found.map(({ app, verdict, reason }) => ({ id: app.id, name: app.name, verdict, reason }));
    },

    async games(request: GamesRequest): Promise<GamesReport> {
      const { includeMaybe } = parseGamesRequest(request);
      const ctx = context();
      const config = await loadConfig(configDir(deps.platform, deps.home, deps.env));
      const { launchers } = await loadSettings(dir());
      const selected = availableIntegrations(deps.platform, deps.integrations).filter((integration) => !launchers.disabled.includes(integration.id));
      const { games, warnings } = await scanIntegrations(ctx, selected, { includeMaybe, allow: config.allow, deny: config.deny });

      // Without Steam we can still list the games; there is just nothing to compare them with.
      let existing: VdfMap[] = [];
      let known: KnownGames = { titles: new Map(), launchKeys: new Map() };
      try {
        const user = await openUser(ctx, {});
        existing = await loadShortcuts(user.configDir);
        known = await knownGames(user, existing);
      } catch {
        // reported by `status`
      }

      const { unique, duplicates } = dedupeGames(games, known);
      const targets = await resolveGames(ctx, unique, false);
      const ours = new Set(existing.filter(isManaged).map(shortcutAppId));
      const excluded = new Set(config.exclude);
      return {
        games: unique.map((game, index) => {
          const appId = computeAppId(quote((targets[index] as SyncGame).exe), game.title);
          const key = gameKey(game);
          return { key, store: game.store, id: game.id, title: game.title, appId, weak: game.weak === true, inSteam: ours.has(appId), excluded: excluded.has(key) };
        }),
        duplicates: duplicates.map(({ game, of }) => ({ title: game.title, store: game.store, of })),
        warnings,
      };
    },

    async setExcluded(keys: string[], excluded: boolean): Promise<void> {
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) throw new Error('Invalid game keys');
      const dir = configDir(deps.platform, deps.home, deps.env);
      const switchedOff = new Set((await loadConfig(dir)).exclude);
      for (const key of keys) {
        if (excluded === true) switchedOff.add(key);
        else switchedOff.delete(key);
      }
      await updateConfig(dir, { exclude: [...switchedOff].sort() });
    },

    async settings(): Promise<Settings> {
      return loadSettings(dir());
    },

    async updateSettings(patch: SettingsPatch): Promise<Settings> {
      return updateSettings(dir(), patch);
    },

    async resetSettings(): Promise<Settings> {
      return resetSettings(dir());
    },

    async lists(): Promise<Lists> {
      const { allow, deny, exclude } = await loadConfig(dir());
      return { allow, deny, exclude };
    },

    async setLists(patch: Partial<Lists>): Promise<Lists> {
      if (typeof patch !== 'object' || patch === null) throw new Error('Invalid lists');
      const next: Partial<Lists> = {};
      for (const name of ['allow', 'deny', 'exclude'] as const) {
        const value = patch[name];
        if (value === undefined) continue;
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`Invalid ${name} list`);
        next[name] = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
      }
      const { allow, deny, exclude } = await updateConfig(dir(), next);
      return { allow, deny, exclude };
    },

    apiKeyStatus,

    async setApiKey(key: string): Promise<ApiKeyStatus> {
      if (typeof key !== 'string') throw new Error('Invalid API key');
      if (!deps.secrets) throw new Error(SECURE_STORAGE_UNAVAILABLE);
      if (key.trim() === '') await deps.secrets.remove(API_KEY);
      else await deps.secrets.set(API_KEY, key.trim());
      return apiKeyStatus();
    },

    async testApiKey(key?: string): Promise<ApiKeyTest> {
      const candidate = (typeof key === 'string' && key.trim()) || (await apiKey());
      if (!candidate) return { ok: false, message: 'There is no API key to test.' };
      try {
        await new SteamGridDbClient(candidate, deps.fetchFn).searchGame('Half-Life');
        return { ok: true, message: 'The key works.' };
      } catch (error) {
        const message = (error as Error).message;
        return { ok: false, message: /HTTP 40[13]/.test(message) ? 'SteamGridDB rejected this key.' : message };
      }
    },

    async steamAccounts(): Promise<SteamAccountInfo[]> {
      try {
        const { steam } = await loadSettings(dir());
        return await listAccounts(steam.dir || (await findSteamRoot(deps)));
      } catch {
        return []; // `status` explains why Steam was not found
      }
    },

    async about(): Promise<AboutInfo> {
      const info: AboutInfo = {
        version: deps.version ?? 'dev',
        platform: deps.platform,
        configFile: configFile(dir()),
        artworkCache: artworkCacheDir(dir()),
        secureStorage: (await deps.secrets?.available()) === true,
      };
      try {
        return { ...info, steamRoot: (await openUser(context(), {})).root };
      } catch {
        return info;
      }
    },

    async openConfigFolder(): Promise<void> {
      if (!deps.openPath) throw new Error('Opening folders is not available here.');
      await mkdir(dir(), { recursive: true });
      await deps.openPath(dir());
    },

    artwork,

    async downloadArtwork(request: ArtworkRequest): Promise<ArtworkResult> {
      const { appId, title, force } = parseArtworkRequest(request);
      const key = await apiKey();
      if (!key) throw new Error('Add a SteamGridDB API key in Settings to download artwork.');
      const outcomes = await fillCache({ cacheRoot: artworkCacheDir(dir()), title, client: new SteamGridDbClient(key, deps.fetchFn), fetchFn: deps.fetchFn, force });
      const { items, pending } = (await artwork([{ appId, title }]))[appId] as ArtworkEntry;
      return { outcomes: outcomes.map(({ kind, status, error }) => ({ kind, status, error })), items, pending };
    },

    async sync(request: SyncRequest): Promise<SyncReport> {
      const options = parseSyncRequest(request);
      const report: SyncReport = { log: [], added: [], updated: [], removed: [], unchanged: [], skipped: [] };
      try {
        const result = await runSync(context((line) => report.log.push(line)), { ...options, apiKey: await apiKey() });
        if (result) {
          report.added = result.added;
          report.updated = result.updated;
          report.removed = result.removed;
          report.unchanged = result.unchanged;
          report.skipped = result.skipped;
        }
      } catch (error) {
        report.error = (error as Error).message;
      }
      return report;
    },
  };
}
