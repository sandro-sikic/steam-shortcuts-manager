import path from 'node:path';
import { listDir, pathExists } from '../shared/fs.js';
import { queryRegistry, type RegistryKey } from '../shared/registry.js';
import type { ScanContext } from '../types.js';
import type { InstalledApp, Signal } from './types.js';

// Unverified: (1) Game Bar records the games it recognizes (or you marked as a game) under
// HKCU\System\GameConfigStore\Children\<guid> with a MatchedExeFullPath value; (2) Unity and Unreal
// installs are recognised by their files in the Uninstall entries' InstallLocation. Neither was
// checked against a real Windows machine.

const GAME_BAR_KEY = 'HKCU\\System\\GameConfigStore\\Children';
const UNINSTALL = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const GENERIC_FOLDERS = new Set(['bin', 'binaries', 'win64', 'win32', 'x64', 'x86', 'game', 'release', 'shipping', 'content']);
const HELPER_EXE = /unins|setup|install|crash|report|redist|updater|launcher|cleanup/i;

function launchFor(exe: string): InstalledApp['launch'] {
  return { kind: 'exe', exe, startDir: path.dirname(exe) };
}

/** Game name from an exe path: the first folder above it that is not a generic build folder. */
export function titleFromExe(exe: string): string {
  const parts = exe.split(/[\\/]/).filter(Boolean);
  const file = parts.pop() as string;
  const folder = parts.reverse().find((name) => !GENERIC_FOLDERS.has(name.toLowerCase()));
  return (folder ?? file.replace(/\.[^.]*$/, '')).replace(/_+/g, ' ');
}

/** Executables the user confirmed (or Windows recognized) as games in Game Bar. */
async function gameBarApps(ctx: ScanContext): Promise<InstalledApp[]> {
  const apps: InstalledApp[] = [];
  for (const key of await queryRegistry(ctx.run, GAME_BAR_KEY)) {
    const exe = key.values.get('MatchedExeFullPath');
    if (!exe || !(await pathExists(exe))) continue;
    const id = key.path.slice(key.path.lastIndexOf('\\') + 1);
    apps.push({ id, name: titleFromExe(exe), launch: launchFor(exe), signals: ['game-bar'] });
  }
  return apps;
}

/** The game executable of an engine install, or undefined if it cannot be determined with confidence. */
async function engineExe(dir: string, names: string[]): Promise<{ exe: string; signal: Signal } | undefined> {
  const lower = new Set(names.map((name) => name.toLowerCase()));
  const exes = names.filter((name) => name.toLowerCase().endsWith('.exe') && !HELPER_EXE.test(name));
  if (lower.has('unityplayer.dll')) {
    const unity = exes.filter((name) => lower.has(`${name.slice(0, -4).toLowerCase()}_data`));
    return unity.length === 1 ? { exe: path.join(dir, unity[0] as string), signal: 'unity' } : undefined;
  }
  if (lower.has('engine') && exes.length === 1) return { exe: path.join(dir, exes[0] as string), signal: 'unreal' };
  return undefined;
}

function installLocation(key: RegistryKey): string | undefined {
  const value = key.values.get('InstallLocation')?.replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
  return value === undefined || value === '' || key.values.get('SystemComponent') === '0x1' ? undefined : value;
}

/** Installed programs whose folder looks like a Unity or Unreal game (a weak signal). */
async function engineApps(ctx: ScanContext): Promise<InstalledApp[]> {
  const queries = [
    queryRegistry(ctx.run, `HKLM\\${UNINSTALL}`, { view: 64 }),
    queryRegistry(ctx.run, `HKLM\\${UNINSTALL}`, { view: 32 }),
    queryRegistry(ctx.run, `HKCU\\${UNINSTALL}`),
  ];
  const apps: InstalledApp[] = [];
  for (const key of (await Promise.all(queries)).flat()) {
    const dir = installLocation(key);
    const name = key.values.get('DisplayName');
    if (dir === undefined || !name) continue;
    const names = await listDir(dir);
    const found = await engineExe(dir, names);
    if (found !== undefined) {
      apps.push({ id: key.path.slice(key.path.lastIndexOf('\\') + 1), name, launch: launchFor(found.exe), signals: [found.signal] });
    }
  }
  return apps;
}

/** Windows apps that are probably games; the same executable found twice is reported once (Game Bar wins). */
export async function scanWindowsApps(ctx: ScanContext): Promise<InstalledApp[]> {
  const seen = new Set<string>();
  const apps: InstalledApp[] = [];
  for (const app of [...(await gameBarApps(ctx)), ...(await engineApps(ctx))]) {
    const key = JSON.stringify(app.launch).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    apps.push(app);
  }
  return apps;
}
