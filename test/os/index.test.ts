import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyInstalledApps, osIntegration } from '../../src/integrations/os/index.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

async function linuxCtx(options: ScanContext['options'] = {}): Promise<ScanContext> {
  const data = await makeTempDir();
  const bin = await makeTempDir();
  const exe = path.join(bin, 'g');
  await writeFile(exe, '#!/bin/sh\n');
  await chmod(exe, 0o755);
  const dir = path.join(data, 'applications');
  await mkdir(dir);
  const entry = (name: string, categories: string) => `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exe}\nCategories=${categories}\n`;
  await writeFile(path.join(dir, 'b.desktop'), entry('Beta Game', 'Game;'));
  await writeFile(path.join(dir, 'a.desktop'), entry('Alpha Game', 'Game;'));
  await writeFile(path.join(dir, 'tool.desktop'), entry('Some Tool', 'Utility;'));
  await writeFile(path.join(dir, 'emu.desktop'), entry('Retro Thing', 'Game;Emulator;'));
  return { platform: 'linux', home: data, env: { XDG_DATA_HOME: data, XDG_DATA_DIRS: data, PATH: bin }, run: async () => '', options };
}

describe.skipIf(process.platform === 'win32')('osIntegration on Linux', () => {
  it('classifies every app, sorted by name, with reasons', async () => {
    const result = await classifyInstalledApps(await linuxCtx());
    expect(result.map((c) => [c.app.name, c.verdict])).toEqual([
      ['Alpha Game', 'game'],
      ['Beta Game', 'game'],
      ['Retro Thing', 'no'],
      ['Some Tool', 'no'],
    ]);
  });

  it('adds only confident games, tagged as Installed Apps', async () => {
    const games = await osIntegration.scan(await linuxCtx());
    expect(games.map((g) => [g.title, g.store, g.id, g.installed])).toEqual([
      ['Alpha Game', 'Installed Apps', 'a', true],
      ['Beta Game', 'Installed Apps', 'b', true],
    ]);
  });

  it('honors allow and deny lists from the config', async () => {
    const games = await osIntegration.scan(await linuxCtx({ allow: ['Some Tool'], deny: ['Alpha Game'] }));
    expect(games.map((g) => g.title)).toEqual(['Beta Game', 'Some Tool']);
  });
});

describe('osIntegration on other platforms and options', () => {
  it('only claims Linux and Windows', () => {
    expect([...osIntegration.platforms].sort()).toEqual(['linux', 'win32']);
    expect(osIntegration.label).toBe('Installed Apps');
  });

  it('finds nothing on macOS (not supported)', async () => {
    const ctx: ScanContext = { platform: 'darwin', home: '/h', env: {}, run: async () => '' };
    expect(await classifyInstalledApps(ctx)).toEqual([]);
    expect(await osIntegration.scan(ctx)).toEqual([]);
  });

  it('includes weak guesses only when asked', async () => {
    const dir = await makeTempDir();
    await mkdir(path.join(dir, 'Unity G'));
    await writeFile(path.join(dir, 'Unity G', 'UnityPlayer.dll'), '');
    await writeFile(path.join(dir, 'Unity G', 'G.exe'), '');
    await mkdir(path.join(dir, 'Unity G', 'G_Data'));
    const run: ScanContext['run'] = async (_c, args) =>
      args[1] === 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        ? `\r\nHKEY_CURRENT_USER\\x\\G\r\n    DisplayName    REG_SZ    Unity G\r\n    InstallLocation    REG_SZ    ${path.join(dir, 'Unity G')}\r\n`
        : '';
    const base: ScanContext = { platform: 'win32', home: 'C:\\h', env: {}, run };
    expect(await osIntegration.scan(base)).toEqual([]);
    expect((await osIntegration.scan({ ...base, options: { includeMaybe: true } })).map((g) => g.title)).toEqual(['Unity G']);
  });
});
