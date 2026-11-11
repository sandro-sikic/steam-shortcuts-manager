import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, parseGamesRequest, parseSyncRequest, systemDeps, type ApiDeps } from '../src/api.js';
import { integrations } from '../src/integrations/index.js';
import type { Integration } from '../src/integrations/types.js';
import { buildShortcut, MANAGED_TAG } from '../src/steam/shortcuts.js';
import { saveShortcuts } from '../src/steam/store.js';
import type { Game } from '../src/types.js';
import { cleanupTempDirs, desktopEnv, fakeFetch, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

const fortnite: Game = { store: 'Epic Games', id: 'fn', title: 'Fortnite', installed: true, launch: { kind: 'exe', exe: '/games/fortnite' } };
const fake = (over: Partial<Integration> = {}): Integration => ({
  id: 'fake',
  label: 'Fake Launcher',
  platforms: ['linux', 'win32', 'darwin'],
  scan: async () => [fortnite],
  ...over,
});

/** A home directory with a Steam installation in the usual Linux place. */
async function setup(options: { running?: boolean; users?: string[]; env?: NodeJS.ProcessEnv; integrations?: Integration[]; platform?: NodeJS.Platform } = {}) {
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
  it('reports the Steam installation and whether Steam is running', async () => {
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
    expect(await api.integrations()).toEqual([{ id: 'fake', label: 'Fake Launcher' }]);
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
