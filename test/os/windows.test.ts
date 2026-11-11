import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanWindowsApps, titleFromExe } from '../../src/integrations/os/windows.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

type Values = Record<string, string>;
const block = (key: string, values: Values) =>
  `\r\n${key}\r\n${Object.entries(values).map(([k, v]) => `    ${k}    REG_SZ    ${v}`).join('\r\n')}\r\n`;

/** A fake `reg` answering by key path (and view flag). */
function fakeReg(answers: Record<string, string>): ScanContext['run'] {
  return async (_command, args) => {
    const key = args[1] as string;
    const view = args.find((a) => a.startsWith('/reg:'));
    return answers[view ? `${key}|${view}` : key] ?? '';
  };
}
const ctxWith = (run: ScanContext['run']): ScanContext => ({ platform: 'win32', home: 'C:\\Users\\h', env: {}, run });

const GAME_BAR = 'HKCU\\System\\GameConfigStore\\Children';
/** `reg query HKCU\...` prints the full hive name. */
const GAME_BAR_OUT = 'HKEY_CURRENT_USER\\System\\GameConfigStore\\Children';
const UNINSTALL = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

async function touch(dir: string, ...files: string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const file of files) {
    if (file.endsWith('/')) await mkdir(path.join(dir, file));
    else await writeFile(path.join(dir, file), '');
  }
}

describe('titleFromExe', () => {
  it('uses the first folder above the exe that is not a generic build folder', () => {
    expect(titleFromExe('/Games/Hades/Hades.exe')).toBe('Hades');
    expect(titleFromExe('/Games/Some_Game/Binaries/Win64/Game-Win64-Shipping.exe')).toBe('Some Game');
    expect(titleFromExe('/bin/Win64/tool.exe')).toBe('tool');
    expect(titleFromExe('C:\\Games\\Hades\\x64\\Hades.exe')).toBe('Hades');
  });
});

describe('scanWindowsApps', () => {
  it('finds games Game Bar knows about when their exe exists', async () => {
    const dir = await makeTempDir();
    const exe = path.join(dir, 'Hades', 'Hades.exe');
    await touch(path.dirname(exe), 'Hades.exe');
    const run = fakeReg({
      [GAME_BAR]:
        block(`${GAME_BAR_OUT}\\{guid-1}`, { MatchedExeFullPath: exe, TitleId: '0' }) +
        block(`${GAME_BAR_OUT}\\{guid-2}`, { MatchedExeFullPath: path.join(dir, 'Gone', 'gone.exe') }) +
        block(`${GAME_BAR_OUT}\\{guid-3}`, { Flags: '1' }),
    });
    expect(await scanWindowsApps(ctxWith(run))).toEqual([
      { id: '{guid-1}', name: 'Hades', launch: { kind: 'exe', exe, startDir: path.dirname(exe) }, signals: ['game-bar'] },
    ]);
  });

  it('recognises Unity and Unreal installs from the uninstall entries, only when the exe is unambiguous', async () => {
    const root = await makeTempDir();
    const unity = path.join(root, 'Unity Game');
    await touch(unity, 'UnityPlayer.dll', 'Cool.exe', 'UnityCrashHandler64.exe', 'Cool_Data/');
    const unityTwo = path.join(root, 'Unity Two');
    await touch(unityTwo, 'UnityPlayer.dll', 'A.exe', 'B.exe', 'A_Data/', 'B_Data/');
    const unreal = path.join(root, 'Unreal Game');
    await touch(unreal, 'Engine/', 'Game.exe', 'unins000.exe');
    const unrealTwo = path.join(root, 'Unreal Two');
    await touch(unrealTwo, 'Engine/', 'A.exe', 'B.exe');
    const plain = path.join(root, 'Plain App');
    await touch(plain, 'app.exe');

    const entry = (name: string, dir: string, extra: Values = {}) => block(`HKEY_LOCAL_MACHINE\\${UNINSTALL}\\${name}`, { DisplayName: name, InstallLocation: `"${dir}${path.sep}"`, ...extra });
    const run = fakeReg({
      [`HKLM\\${UNINSTALL}|/reg:64`]: entry('Unity Game', unity) + entry('Unity Two', unityTwo) + entry('Unreal Game', unreal),
      [`HKLM\\${UNINSTALL}|/reg:32`]:
        entry('Unreal Two', unrealTwo) +
        entry('Plain App', plain) +
        entry('System Thing', unity, { SystemComponent: '0x1' }) +
        entry('No Location', '').replace(/InstallLocation.*\r\n/, '') +
        entry('Empty Location', '') +
        block('HKEY_LOCAL_MACHINE\\x\\NoName', { InstallLocation: unity }) +
        entry('Missing Dir', path.join(root, 'missing')),
      [`HKCU\\${UNINSTALL}`]: entry('Unity Game', unity),
    });
    const apps = await scanWindowsApps(ctxWith(run));
    expect(apps.map((a) => [a.id, a.name, a.signals])).toEqual([
      ['Unity Game', 'Unity Game', ['unity']],
      ['Unreal Game', 'Unreal Game', ['unreal']],
    ]);
    expect(apps[0]?.launch).toEqual({ kind: 'exe', exe: path.join(unity, 'Cool.exe'), startDir: unity });
  });

  it('reports an executable only once, preferring Game Bar over a fingerprint', async () => {
    const root = await makeTempDir();
    const dir = path.join(root, 'Cool Game');
    await touch(dir, 'UnityPlayer.dll', 'Cool.exe', 'Cool_Data/');
    const exe = path.join(dir, 'Cool.exe');
    const run = fakeReg({
      [GAME_BAR]: block(`${GAME_BAR_OUT}\\{g}`, { MatchedExeFullPath: exe }),
      [`HKCU\\${UNINSTALL}`]: block(`HKEY_CURRENT_USER\\${UNINSTALL}\\Cool`, { DisplayName: 'Cool Game', InstallLocation: dir }),
    });
    const apps = await scanWindowsApps(ctxWith(run));
    expect(apps).toHaveLength(1);
    expect(apps[0]?.signals).toEqual(['game-bar']);
  });

  it('returns nothing when the registry has nothing', async () => {
    expect(await scanWindowsApps(ctxWith(fakeReg({})))).toEqual([]);
  });
});
