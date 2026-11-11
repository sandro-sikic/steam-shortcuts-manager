import { artworkCacheDir, choicesFor, copyCachedToGrid, ensureArtwork, type ArtworkOutcome } from './artwork/cache.js';
import { removeTaggedArtwork } from './artwork/grid.js';
import { SteamGridDbClient, type FetchLike } from './artwork/steamgriddb.js';
import { configDir, loadConfig } from './config.js';
import { loadSettings } from './settings.js';
import { dedupeGames, exeKey, gameKey, normalizeTitle, type Duplicate, type KnownGames } from './dedupe.js';
import { selectIntegrations, availableIntegrations } from './integrations/index.js';
import type { Classification } from './integrations/os/classify.js';
import { classifyInstalledApps } from './integrations/os/index.js';
import type { Integration, ScanOptions } from './integrations/types.js';
import { resolveTarget, wrapperDir } from './launcher/wrapper.js';
import { findSteamRoot, resolveUser, type SteamUser } from './steam/locate.js';
import { isSteamRunning, type Runner } from './steam/running.js';
import { listInstalledSteamTitles } from './steam/library.js';
import { computeAppId, getField, isManaged, quote, shortcutAppId, shortcutTags, shortcutTitle } from './steam/shortcuts.js';
import { loadShortcuts, saveShortcuts } from './steam/store.js';
import { planSync, type SyncGame, type SyncItem, type SyncResult } from './steam/sync.js';
import type { VdfMap } from './vdf/types.js';
import type { Game } from './types.js';

/** Everything with side effects, injected so the commands can be tested without a real Steam. */
export interface AppContext {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  runner: Runner;
  fetchFn: FetchLike;
  integrations: Integration[];
  log: (message: string) => void;
}

export interface GlobalOptions {
  steamDir?: string;
  user?: string;
  apiKey?: string;
  allowSteamRunning?: boolean;
}

