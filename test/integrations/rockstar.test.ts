import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rockstarIntegration } from '../../src/integrations/rockstar.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const BASE = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Rockstar Games';

function regKey(name: string, values: Record<string, string>): string {
  const lines = Object.entries(values).map(([k, v]) => `    ${k}    REG_SZ    ${v}`);
  return [`${BASE}\\${name}`, ...lines, ''].join('\r\n');
}

function ctx(outputs: { view32?: string; plain?: string }): ScanContext {
  return {
    platform: 'win32',
    home: '/unused',
    env: {},
    run: async (_command, args) => (args.includes('/reg:32') ? (outputs.view32 ?? '') : (outputs.plain ?? '')),
  };
}

async function installDir(name: string, files: string[]): Promise<string> {
  const dir = path.join(await makeTempDir(), name);
  await mkdir(dir, { recursive: true });
  for (const file of files) await writeFile(path.join(dir, file), '');
  return dir;
}

describe('rockstarIntegration', () => {
  it('describes itself', () => {
    expect(rockstarIntegration.id).toBe('rockstar');
    expect(rockstarIntegration.label).toBe('Rockstar Games Launcher');
    expect(rockstarIntegration.platforms).toEqual(['win32']);
  });

  it('returns nothing when the launcher is not installed', async () => {
    expect(await rockstarIntegration.scan(ctx({}))).toEqual([]);
  });

  it('lists games with their known main executables, sorted by title', async () => {
    const rdr2 = await installDir('rdr2', ['RDR2.exe', 'Launcher.exe']);
    const gta = await installDir('gta', ['PlayGTAV.exe']);
    const output = [
      regKey('Red Dead Redemption 2', { InstallFolder: rdr2, Language: 'en' }),
      regKey('Grand Theft Auto V', { InstallFolder: gta }),
    ].join('\r\n');
    const games = await rockstarIntegration.scan(ctx({ view32: output }));
    expect(games.map((g) => g.title)).toEqual(['Grand Theft Auto V', 'Red Dead Redemption 2']);
    expect(games[1]).toEqual({
      store: 'Rockstar Games Launcher',
      id: 'Red Dead Redemption 2',
      title: 'Red Dead Redemption 2',
      installed: true,
      launch: { kind: 'exe', exe: path.join(rdr2, 'RDR2.exe'), startDir: rdr2 },
    });
    expect(games[0]?.launch).toMatchObject({ exe: path.join(gta, 'PlayGTAV.exe') });
  });

  it('uses the known exe for a known title', async () => {
    const dir = await installDir('gta', ['PlayGTAV.exe', 'GTA5.exe']);
    const games = await rockstarIntegration.scan(ctx({ view32: regKey('Grand Theft Auto V', { InstallFolder: dir }) }));
    expect(games[0]?.launch).toEqual({ kind: 'exe', exe: path.join(dir, 'PlayGTAV.exe'), startDir: dir });
  });

  it('falls back to the plain key and de-duplicates titles found in both views', async () => {
    const dir = await installDir('mp3', ['MaxPayne3.exe']);
    const output = regKey('Max Payne 3', { InstallFolder: dir });
    const games = await rockstarIntegration.scan(ctx({ view32: output, plain: output }));
    expect(games.map((g) => g.id)).toEqual(['Max Payne 3']);
    expect(await rockstarIntegration.scan(ctx({ plain: output }))).toHaveLength(1);
  });

  it('picks the only non-helper exe for unknown titles', async () => {
    const dir = await installDir('bully', ['Bully.exe', 'unins000.exe', 'CrashReporter.exe', 'readme.txt']);
    const games = await rockstarIntegration.scan(ctx({ view32: regKey('Bully', { InstallFolder: dir }) }));
    expect(games[0]?.launch).toEqual({ kind: 'exe', exe: path.join(dir, 'Bully.exe'), startDir: dir });
  });

  it('falls back to the heuristic when a known exe is missing', async () => {
    const dir = await installDir('lan', ['Game.exe']);
    const games = await rockstarIntegration.scan(ctx({ view32: regKey('L.A. Noire', { InstallFolder: dir }) }));
    expect(games[0]?.launch).toMatchObject({ exe: path.join(dir, 'Game.exe') });
  });

  it('skips ambiguous, exe-less, missing, launcher and incomplete entries', async () => {
    const ambiguous = await installDir('amb', ['A.exe', 'B.exe']);
    const none = await installDir('none', ['readme.txt']);
    const ok = await installDir('ok', ['GTAIV.exe']);
    const output = [
      regKey('Ambiguous', { InstallFolder: ambiguous }),
      regKey('NoExe', { InstallFolder: none }),
      regKey('Gone', { InstallFolder: path.join(ok, 'missing') }),
      regKey('Launcher', { InstallFolder: ok }),
      regKey('Social Club', { InstallFolder: ok }),
      regKey('NoFolder', { Language: 'en' }),
      regKey('Steam Copy', { InstallFolderSteam: ok }),
      `${BASE}\\Grand Theft Auto IV\\Sub\r\n    InstallFolder    REG_SZ    ${ok}\r\n`,
      `${BASE}`,
      regKey('Grand Theft Auto IV', { InstallFolder: ok }),
    ].join('\r\n');
    const games = await rockstarIntegration.scan(ctx({ view32: output }));
    expect(games.map((g) => g.id)).toEqual(['Grand Theft Auto IV']);
  });
});
