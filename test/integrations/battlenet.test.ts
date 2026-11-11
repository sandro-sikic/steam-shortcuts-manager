import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { battlenetIntegration } from '../../src/integrations/battlenet.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const BASE = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const PLAIN = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

function entry(base: string, name: string, values: Record<string, string>): string {
  const lines = Object.entries(values).map(([k, v]) => `    ${k}    REG_SZ    ${v}`);
  return [`${base}\\${name}`, ...lines, ''].join('\r\n');
}

function ctxWith(outputs: Record<string, string>): ScanContext & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    platform: 'win32',
    home: '/unused',
    env: {},
    calls,
    run: async (command, args) => {
      calls.push([command, ...args]);
      return outputs[args[1] as string] ?? '';
    },
  };
}

async function installDir(files: string[]): Promise<string> {
  const dir = await makeTempDir();
  for (const f of files) await writeFile(path.join(dir, f), '');
  return dir;
}

const blizzard = (title: string, dir: string, extra: Record<string, string> = {}) => ({
  DisplayName: title,
  Publisher: 'Blizzard Entertainment',
  InstallLocation: dir,
  ...extra,
});

describe('battlenet integration', () => {
  it('has the expected metadata', () => {
    expect(battlenetIntegration).toMatchObject({ id: 'battlenet', label: 'Battle.net', platforms: ['win32'] });
  });

  it('returns nothing when no uninstall entries exist', async () => {
    const ctx = ctxWith({});
    expect(await battlenetIntegration.scan(ctx)).toEqual([]);
    expect(ctx.calls).toEqual([
      ['reg', 'query', BASE, '/s', '/reg:32'],
      ['reg', 'query', PLAIN, '/s'],
    ]);
  });

  it('launches known titles through the Battle.net URI and sorts by title', async () => {
    const wow = await installDir([]);
    const d4 = await installDir([]);
    const ctx = ctxWith({
      [BASE]: [
        entry(BASE, 'World of Warcraft', blizzard('World of Warcraft', wow)),
        entry(BASE, 'Diablo IV', blizzard('Diablo IV', d4)),
      ].join('\r\n'),
    });
    expect(await battlenetIntegration.scan(ctx)).toEqual([
      { store: 'Battle.net', id: 'Diablo IV', title: 'Diablo IV', installed: true, launch: { kind: 'uri', uri: 'battlenet://Fen', waitFor: 'Diablo IV.exe' } },
      { store: 'Battle.net', id: 'World of Warcraft', title: 'World of Warcraft', installed: true, launch: { kind: 'uri', uri: 'battlenet://WoW', waitFor: 'Wow.exe' } },
    ]);
    expect(ctx.calls).toHaveLength(1);
  });

  it('falls back to the plain registry key and launches unknown titles by their single exe', async () => {
    const dir = await installDir(['Game.exe', 'Game.dll', 'UnityCrashHandler64.exe', 'unins000.exe']);
    const ctx = ctxWith({ [PLAIN]: entry(PLAIN, 'Some Blizzard Game', blizzard('Some Blizzard Game', dir)) });
    expect(await battlenetIntegration.scan(ctx)).toEqual([
      { store: 'Battle.net', id: 'Some Blizzard Game', title: 'Some Blizzard Game', installed: true, launch: { kind: 'exe', exe: path.join(dir, 'Game.exe'), startDir: dir } },
    ]);
  });

  it('skips unknown titles with no or several candidate executables', async () => {
    const none = await installDir(['readme.txt', 'Updater.exe']);
    const many = await installDir(['A.exe', 'B.exe']);
    const ctx = ctxWith({
      [BASE]: [entry(BASE, 'None', blizzard('None', none)), entry(BASE, 'Many', blizzard('Many', many))].join('\r\n'),
    });
    expect(await battlenetIntegration.scan(ctx)).toEqual([]);
  });

  it('skips the Battle.net app, other publishers, incomplete entries and missing install dirs', async () => {
    const dir = await installDir([]);
    const missing = path.join(dir, 'gone');
    const ctx = ctxWith({
      [BASE]: [
        entry(BASE, 'Battle.net', blizzard('Battle.net', dir)),
        entry(BASE, 'Other', { ...blizzard('Hearthstone', dir), Publisher: 'Someone Else' }),
        entry(BASE, 'NoPublisher', { DisplayName: 'Hearthstone', InstallLocation: dir }),
        entry(BASE, 'NoTitle', { Publisher: 'Blizzard Entertainment', InstallLocation: dir }),
        entry(BASE, 'NoDir', { DisplayName: 'Hearthstone', Publisher: 'Blizzard Entertainment' }),
        entry(BASE, 'Gone', blizzard('Hearthstone', missing)),
        entry(BASE, 'Hearthstone', blizzard('Hearthstone', dir)),
      ].join('\r\n'),
    });
    const games = await battlenetIntegration.scan(ctx);
    expect(games.map((g) => g.id)).toEqual(['Hearthstone']);
    expect(games[0]?.launch).toEqual({ kind: 'uri', uri: 'battlenet://WTCG', waitFor: 'Hearthstone.exe' });
  });

  it('de-duplicates by key name and matches titles case-insensitively', async () => {
    const dir = await installDir([]);
    await mkdir(path.join(dir, 'sub'));
    const ctx = ctxWith({
      [BASE]: [
        entry(BASE, 'Overwatch', blizzard('OVERWATCH', dir)),
        entry(BASE, 'Overwatch', blizzard('Overwatch 2', dir)),
      ].join('\r\n'),
    });
    const games = await battlenetIntegration.scan(ctx);
    expect(games).toHaveLength(1);
    expect(games[0]?.launch).toEqual({ kind: 'uri', uri: 'battlenet://Pro', waitFor: 'Overwatch.exe' });
  });
});
