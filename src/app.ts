import { installArtwork, type ArtworkOutcome } from './artwork/install.js';
import { SteamGridDbClient, type FetchLike } from './artwork/steamgriddb.js';
import { findSteamRoot, resolveUser, type SteamUser } from './steam/locate.js';
import { isSteamRunning, type Runner } from './steam/running.js';
import { isManaged, shortcutAppId, shortcutTags, shortcutTitle } from './steam/shortcuts.js';
import { loadShortcuts, saveShortcuts } from './steam/store.js';
import { planSync, type SyncItem, type SyncResult } from './steam/sync.js';
import type { Game, Provider } from './types.js';

/** Everything with side effects, injected so the commands can be tested without a real Steam. */
export interface AppContext {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  runner: Runner;
  fetchFn: FetchLike;
  providers: Provider[];
  log: (message: string) => void;
}

export interface GlobalOptions {
  steamDir?: string;
  user?: string;
  apiKey?: string;
  allowSteamRunning?: boolean;
}

export interface SyncCommandOptions {
  prune?: boolean;
  dryRun?: boolean;
  artwork?: boolean;
  forceArtwork?: boolean;
}

export interface AddCommandOptions extends SyncCommandOptions {
  title: string;
  exe: string;
  store: string;
  startDir?: string;
  launchOptions?: string;
}

async function openUser(ctx: AppContext, options: GlobalOptions): Promise<SteamUser> {
  const root = options.steamDir ?? (await findSteamRoot(ctx));
  return resolveUser(root, options.user);
}

async function ensureSteamClosed(ctx: AppContext, options: GlobalOptions): Promise<void> {
  if (options.allowSteamRunning) return;
  if (await isSteamRunning(ctx.platform, ctx.runner)) {
    throw new Error('Steam is running and would overwrite our changes. Close Steam first (or pass --allow-steam-running).');
  }
}

function summarize(outcomes: ArtworkOutcome[]): string {
  const count = (status: ArtworkOutcome['status']): number => outcomes.filter((o) => o.status === status).length;
  return `artwork: ${count('saved')} saved, ${count('exists')} already present, ${count('missing')} not found, ${count('failed')} failed`;
}

async function fetchArtwork(
  ctx: AppContext,
  user: SteamUser,
  items: SyncItem[],
  options: GlobalOptions & SyncCommandOptions,
): Promise<void> {
  if (options.artwork === false || items.length === 0) return;
  const apiKey = options.apiKey ?? ctx.env['STEAMGRIDDB_API_KEY'];
  if (!apiKey) {
    ctx.log('Skipping artwork: set STEAMGRIDDB_API_KEY or pass --api-key to download it from SteamGridDB.');
    return;
  }
  const client = new SteamGridDbClient(apiKey, ctx.fetchFn);
  for (const item of items) {
    const outcomes = await installArtwork({
      gridDir: user.gridDir,
      appId: item.appId,
      title: item.title,
      client,
      fetchFn: ctx.fetchFn,
      force: options.forceArtwork,
    });
    ctx.log(`  ${item.title} (${summarize(outcomes)})`);
  }
}

function report(ctx: AppContext, result: SyncResult, dryRun: boolean): void {
  const prefix = dryRun ? '[dry run] ' : '';
  const sections: [string, SyncItem[]][] = [
    ['Added', result.added],
    ['Updated', result.updated],
    ['Removed', result.removed],
    ['Skipped (conflicts with a shortcut we do not manage, or duplicate)', result.skipped],
  ];
  for (const [label, items] of sections) {
    if (items.length === 0) continue;
    ctx.log(`${prefix}${label}:`);
    for (const item of items) ctx.log(`  ${item.title}${item.store ? ` [${item.store}]` : ''}`);
  }
  ctx.log(`${prefix}${result.added.length} added, ${result.updated.length} updated, ${result.removed.length} removed, ${result.unchanged.length} unchanged`);
}

/** Shared tail of `sync` and `add`: plan, report, write, then fetch artwork. */
async function applyGames(
  ctx: AppContext,
  games: Game[],
  options: GlobalOptions & SyncCommandOptions,
): Promise<SyncResult> {
  const user = await openUser(ctx, options);
  const result = planSync(await loadShortcuts(user.configDir), games, { prune: Boolean(options.prune) });
  report(ctx, result, Boolean(options.dryRun));
  if (options.dryRun) return result;

  const changed = result.added.length + result.updated.length + result.removed.length > 0;
  if (changed) {
    await ensureSteamClosed(ctx, options);
    const backup = await saveShortcuts(user.configDir, result.entries);
    if (backup) ctx.log(`Backed up previous shortcuts to ${backup}`);
  }
  await fetchArtwork(ctx, user, [...result.added, ...result.updated, ...result.unchanged], options);
  return result;
}

export async function runSync(ctx: AppContext, options: GlobalOptions & SyncCommandOptions): Promise<void> {
  if (ctx.providers.length === 0) {
    ctx.log('No providers are configured yet, so there is nothing to sync. Use "add" to add a game by hand.');
    return;
  }
  const games = (await Promise.all(ctx.providers.map((provider) => provider.listGames()))).flat();
  await applyGames(ctx, games, options);
}

export async function runAdd(ctx: AppContext, options: GlobalOptions & AddCommandOptions): Promise<void> {
  const game: Game = {
    store: options.store,
    id: options.title,
    title: options.title,
    installed: true,
    exe: options.exe,
    startDir: options.startDir,
    launchOptions: options.launchOptions,
  };
  const result = await applyGames(ctx, [game], options);
  if (result.skipped.length > 0) {
    throw new Error(`"${options.title}" already exists as a shortcut that steam-manager does not manage.`);
  }
}

export async function runList(ctx: AppContext, options: GlobalOptions): Promise<void> {
  const user = await openUser(ctx, options);
  const entries = await loadShortcuts(user.configDir);
  if (entries.length === 0) {
    ctx.log('No non-Steam shortcuts found.');
    return;
  }
  for (const entry of entries) {
    const tags = shortcutTags(entry).filter((tag) => tag !== 'steam-manager');
    const managed = isManaged(entry) ? ' (managed)' : '';
    ctx.log(`${shortcutAppId(entry)}  ${shortcutTitle(entry)}${tags.length ? ` [${tags.join(', ')}]` : ''}${managed}`);
  }
}
