import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { itchIntegration } from '../../src/integrations/itch.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

function ctxFor(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): ScanContext {
  return { platform, home, env, run: async () => '' };
}

async function put(file: string, content: string | Buffer = '', mode = 0o644): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
  await chmod(file, mode);
}

async function receipt(dir: string, value: unknown): Promise<void> {
  await put(path.join(dir, '.itch', 'receipt.json.gz'), gzipSync(JSON.stringify(value)));
}

describe('itch integration', () => {
  it('describes itself', () => {
    expect(itchIntegration).toMatchObject({ id: 'itch', label: 'itch.io', platforms: ['win32', 'linux', 'darwin'] });
  });

  it('returns nothing when the itch apps folder is absent', async () => {
    const home = await makeTempDir();
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      expect(await itchIntegration.scan(ctxFor(home, platform))).toEqual([]);
    }
  });

  it('finds Windows games under APPDATA, sorted by title, ignoring helpers and stray files', async () => {
    const appdata = await makeTempDir();
    const apps = path.join(appdata, 'itch', 'apps');
    await put(path.join(apps, 'zeta-game', 'Zeta.exe'));
    await put(path.join(apps, 'zeta-game', 'unins000.exe'));
    await receipt(path.join(apps, 'zeta-game'), { game: { id: 42, title: 'Zeta Quest' } });
    await put(path.join(apps, 'alpha', 'bin', 'helper.exe'));
    await put(path.join(apps, 'alpha', 'bin', 'Alpha.exe'));
    await put(path.join(apps, 'alpha', 'readme.txt'));
    await receipt(path.join(apps, 'alpha'), { game: { id: '7', title: 'alpha beta' } });
    await put(path.join(apps, 'stray-file.txt'));
    await mkdir(path.join(apps, 'empty'), { recursive: true });
    await put(path.join(apps, 'dirs-only', 'sub', 'notes.txt'));

    const games = await itchIntegration.scan(ctxFor('/unused', 'win32', { APPDATA: appdata }));
    expect(games).toEqual([
      { store: 'itch.io', id: '7', title: 'alpha beta', installed: true, launch: { kind: 'exe', exe: path.join(apps, 'alpha', 'bin', 'Alpha.exe'), startDir: path.join(apps, 'alpha', 'bin') } },
      { store: 'itch.io', id: '42', title: 'Zeta Quest', installed: true, launch: { kind: 'exe', exe: path.join(apps, 'zeta-game', 'Zeta.exe'), startDir: path.join(apps, 'zeta-game') } },
    ]);
  });

  it('falls back to the default AppData location, and to folder name for title and id without a receipt', async () => {
    const home = await makeTempDir();
    const dir = path.join(home, 'AppData', 'Roaming', 'itch', 'apps', 'Cool Game');
    await put(path.join(dir, 'a.exe'));
    await put(path.join(dir, 'cool game.exe'));
    const [game] = await itchIntegration.scan(ctxFor(home, 'win32'));
    expect(game).toMatchObject({ id: 'Cool Game', title: 'Cool Game', launch: { exe: path.join(dir, 'cool game.exe') } });
  });

  it('treats unreadable, non-object or incomplete receipts as missing', async () => {
    const home = await makeTempDir();
    const apps = path.join(home, '.config', 'itch', 'apps');
    await put(path.join(apps, 'bad-gzip', 'g.exe'));
    await put(path.join(apps, 'bad-gzip', '.itch', 'receipt.json.gz'), 'not gzip');
    await put(path.join(apps, 'null-json', 'g.exe'));
    await receipt(path.join(apps, 'null-json'), null);
    await put(path.join(apps, 'blank', 'g.exe'));
    await receipt(path.join(apps, 'blank'), { game: { id: '', title: '  ' } });
    await put(path.join(apps, 'weird-id', 'g.exe'));
    await receipt(path.join(apps, 'weird-id'), { game: { id: { x: 1 }, title: 5 } });
    const games = await itchIntegration.scan(ctxFor(home, 'win32', { APPDATA: path.join(home, '.config') }));
    expect(games.map((g) => [g.id, g.title])).toEqual([
      ['bad-gzip', 'bad-gzip'], ['blank', 'blank'], ['null-json', 'null-json'], ['weird-id', 'weird-id'],
    ]);
  });

  it('de-duplicates games by receipt id, keeping the first folder', async () => {
    const appdata = await makeTempDir();
    const apps = path.join(appdata, 'itch', 'apps');
    for (const folder of ['one', 'two']) {
      await put(path.join(apps, folder, 'g.exe'));
      await receipt(path.join(apps, folder), { game: { id: 5, title: folder } });
    }
    const games = await itchIntegration.scan(ctxFor('/unused', 'win32', { APPDATA: appdata }));
    expect(games.map((g) => g.title)).toEqual(['one']);
  });

  it('uses executables listed in the receipt, including backslash paths, and ignores bad entries', async () => {
    const appdata = await makeTempDir();
    const dir = path.join(appdata, 'itch', 'apps', 'g');
    await put(path.join(dir, 'a-first.exe'));
    await put(path.join(dir, 'bin', 'Real.exe'));
    await receipt(dir, { game: { id: 1, title: 'Real' }, files: [42, 'missing.exe', 'bin\\Real.exe', 'bin'] });
    const [game] = await itchIntegration.scan(ctxFor('/unused', 'win32', { APPDATA: appdata }));
    expect(game!.launch).toMatchObject({ exe: path.join(dir, 'bin', 'Real.exe') });
  });

  it('scans when the receipt lists no usable files (non-array files field)', async () => {
    const appdata = await makeTempDir();
    const dir = path.join(appdata, 'itch', 'apps', 'g');
    await put(path.join(dir, 'g.exe'));
    await receipt(dir, { files: 'nope' });
    expect(await itchIntegration.scan(ctxFor('/unused', 'win32', { APPDATA: appdata }))).toHaveLength(1);
  });

  it('finds Linux games by executable bit, honoring XDG_CONFIG_HOME and skipping helpers and libraries', async () => {
    const xdg = await makeTempDir();
    const dir = path.join(xdg, 'itch', 'apps', 'linuxgame');
    await put(path.join(dir, 'crashpad_handler'), '', 0o755);
    await put(path.join(dir, 'libfoo.so'), '', 0o755);
    await put(path.join(dir, 'libfoo.so.1'), '', 0o755);
    await put(path.join(dir, 'data.pak'), '', 0o644);
    await put(path.join(dir, 'Zzz.x86_64'), '', 0o755);
    await put(path.join(dir, 'linuxgame'), '', 0o755);
    const games = await itchIntegration.scan(ctxFor('/unused', 'linux', { XDG_CONFIG_HOME: xdg }));
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: 'linuxgame', launch: { kind: 'exe', exe: path.join(dir, 'linuxgame'), startDir: dir } });
  });

  it('uses ~/.config on Linux when XDG_CONFIG_HOME is unset, and skips games with no executable', async () => {
    const home = await makeTempDir();
    const apps = path.join(home, '.config', 'itch', 'apps');
    await put(path.join(apps, 'ok', 'run.sh'), '', 0o755);
    await put(path.join(apps, 'plain', 'data.txt'));
    const games = await itchIntegration.scan(ctxFor(home, 'linux'));
    expect(games.map((g) => g.id)).toEqual(['ok']);
  });

  it('finds macOS .app bundles, preferring the binary named like the bundle', async () => {
    const home = await makeTempDir();
    const apps = path.join(home, 'Library', 'Application Support', 'itch', 'apps');
    await put(path.join(apps, 'mac', 'Other.app', 'Contents', 'MacOS', 'Other'));
    await put(path.join(apps, 'mac', 'Fun Game.app', 'Contents', 'MacOS', 'aaa'));
    await put(path.join(apps, 'mac', 'Fun Game.app', 'Contents', 'MacOS', 'Fun Game'));
    await receipt(path.join(apps, 'mac'), { game: { id: 9, title: 'Fun Game' }, files: ['Fun Game.app'] });
    await put(path.join(apps, 'nested', 'inner', 'Nest.app', 'Contents', 'MacOS', 'launcher'));
    await mkdir(path.join(apps, 'nobin', 'Empty.app', 'Contents', 'MacOS'), { recursive: true });
    await put(path.join(apps, 'notapp', 'Thing.exe'));
    await mkdir(path.join(apps, 'notapp', 'Dir'), { recursive: true });
    const games = await itchIntegration.scan(ctxFor(home, 'darwin'));
    const macos = path.join(apps, 'mac', 'Fun Game.app', 'Contents', 'MacOS');
    expect(games.map((g) => g.title)).toEqual(['Fun Game', 'nested']);
    expect(games[0]!.launch).toEqual({ kind: 'exe', exe: path.join(macos, 'Fun Game'), startDir: macos });
  });
});
