import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { epicIntegration } from '../../src/integrations/epic.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const MANIFESTS = ['Epic', 'EpicGamesLauncher', 'Data', 'Manifests'];

async function setup(platform: NodeJS.Platform, items: Record<string, string | object>) {
  const root = await makeTempDir();
  const dir = platform === 'win32' ? path.join(root, ...MANIFESTS) : path.join(root, 'Library', 'Application Support', ...MANIFESTS);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(items)) {
    await writeFile(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  const ctx: ScanContext = {
    platform,
    home: root,
    env: platform === 'win32' ? { ProgramData: root } : {},
    run: async () => '',
  };
  return ctx;
}

const game = (appName: string, extra: object = {}) => ({
  DisplayName: `Game ${appName}`,
  AppName: appName,
  InstallLocation: `/games/${appName}`,
  LaunchExecutable: `Bin/${appName}.exe`,
  CatalogNamespace: `ns${appName}`,
  CatalogItemId: `item${appName}`,
  ...extra,
});

describe('epic integration', () => {
  it('declares its identity', () => {
    expect(epicIntegration).toMatchObject({ id: 'epic', label: 'Epic Games', platforms: ['win32', 'darwin'] });
  });

  it('returns [] when the launcher is absent', async () => {
    const root = await makeTempDir();
    expect(await epicIntegration.scan({ platform: 'darwin', home: root, env: {}, run: async () => '' })).toEqual([]);
    expect(await epicIntegration.scan({ platform: 'win32', home: root, env: {}, run: async () => '' })).toEqual([]);
  });

  it('launches through the launcher URI and waits for the executable', async () => {
    const ctx = await setup('win32', { 'A.item': game('Alpha', { LaunchExecutable: 'Win64\\Alpha Game.exe' }) });
    expect(await epicIntegration.scan(ctx)).toEqual([
      {
        store: 'Epic Games',
        id: 'Alpha',
        title: 'Game Alpha',
        installed: true,
        launch: {
          kind: 'uri',
          uri: 'com.epicgames.launcher://apps/nsAlpha%3AitemAlpha%3AAlpha?action=launch&silent=true',
          waitFor: 'Alpha Game.exe',
        },
      },
    ]);
  });

  it('works on macOS and omits waitFor when the executable is missing or unsafe', async () => {
    const ctx = await setup('darwin', {
      'a.item': game('Alpha', { LaunchExecutable: undefined }),
      'b.item': game('Beta', { LaunchExecutable: 'Bin/we;ird.exe' }),
    });
    const games = await epicIntegration.scan(ctx);
    expect(games.map((g) => g.id)).toEqual(['Alpha', 'Beta']);
    for (const g of games) expect(g.launch).toMatchObject({ kind: 'uri' });
    for (const g of games) expect(g.launch).not.toHaveProperty('waitFor');
  });

  it('falls back to a direct exe launch without catalog ids', async () => {
    const ctx = await setup('win32', {
      'a.item': game('Alpha', { CatalogNamespace: undefined }),
      'b.item': game('Beta', { CatalogItemId: ' ' }),
    });
    const games = await epicIntegration.scan(ctx);
    expect(games[0]?.launch).toEqual({ kind: 'exe', exe: path.join('/games/Alpha', 'Bin/Alpha.exe'), startDir: '/games/Alpha' });
    expect(games[1]?.launch).toMatchObject({ kind: 'exe' });
  });

  it('skips incomplete installs, add-ons, malformed and unlaunchable entries', async () => {
    const ctx = await setup('win32', {
      'ok.item': game('Ok', { MainGameAppName: 'Ok' }),
      'dlc.item': game('Dlc', { MainGameAppName: 'Ok' }),
      'inc.item': game('Inc', { bIsIncompleteInstall: true }),
      'noname.item': game('NoName', { DisplayName: '' }),
      'noapp.item': game('NoApp', { AppName: 5 }),
      'nolaunch.item': game('NoLaunch', { CatalogNamespace: undefined, InstallLocation: undefined }),
      'noexe.item': game('NoExe', { CatalogNamespace: undefined, LaunchExecutable: undefined }),
      'bad.item': '{nope',
      'null.item': 'null',
      'ignored.txt': game('Ignored'),
    });
    expect((await epicIntegration.scan(ctx)).map((g) => g.id)).toEqual(['Ok']);
  });

  it('de-duplicates by AppName and sorts by title case-insensitively', async () => {
    const ctx = await setup('win32', {
      '1.ITEM': game('Zed', { DisplayName: 'zebra' }),
      '2.item': game('Zed', { DisplayName: 'Duplicate' }),
      '3.item': game('Ant', { DisplayName: 'Apple' }),
      '4.item': game('Bee', { DisplayName: 'banana' }),
    });
    expect((await epicIntegration.scan(ctx)).map((g) => g.title)).toEqual(['Apple', 'banana', 'zebra']);
  });

  it('defaults ProgramData when the environment lacks it', async () => {
    const root = await makeTempDir();
    const games = await epicIntegration.scan({ platform: 'win32', home: root, env: {}, run: async () => '' });
    expect(games).toEqual([]);
  });
});
