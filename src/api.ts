import os from 'node:os';
import { openUser, runSync, scanApps, type AppContext } from './app.js';
import { availableIntegrations, integrations } from './integrations/index.js';
import type { AppInfo, IntegrationInfo, ShortcutInfo, SteamManagerApi, StatusInfo, SyncReport, SyncRequest } from './ipc.js';
import { findSteamRoot, resolveUser } from './steam/locate.js';
import { defaultRunner, isSteamRunning } from './steam/running.js';
import { isManaged, MANAGED_TAG, shortcutAppId, shortcutTags, shortcutTitle } from './steam/shortcuts.js';
import { loadShortcuts } from './steam/store.js';

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
