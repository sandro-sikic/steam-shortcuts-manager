import path from 'node:path';
import type { Game } from '../types.js';
import { listDir, pathExists } from './shared/fs.js';
import type { Integration, ScanContext } from './types.js';

// Unverified: Windows paths (classic MinecraftLauncher.exe under Program Files, Store package family
// Microsoft.4297127D64EC6_8wekyb3d8bbwe with app id "Minecraft") and the Linux install locations
// (/opt/minecraft-launcher, /usr/bin, ~/.local/bin, Flatpak com.mojang.Minecraft) are from memory.
// System paths on Linux are prefixed with STEAM_MANAGER_FS_ROOT (default '/') so tests can fake them.
// For Flatpak, an exports wrapper is launched directly (it runs `flatpak run` itself); otherwise
// `flatpak run com.mojang.Minecraft` is used.

const TITLE = 'Minecraft Launcher';
const ID = 'minecraft-launcher';
const STORE_PREFIX = 'Microsoft.4297127D64EC6_';
const STORE_APP = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft';
const FLATPAK_APP = 'com.mojang.Minecraft';

async function firstExisting(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) if (await pathExists(candidate)) return candidate;
  return undefined;
}

async function findWindows(ctx: ScanContext): Promise<Game['launch'] | undefined> {
  const roots = [
    ctx.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    ctx.env['ProgramFiles'] ?? 'C:\\Program Files',
  ];
  const exe = await firstExisting(roots.map((root) => path.join(root, 'Minecraft Launcher', 'MinecraftLauncher.exe')));
  if (exe) return { kind: 'exe', exe, startDir: path.dirname(exe) };

  const local = ctx.env['LOCALAPPDATA'] ?? path.join(ctx.home, 'AppData', 'Local');
  const packages = await listDir(path.join(local, 'Packages'));
  if (!packages.some((name) => name.startsWith(STORE_PREFIX))) return undefined;
  return {
    kind: 'exe',
    exe: path.join(ctx.env['SystemRoot'] ?? 'C:\\Windows', 'explorer.exe'),
    args: `shell:AppsFolder\\${STORE_APP}`,
  };
}

async function findLinux(ctx: ScanContext): Promise<Game['launch'] | undefined> {
  const root = ctx.env['STEAM_MANAGER_FS_ROOT'] ?? '/';
  const exe = await firstExisting([
    path.join(root, 'opt', 'minecraft-launcher', 'minecraft-launcher'),
    path.join(root, 'usr', 'bin', 'minecraft-launcher'),
    path.join(ctx.home, '.local', 'bin', 'minecraft-launcher'),
  ]);
  if (exe) return { kind: 'exe', exe, startDir: path.dirname(exe) };

  const wrapper = await firstExisting([
    path.join(root, 'var', 'lib', 'flatpak', 'exports', 'bin', FLATPAK_APP),
    path.join(ctx.home, '.local', 'share', 'flatpak', 'exports', 'bin', FLATPAK_APP),
  ]);
  if (wrapper) return { kind: 'exe', exe: wrapper };
  if (await pathExists(path.join(ctx.home, '.var', 'app', FLATPAK_APP))) {
    return { kind: 'exe', exe: path.join(root, 'usr', 'bin', 'flatpak'), args: `run ${FLATPAK_APP}` };
  }
  return undefined;
}

export const minecraftIntegration: Integration = {
  id: 'minecraft',
  label: 'Minecraft Launcher',
  platforms: ['win32', 'linux'],
  async scan(ctx) {
    const launch = ctx.platform === 'win32' ? await findWindows(ctx) : await findLinux(ctx);
    if (!launch) return [];
    return [{ store: this.label, id: ID, title: TITLE, installed: true, launch }];
  },
};
