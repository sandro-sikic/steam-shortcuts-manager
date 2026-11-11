import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, createArtworkServer, parseArtworkPick, parseArtworkRequest, parseGamesRequest, parseSyncRequest, systemDeps, type ApiDeps } from '../src/api.js';
import { integrations } from '../src/integrations/index.js';
import type { Integration } from '../src/integrations/types.js';
import { buildShortcut, MANAGED_TAG } from '../src/steam/shortcuts.js';
import { saveShortcuts, loadShortcuts } from '../src/steam/store.js';
import { cacheKey } from '../src/artwork/cache.js';
import { readTag } from '../src/artwork/tag.js';
import { updateConfig } from '../src/config.js';
import type { SecretStore } from '../src/secrets.js';
import type { Game } from '../src/types.js';
import { cleanupTempDirs, desktopEnv, fakeFetch, fullUrl, makeTempDir, sgdbList, sgdbRoutes, sgdbSearch } from './helpers.js';

afterEach(cleanupTempDirs);

const cacheOf = (home: string, title: string) => path.join(home, '.config', 'steam-manager', 'artwork-cache', cacheKey(title) as string);

const fortnite: Game = { store: 'Epic Games', id: 'fn', title: 'Fortnite', installed: true, launch: { kind: 'exe', exe: '/games/fortnite' } };
const fake = (over: Partial<Integration> = {}): Integration => ({
  id: 'fake',
  label: 'Fake Launcher',
  platforms: ['linux', 'win32', 'darwin'],
  scan: async () => [fortnite],
  ...over,
});

/** A home directory with a Steam installation in the usual Linux place. */
/** An in-memory secret store. */
function memorySecrets(available = true): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    available: async () => available,
    get: async (name) => (available ? data.get(name) : undefined),
    set: async (name, value) => {
      if (!available) throw new Error('Secure storage is not available on this system. Set the STEAMGRIDDB_API_KEY environment variable instead.');
      data.set(name, value);
    },
    remove: async (name) => void data.delete(name),
  };
}

async function setup(options: { running?: boolean; users?: string[]; env?: NodeJS.ProcessEnv; integrations?: Integration[]; platform?: NodeJS.Platform; extra?: Partial<ApiDeps> } = {}) {
  const home = await makeTempDir();
  const steam = path.join(home, '.steam', 'steam');
  for (const id of options.users ?? ['1']) await mkdir(path.join(steam, 'userdata', id, 'config'), { recursive: true });
  const deps: ApiDeps = {
    platform: options.platform ?? 'linux',
    home,
    env: options.env ?? {},
    runner: async () => (options.running ? '123\n' : ''),
    fetchFn: fakeFetch({}),
    integrations: options.integrations ?? [fake()],
    ...options.extra,
  };
  return { deps, api: createApi(deps), steam, configDir: path.join(steam, 'userdata', '1', 'config'), home };
}

describe('parseSyncRequest', () => {
  it('defaults to the safe choices: dry run and artwork on, everything else off', () => {
    expect(parseSyncRequest({})).toEqual({ dryRun: true, prune: false, includeMaybe: false, artwork: true, only: undefined });
  });

  it('honors explicit choices and a list of integrations', () => {
    expect(parseSyncRequest({ dryRun: false, prune: true, includeMaybe: true, artwork: false, only: ['epic'] })).toEqual({
      dryRun: false,
      prune: true,
      includeMaybe: true,
      artwork: false,
      only: ['epic'],
    });
  });

  it('treats an empty list as "all", ignores truthy non-booleans, and rejects bad input', () => {
    expect(parseSyncRequest({ only: [] }).only).toBeUndefined();
    expect(parseSyncRequest({ dryRun: 'no', prune: 1 })).toMatchObject({ dryRun: true, prune: false });
    expect(() => parseSyncRequest(null)).toThrow('Invalid sync request');
    expect(() => parseSyncRequest('x')).toThrow('Invalid sync request');
    expect(() => parseSyncRequest({ only: 'epic' })).toThrow('"only" must be a list');
    expect(() => parseSyncRequest({ only: [1] })).toThrow('"only" must be a list');
  });
});

describe('systemDeps', () => {
  it('describes the real machine', () => {
    const deps = systemDeps();
    expect(deps.platform).toBe(process.platform);
    expect(deps.env).toBe(process.env);
    expect(deps.integrations).toBe(integrations);
    expect(deps.fetchFn).toBe(fetch);
    expect(typeof deps.home).toBe('string');
  });
});

describe('api.status', () => {
  it.skipIf(process.platform === 'win32')('reports the Steam installation and whether Steam is running', async () => {
    const { api, steam } = await setup();
    expect(await api.status()).toEqual({ platform: 'linux', steamRunning: false, steamRoot: steam, accountId: '1' });
    expect((await (await setup({ running: true })).api.status()).steamRunning).toBe(true);
  });

  it('returns the problem instead of throwing when Steam or its user cannot be found', async () => {
    const none = await setup({ users: ['1', '2'] });
    expect((await none.api.status()).error).toContain('Could not determine the Steam user');
    const home = await makeTempDir();
    const missing = createApi({ ...none.deps, home });
    expect((await missing.status()).error).toContain('Steam installation not found');
  });
});

describe('api.shortcuts', () => {
  it('lists shortcuts with their tags and managed flag', async () => {
    const { api, configDir } = await setup();
    const mine = buildShortcut({ title: 'Mine', exe: '/mine', tags: ['Favorites'] });
    const ours = buildShortcut({ title: 'Fortnite', exe: '/games/fortnite', tags: ['Epic Games', MANAGED_TAG] });
    await saveShortcuts(configDir, [mine, ours]);
    expect(await api.shortcuts()).toEqual([
      { appId: expect.any(Number), title: 'Mine', tags: ['Favorites'], managed: false },
      { appId: expect.any(Number), title: 'Fortnite', tags: ['Epic Games'], managed: true },
    ]);
  });

  it('is empty without a shortcuts file and rejects without Steam', async () => {
    const { api, deps } = await setup();
    expect(await api.shortcuts()).toEqual([]);
    await expect(createApi({ ...deps, home: await makeTempDir() }).shortcuts()).rejects.toThrow('Steam installation not found');
  });
});

