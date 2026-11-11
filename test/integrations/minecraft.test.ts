import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { minecraftIntegration } from '../../src/integrations/minecraft.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

async function touch(...parts: string[]): Promise<string> {
  const file = path.join(...parts);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '');
  return file;
}

async function ctxFor(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): Promise<{ ctx: ScanContext; dir: string }> {
  const dir = await makeTempDir();
  return { dir, ctx: { platform, home: path.join(dir, 'home'), env, run: async () => '' } };
}

const game = (launch: unknown) => [
  { store: 'Minecraft Launcher', id: 'minecraft-launcher', title: 'Minecraft Launcher', installed: true, launch },
];

describe('minecraft integration (Windows)', () => {
  it('returns nothing when no launcher is installed', async () => {
    const { ctx, dir } = await ctxFor('win32');
    ctx.env = { 'ProgramFiles(x86)': path.join(dir, 'a'), ProgramFiles: path.join(dir, 'b'), LOCALAPPDATA: path.join(dir, 'c') };
    expect(await minecraftIntegration.scan(ctx)).toEqual([]);
  });

  it('falls back to default roots when the environment is empty', async () => {
    const { ctx } = await ctxFor('win32');
    expect(await minecraftIntegration.scan(ctx)).toEqual([]);
  });

  it('finds the classic launcher in Program Files (x86)', async () => {
    const { ctx, dir } = await ctxFor('win32');
    const exe = await touch(dir, 'pf86', 'Minecraft Launcher', 'MinecraftLauncher.exe');
    ctx.env = { 'ProgramFiles(x86)': path.join(dir, 'pf86'), ProgramFiles: path.join(dir, 'pf') };
    expect(await minecraftIntegration.scan(ctx)).toEqual(game({ kind: 'exe', exe, startDir: path.dirname(exe) }));
  });

  it('finds the classic launcher in Program Files and prefers it over the Store variant', async () => {
    const { ctx, dir } = await ctxFor('win32');
    const exe = await touch(dir, 'pf', 'Minecraft Launcher', 'MinecraftLauncher.exe');
    await mkdir(path.join(dir, 'local', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe'), { recursive: true });
    ctx.env = { 'ProgramFiles(x86)': path.join(dir, 'pf86'), ProgramFiles: path.join(dir, 'pf'), LOCALAPPDATA: path.join(dir, 'local') };
    expect(await minecraftIntegration.scan(ctx)).toEqual(game({ kind: 'exe', exe, startDir: path.dirname(exe) }));
  });

  it('launches the Store variant through explorer.exe', async () => {
    const { ctx, dir } = await ctxFor('win32');
    await mkdir(path.join(dir, 'local', 'Packages', 'Microsoft.4297127D64EC6_8wekyb3d8bbwe'), { recursive: true });
    ctx.env = { LOCALAPPDATA: path.join(dir, 'local'), SystemRoot: path.join(dir, 'win'), ProgramFiles: path.join(dir, 'pf'), 'ProgramFiles(x86)': path.join(dir, 'pf86') };
    expect(await minecraftIntegration.scan(ctx)).toEqual(
      game({
        kind: 'exe',
        exe: path.join(dir, 'win', 'explorer.exe'),
        args: 'shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft',
      }),
    );
  });

  it('ignores unrelated packages and defaults LOCALAPPDATA/SystemRoot sensibly', async () => {
    const { ctx, dir } = await ctxFor('win32');
    ctx.env = { ProgramFiles: path.join(dir, 'none'), 'ProgramFiles(x86)': path.join(dir, 'none86') };
    await mkdir(path.join(dir, 'home', 'AppData', 'Local', 'Packages', 'Other.App_123'), { recursive: true });
    expect(await minecraftIntegration.scan(ctx)).toEqual([]);

    await mkdir(path.join(dir, 'home', 'AppData', 'Local', 'Packages', 'Microsoft.4297127D64EC6_abc'), { recursive: true });
    const result = await minecraftIntegration.scan(ctx);
    expect(result[0]?.launch).toMatchObject({ kind: 'exe', exe: path.join('C:\\Windows', 'explorer.exe') });
  });
});

describe('minecraft integration (Linux)', () => {
  it('returns nothing when no launcher is installed', async () => {
    const { ctx, dir } = await ctxFor('linux', {});
    ctx.env = { STEAM_MANAGER_FS_ROOT: path.join(dir, 'root') };
    expect(await minecraftIntegration.scan(ctx)).toEqual([]);
  });

  it('finds the native launcher in /opt first', async () => {
    const { ctx, dir } = await ctxFor('linux');
    const root = path.join(dir, 'root');
    ctx.env = { STEAM_MANAGER_FS_ROOT: root };
    await touch(root, 'usr', 'bin', 'minecraft-launcher');
    const exe = await touch(root, 'opt', 'minecraft-launcher', 'minecraft-launcher');
    expect(await minecraftIntegration.scan(ctx)).toEqual(game({ kind: 'exe', exe, startDir: path.dirname(exe) }));
  });

  it('finds the launcher in /usr/bin and in ~/.local/bin', async () => {
    const { ctx, dir } = await ctxFor('linux');
    const root = path.join(dir, 'root');
    ctx.env = { STEAM_MANAGER_FS_ROOT: root };
    const local = await touch(ctx.home, '.local', 'bin', 'minecraft-launcher');
    expect((await minecraftIntegration.scan(ctx))[0]?.launch).toMatchObject({ exe: local });
    const sys = await touch(root, 'usr', 'bin', 'minecraft-launcher');
    expect((await minecraftIntegration.scan(ctx))[0]?.launch).toMatchObject({ exe: sys });
  });

  it('launches a system Flatpak export wrapper directly', async () => {
    const { ctx, dir } = await ctxFor('linux');
    const root = path.join(dir, 'root');
    ctx.env = { STEAM_MANAGER_FS_ROOT: root };
    const wrapper = await touch(root, 'var', 'lib', 'flatpak', 'exports', 'bin', 'com.mojang.Minecraft');
    expect(await minecraftIntegration.scan(ctx)).toEqual(game({ kind: 'exe', exe: wrapper }));
  });

  it('launches a user Flatpak export wrapper directly', async () => {
    const { ctx } = await ctxFor('linux');
    const wrapper = await touch(ctx.home, '.local', 'share', 'flatpak', 'exports', 'bin', 'com.mojang.Minecraft');
    expect(await minecraftIntegration.scan(ctx)).toEqual(game({ kind: 'exe', exe: wrapper }));
  });

  it.skipIf(process.platform === 'win32')('falls back to `flatpak run` when only the Flatpak data directory exists', async () => {
    const { ctx, dir } = await ctxFor('linux');
    await mkdir(path.join(ctx.home, '.var', 'app', 'com.mojang.Minecraft'), { recursive: true });
    expect(await minecraftIntegration.scan(ctx)).toEqual(game({ kind: 'exe', exe: '/usr/bin/flatpak', args: 'run com.mojang.Minecraft' }));
    ctx.env = { STEAM_MANAGER_FS_ROOT: path.join(dir, 'root') };
    expect((await minecraftIntegration.scan(ctx))[0]?.launch).toMatchObject({ exe: path.join(dir, 'root', 'usr', 'bin', 'flatpak') });
  });
});
