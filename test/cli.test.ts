import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppContext } from '../src/app.js';
import { createProgram } from '../src/cli.js';
import { tagImage } from '../src/artwork/tag.js';
import { osIntegration } from '../src/integrations/os/index.js';
import { buildShortcut, computeAppId, MANAGED_TAG } from '../src/steam/shortcuts.js';
import { loadShortcuts, saveShortcuts } from '../src/steam/store.js';
import type { Integration } from '../src/integrations/types.js';
import type { Game } from '../src/types.js';
import { cleanupTempDirs, desktopEnv, fakeFetch, makeSteamRoot, makeTempDir, sgdbRoutes } from './helpers.js';

afterEach(cleanupTempDirs);

const artRoutes = sgdbRoutes({ title: 'Fortnite', counts: { wide: 0, logo: 0, icon: 0 } });

const fortnite: Game = { store: 'Epic Games', id: 'fn', title: 'Fortnite', installed: true, launch: { kind: 'exe', exe: '/games/fortnite' } };

async function setup(options: { running?: boolean; integrations?: Integration[]; env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {}) {
  const root = await makeSteamRoot(['1']);
  const home = await makeTempDir();
  const logs: string[] = [];
  const fetchFn = fakeFetch(artRoutes);
  const ctx: AppContext = {
    platform: options.platform ?? 'linux',
    home,
    env: options.env ?? {},
    runner: async () => (options.running ? '999\n' : ''),
    fetchFn,
    integrations: options.integrations ?? [],
    log: (message) => logs.push(message),
  };
  const configDir = path.join(root, 'userdata', '1', 'config');
  const run = (...args: string[]) => createProgram(ctx).parseAsync(['node', 'steam-manager', '--steam-dir', root, ...args]);
  return { root, home, configDir, gridDir: path.join(configDir, 'grid'), logs, fetchFn, ctx, run };
}

const integration = (games: Game[], over: Partial<Integration> = {}): Integration => ({
  id: 'fake',
  label: 'Fake',
  platforms: ['linux', 'win32', 'darwin'],
  scan: async () => games,
  ...over,
});

describe('list', () => {
  it('reports when there are no shortcuts', async () => {
    const { run, logs } = await setup();
    await run('list');
    expect(logs).toEqual(['No non-Steam shortcuts found.']);
  });

  it('lists shortcuts with their tags and managed marker', async () => {
    const { run, logs, configDir } = await setup();
    await saveShortcuts(configDir, [
      buildShortcut({ title: 'Mine', exe: '/mine', tags: [] }),
      buildShortcut({ title: 'Fortnite', exe: '/games/fortnite', tags: ['Epic Games', MANAGED_TAG] }),
    ]);
    await run('list');
    const id = computeAppId('"/games/fortnite"', 'Fortnite');
    expect(logs).toEqual([`${computeAppId('"/mine"', 'Mine')}  Mine`, `${id}  Fortnite [Epic Games] (managed)`]);
  });

  it('auto-detects the Steam installation', async () => {
    const home = await makeTempDir();
    await mkdir(path.join(home, '.steam', 'steam', 'userdata', '3', 'config'), { recursive: true });
    const { ctx, logs } = await setup();
    await createProgram({ ...ctx, home }).parseAsync(['node', 'steam-manager', 'list']);
    expect(logs).toEqual(['No non-Steam shortcuts found.']);
  });
});

describe('switched-off games', () => {
  const exclude = async (home: string, keys: string[]) => {
    const dir = path.join(home, '.config', 'steam-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), JSON.stringify({ exclude: keys }));
  };

  it('does not add a game the user switched off', async () => {
    const other: Game = { ...fortnite, id: 'rl', title: 'Rocket League', launch: { kind: 'exe', exe: '/games/rl' } };
    const { run, home, configDir } = await setup({ integrations: [integration([fortnite, other])] });
    await exclude(home, ['Epic Games:fn']);
    await run('sync', '--no-artwork');
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['Rocket League']);
  });

  it('removes our shortcut when the game is switched off later, and re-adds it when switched on', async () => {
    const { run, home, configDir } = await setup({ integrations: [integration([fortnite])] });
    await run('sync', '--no-artwork');
    expect(await loadShortcuts(configDir)).toHaveLength(1);

    await exclude(home, ['Epic Games:fn']);
    await run('sync', '--no-artwork');
    expect(await loadShortcuts(configDir)).toEqual([]);

    await exclude(home, []);
    await run('sync', '--no-artwork');
    expect(await loadShortcuts(configDir)).toHaveLength(1);
  });

  it('removes the shortcut of a switched-off game that is started through a wrapper script', async () => {
    const uriGame: Game = { store: 'Ubisoft Connect', id: '720', title: 'Anno', installed: true, launch: { kind: 'uri', uri: 'uplay://launch/720/0' } };
    const { run, home, configDir } = await setup({ integrations: [integration([uriGame])] });
    await run('sync', '--no-artwork');
    expect(await loadShortcuts(configDir)).toHaveLength(1);
    await exclude(home, ['Ubisoft Connect:720']);
    await run('sync', '--no-artwork');
    expect(await loadShortcuts(configDir)).toEqual([]);
  });
});

describe('removing a game takes its own images along', () => {
  const id = computeAppId('"/games/fortnite"', 'Fortnite');
  const ours = (text: string) => tagImage(Buffer.from(text));

  async function synced(over: { kept?: boolean } = {}) {
    const t = await setup({ integrations: [integration([fortnite])] });
    await t.run('sync', '--no-artwork');
    const grid = path.join(t.configDir, 'grid');
    await mkdir(grid, { recursive: true });
    await writeFile(path.join(grid, `${id}p.png`), ours('poster'));
    await writeFile(path.join(grid, `${id}_icon.ico`), ours('icon'));
    await writeFile(path.join(grid, '999p.png'), ours('another game'));
    if (over.kept) await writeFile(path.join(grid, `${id}_hero.png`), 'the user made this');
    t.logs.length = 0;
    return { ...t, grid };
  }
  const switchOff = async (home: string) => {
    const dir = path.join(home, '.config', 'steam-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), JSON.stringify({ exclude: ['Epic Games:fn'] }));
  };

  it('deletes only the images carrying our tag, and says what it kept', async () => {
    const t = await synced({ kept: true });
    await switchOff(t.home);
    await t.run('sync', '--no-artwork');
    expect(t.logs).toContain("  Fortnite: removed 2 of our images from Steam's artwork folder, kept 1 that are not ours");
    expect((await readdir(t.grid)).sort()).toEqual([`${id}_hero.png`, '999p.png']);
    expect(await readFile(path.join(t.grid, `${id}_hero.png`), 'utf8')).toBe('the user made this');
  });

  it('says nothing about images when everything was ours or there were none', async () => {
    const t = await synced();
    await switchOff(t.home);
    await t.run('sync', '--no-artwork');
    expect(t.logs).toContain("  Fortnite: removed 2 of our images from Steam's artwork folder");
    expect(await readdir(t.grid)).toEqual(['999p.png']);

    const bare = await setup({ integrations: [integration([fortnite])] });
    await bare.run('sync', '--no-artwork');
    await switchOff(bare.home);
    bare.logs.length = 0;
    await bare.run('sync', '--no-artwork');
    expect(bare.logs.some((line) => line.includes('our images'))).toBe(false);
  });

  it('also does it when pruning games that are gone', async () => {
    const t = await synced();
    t.ctx.integrations = [integration([])];
    await t.run('sync', '--no-artwork', '--prune');
    expect(t.logs).toContain("  Fortnite: removed 2 of our images from Steam's artwork folder");
    expect(await readdir(t.grid)).toEqual(['999p.png']);
  });

  it('deletes nothing on a dry run, or when the game stays in Steam', async () => {
    const t = await synced();
    await switchOff(t.home);
    await t.run('sync', '--no-artwork', '--dry-run');
    expect((await readdir(t.grid)).sort()).toEqual([`${id}_icon.ico`, `${id}p.png`, '999p.png']);
    await mkdir(path.join(t.home, '.config', 'steam-manager'), { recursive: true });
    await writeFile(path.join(t.home, '.config', 'steam-manager', 'config.json'), '{}');
    await t.run('sync', '--no-artwork');
    expect((await readdir(t.grid)).sort()).toEqual([`${id}_icon.ico`, `${id}p.png`, '999p.png']);
  });
});

describe('integrations', () => {
  it('lists the integrations available on this platform', async () => {
    const { run, logs } = await setup({ integrations: [integration([]), integration([], { id: 'win', label: 'Windows Only', platforms: ['win32'] })] });
    await run('integrations');
    expect(logs).toEqual(['fake  Fake']);
  });

  it('says so when there are none', async () => {
    const { run, logs } = await setup();
    await run('integrations');
    expect(logs).toEqual(['No integrations are available on this platform.']);
  });
});

describe('add', () => {
  const add = ['add', '--title', 'Fortnite', '--exe', '/games/fortnite', '--store', 'Epic Games'];

  it('adds a tagged shortcut and downloads artwork named after its app ID', async () => {
    const { run, logs, configDir, gridDir } = await setup({ env: { STEAMGRIDDB_API_KEY: 'envkey' } });
    await run(...add, '--start-dir', '/games', '--launch-options', '-x');
    const [entry] = await loadShortcuts(configDir);
    expect(entry?.get('StartDir')).toBe('"/games"');
    expect(entry?.get('LaunchOptions')).toBe('-x');
    const id = computeAppId('"/games/fortnite"', 'Fortnite');
    expect((await readdir(gridDir)).sort()).toEqual([`${id}_hero.png`, `${id}p.png`]);
    expect(logs).toContain('  Fortnite (artwork: 2 saved, 0 already present, 3 not found, 0 failed)');
    expect(logs.some((l) => l.startsWith('Backed up'))).toBe(false);
  });

  it('reports artwork downloads that fail, and still adds the game', async () => {
    const { run, logs, configDir, ctx } = await setup({ env: { STEAMGRIDDB_API_KEY: 'k' } });
    ctx.fetchFn = fakeFetch({}); // every request answers 404
    await run(...add);
    expect(logs).toContain('  Fortnite (artwork: 0 saved, 0 already present, 0 not found, 5 failed)');
    expect(await loadShortcuts(configDir)).toHaveLength(1);
  });

  it('defaults the store to "Other" and honors --api-key', async () => {
    const { run, configDir, fetchFn } = await setup();
    await run('add', '--title', 'Fortnite', '--exe', '/e', '--api-key', 'flagkey', '--no-artwork');
    expect(fetchFn.requests).toHaveLength(0);
    expect((await loadShortcuts(configDir))[0]?.get('tags')).toEqual(new Map([['0', 'Other'], ['1', MANAGED_TAG]]));
  });

  it('skips artwork with a hint when there is no API key', async () => {
    const { run, logs, fetchFn } = await setup();
    await run(...add);
    expect(logs.some((l) => l.startsWith('Skipping artwork'))).toBe(true);
    expect(fetchFn.requests).toHaveLength(0);
  });

  it('writes nothing on a dry run', async () => {
    const { run, logs, configDir } = await setup({ running: true });
    await run(...add, '--dry-run');
    expect(await loadShortcuts(configDir)).toEqual([]);
    expect(logs).toEqual(['[dry run] Added:', '  Fortnite [Epic Games]', '[dry run] 1 added, 0 updated, 0 removed, 0 unchanged']);
  });

  it('refuses to write while Steam is running unless told otherwise', async () => {
    const { run, configDir } = await setup({ running: true });
    await expect(run(...add, '--no-artwork')).rejects.toThrow('Steam is running');
    expect(await loadShortcuts(configDir)).toEqual([]);
    await run('--allow-steam-running', ...add, '--no-artwork');
    expect(await loadShortcuts(configDir)).toHaveLength(1);
  });

  it('is idempotent: a re-run changes nothing, needs no closed Steam, and reuses artwork', async () => {
    const { ctx, run, logs, gridDir } = await setup({ env: { STEAMGRIDDB_API_KEY: 'k' } });
    await run(...add);
    ctx.runner = async () => '1';
    logs.length = 0;
    await run(...add);
    expect(logs).toEqual(['0 added, 0 updated, 0 removed, 0 unchanged'.replace('0 unchanged', '1 unchanged'), '  Fortnite (artwork: 0 saved, 2 already present, 3 not found, 0 failed)']);
    await run(...add, '--force-artwork');
    expect(logs.at(-1)).toContain('2 saved');
    expect(await readdir(gridDir)).toHaveLength(2);
  });

  it('backs up the previous file when changing it', async () => {
    const { run, logs } = await setup();
    await run(...add, '--no-artwork');
    await run('add', '--title', 'Other', '--exe', '/o', '--no-artwork');
    expect(logs.some((l) => l.startsWith('Backed up previous shortcuts to '))).toBe(true);
  });

  it('refuses to overwrite a shortcut it does not manage', async () => {
    const { run, configDir } = await setup();
    await saveShortcuts(configDir, [buildShortcut({ title: 'Fortnite', exe: '/games/fortnite', tags: [] })]);
    await expect(run(...add, '--no-artwork')).rejects.toThrow('does not manage');
  });

  it('requires a title and an exe', async () => {
    const { run } = await setup();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await expect(run('add')).rejects.toThrow("required option '--title <title>' not specified");
    stderr.mockRestore();
  });
});

describe('sync', () => {
  it('explains that there is nothing to sync without integrations', async () => {
    const { run, logs } = await setup();
    await run('sync');
    expect(logs).toEqual(['No integrations are available on this platform, so there is nothing to sync. Use "add" to add a game by hand.']);
  });

  it('ignores integrations that do not exist on this platform', async () => {
    const { run, logs } = await setup({ integrations: [integration([fortnite], { platforms: ['win32'] })] });
    await run('sync');
    expect(logs[0]).toContain('No integrations are available');
  });

  it('limits the sync with --only and rejects unknown ids', async () => {
    const other: Game = { ...fortnite, id: 'rl', title: 'Rocket League', launch: { kind: 'exe', exe: '/games/rl' } };
    const { run, configDir } = await setup({ integrations: [integration([fortnite]), integration([other], { id: 'fake2' })] });
    await run('sync', '--no-artwork', '--only', 'fake2');
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['Rocket League']);
    await expect(run('sync', '--only', 'nope')).rejects.toThrow('Unknown or unavailable integration "nope". Available here: fake, fake2');
  });

  it('reports a failing integration and carries on with the others', async () => {
    const broken = integration([], { id: 'broken', label: 'Broken', scan: async () => { throw new Error('boom'); } });
    const { run, logs, configDir } = await setup({ integrations: [broken, integration([fortnite])] });
    await run('sync', '--no-artwork');
    expect(logs[0]).toBe('Could not scan Broken: boom');
    expect(await loadShortcuts(configDir)).toHaveLength(1);
  });

  it('generates a wrapper script for URI launches and points the shortcut at it', async () => {
    const uriGame: Game = { store: 'Ubisoft Connect', id: '720', title: 'Anno', installed: true, launch: { kind: 'uri', uri: 'uplay://launch/720/0' } };
    const { run, home, configDir } = await setup({ integrations: [integration([uriGame])] });
    await run('sync', '--no-artwork');
    const script = path.join(home, '.config', 'steam-manager', 'launchers', 'Ubisoft_Connect-720.sh');
    const [entry] = await loadShortcuts(configDir);
    expect(entry?.get('Exe')).toBe(`"${script}"`);
    expect(await readFile(script, 'utf8')).toContain("xdg-open 'uplay://launch/720/0'");
  });

  it('does not write wrapper scripts on a dry run', async () => {
    const uriGame: Game = { store: 'Ubisoft Connect', id: '720', title: 'Anno', installed: true, launch: { kind: 'uri', uri: 'uplay://launch/720/0' } };
    const { run, home } = await setup({ integrations: [integration([uriGame])] });
    await run('sync', '--dry-run');
    await expect(readdir(path.join(home, '.config'))).rejects.toThrow();
  });

  it('syncs games from all providers, then updates and prunes on later runs', async () => {
    const other: Game = { ...fortnite, id: 'rl', title: 'Rocket League', launch: { kind: 'exe', exe: '/games/rl' } };
    const { run, ctx, logs, configDir } = await setup({ integrations: [integration([fortnite]), integration([other], { id: 'fake2' })] });
    await run('sync', '--no-artwork');
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['Fortnite', 'Rocket League']);

    ctx.integrations = [integration([{ ...fortnite, store: 'GOG' }])];
    logs.length = 0;
    await run('sync', '--no-artwork', '--prune');
    expect(logs).toEqual([
      'Updated:', '  Fortnite [GOG]',
      'Removed:', '  Rocket League [Epic Games]',
      '1 added'.replace('1 added', '0 added') + ', 1 updated, 1 removed, 0 unchanged',
      expect.stringMatching(/^Backed up/),
    ]);
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['Fortnite']);
  });

  it('lists pruned shortcuts without a store tag by title alone', async () => {
    const { run, logs, configDir } = await setup({ integrations: [integration([])] });
    await saveShortcuts(configDir, [buildShortcut({ title: 'Tagless', exe: '/t', tags: [MANAGED_TAG] })]);
    await run('sync', '--prune');
    expect(logs.slice(0, 2)).toEqual(['Removed:', '  Tagless']);
  });

  it('reports conflicts and nothing else to do', async () => {
    const { run, logs, configDir } = await setup({ integrations: [integration([fortnite])] });
    await saveShortcuts(configDir, [buildShortcut({ title: 'Fortnite', exe: '/games/fortnite', tags: [] })]);
    await run('sync');
    expect(logs).toEqual([
      'Skipped duplicates:',
      '  Fortnite [Epic Games], same as Fortnite (your own shortcut)',
      '0 added, 0 updated, 0 removed, 0 unchanged',
    ]);
  });

  it('does nothing quietly when providers return no installed games', async () => {
    const { run, logs, fetchFn } = await setup({ integrations: [integration([])], env: { STEAMGRIDDB_API_KEY: 'k' } });
    await run('sync');
    expect(logs).toEqual(['0 added, 0 updated, 0 removed, 0 unchanged']);
    expect(fetchFn.requests).toHaveLength(0);
  });

  it('downloads artwork for synced games', async () => {
    const { run, logs } = await setup({ integrations: [integration([fortnite])], env: { STEAMGRIDDB_API_KEY: 'k' } });
    await run('sync');
    expect(logs.at(-1)).toBe('  Fortnite (artwork: 2 saved, 0 already present, 3 not found, 0 failed)');
  });
});

