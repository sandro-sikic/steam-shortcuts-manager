import os from 'node:os';
import { configDir, loadConfig, updateConfig } from './config.js';
import { openUser, resolveGames, runSync, scanApps, scanIntegrations, knownGames, type AppContext } from './app.js';
import { dedupeGames, gameKey, type KnownGames } from './dedupe.js';
import { availableIntegrations, integrations } from './integrations/index.js';
import type { AppInfo, GamesReport, GamesRequest, IntegrationInfo, ShortcutInfo, SteamManagerApi, StatusInfo, SyncReport, SyncRequest } from './ipc.js';
import { findSteamRoot, resolveUser } from './steam/locate.js';
import { defaultRunner, isSteamRunning } from './steam/running.js';
import { computeAppId, isManaged, MANAGED_TAG, quote, shortcutAppId, shortcutTags, shortcutTitle } from './steam/shortcuts.js';
import type { SyncGame } from './steam/sync.js';
import { loadShortcuts } from './steam/store.js';
import type { VdfMap } from './vdf/types.js';

/** Everything with side effects; the `log` is supplied per call. */
export type ApiDeps = Omit<AppContext, 'log'>;

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

/** The CLI's commands as data, for UIs. Never throws for "Steam not found" in `status`; `sync` reports errors in the result. */
export function createApi(deps: ApiDeps): SteamManagerApi {
  /** Read-only calls log nothing the UI needs; anything unexpected goes to the console. */
  const context = (log: (message: string) => void = console.debug): AppContext => ({ ...deps, log });

  return {
    async status(): Promise<StatusInfo> {
      const info: StatusInfo = { platform: deps.platform, steamRunning: await isSteamRunning(deps.platform, deps.runner) };
      try {
        const steamRoot = await findSteamRoot(deps);
        const { accountId } = await resolveUser(steamRoot);
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
      return availableIntegrations(deps.platform, deps.integrations).map(({ id, label }) => ({ id, label }));
    },

    async apps(all: boolean): Promise<AppInfo[]> {
      const found = await scanApps(context(), all === true);
      return found.map(({ app, verdict, reason }) => ({ id: app.id, name: app.name, verdict, reason }));
    },

    async games(request: GamesRequest): Promise<GamesReport> {
      const { includeMaybe } = parseGamesRequest(request);
      const ctx = context();
      const config = await loadConfig(configDir(deps.platform, deps.home, deps.env));
      const selected = availableIntegrations(deps.platform, deps.integrations);
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

    async sync(request: SyncRequest): Promise<SyncReport> {
      const options = parseSyncRequest(request);
      const report: SyncReport = { log: [], added: [], updated: [], removed: [], unchanged: [], skipped: [] };
      try {
        const result = await runSync(context((line) => report.log.push(line)), options);
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
