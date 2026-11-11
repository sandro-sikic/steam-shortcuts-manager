import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { heroicIntegration } from '../../src/integrations/heroic.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

async function put(root: string, rel: string[], data: unknown): Promise<void> {
  const file = path.join(root, ...rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
}

function ctx(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): ScanContext {
  return { platform, home, env, run: async () => '' };
}

describe('heroic integration', () => {
  it('declares its identity', () => {
    expect(heroicIntegration.id).toBe('heroic');
    expect(heroicIntegration.label).toBe('Heroic Games Launcher');
    expect(heroicIntegration.platforms).toEqual(['linux', 'win32', 'darwin']);
  });

  it('returns nothing when Heroic is absent or the platform is unknown', async () => {
    const home = await makeTempDir();
    expect(await heroicIntegration.scan(ctx(home, 'linux'))).toEqual([]);
    expect(await heroicIntegration.scan(ctx(home, 'win32'))).toEqual([]);
    expect(await heroicIntegration.scan(ctx(home, 'freebsd'))).toEqual([]);
  });

  it('lists Epic, GOG and Amazon games sorted by title with per-store tags', async () => {
    const home = await makeTempDir();
    const root = path.join(home, '.config', 'heroic');
    await put(root, ['legendaryConfig', 'legendary', 'installed.json'], {
      Sugar: { app_name: 'Sugar', title: 'Zebra Game', install_path: '/g/zebra', executable: 'Bin/Zebra.exe', is_dlc: false },
      SugarDlc: { app_name: 'SugarDlc', title: 'Zebra DLC', is_dlc: true },
      Fn: { title: 'apple', install_path: '/g/apple', executable: 'bad;name.exe' },
      NoTitle: { app_name: 'NoTitle', install_path: '/g/Some Folder/', executable: 'a\\b\\Run.exe' },
      Idless: 'not a record',
    });
    await put(root, ['store_cache', 'legendary_library.json'], { library: [{ app_name: 'Sugar', title: 'Ignored' }, { app_name: 'x' }, { title: 'no id' }] });
    await put(root, ['gog_store', 'installed.json'], { installed: [{ appName: '123', install_path: '/g/gog', platform: 'linux' }, { platform: 'linux' }] });
    await put(root, ['store_cache', 'gog_library.json'], { games: [{ app_name: '123', title: 'Gog Game' }] });
    await put(root, ['nile_config', 'nile', 'installed.json'], [{ id: 'amzn1', path: '/g/amz' }, 7]);
    await put(root, ['store_cache', 'nile_library.json'], [{ id: 'amzn1', title: 'Amazon Game' }]);

    const games = await heroicIntegration.scan(ctx(home, 'linux'));
    expect(games.map((g) => [g.store, g.id, g.title])).toEqual([
      ['Heroic (Amazon Games)', 'nile:amzn1', 'Amazon Game'],
      ['Heroic (Epic Games)', 'legendary:Fn', 'apple'],
      ['Heroic (GOG)', 'gog:123', 'Gog Game'],
      ['Heroic (Epic Games)', 'legendary:NoTitle', 'Some Folder'],
      ['Heroic (Epic Games)', 'legendary:Sugar', 'Zebra Game'],
    ]);
    expect(games.every((g) => g.installed)).toBe(true);
    const byId = Object.fromEntries(games.map((g) => [g.id, g.launch]));
    expect(byId['legendary:Sugar']).toEqual({ kind: 'uri', uri: 'heroic://launch/legendary/Sugar', waitFor: 'Zebra.exe' });
    expect(byId['legendary:NoTitle']).toEqual({ kind: 'uri', uri: 'heroic://launch/legendary/NoTitle', waitFor: 'Run.exe' });
    expect(byId['legendary:Fn']).toEqual({ kind: 'uri', uri: 'heroic://launch/legendary/Fn' });
    expect(byId['gog:123']).toEqual({ kind: 'uri', uri: 'heroic://launch/gog/123' });
    expect(byId['nile:amzn1']).toEqual({ kind: 'uri', uri: 'heroic://launch/nile/amzn1' });
  });

  it('falls back to the app name for titles and tolerates malformed files', async () => {
    const home = await makeTempDir();
    const root = path.join(home, '.config', 'heroic');
    await put(root, ['legendaryConfig', 'legendary', 'installed.json'], '{broken');
    await put(root, ['gog_store', 'installed.json'], 42);
    await put(root, ['gogdlConfig', 'heroic_gogdl', 'installed.json'], [{ appName: '9' }, { appName: 'dup', title: 'Dup', path: '/p/dup' }]);
    await put(root, ['store_cache', 'gog_library.json'], 'nope');
    const games = await heroicIntegration.scan(ctx(home, 'linux'));
    expect(games.map((g) => [g.id, g.title])).toEqual([
      ['gog:dup', 'Dup'],
      ['gog:9', '9'],
    ].sort((a, b) => a[1]!.toLowerCase().localeCompare(b[1]!.toLowerCase())));
  });

  it('de-duplicates games found in several roots or files, keeping the first', async () => {
    const home = await makeTempDir();
    const xdg = await makeTempDir();
    await put(xdg, ['heroic', 'gog_store', 'installed.json'], { installed: [{ appName: '1', title: 'First' }] });
    await put(xdg, ['heroic', 'gogdlConfig', 'heroic_gogdl', 'installed.json'], { installed: [{ appName: '1', title: 'Again' }] });
    await put(home, ['.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic', 'gog_store', 'installed.json'], {
      installed: [{ appName: '1', title: 'Flatpak' }, { appName: '2', title: 'Only Flatpak' }],
    });
    const games = await heroicIntegration.scan(ctx(home, 'linux', { XDG_CONFIG_HOME: xdg }));
    expect(games.map((g) => g.title)).toEqual(['First', 'Only Flatpak']);
  });

  it('reads %APPDATA%\\heroic on Windows, with a home-based fallback', async () => {
    const home = await makeTempDir();
    const appData = await makeTempDir();
    const data = { installed: [{ appName: 'w', title: 'Win Game' }] };
    await put(appData, ['heroic', 'gog_store', 'installed.json'], data);
    expect((await heroicIntegration.scan(ctx(home, 'win32', { APPDATA: appData }))).map((g) => g.title)).toEqual(['Win Game']);
    await put(home, ['AppData', 'Roaming', 'heroic', 'gog_store', 'installed.json'], data);
    expect((await heroicIntegration.scan(ctx(home, 'win32'))).map((g) => g.title)).toEqual(['Win Game']);
  });

  it('reads Application Support on macOS', async () => {
    const home = await makeTempDir();
    await put(home, ['Library', 'Application Support', 'heroic', 'nile_config', 'nile', 'installed.json'], { a1: { path: '/Games/Mac Game' } });
    const games = await heroicIntegration.scan(ctx(home, 'darwin'));
    expect(games.map((g) => [g.id, g.title])).toEqual([['nile:a1', 'Mac Game']]);
  });
});
