import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eaIntegration } from '../../src/integrations/ea.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const WOW = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\EA Games';

function regOutput(entries: Record<string, Record<string, string>>, base = WOW): string {
  return Object.entries(entries)
    .map(([name, values]) => `${base}\\${name}\r\n${Object.entries(values).map(([k, v]) => `    ${k}    REG_SZ    ${v}`).join('\r\n')}\r\n`)
    .join('\r\n');
}

/** Fake `reg`: answers each queried key with the given output. */
function fakeRun(outputs: Record<string, string>): ScanContext['run'] {
  return async (command, args) => (command === 'reg' ? (outputs[args[1] as string] ?? '') : '');
}

async function ctxFor(programFiles: string, outputs: Record<string, string> = {}): Promise<ScanContext> {
  return { platform: 'win32', home: programFiles, env: { ProgramFiles: programFiles }, run: fakeRun(outputs) };
}

async function makeGame(dir: string, files: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), content);
  }
}

const installerData = (title: string, filePath: string, extra = '') => `<?xml version="1.0"?>
<DiPManifest><gameTitles>${extra}<gameTitle locale="en_US">${title}</gameTitle></gameTitles>
<runtime><launcher><filePath>${filePath}</filePath></launcher></runtime></DiPManifest>`;

describe('eaIntegration', () => {
  it('describes itself', () => {
    expect([eaIntegration.id, eaIntegration.label, eaIntegration.platforms]).toEqual(['ea', 'EA app', ['win32']]);
  });

  it('returns nothing when EA is not installed', async () => {
    expect(await eaIntegration.scan(await ctxFor(await makeTempDir()))).toEqual([]);
  });

  it('falls back to the default Program Files location when ProgramFiles is unset', async () => {
    const ctx: ScanContext = { platform: 'win32', home: '/nowhere', env: {}, run: fakeRun({}) };
    expect(await eaIntegration.scan(ctx)).toEqual([]);
  });

  it('finds registry games, enriching title and exe from installerdata.xml', async () => {
    const root = await makeTempDir();
    const fifa = path.join(root, 'FIFA');
    const zed = path.join(root, 'zed');
    await makeGame(fifa, {
      'game.exe': '', 'other.exe': '', 'Bin/fifa.exe': '',
      '__Installer/installerdata.xml': installerData('FIFA &amp; Friends&#8482;', '[HKEY_LOCAL_MACHINE\\SOFTWARE\\EA Games\\FIFA\\Install Dir]\\Bin\\fifa.exe', '<gameTitle locale="de_DE">Deutsch</gameTitle>'),
    });
    await makeGame(zed, { 'zed.exe': '' });
    const ctx = await ctxFor(root, {
      [WOW]: regOutput({ FIFA: { 'Install Dir': fifa + path.sep }, Zed: { 'Install Dir': zed, DisplayName: 'Zed Game' } }),
    });

    expect(await eaIntegration.scan(ctx)).toEqual([
      { store: 'EA app', id: 'FIFA', title: 'FIFA & Friends™', installed: true, launch: { kind: 'exe', exe: path.join(fifa, 'Bin', 'fifa.exe'), startDir: fifa } },
      { store: 'EA app', id: 'Zed', title: 'Zed Game', installed: true, launch: { kind: 'exe', exe: path.join(zed, 'zed.exe'), startDir: zed } },
    ]);
  });

  it('reads the other registry locations and the InstallDir spelling', async () => {
    const root = await makeTempDir();
    const a = path.join(root, 'a');
    const b = path.join(root, 'b');
    await makeGame(a, { 'a.exe': '' });
    await makeGame(b, { 'b.exe': '' });
    const ctx = await ctxFor(root, {
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\EA Games': regOutput({ A: { 'Install Dir': a } }, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\EA Games'),
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Origin Games': regOutput({ '123': { InstallDir: b, DisplayName: 'B Game' } }, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Origin Games'),
    });
    expect((await eaIntegration.scan(ctx)).map((g) => [g.id, g.title])).toEqual([['A', 'a'], ['123', 'B Game']]);
  });

  it('discovers games in the default EA Games folder and ignores stray files', async () => {
    const root = await makeTempDir();
    await makeGame(path.join(root, 'EA Games', 'Apex'), { 'Apex.exe': '', 'unins000.exe': '', 'CrashReporter.exe': '' });
    await writeFile(path.join(root, 'EA Games', 'readme.txt'), '');
    expect(await eaIntegration.scan(await ctxFor(root))).toEqual([
      { store: 'EA app', id: 'Apex', title: 'Apex', installed: true, launch: { kind: 'exe', exe: path.join(root, 'EA Games', 'Apex', 'Apex.exe'), startDir: path.join(root, 'EA Games', 'Apex') } },
    ]);
  });

  it('skips games without a determinable exe and entries without an install dir', async () => {
    const root = await makeTempDir();
    const none = path.join(root, 'none');
    const many = path.join(root, 'many');
    const outside = path.join(root, 'outside');
    await makeGame(none, { 'setup.exe': '' });
    await makeGame(many, { 'a.exe': '', 'b.exe': '' });
    await makeGame(outside, {
      '__Installer/installerdata.xml': installerData('X', '..\\other.exe'),
      'a.exe': '', 'b.exe': '',
    });
    const ctx = await ctxFor(root, {
      [WOW]: regOutput({ None: { 'Install Dir': none }, Many: { 'Install Dir': many }, Outside: { 'Install Dir': outside }, NoDir: { DisplayName: 'x' }, Gone: { 'Install Dir': path.join(root, 'gone') } }),
    });
    expect(await eaIntegration.scan(ctx)).toEqual([]);
  });

  it('tolerates malformed installerdata.xml and non-exe or missing launcher paths', async () => {
    const root = await makeTempDir();
    const dirs = ['bad', 'noexe', 'missing', 'notitle'].map((n) => path.join(root, n));
    await makeGame(dirs[0] as string, { 'g.exe': '', '__Installer/installerdata.xml': '<<not xml' });
    await makeGame(dirs[1] as string, { 'g.exe': '', 'readme.txt': '', '__Installer/installerdata.xml': installerData('NoExe', 'readme.txt') });
    await makeGame(dirs[2] as string, { 'g.exe': '', '__Installer/installerdata.xml': installerData('Missing', 'nope.exe') });
    await makeGame(dirs[3] as string, { 'g.exe': '', '__Installer/installerdata.xml': '<gameTitle locale="fr_FR"> </gameTitle>' });
    const ctx = await ctxFor(root, {
      [WOW]: regOutput({ Bad: { 'Install Dir': dirs[0] as string }, NoExe: { 'Install Dir': dirs[1] as string }, Missing: { 'Install Dir': dirs[2] as string }, NoTitle: { 'Install Dir': dirs[3] as string } }),
    });
    const games = await eaIntegration.scan(ctx);
    expect(games.map((g) => [g.id, g.title])).toEqual([['Bad', 'bad'], ['Missing', 'Missing'], ['NoExe', 'NoExe'], ['NoTitle', 'notitle']]);
    expect(games.every((g) => g.launch.kind === 'exe' && g.launch.exe.endsWith('g.exe'))).toBe(true);
  });

  it('uses the first title when none is en_US and a relative launcher path', async () => {
    const root = await makeTempDir();
    const dir = path.join(root, 'rel');
    await makeGame(dir, { 'run.exe': '', 'x.exe': '', '__Installer/installerdata.xml': installerData('Relative', 'run.exe').replace('en_US', 'fr_FR') });
    const ctx = await ctxFor(root, { [WOW]: regOutput({ Rel: { 'Install Dir': dir } }) });
    expect(await eaIntegration.scan(ctx)).toMatchObject([{ title: 'Relative', launch: { exe: path.join(dir, 'run.exe') } }]);
  });

  it('de-duplicates by id and by install directory', async () => {
    const root = await makeTempDir();
    const dir = path.join(root, 'EA Games', 'Dup');
    await makeGame(dir, { 'dup.exe': '' });
    const ctx = await ctxFor(root, {
      [WOW]: regOutput({ Dup: { 'Install Dir': dir, DisplayName: 'Dup Game' }, Dup2: { 'Install Dir': dir + path.sep } }),
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Origin Games': regOutput({ Dup: { 'Install Dir': dir } }, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Origin Games'),
    });
    const games = await eaIntegration.scan(ctx);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({ id: 'Dup', title: 'Dup Game' });
  });
});
