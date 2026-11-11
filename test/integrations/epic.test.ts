import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { epicIntegration } from '../../src/integrations/epic.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { deflateSync } from 'node:zlib';
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
    drives: [],
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
    expect(await epicIntegration.scan({ platform: 'win32', home: root, env: {}, run: async () => '', drives: [] })).toEqual([]);
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
          installDir: '/games/Alpha',
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

  it('omits the install folder from a launcher link when the manifest has none', async () => {
    const ctx = await setup('win32', { 'a.item': game('Alpha', { InstallLocation: undefined }) });
    expect((await epicIntegration.scan(ctx))[0]?.launch).not.toHaveProperty('installDir');
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
    const games = await epicIntegration.scan({ platform: 'win32', home: root, env: {}, run: async () => '', drives: [] });
    expect(games).toEqual([]);
  });

  describe('install folders', () => {
    const fstr = (value: string): Buffer => {
      const bytes = Buffer.from(`${value}\0`, 'latin1');
      const length = Buffer.alloc(4);
      length.writeInt32LE(value === '' ? 0 : bytes.length);
      return value === '' ? length : Buffer.concat([length, bytes]);
    };
    /** A binary manifest like the launcher's, naming the game and its executable. */
    const manifest = (appName: string, exe: string): Buffer => {
      const fixed = Buffer.alloc(14);
      const body = deflateSync(Buffer.concat([fixed, fstr(appName), fstr('1.0'), fstr(exe), fstr('')]));
      const header = Buffer.alloc(41);
      header.writeUInt32LE(0x44bec00c, 0);
      header.writeUInt32LE(41, 4);
      header.writeUInt8(1, 36);
      return Buffer.concat([header, body]);
    };
    const catalog = (items: object[]) => Buffer.from(Buffer.from(JSON.stringify(items)).toString('base64'));

    /** A Windows machine with Epic's data and game folders, but no `.item` manifests. */
    async function machine(games: Record<string, Buffer | null>, catcache?: Buffer) {
      const root = await makeTempDir();
      const programFiles = path.join(root, 'Program Files');
      for (const [folder, data] of Object.entries(games)) {
        const store = path.join(programFiles, 'Epic Games', folder, '.egstore');
        await mkdir(store, { recursive: true });
        if (data) await writeFile(path.join(store, 'ABC123.manifest'), data);
      }
      if (catcache) {
        await mkdir(path.join(root, 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog'), { recursive: true });
        await writeFile(path.join(root, 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin'), catcache);
      }
      const ctx: ScanContext = { platform: 'win32', home: root, env: { ProgramData: root, ProgramFiles: programFiles }, run: async () => '', drives: [] };
      return { ctx, programFiles };
    }

    it('finds games without a list of installed games, with the title and ids from the launcher catalog', async () => {
      const { ctx, programFiles } = await machine(
        { Automachef: manifest('Salt', 'Automachef.exe'), AstroDuel2: manifest('Pepper', 'AstroDuel2.exe') },
        catalog([
          { id: 'item1', namespace: 'ns1', title: 'Automachef', releaseInfo: [{ appId: 'Salt' }] },
          { id: 'item2', namespace: 'ns2', title: 'Astro Duel 2', customAttributes: { FolderName: { value: 'AstroDuel2' } } },
        ]),
      );
      expect(await epicIntegration.scan(ctx)).toEqual([
        { store: 'Epic Games', id: 'Pepper', title: 'Astro Duel 2', installed: true, launch: { kind: 'uri', uri: 'com.epicgames.launcher://apps/ns2%3Aitem2%3APepper?action=launch&silent=true', waitFor: 'AstroDuel2.exe', installDir: path.join(programFiles, 'Epic Games', 'AstroDuel2') } },
        { store: 'Epic Games', id: 'Salt', title: 'Automachef', installed: true, launch: { kind: 'uri', uri: 'com.epicgames.launcher://apps/ns1%3Aitem1%3ASalt?action=launch&silent=true', waitFor: 'Automachef.exe', installDir: path.join(programFiles, 'Epic Games', 'Automachef') } },
      ]);
    });

    it('uses the folder name as the title and the short launcher link when the catalog does not know the game', async () => {
      const { ctx, programFiles } = await machine({ AstroDuel2: manifest('Pepper', 'Bin/Astro Duel;2.exe'), Automachef: manifest('Salt', 'Automachef.exe') });
      const games = await epicIntegration.scan(ctx);
      expect(games.map((g) => g.title)).toEqual(['Astro Duel 2', 'Automachef']);
      expect(games[0]?.launch).toEqual({ kind: 'uri', uri: 'com.epicgames.launcher://apps/Pepper?action=launch&silent=true', installDir: path.join(programFiles, 'Epic Games', 'AstroDuel2') });
    });

    it('skips the launcher and redistributables, folders without a readable manifest, and games without an executable', async () => {
      const { ctx } = await machine({
        Launcher: manifest('Launcher', 'EpicGamesLauncher.exe'),
        DirectXRedist: manifest('Redist', 'dx.exe'),
        GameInputRedist: manifest('Input', 'in.exe'),
        NoStore: null,
        Broken: Buffer.from('garbage'),
        Tool: manifest('Tool', ''),
        Real: manifest('Real', 'Real.exe'),
      });
      expect((await epicIntegration.scan(ctx)).map((g) => g.id)).toEqual(['Real']);
    });

    it('does not add a game the manifests already listed, and ignores folders on other platforms', async () => {
      const { ctx } = await machine({ Automachef: manifest('Salt', 'Automachef.exe') });
      const dir = path.join(ctx.env['ProgramData'] as string, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'a.item'), JSON.stringify(game('Salt', { DisplayName: 'From the manifest' })));
      expect((await epicIntegration.scan(ctx)).map((g) => g.title)).toEqual(['From the manifest']);
      expect(await epicIntegration.scan({ ...ctx, platform: 'darwin', home: ctx.home })).toEqual([]);
    });

    it('looks in the Program Files variants and in Epic Games folders on any drive', async () => {
      const { ctx } = await machine({});
      const other = path.join(ctx.home, 'Other');
      await mkdir(path.join(other, 'Epic Games', 'Elsewhere', '.egstore'), { recursive: true });
      await writeFile(path.join(other, 'Epic Games', 'Elsewhere', '.egstore', 'X.manifest'), manifest('Else', 'e.exe'));
      for (const variable of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
        const found = await epicIntegration.scan({ ...ctx, env: { ProgramData: ctx.home, [variable]: other } });
        expect(found.map((g) => g.id)).toEqual(['Else']);
      }
      expect(await epicIntegration.scan({ ...ctx, env: { ProgramData: ctx.home } })).toEqual([]);
      expect((await epicIntegration.scan({ ...ctx, env: { ProgramData: ctx.home }, drives: [other] })).map((g) => g.id)).toEqual(['Else']);
    });

    it('looks on drives C: through Z: when no drives are given', async () => {
      const { ctx } = await machine({});
      const { drives, ...unset } = ctx;
      expect(drives).toEqual([]);
      expect(await epicIntegration.scan({ ...unset, env: { ProgramData: ctx.home } })).toBeInstanceOf(Array);
    });
  });
});