describe.skipIf(process.platform === 'win32')('installed apps', () => {
  const apps = { 'Alpha Game': 'Game;', 'Beta Game': 'Game;', 'Some Tool': 'Utility;' };

  it('apps lists the games found and, with --all, the rest with reasons', async () => {
    const { run, logs } = await setup({ env: await desktopEnv(apps) });
    await run('apps');
    expect(logs).toEqual(['game   Alpha Game  (freedesktop-game)', 'game   Beta Game  (freedesktop-game)']);
    logs.length = 0;
    await run('apps', '--all');
    expect(logs).toContain('no     Some Tool  (categorized as Utility)');
  });

  it('apps says so when nothing looks like a game', async () => {
    const { run, logs } = await setup({ env: await desktopEnv({ 'Some Tool': 'Utility;' }) });
    await run('apps');
    expect(logs).toEqual(['No games found among the installed apps.']);
  });

  it('sync adds confident games under the Installed Apps tag', async () => {
    const { run, configDir, logs } = await setup({ env: await desktopEnv(apps), integrations: [osIntegration] });
    await run('sync', '--no-artwork');
    const entries = await loadShortcuts(configDir);
    expect(entries.map((e) => e.get('AppName'))).toEqual(['Alpha Game', 'Beta Game']);
    expect(entries[0]?.get('tags')).toEqual(new Map([['0', 'Installed Apps'], ['1', MANAGED_TAG]]));
    expect(logs).toContain('2 added, 0 updated, 0 removed, 0 unchanged');
  });

  it('never adds a game twice: the specific launcher wins over the OS guess', async () => {
    const alpha: Game = { store: 'Epic Games', id: 'a', title: 'Alpha Game', installed: true, launch: { kind: 'exe', exe: '/epic/alpha' } };
    const { run, configDir, logs } = await setup({ env: await desktopEnv(apps), integrations: [integration([alpha]), osIntegration] });
    await run('sync', '--no-artwork');
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['Alpha Game', 'Beta Game']);
    expect(logs).toContain('Skipped duplicates:');
    expect(logs).toContain('  Alpha Game [Installed Apps], same as Alpha Game [Epic Games]');
  });

  it('skips games that are already installed in Steam itself', async () => {
    const { run, root, configDir, logs } = await setup({ env: await desktopEnv(apps), integrations: [osIntegration] });
    await mkdir(path.join(root, 'steamapps'), { recursive: true });
    await writeFile(path.join(root, 'steamapps', 'appmanifest_1.acf'), '"AppState" { "name" "Beta Game" }');
    await run('sync', '--no-artwork');
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['Alpha Game']);
    expect(logs).toContain('  Beta Game [Installed Apps], same as Beta Game (installed in Steam)');
  });

  it('tolerates hand-made shortcuts that lack an exe or launch options', async () => {
    const { run, configDir } = await setup({ env: await desktopEnv(apps), integrations: [osIntegration] });
    await saveShortcuts(configDir, [
      new Map<string, string | number>([['appid', 1], ['AppName', 'No Exe']]),
      new Map<string, string | number>([['appid', 2], ['AppName', 'No Options'], ['Exe', '"/somewhere/else"']]),
    ]);
    await run('sync', '--no-artwork');
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['No Exe', 'No Options', 'Alpha Game', 'Beta Game']);
  });

  it('is idempotent across runs', async () => {
    const { run, configDir, logs } = await setup({ env: await desktopEnv(apps), integrations: [osIntegration] });
    await run('sync', '--no-artwork');
    logs.length = 0;
    await run('sync', '--no-artwork');
    expect(logs).toEqual(['0 added, 0 updated, 0 removed, 2 unchanged']);
    expect(await loadShortcuts(configDir)).toHaveLength(2);
  });

  it('applies allow and deny lists from config.json', async () => {
    const { run, home, configDir } = await setup({ env: await desktopEnv(apps), integrations: [osIntegration] });
    const dir = path.join(home, '.config', 'steam-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), JSON.stringify({ allow: ['Some Tool'], deny: ['Alpha Game'] }));
    await run('sync', '--no-artwork');
    expect((await loadShortcuts(configDir)).map((e) => e.get('AppName'))).toEqual(['Beta Game', 'Some Tool']);
  });

  it('reports an invalid config file', async () => {
    const { run, home } = await setup({ env: await desktopEnv(apps), integrations: [osIntegration] });
    const dir = path.join(home, '.config', 'steam-manager');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), '{broken');
    await expect(run('sync')).rejects.toThrow('Invalid config file');
    await expect(run('apps')).rejects.toThrow('Invalid config file');
  });
});

describe('weak guesses on Windows', () => {
  it('sync adds Unity/Unreal installs only with --include-maybe', async () => {
    const dir = await makeTempDir();
    const game = path.join(dir, 'Unity G');
    await mkdir(path.join(game, 'G_Data'), { recursive: true });
    await writeFile(path.join(game, 'UnityPlayer.dll'), '');
    await writeFile(path.join(game, 'G.exe'), '');
    const reg = `\r\nHKEY_CURRENT_USER\\x\\G\r\n    DisplayName    REG_SZ    Unity G\r\n    InstallLocation    REG_SZ    ${game}\r\n`;
    const base = await setup({ platform: 'win32', integrations: [osIntegration] });
    base.ctx.runner = async (command, args) => (command === 'reg' && args[1]?.startsWith('HKCU\\SOFTWARE') ? reg : '');

    await base.run('apps');
    expect(base.logs).toEqual(['maybe  Unity G  (unity)']);
    await base.run('sync', '--no-artwork');
    expect(await loadShortcuts(base.configDir)).toEqual([]);

    await base.run('sync', '--no-artwork', '--include-maybe');
    expect((await loadShortcuts(base.configDir)).map((e) => e.get('AppName'))).toEqual(['Unity G']);
  });
});