export interface SyncCommandOptions {
  /** Limit the sync to these integration ids. */
  only?: string[];
  /** Also add installed apps that only weakly look like games. */
  includeMaybe?: boolean;
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

/** Locates Steam and picks the account; command-line options win over the saved settings. */
export async function openUser(ctx: AppContext, options: GlobalOptions): Promise<SteamUser> {
  const { steam } = await loadSettings(configDir(ctx.platform, ctx.home, ctx.env));
  const root = options.steamDir ?? (steam.dir || (await findSteamRoot(ctx)));
  return resolveUser(root, options.user ?? (steam.user || undefined));
}

/** Games that already exist: installed in Steam itself, or shortcuts the user added by hand. */
export async function knownGames(user: SteamUser, existing: VdfMap[]): Promise<KnownGames> {
  const known: KnownGames = { titles: new Map(), launchKeys: new Map() };
  for (const title of await listInstalledSteamTitles(user.root)) {
    known.titles.set(normalizeTitle(title), `${title} (installed in Steam)`);
  }
  for (const entry of existing.filter((e) => !isManaged(e))) {
    const origin = `${shortcutTitle(entry)} (your own shortcut)`;
    known.titles.set(normalizeTitle(shortcutTitle(entry)), origin);
    const exe = getField(entry, 'Exe');
    const args = getField(entry, 'LaunchOptions');
    if (typeof exe === 'string' && exe !== '') known.launchKeys.set(exeKey(exe, typeof args === 'string' ? args : undefined), origin);
  }
  return known;
}

async function ensureSteamClosed(ctx: AppContext, options: GlobalOptions): Promise<void> {
  const { steam } = await loadSettings(configDir(ctx.platform, ctx.home, ctx.env));
  if (options.allowSteamRunning || steam.allowRunning) return;
  if (await isSteamRunning(ctx.platform, ctx.runner)) {
    throw new Error('Steam is running and would overwrite our changes. Close Steam first (or pass --allow-steam-running).');
  }
}

function summarize(outcomes: ArtworkOutcome[]): string {
  const count = (status: ArtworkOutcome['status']): number => outcomes.filter((o) => o.status === status).length;
  const none = count('none');
  return `artwork: ${count('saved')} saved, ${count('exists')} already present, ${count('missing')} not found, ${count('failed')} failed${none > 0 ? `, ${none} left out` : ''}`;
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
  const dir = configDir(ctx.platform, ctx.home, ctx.env);
  const { artwork } = await loadSettings(dir);
  const { artworkChoices } = await loadConfig(dir);
  const prefs = { options: artwork.options, nsfw: artwork.nsfw };
  const cacheRoot = artworkCacheDir(dir);
  for (const item of items) {
    // Everything is downloaded once into the app's cache; Steam's grid folder gets copies of the images the user selected.
    const choices = choicesFor(artworkChoices, item.title);
    const filled = await ensureArtwork({ cacheRoot, title: item.title, client, fetchFn: ctx.fetchFn, prefs, choices, force: options.forceArtwork });
    const failed = new Map(filled.filter((outcome) => outcome.status === 'failed').map((outcome) => [outcome.kind, outcome.error as string]));
    const outcomes = await copyCachedToGrid({
      cacheRoot,
      title: item.title,
      gridDir: user.gridDir,
      appId: item.appId,
      kinds: artwork.kinds,
      prefs,
      choices,
      force: options.forceArtwork,
      failed,
    });
    ctx.log(`  ${item.title} (${summarize(outcomes)})`);
  }
}

function report(ctx: AppContext, result: SyncResult, duplicates: Duplicate[], dryRun: boolean): void {
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
  if (duplicates.length > 0) {
    ctx.log(`${prefix}Skipped duplicates:`);
    for (const { game, of } of duplicates) ctx.log(`  ${game.title} [${game.store}], same as ${of}`);
  }
  ctx.log(`${prefix}${result.added.length} added, ${result.updated.length} updated, ${result.removed.length} removed, ${result.unchanged.length} unchanged`);
}

/** Resolves each game's launch spec to a shortcut target, generating wrapper scripts as needed. */
export async function resolveGames(ctx: AppContext, games: Game[], write: boolean): Promise<SyncGame[]> {
  const dir = wrapperDir(ctx.platform, ctx.home, ctx.env);
  return Promise.all(
    games.map(async (game) => {
      const target = await resolveTarget(game, { platform: ctx.platform, dir, write });
      return { store: game.store, title: game.title, installed: game.installed, ...target };
    }),
  );
}

/** Shared tail of `sync` and `add`: plan, report, write, then fetch artwork. */
async function applyGames(
  ctx: AppContext,
  games: Game[],
  options: GlobalOptions & SyncCommandOptions,
  dedupe: boolean,
  excluded: ReadonlySet<string>,
): Promise<SyncResult> {
  const user = await openUser(ctx, options);
  const existing = await loadShortcuts(user.configDir);
  const { unique, duplicates } = dedupe ? dedupeGames(games, await knownGames(user, existing)) : { unique: games, duplicates: [] };
  const included = unique.filter((game) => !excluded.has(gameKey(game)));
  const switchedOff = unique.filter((game) => excluded.has(gameKey(game)));
  const resolved = await resolveGames(ctx, included, !options.dryRun);
  const remove = new Set((await resolveGames(ctx, switchedOff, false)).map((game) => computeAppId(quote(game.exe), game.title)));
  const result = planSync(existing, resolved, { prune: Boolean(options.prune), remove });
  report(ctx, result, duplicates, Boolean(options.dryRun));
  if (options.dryRun) return result;

  const changed = result.added.length + result.updated.length + result.removed.length > 0;
  if (changed) {
    await ensureSteamClosed(ctx, options);
    const backup = await saveShortcuts(user.configDir, result.entries);
    if (backup) ctx.log(`Backed up previous shortcuts to ${backup}`);
    // Take our artwork away with the shortcut. Only files carrying our tag go; the user's own images stay.
    for (const item of result.removed) {
      const { removed, kept } = await removeTaggedArtwork(user.gridDir, item.appId);
      if (removed + kept > 0) ctx.log(`  ${item.title}: removed ${removed} of our images from Steam's artwork folder${kept > 0 ? `, kept ${kept} that are not ours` : ''}`);
    }
  }
  await fetchArtwork(ctx, user, [...result.added, ...result.updated, ...result.unchanged], options);
  return result;
}

/** Runs the given integrations; one that fails is reported as a warning and the others still run. */
export async function scanIntegrations(
  ctx: AppContext,
  selected: Integration[],
  options: ScanOptions,
): Promise<{ games: Game[]; warnings: string[] }> {
  const scanContext = { platform: ctx.platform, home: ctx.home, env: ctx.env, run: ctx.runner, options };
  const games: Game[] = [];
  const warnings: string[] = [];
  for (const integration of selected) {
    try {
      games.push(...(await integration.scan(scanContext)));
    } catch (error) {
      warnings.push(`Could not scan ${integration.label}: ${(error as Error).message}`);
    }
  }
  return { games, warnings };
}

export async function runSync(ctx: AppContext, options: GlobalOptions & SyncCommandOptions): Promise<SyncResult | undefined> {
  const { launchers } = await loadSettings(configDir(ctx.platform, ctx.home, ctx.env));
  const chosen = selectIntegrations(ctx.platform, options.only, ctx.integrations);
  // Launchers switched off in settings are skipped, unless the user named them with --only.
  const selected = options.only ? chosen : chosen.filter((integration) => !launchers.disabled.includes(integration.id));
  if (selected.length === 0) {
    ctx.log('No integrations are available on this platform, so there is nothing to sync. Use "add" to add a game by hand.');
    return undefined;
  }
  const config = await loadConfig(configDir(ctx.platform, ctx.home, ctx.env));
  const { games, warnings } = await scanIntegrations(ctx, selected, { includeMaybe: options.includeMaybe, allow: config.allow, deny: config.deny });
  for (const warning of warnings) ctx.log(warning);
  return applyGames(ctx, games, options, true, new Set(config.exclude));
}

export async function runIntegrations(ctx: AppContext): Promise<void> {
  const available = availableIntegrations(ctx.platform, ctx.integrations);
  if (available.length === 0) {
    ctx.log('No integrations are available on this platform.');
    return;
  }
  for (const integration of available) ctx.log(`${integration.id}  ${integration.label}`);
}

export async function runAdd(ctx: AppContext, options: GlobalOptions & AddCommandOptions): Promise<void> {
  const game: Game = {
    store: options.store,
    id: options.title,
    title: options.title,
    installed: true,
    launch: { kind: 'exe', exe: options.exe, startDir: options.startDir, args: options.launchOptions },
  };
  const result = await applyGames(ctx, [game], options, false, new Set());
  if (result.skipped.length > 0) {
    throw new Error(`"${options.title}" already exists as a shortcut that steam-manager does not manage.`);
  }
}

/** Scans the installed apps and classifies them, honoring the user's config; `all` includes the rejected ones. */
export async function scanApps(ctx: AppContext, all: boolean): Promise<Classification[]> {
  const config = await loadConfig(configDir(ctx.platform, ctx.home, ctx.env));
  const scanContext = {
    platform: ctx.platform,
    home: ctx.home,
    env: ctx.env,
    run: ctx.runner,
    options: { allow: config.allow, deny: config.deny },
  };
  return (await classifyInstalledApps(scanContext)).filter((c) => all || c.verdict !== 'no');
}

/** Shows what the installed-apps scan found and why each app was or was not judged a game. */
export async function runApps(ctx: AppContext, options: { all?: boolean }): Promise<void> {
  const shown = await scanApps(ctx, Boolean(options.all));
  if (shown.length === 0) {
    ctx.log('No games found among the installed apps.');
    return;
  }
  for (const { app, verdict, reason } of shown) ctx.log(`${verdict.padEnd(5)}  ${app.name}  (${reason})`);
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