describe('api.integrations', () => {
  it('lists the integrations available on this platform', async () => {
    const { api } = await setup({ integrations: [fake(), fake({ id: 'win', label: 'Windows Only', platforms: ['win32'] })] });
    expect(await api.integrations()).toEqual([{ id: 'fake', label: 'Fake Launcher', enabled: true }]);
  });
});

describe('api.apps', () => {
  it('returns nothing on a platform without an installed-apps scan', async () => {
    expect(await (await setup({ platform: 'darwin' })).api.apps(true)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('returns games, and with `all` the rejected apps too', async () => {
    const env = await desktopEnv({ 'Alpha Game': 'Game;', 'Some Tool': 'Utility;' });
    const { api } = await setup({ env });
    expect(await api.apps(false)).toEqual([{ id: 'AlphaGame', name: 'Alpha Game', verdict: 'game', reason: 'freedesktop-game' }]);
    expect((await api.apps(true)).map((a) => a.verdict)).toEqual(['game', 'no']);
  });
});

describe('api.sync', () => {
  const request = { dryRun: true, prune: false, includeMaybe: false, artwork: false };

  it('previews a sync as data plus the CLI log', async () => {
    const { api } = await setup();
    const report = await api.sync(request);
    expect(report.added).toEqual([{ appId: expect.any(Number), title: 'Fortnite', store: 'Epic Games' }]);
    expect(report.updated).toEqual([]);
    expect(report.log).toEqual(['[dry run] Added:', '  Fortnite [Epic Games]', '[dry run] 1 added, 0 updated, 0 removed, 0 unchanged']);
    expect(report.error).toBeUndefined();
    await expect(api.shortcuts()).resolves.toEqual([]);
  });

  it('writes shortcuts for real, and a second run reports them unchanged', async () => {
    const { api } = await setup();
    const real = { ...request, dryRun: false };
    expect((await api.sync(real)).added).toHaveLength(1);
    expect((await api.shortcuts()).map((s) => s.title)).toEqual(['Fortnite']);
    const again = await api.sync(real);
    expect(again.unchanged).toHaveLength(1);
    expect(again.added).toEqual([]);
  });

  it('explains when there is nothing to sync', async () => {
    const { api } = await setup({ integrations: [] });
    const report = await api.sync(request);
    expect(report.log[0]).toContain('No integrations are available');
    expect(report.added).toEqual([]);
  });

  it('reports a failure in the result instead of throwing', async () => {
    const { api } = await setup({ running: true });
    const report = await api.sync({ ...request, dryRun: false });
    expect(report.error).toContain('Steam is running');
    expect(report.log).toContain('Added:');
    expect(report.added).toEqual([]);
  });

  it('rejects an invalid request', async () => {
    const { api } = await setup();
    await expect(api.sync(null as never)).rejects.toThrow('Invalid sync request');
  });

  it('limits the sync to the chosen integrations', async () => {
    const { api } = await setup();
    await expect(api.sync({ ...request, only: ['nope'] })).resolves.toMatchObject({ error: expect.stringContaining('Unknown or unavailable') });
  });
});

describe('parseGamesRequest', () => {
  it('reads includeMaybe, defaulting to off, and rejects non-objects', () => {
    expect(parseGamesRequest({})).toEqual({ includeMaybe: false });
    expect(parseGamesRequest({ includeMaybe: true })).toEqual({ includeMaybe: true });
    expect(parseGamesRequest({ includeMaybe: 'yes' })).toEqual({ includeMaybe: false });
    expect(() => parseGamesRequest(null)).toThrow('Invalid games request');
    expect(() => parseGamesRequest(5)).toThrow('Invalid games request');
  });
});

describe('api.games', () => {
  const request = { includeMaybe: false };
  const other: Game = { store: 'GOG Galaxy', id: 'hades', title: 'Hades', installed: true, launch: { kind: 'exe', exe: '/games/hades' } };

  it('lists the found games with their key, shortcut ID and state', async () => {
    const { api } = await setup({ integrations: [fake({ scan: async () => [fortnite, other] })] });
    const report = await api.games(request);
    expect(report.games).toEqual([
      { key: 'Epic Games:fn', store: 'Epic Games', id: 'fn', title: 'Fortnite', appId: expect.any(Number), weak: false, inSteam: false, excluded: false },
      { key: 'GOG Galaxy:hades', store: 'GOG Galaxy', id: 'hades', title: 'Hades', appId: expect.any(Number), weak: false, inSteam: false, excluded: false },
    ]);
    expect(report.duplicates).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('knows which games are already in Steam, with the same ID the shortcut got', async () => {
    const { api } = await setup();
    const before = (await api.games(request)).games[0];
    await api.sync({ dryRun: false, prune: false, includeMaybe: false, artwork: false });
    const after = (await api.games(request)).games[0];
    expect(before?.inSteam).toBe(false);
    expect(after?.inSteam).toBe(true);
    expect(after?.appId).toBe(before?.appId);
    expect((await api.shortcuts())[0]?.appId).toBe(after?.appId);
  });

  it('marks games the user switched off, and weak guesses', async () => {
    const guess: Game = { ...other, weak: true };
    const { api } = await setup({ integrations: [fake({ scan: async () => [fortnite, guess] })] });
    await api.setExcluded(['Epic Games:fn'], true);
    const { games } = await api.games(request);
    expect(games.map((g) => [g.title, g.excluded, g.weak])).toEqual([['Fortnite', true, false], ['Hades', false, true]]);
  });

  it('passes includeMaybe on to the launchers', async () => {
    const seen: (boolean | undefined)[] = [];
    const spy = fake({ scan: async (ctx) => { seen.push(ctx.options?.includeMaybe); return []; } });
    const { api } = await setup({ integrations: [spy] });
    await api.games({ includeMaybe: true });
    await api.games(request);
    expect(seen).toEqual([true, false]);
  });

  it('drops duplicates, saying what they duplicate, including your own shortcuts and Steam games', async () => {
    const dupe: Game = { ...fortnite, store: 'Heroic (Epic Games)', id: 'heroic:fn', launch: { kind: 'exe', exe: '/heroic/fn' } };
    const steamOwned: Game = { ...other, title: 'Portal 2', id: 'p2', launch: { kind: 'exe', exe: '/games/p2' } };
    const { api, configDir, steam } = await setup({ integrations: [fake({ scan: async () => [fortnite, dupe, steamOwned, other] })] });
    await mkdir(path.join(steam, 'steamapps'), { recursive: true });
    await writeFile(path.join(steam, 'steamapps', 'appmanifest_620.acf'), '"AppState" { "name" "Portal 2" }');
    await saveShortcuts(configDir, [buildShortcut({ title: 'Hades', exe: '/mine/hades', tags: [] })]);

    const report = await api.games(request);
    expect(report.games.map((g) => g.title)).toEqual(['Fortnite']);
    expect(report.duplicates).toEqual([
      { title: 'Fortnite', store: 'Heroic (Epic Games)', of: 'Fortnite [Epic Games]' },
      { title: 'Portal 2', store: 'GOG Galaxy', of: 'Portal 2 (installed in Steam)' },
      { title: 'Hades', store: 'GOG Galaxy', of: 'Hades (your own shortcut)' },
    ]);
  });

  it('reports a launcher that fails and lists the rest', async () => {
    const broken = fake({ id: 'broken', label: 'Broken', scan: async () => { throw new Error('boom'); } });
    const { api } = await setup({ integrations: [broken, fake()] });
    const report = await api.games(request);
    expect(report.warnings).toEqual(['Could not scan Broken: boom']);
    expect(report.games).toHaveLength(1);
  });

  it('still lists the games when Steam cannot be found', async () => {
    const { deps } = await setup();
    const report = await createApi({ ...deps, home: await makeTempDir() }).games(request);
    expect(report.games.map((g) => [g.title, g.inSteam])).toEqual([['Fortnite', false]]);
  });

  it('rejects an invalid request', async () => {
    const { api } = await setup();
    await expect(api.games(null as never)).rejects.toThrow('Invalid games request');
  });
});

describe('api.setExcluded', () => {
  it('switches games off and on, keeping the list sorted and free of duplicates', async () => {
    const { api, home } = await setup();
    const file = path.join(home, '.config', 'steam-manager', 'config.json');
    await api.setExcluded(['b:2', 'a:1', 'b:2'], true);
    expect(JSON.parse(await readFile(file, 'utf8')).exclude).toEqual(['a:1', 'b:2']);
    await api.setExcluded(['a:1', 'zzz:never-there'], false);
    expect(JSON.parse(await readFile(file, 'utf8')).exclude).toEqual(['b:2']);
  });

  it('rejects invalid input and does not overwrite an unreadable config', async () => {
    const { api, home } = await setup();
    await expect(api.setExcluded('a:1' as never, true)).rejects.toThrow('Invalid game keys');
    await expect(api.setExcluded([1 as never], true)).rejects.toThrow('Invalid game keys');
    const dir = path.join(home, '.config', 'steam-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), '{broken');
    await expect(api.setExcluded(['a:1'], true)).rejects.toThrow('Invalid config file');
    expect(await readFile(path.join(dir, 'config.json'), 'utf8')).toBe('{broken');
  });

  it('only ever switches a game off when excluded is exactly true', async () => {
    const { api, home } = await setup();
    await api.setExcluded(['a:1'], 'yes' as never);
    const file = path.join(home, '.config', 'steam-manager', 'config.json');
    expect(JSON.parse(await readFile(file, 'utf8')).exclude).toEqual([]);
  });
});

describe('api settings', () => {
  it('reads, updates and resets settings, saving them in config.json', async () => {
    const { api, home } = await setup();
    expect((await api.settings()).ui.theme).toBe('system');
    const updated = await api.updateSettings({ ui: { theme: 'dark' }, sync: { prune: true } });
    expect(updated.ui.theme).toBe('dark');
    expect((await api.settings()).sync.prune).toBe(true);
    const file = JSON.parse(await readFile(path.join(home, '.config', 'steam-manager', 'config.json'), 'utf8'));
    expect(file.settings.ui.theme).toBe('dark');
    expect((await api.resetSettings()).ui.theme).toBe('system');
  });

  it('rejects invalid settings', async () => {
    const { api } = await setup();
    await expect(api.updateSettings({ ui: { theme: 'neon' } } as never)).rejects.toThrow('ui.theme must be one of');
  });
});

describe('api lists', () => {
  it('reads and replaces the allow, deny and exclude lists, trimming and removing duplicates', async () => {
    const { api } = await setup();
    expect(await api.lists()).toEqual({ allow: [], deny: [], exclude: [] });
    expect(await api.setLists({ allow: [' Hades ', 'Hades', ''], deny: ['Tool'] })).toEqual({ allow: ['Hades'], deny: ['Tool'], exclude: [] });
    expect(await api.setLists({ exclude: ['a:1'] })).toEqual({ allow: ['Hades'], deny: ['Tool'], exclude: ['a:1'] });
    expect(await api.lists()).toEqual({ allow: ['Hades'], deny: ['Tool'], exclude: ['a:1'] });
    expect(await api.setLists({})).toEqual({ allow: ['Hades'], deny: ['Tool'], exclude: ['a:1'] });
  });

  it('rejects invalid lists', async () => {
    const { api } = await setup();
    await expect(api.setLists(null as never)).rejects.toThrow('Invalid lists');
    await expect(api.setLists({ allow: 'x' } as never)).rejects.toThrow('Invalid allow list');
    await expect(api.setLists({ deny: [1] } as never)).rejects.toThrow('Invalid deny list');
  });
});

describe('api key', () => {
  const key = (api: ReturnType<typeof createApi>) => api.apiKeyStatus();

  it('says where the key comes from, preferring the one saved in the app', async () => {
    const secrets = memorySecrets();
    const none = await setup({ extra: { secrets } });
    expect(await key(none.api)).toEqual({ set: false, source: 'none', secureStorage: true });
    const fromEnv = await setup({ env: { STEAMGRIDDB_API_KEY: 'envkey' }, extra: { secrets } });
    expect(await key(fromEnv.api)).toEqual({ set: true, source: 'environment', secureStorage: true });
    secrets.data.set('steamgriddb', 'saved');
    expect(await key(fromEnv.api)).toEqual({ set: true, source: 'saved', secureStorage: true });
  });

  it('works without secure storage', async () => {
    expect(await key((await setup()).api)).toEqual({ set: false, source: 'none', secureStorage: false });
    expect(await key((await setup({ extra: { secrets: memorySecrets(false) } })).api)).toMatchObject({ secureStorage: false });
  });

  it('saves a key trimmed, and an empty key removes it', async () => {
    const secrets = memorySecrets();
    const { api } = await setup({ extra: { secrets } });
    expect(await api.setApiKey('  abc123  ')).toEqual({ set: true, source: 'saved', secureStorage: true });
    expect(secrets.data.get('steamgriddb')).toBe('abc123');
    expect(await api.setApiKey('   ')).toEqual({ set: false, source: 'none', secureStorage: true });
    expect(secrets.data.has('steamgriddb')).toBe(false);
  });

  it('explains when keys cannot be stored, and rejects bad input', async () => {
    await expect((await setup()).api.setApiKey('x')).rejects.toThrow('Secure storage is not available');
    await expect((await setup({ extra: { secrets: memorySecrets(false) } })).api.setApiKey('x')).rejects.toThrow('Secure storage is not available');
    await expect((await setup({ extra: { secrets: memorySecrets() } })).api.setApiKey(5 as never)).rejects.toThrow('Invalid API key');
  });

  const API = 'https://www.steamgriddb.com/api/v2/search/autocomplete/Half-Life';
  const withFetch = (routes: Parameters<typeof fakeFetch>[0], extra: Partial<ApiDeps> = {}, env: NodeJS.ProcessEnv = {}) => setup({ env, extra: { fetchFn: fakeFetch(routes), ...extra } });

  it('tests a given key against SteamGridDB', async () => {
    const fetchFn = fakeFetch({ [API]: { json: { success: true, data: [{ id: 1, name: 'Half-Life' }] } } });
    const { api } = await setup({ extra: { fetchFn } });
    expect(await api.testApiKey(' goodkey ')).toEqual({ ok: true, message: 'The key works.' });
    expect(fetchFn.requests[0]?.auth).toBe('Bearer goodkey');
  });

  it('tests the key in use when none is given: saved first, then the environment', async () => {
    const routes = { [API]: { json: { success: true, data: [] } } };
    const saved = memorySecrets();
    saved.data.set('steamgriddb', 'savedkey');
    const first = await withFetch(routes, { secrets: saved }, { STEAMGRIDDB_API_KEY: 'envkey' });
    expect((await first.api.testApiKey()).ok).toBe(true);
    expect((first.deps.fetchFn as ReturnType<typeof fakeFetch>).requests[0]?.auth).toBe('Bearer savedkey');
    const env = await withFetch(routes, {}, { STEAMGRIDDB_API_KEY: 'envkey' });
    await env.api.testApiKey('   ');
    expect((env.deps.fetchFn as ReturnType<typeof fakeFetch>).requests[0]?.auth).toBe('Bearer envkey');
  });

  it('says so when there is nothing to test, and explains rejected keys and other failures', async () => {
    expect(await (await setup()).api.testApiKey()).toEqual({ ok: false, message: 'There is no API key to test.' });
    expect(await (await withFetch({ [API]: { status: 401 } })).api.testApiKey('bad')).toEqual({ ok: false, message: 'SteamGridDB rejected this key.' });
    expect((await (await withFetch({ [API]: { status: 403 } })).api.testApiKey('bad')).message).toBe('SteamGridDB rejected this key.');
    expect((await (await withFetch({ [API]: { status: 500 } })).api.testApiKey('k')).message).toBe('SteamGridDB request failed with HTTP 500');
  });

  it('downloads artwork with the saved key when syncing', async () => {
    const secrets = memorySecrets();
    secrets.data.set('steamgriddb', 'savedkey');
    const fetchFn = fakeFetch({ 'https://www.steamgriddb.com/api/v2/search/autocomplete/Fortnite': { json: { success: true, data: [] } } });
    const { api } = await setup({ extra: { secrets, fetchFn } });
    await api.sync({ dryRun: false, prune: false, includeMaybe: false, artwork: true });
    expect(fetchFn.requests[0]).toEqual({ url: 'https://www.steamgriddb.com/api/v2/search/autocomplete/Fortnite', auth: 'Bearer savedkey' });
  });
});

describe('api steam accounts and about', () => {
  it('lists the accounts, from the saved Steam folder when there is one', async () => {
    const { api, home } = await setup({ users: ['1', '2'] });
    expect((await api.steamAccounts()).map((a) => a.accountId)).toEqual(['1', '2']);
    const other = path.join(home, 'OtherSteam');
    await mkdir(path.join(other, 'userdata', '9', 'config'), { recursive: true });
    await api.updateSettings({ steam: { dir: other } });
    expect((await api.steamAccounts()).map((a) => a.accountId)).toEqual(['9']);
  });

  it('lists none when Steam cannot be found', async () => {
    const { deps } = await setup();
    expect(await createApi({ ...deps, home: await makeTempDir() }).steamAccounts()).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('describes the app, the config file and Steam', async () => {
    const { api, steam, home } = await setup({ extra: { version: '1.2.3', secrets: memorySecrets() } });
    expect(await api.about()).toEqual({
      version: '1.2.3',
      platform: 'linux',
      configFile: path.join(home, '.config', 'steam-manager', 'config.json'),
      artworkCache: path.join(home, '.config', 'steam-manager', 'artwork-cache'),
      steamRoot: steam,
      secureStorage: true,
    });
  });

  it('copes without a version, without secure storage and without Steam', async () => {
    const { deps } = await setup();
    const about = await createApi({ ...deps, home: await makeTempDir() }).about();
    expect(about).toMatchObject({ version: 'dev', secureStorage: false });
    expect(about.steamRoot).toBeUndefined();
  });
});

describe('api openConfigFolder', () => {
  it.skipIf(process.platform === 'win32')('creates the folder if needed and opens it', async () => {
    const opened: string[] = [];
    const { api, home } = await setup({ extra: { openPath: async (folder) => void opened.push(folder) } });
    await api.openConfigFolder();
    expect(opened).toEqual([path.join(home, '.config', 'steam-manager')]);
    await expect(readFile(path.join(opened[0] as string, 'nothing'))).rejects.toThrow();
  });

  it('says when opening folders is not possible', async () => {
    await expect((await setup()).api.openConfigFolder()).rejects.toThrow('Opening folders is not available here.');
  });
});

describe('settings take effect', () => {
  const request = { dryRun: false, prune: false, includeMaybe: false, artwork: false };

  it('uses the Steam folder and account from settings, for status, shortcuts and sync', async () => {
    const { api, home } = await setup();
    const custom = path.join(home, 'Games', 'Steam');
    for (const id of ['5', '6']) await mkdir(path.join(custom, 'userdata', id, 'config'), { recursive: true });
    await api.updateSettings({ steam: { dir: custom, user: '6' } });

    expect(await api.status()).toMatchObject({ steamRoot: custom, accountId: '6' });
    await api.sync(request);
    expect((await loadShortcuts(path.join(custom, 'userdata', '6', 'config'))).map((e) => e.get('AppName'))).toEqual(['Fortnite']);
    expect((await api.shortcuts()).map((s) => s.title)).toEqual(['Fortnite']);
  });

  it('lets Steam be running when the setting allows it', async () => {
    const { api } = await setup({ running: true });
    expect((await api.sync(request)).error).toContain('Steam is running');
    await api.updateSettings({ steam: { allowRunning: true } });
    const report = await api.sync(request);
    expect(report.error).toBeUndefined();
    expect(report.added).toHaveLength(1);
  });

  it('skips launchers switched off, but still scans one named explicitly', async () => {
    const { api } = await setup();
    await api.updateSettings({ launchers: { disabled: ['fake'] } });
    expect(await api.integrations()).toEqual([{ id: 'fake', label: 'Fake Launcher', enabled: false }]);
    expect((await api.games({ includeMaybe: false })).games).toEqual([]);
    expect((await api.sync(request)).log[0]).toContain('No integrations are available');
    expect((await api.sync({ ...request, only: ['fake'] })).added).toHaveLength(1);
  });

  it('copies only the chosen kinds of artwork into Steam, while the app’s cache gets all of them', async () => {
    const { api, home, configDir } = await setup({ env: { STEAMGRIDDB_API_KEY: 'k' }, extra: { fetchFn: fakeFetch(sgdbRoutes({ title: 'Fortnite' })) } });
    await api.updateSettings({ artwork: { kinds: ['hero'] } });
    await api.sync({ ...request, artwork: true });
    const appId = (await api.shortcuts())[0]?.appId;
    expect(await readdir(path.join(configDir, 'grid'))).toEqual([`${appId}_hero.png`]);
    expect((await readdir(cacheOf(home, 'Fortnite'))).sort()).toEqual(['full-hero-3000.png', 'full-icon-5000.ico', 'full-logo-4000.png', 'full-poster-1000.png', 'full-wide-2000.jpg', 'meta.json']);
  });

  it('copies the image the user picked, asks SteamGridDB for the saved number of options, and leaves out types set to none', async () => {
    const fetchFn = fakeFetch(sgdbRoutes({ title: 'Fortnite', nsfw: true }));
    const { api, configDir, home } = await setup({ env: { STEAMGRIDDB_API_KEY: 'k' }, extra: { fetchFn } });
    await api.updateSettings({ artwork: { options: 2, nsfw: true } });
    await updateConfig(path.join(home, '.config', 'steam-manager'), { artworkChoices: { [cacheKey('Fortnite') as string]: { poster: 1001, hero: null } } });
    const log = (await api.sync({ ...request, artwork: true })).log.join('\n');
    const appId = (await api.shortcuts())[0]?.appId;
    expect((await readdir(path.join(configDir, 'grid'))).sort()).toEqual([`${appId}.jpg`, `${appId}_icon.ico`, `${appId}_logo.png`, `${appId}p.png`]);
    expect(readTag(await readFile(path.join(configDir, 'grid', `${appId}p.png`)))).toEqual({ id: 1001 });
    expect(log).toContain('1 left out');
    expect(fetchFn.requests.map((r) => r.url)).toContain(sgdbList('poster', 1, true));
  });
});

describe('parseArtworkRequest', () => {
  it('reads a request, trimming the title and defaulting force to off', () => {
    expect(parseArtworkRequest({ appId: 12, title: '  Hades ' })).toEqual({ appId: 12, title: 'Hades', force: false });
    expect(parseArtworkRequest({ appId: 0, title: 'x', force: true })).toEqual({ appId: 0, title: 'x', force: true });
    expect(parseArtworkRequest({ appId: 1, title: 'x', force: 'yes' }).force).toBe(false);
  });

  it.each([
    [null, 'appId must be a whole number'],
    ['x', 'appId must be a whole number'],
    [{ title: 'x' }, 'appId must be a whole number'],
    [{ appId: '5', title: 'x' }, 'appId must be a whole number'],
    [{ appId: 1.5, title: 'x' }, 'appId must be a whole number'],
    [{ appId: -1, title: 'x' }, 'appId must be a whole number'],
    [{ appId: 1 }, 'title is required'],
    [{ appId: 1, title: '   ' }, 'title is required'],
    [{ appId: 1, title: 5 }, 'title is required'],
  ])('rejects %j', (value, message) => {
    expect(() => parseArtworkRequest(value)).toThrow(message);
  });
});

describe('parseArtworkPick', () => {
  it('reads a pick of an image or of none', () => {
    expect(parseArtworkPick({ appId: 1, title: ' Hades ', kind: 'hero', imageId: 7 })).toEqual({ appId: 1, title: 'Hades', kind: 'hero', imageId: 7 });
    expect(parseArtworkPick({ appId: 1, title: 'x', kind: 'logo', imageId: null }).imageId).toBeNull();
  });

  it.each([
    [{ appId: 'x', title: 'x', kind: 'hero', imageId: 1 }, 'appId must be a whole number'],
    [{ appId: 1, title: 'x', kind: 'banner', imageId: 1 }, 'unknown image type'],
    [{ appId: 1, title: 'x', imageId: 1 }, 'unknown image type'],
    [{ appId: 1, title: 'x', kind: 'hero' }, 'imageId must be a whole number or null'],
    [{ appId: 1, title: 'x', kind: 'hero', imageId: 1.5 }, 'imageId must be a whole number or null'],
    [{ appId: 1, title: 'x', kind: 'hero', imageId: -1 }, 'imageId must be a whole number or null'],
    [{ appId: 1, title: 'x', kind: 'hero', imageId: '1' }, 'imageId must be a whole number or null'],
  ])('rejects %j', (value, message) => {
    expect(() => parseArtworkPick(value)).toThrow(message);
  });
});

describe('api artwork', () => {
  const grid = (configDir: string) => path.join(configDir, 'grid');
  const put = async (dir: string, name: string, content = 'x') => {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), content);
  };
  const withKey = (title = 'Fortnite', over: Parameters<typeof sgdbRoutes>[0]['counts'] = {}) => setup({ env: { STEAMGRIDDB_API_KEY: 'k' }, extra: { fetchFn: fakeFetch(sgdbRoutes({ title, counts: over })) } });
  const game = { appId: 7, title: 'Fortnite' };

  it('lists what each game has: the image in Steam’s folder, else the cached one, in the usual order', async () => {
    const { api, configDir, home } = await setup();
    for (const name of ['5_icon.png', '5p.png', '5_hero.jpg', '5.png', '6p.png', '7p.png', 'readme.txt']) await put(grid(configDir), name);
    await put(cacheOf(home, 'Fortnite'), 'logo.png', 'CACHED');
    const found = await api.artwork([{ appId: 5, title: 'Fortnite' }, { appId: 6, title: 'Other' }, { appId: 99, title: 'Nothing' }]);

    expect(Object.keys(found).sort()).toEqual(['5', '6', '99']);
    expect(found[5]?.items.map((i) => i.kind)).toEqual(['poster', 'wide', 'hero', 'logo', 'icon']);
    expect(found[5]?.items[0]?.url).toMatch(/^steam-manager-art:\/\/grid\/5p\.png\?v=\d+$/);
    expect(found[5]?.items[3]?.url).toMatch(/^steam-manager-art:\/\/cache\/fortnite-[0-9a-f]{8}\/logo\.png\?v=\d+$/);
    expect(found[6]?.items).toHaveLength(1);
    expect(found[99]).toEqual({ items: [], choices: {}, pending: true, optionsReady: false });
  });

  it('says which games still have images to fetch, and not for games with nothing to look up', async () => {
    const { api } = await withKey();
    await api.downloadArtwork({ ...game, force: false });
    const found = await api.artwork([game, { appId: 3, title: 'Never Seen' }, { appId: 4, title: '!!!' }]);
    expect(Object.values(found).map((entry) => entry.pending)).toEqual([true, false, false]); // ordered by app id: 3, 4, 7
  });

  it('shows cached images even when Steam cannot be found', async () => {
    const { deps, home } = await setup();
    await put(cacheOf(home, 'Fortnite'), 'poster.png');
    const found = await createApi({ ...deps, home }).artwork([{ appId: 1, title: 'Fortnite' }]);
    const nothing = await createApi({ ...deps, home: await makeTempDir() }).artwork([{ appId: 1, title: 'Fortnite' }]);
    expect(found[1]?.items).toHaveLength(1);
    expect(nothing[1]?.items).toEqual([]);
  });

  it('rejects invalid games', async () => {
    const { api } = await setup();
    await expect(api.artwork('x' as never)).rejects.toThrow('Invalid games');
    await expect(api.artwork([{ appId: 1.5, title: 'x' }])).rejects.toThrow('Invalid games');
    await expect(api.artwork([{ appId: 1, title: 5 as never }])).rejects.toThrow('Invalid games');
    await expect(api.artwork([null as never])).rejects.toThrow('Invalid games');
  });

  it('downloads the first image of each type into the app’s cache, not into Steam’s folder, and returns what it has now', async () => {
    const { api, home, configDir } = await withKey('Fortnite', { wide: 0 });
    const result = await api.downloadArtwork({ ...game, force: false });
    expect(result.outcomes.map((o) => [o.kind, o.status])).toEqual([['poster', 'saved'], ['wide', 'missing'], ['hero', 'saved'], ['logo', 'saved'], ['icon', 'saved']]);
    expect(result.entry.items.map((i) => i.kind)).toEqual(['poster', 'hero', 'logo', 'icon']);
    expect(result.entry.items[0]?.url).toContain('steam-manager-art://cache/');
    expect(result.entry.pending).toBe(false);
    expect(result.entry.optionsReady).toBe(false); // previews are only fetched for the game page
    expect(result.entry.choices.poster?.options.map((o) => [o.id, o.thumbUrl, o.fullUrl !== undefined])).toEqual([[1000, undefined, true], [1001, undefined, false], [1002, undefined, false]]);
    expect(result.entry.choices.poster?.selected).toBe(1000);
    expect(await readFile(path.join(cacheOf(home, 'Fortnite'), 'full-hero-3000.png'), 'latin1')).toContain('IMG:');
    await expect(readFile(path.join(grid(configDir), '7p.png'))).rejects.toThrow();
  });

  it('keeps cached images unless forced, and downloads with the key saved in the app', async () => {
    const secrets = memorySecrets();
    secrets.data.set('steamgriddb', 'savedkey');
    const fetchFn = fakeFetch(sgdbRoutes({ title: 'Fortnite' }));
    const { api, home } = await setup({ extra: { secrets, fetchFn } });
    await api.downloadArtwork({ ...game, force: false });
    expect(fetchFn.requests[0]?.auth).toBe('Bearer savedkey');
    const file = path.join(cacheOf(home, 'Fortnite'), 'full-poster-1000.png');
    await writeFile(file, 'OLD');
    const kept = await api.downloadArtwork({ ...game, force: false });
    expect(kept.outcomes[0]).toMatchObject({ kind: 'poster', status: 'exists' });
    expect(await readFile(file, 'utf8')).toBe('OLD');
    const forced = await api.downloadArtwork({ ...game, force: true });
    expect(forced.outcomes[0]).toMatchObject({ kind: 'poster', status: 'saved' });
    expect(await readFile(file, 'latin1')).toContain('IMG:');
  });

  it('reports failures per image instead of throwing, and leaves the game pending so it is retried', async () => {
    const { api } = await setup({ env: { STEAMGRIDDB_API_KEY: 'bad' }, extra: { fetchFn: fakeFetch({ [sgdbSearch('Fortnite')]: { status: 401 } }) } });
    const result = await api.downloadArtwork({ ...game, force: false });
    expect(result.outcomes.every((o) => o.status === 'failed' && o.error?.includes('HTTP 401'))).toBe(true);
    expect(result.entry.items).toEqual([]);
    expect(result.entry.pending).toBe(true);
  });

  it('asks for a key when there is none, and rejects bad requests', async () => {
    const { api } = await setup();
    await expect(api.downloadArtwork({ appId: 1, title: 'x', force: false })).rejects.toThrow('Add a SteamGridDB API key in Settings');
    await expect(api.loadArtworkOptions({ appId: 1, title: 'x', force: false })).rejects.toThrow('Add a SteamGridDB API key in Settings');
    await expect(api.downloadArtwork({ appId: 'x' } as never)).rejects.toThrow('Invalid artwork request');
  });

  it('loads every option with its preview for the game page, and shows them once ready', async () => {
    const { api, home } = await withKey();
    const result = await api.loadArtworkOptions({ ...game, force: false });
    expect(result.entry.optionsReady).toBe(true);
    const poster = result.entry.choices.poster;
    expect(poster?.options).toHaveLength(3);
    expect(poster?.options.every((o) => o.thumbUrl?.startsWith('steam-manager-art://cache/fortnite-'))).toBe(true);
    expect(poster?.options[0]).toMatchObject({ id: 1000, style: 'alternate', width: 600, height: 900, nsfw: false });
    expect((await readdir(cacheOf(home, 'Fortnite'))).filter((f) => f.startsWith('thumb-'))).toHaveLength(15);
  });

  it('shows no more options than the setting allows, and no adult options unless allowed', async () => {
    const { api } = await withKey();
    await api.loadArtworkOptions({ ...game, force: false });
    await api.updateSettings({ artwork: { options: 2 } });
    expect((await api.artwork([game]))[7]?.choices.poster?.options).toHaveLength(2);
  });

  it('remembers a pick and downloads its full image, and a pick of none', async () => {
    const { api, home } = await withKey();
    await api.loadArtworkOptions({ ...game, force: false });
    const picked = await api.chooseArtwork({ ...game, kind: 'poster', imageId: 1002 });
    expect(picked.downloadError).toBeUndefined();
    expect(picked.entry.choices.poster?.selected).toBe(1002);
    expect(picked.entry.items.find((i) => i.kind === 'poster')?.url).toContain('full-poster-1002.png');
    expect((await readdir(cacheOf(home, 'Fortnite'))).includes('full-poster-1002.png')).toBe(true);
    const none = await api.chooseArtwork({ ...game, kind: 'hero', imageId: null });
    expect(none.entry.choices.hero?.selected).toBeNull();
    expect(none.entry.items.some((i) => i.kind === 'hero')).toBe(false);
    expect((await api.artwork([game]))[7]?.choices.poster?.selected).toBe(1002); // it persists
  });

  it('remembers a pick without a key when its image is already downloaded, and says so when it is not', async () => {
    const secrets = memorySecrets();
    secrets.data.set('steamgriddb', 'k');
    const fetchFn = fakeFetch(sgdbRoutes({ title: 'Fortnite' }));
    const { api, deps } = await setup({ extra: { secrets, fetchFn } });
    await api.loadArtworkOptions({ ...game, force: false });
    secrets.data.clear();
    const have = await api.chooseArtwork({ ...game, kind: 'poster', imageId: 1000 });
    expect(have.downloadError).toBeUndefined();
    const none = await api.chooseArtwork({ ...game, kind: 'poster', imageId: null });
    expect(none.downloadError).toBeUndefined();
    const missing = await api.chooseArtwork({ ...game, kind: 'poster', imageId: 1001 });
    expect(missing.downloadError).toContain('Add a SteamGridDB API key');
    expect(missing.entry.choices.poster?.selected).toBe(1001);
    expect(deps).toBeDefined();
  });

  it('keeps the pick and reports it when its image cannot be downloaded', async () => {
    const { api } = await setup({ env: { STEAMGRIDDB_API_KEY: 'k' }, extra: { fetchFn: fakeFetch(sgdbRoutes({ title: 'Fortnite', extra: { [fullUrl('poster', 1)]: { status: 500 } } })) } });
    await api.loadArtworkOptions({ ...game, force: false });
    const result = await api.chooseArtwork({ ...game, kind: 'poster', imageId: 1001 });
    expect(result.downloadError).toContain('HTTP 500');
    expect(result.entry.choices.poster?.selected).toBe(1001);
  });

  it('has nowhere to keep a pick for a game without a title, and rejects bad picks', async () => {
    const { api } = await setup();
    await expect(api.chooseArtwork({ appId: 1, title: '!!!', kind: 'poster', imageId: 1 })).rejects.toThrow('no title');
    await expect(api.chooseArtwork({ appId: 1, title: 'x', kind: 'banner', imageId: 1 } as never)).rejects.toThrow('Invalid artwork pick');
  });
});

describe('artwork server', () => {
  it('serves an image from the grid folder, and refuses everything else', async () => {
    const { deps, configDir } = await setup();
    const serve = createArtworkServer(deps);
    await mkdir(path.join(configDir, 'grid'), { recursive: true });
    await writeFile(path.join(configDir, 'grid', '5p.png'), 'PNG');

    const ok = await serve('steam-manager-art://grid/5p.png?v=1');
    expect(ok).toMatchObject({ status: 200, contentType: 'image/png' });
    expect((ok as { data: Buffer }).data.toString()).toBe('PNG');
    expect(await serve('steam-manager-art://grid/6p.png')).toEqual({ status: 404 });
    expect(await serve('steam-manager-art://grid/..%2Fsecret.png')).toEqual({ status: 400 });
    expect(await serve('steam-manager-art://grid/notes.txt')).toEqual({ status: 400 });
    expect(await serve('steam-manager-art://grid/a/5p.png')).toEqual({ status: 400 });
    expect(await serve('steam-manager-art://other/5p.png')).toEqual({ status: 400 });
    expect(await serve('https://grid/5p.png')).toEqual({ status: 400 });
    expect(await serve('steam-manager-art://grid/%E0%A4%A')).toEqual({ status: 400 });
    expect(await serve('not a url')).toEqual({ status: 400 });
  });

  it('serves an image from the artwork cache, even encoded, and refuses anything else there', async () => {
    const { deps, home } = await setup();
    const serve = createArtworkServer(deps);
    const dir = path.join(home, '.config', 'steam-manager', 'artwork-cache', cacheKey('Hades') as string);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'hero.jpg'), 'JPG');
    const key = encodeURIComponent(cacheKey('Hades') as string);

    expect(await serve(`steam-manager-art://cache/${key}/hero.jpg?v=3`)).toMatchObject({ status: 200, contentType: 'image/jpeg' });
    expect(await serve(`steam-manager-art://cache/${key}/logo.png`)).toEqual({ status: 404 });
    expect(await serve(`steam-manager-art://cache/${key}/meta.json`)).toEqual({ status: 400 });
    expect(await serve('steam-manager-art://cache/..%2Fgrid/hero.jpg')).toEqual({ status: 400 });
    expect(await serve(`steam-manager-art://cache/${key}`)).toEqual({ status: 400 });
    expect(await serve(`steam-manager-art://cache/${key}/hero.jpg/more`)).toEqual({ status: 400 });
    expect(await serve('steam-manager-art://cache/%E0%A4%A/hero.jpg')).toEqual({ status: 400 });
  });

  it('serves cached images without Steam, and says not found for grid images when Steam cannot be found', async () => {
    const { deps, home } = await setup();
    const dir = path.join(home, '.config', 'steam-manager', 'artwork-cache', cacheKey('Hades') as string);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'icon.ico'), 'ICO');
    const noSteam = createArtworkServer({ ...deps, home });
    const elsewhere = createArtworkServer({ ...deps, home: await makeTempDir() });
    expect(await elsewhere('steam-manager-art://grid/5p.png')).toEqual({ status: 404 });
    expect(await noSteam(`steam-manager-art://cache/${encodeURIComponent(cacheKey('Hades') as string)}/icon.ico`)).toMatchObject({ status: 200 });
  });
});
