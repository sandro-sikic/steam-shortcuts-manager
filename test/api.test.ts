import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApi, parseSyncRequest, systemDeps, type ApiDeps } from '../src/api.js';
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
