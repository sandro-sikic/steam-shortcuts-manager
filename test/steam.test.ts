import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSteamRoot, listAccountIds, listAccounts, resolveUser, steamRootCandidates } from '../src/steam/locate.js';
import { defaultRunner, isSteamRunning } from '../src/steam/running.js';
import { buildShortcut, MANAGED_TAG } from '../src/steam/shortcuts.js';
import { loadShortcuts, saveShortcuts, shortcutsPath } from '../src/steam/store.js';
import { cleanupTempDirs, loginUsersVdf, makeSteamRoot, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

describe('steamRootCandidates', () => {
  it('covers Linux (native and Flatpak)', () => {
    expect(steamRootCandidates({ platform: 'linux', home: '/h', env: {} })).toEqual([
      '/h/.steam/steam',
      '/h/.local/share/Steam',
      '/h/.var/app/com.valvesoftware.Steam/.local/share/Steam',
    ]);
  });

  it('covers macOS', () => {
    expect(steamRootCandidates({ platform: 'darwin', home: '/Users/h', env: {} })).toEqual([
      '/Users/h/Library/Application Support/Steam',
    ]);
  });

  it('covers Windows, skipping unset environment variables', () => {
    const env = { 'ProgramFiles(x86)': 'D:\\Programs', ProgramFiles: '' };
    expect(steamRootCandidates({ platform: 'win32', home: 'C:\\Users\\h', env })).toEqual([
      'D:\\Programs\\Steam',
      'C:\\Program Files (x86)\\Steam',
    ]);
  });
});

describe('findSteamRoot', () => {
  it('returns the first candidate with a userdata folder', async () => {
    const home = await makeTempDir();
    const steam = path.join(home, '.local', 'share', 'Steam');
    await mkdir(path.join(steam, 'userdata'), { recursive: true });
    await expect(findSteamRoot({ platform: 'linux', home, env: {} })).resolves.toBe(steam);
  });

  it('throws when nothing is found', async () => {
    const home = await makeTempDir();
    await expect(findSteamRoot({ platform: 'linux', home, env: {} })).rejects.toThrow('Steam installation not found');
  });
});

describe('resolveUser', () => {
  // SteamID64 76561198000000001 -> account ID 39734273 (76561198000000001 - 76561197960265728)
  const recentSteamId = '76561198000000001';
  const recentAccount = '39734273';

  it('lists numeric accounts only, excluding 0', async () => {
    const root = await makeSteamRoot(['5', '0', '1']);
    await mkdir(path.join(root, 'userdata', 'ac'));
    await expect(listAccountIds(root)).resolves.toEqual(['1', '5']);
  });

  it('honors an explicit user', async () => {
    const root = await makeSteamRoot(['1', '2']);
    const user = await resolveUser(root, '2');
    expect(user).toEqual({
      root,
      accountId: '2',
      configDir: path.join(root, 'userdata', '2', 'config'),
      gridDir: path.join(root, 'userdata', '2', 'config', 'grid'),
    });
  });

  it('rejects an unknown explicit user', async () => {
    await expect(resolveUser(await makeSteamRoot(['1']), '9')).rejects.toThrow('Steam user 9 not found. Available: 1');
    await expect(resolveUser(await makeSteamRoot([]), '9')).rejects.toThrow('Available: none');
  });

  it('picks the most recent user from loginusers.vdf', async () => {
    const root = await makeSteamRoot(['1', recentAccount], loginUsersVdf(recentSteamId));
    await expect(resolveUser(root)).resolves.toMatchObject({ accountId: recentAccount });
  });

  it('falls back to the only account when loginusers.vdf is missing, empty, or stale', async () => {
    await expect(resolveUser(await makeSteamRoot(['7']))).resolves.toMatchObject({ accountId: '7' });
    await expect(resolveUser(await makeSteamRoot(['7'], '"other" { }'))).resolves.toMatchObject({ accountId: '7' });
    const noneRecent = '"users" { "76561198000000001" { "MostRecent" "0" } "76561198000000002" "text" }';
    await expect(resolveUser(await makeSteamRoot(['7'], noneRecent))).resolves.toMatchObject({ accountId: '7' });
    await expect(resolveUser(await makeSteamRoot(['7'], loginUsersVdf(recentSteamId)))).resolves.toMatchObject({ accountId: '7' });
  });

  it('asks for --user when it cannot decide', async () => {
    await expect(resolveUser(await makeSteamRoot(['1', '2']))).rejects.toThrow('Use --user with one of: 1, 2');
    await expect(resolveUser(await makeSteamRoot([]))).rejects.toThrow('one of: none');
  });
});

describe('listAccounts', () => {
  const vdf = `"users"
{
	"76561198000000001" { "AccountName" "login_a" "PersonaName" "Persona A" "MostRecent" "1" }
	"76561198000000002" { "AccountName" "login_b" "MostRecent" "0" }
	"76561198000000003" { "AccountName" { } }
	"not-a-number" { "AccountName" "skipped" }
	"76561198000000004" "text"
}`;

  it('names each account (display name, else login name) and marks the most recent', async () => {
    const root = await makeSteamRoot(['39734273', '39734274', '39734275', '99'], vdf);
    expect(await listAccounts(root)).toEqual([
      { accountId: '39734273', name: 'Persona A', mostRecent: true },
      { accountId: '39734274', name: 'login_b', mostRecent: false },
      { accountId: '39734275', name: '', mostRecent: false },
      { accountId: '99', name: '', mostRecent: false },
    ]);
  });

  it('still lists the accounts without loginusers.vdf, or with an unusable one', async () => {
    expect(await listAccounts(await makeSteamRoot(['5']))).toEqual([{ accountId: '5', name: '', mostRecent: false }]);
    expect(await listAccounts(await makeSteamRoot(['5'], '"other" { }'))).toEqual([{ accountId: '5', name: '', mostRecent: false }]);
  });
});

describe('isSteamRunning', () => {
  it('uses tasklist on Windows', async () => {
    expect(await isSteamRunning('win32', async () => 'steam.exe   1234 Console')).toBe(true);
    expect(await isSteamRunning('win32', async () => 'INFO: No tasks are running')).toBe(false);
  });

  it('uses pgrep elsewhere', async () => {
    const calls: string[][] = [];
    const run = async (command: string, args: string[]): Promise<string> => {
      calls.push([command, ...args]);
      return '123\n';
    };
    expect(await isSteamRunning('linux', run)).toBe(true);
    expect(await isSteamRunning('darwin', async () => '')).toBe(false);
    await isSteamRunning('darwin', run);
    expect(calls).toEqual([['pgrep', '-x', 'steam'], ['pgrep', '-x', 'steam_osx']]);
  });

  it('defaultRunner returns stdout, or nothing for failing or missing commands', async () => {
    expect(await defaultRunner(process.execPath, ['-e', 'process.stdout.write("hi")'])).toBe('hi');
    expect(await defaultRunner(process.execPath, ['-e', 'process.exit(1)'])).toBe('');
    expect(await defaultRunner('/definitely/not/a/command', [])).toBe('');
  });
});

describe('shortcuts store', () => {
  const entry = buildShortcut({ title: 'G', exe: '/g', tags: ['Epic Games', MANAGED_TAG] });

  it('loads nothing when the file does not exist', async () => {
    expect(await loadShortcuts(await makeTempDir())).toEqual([]);
  });

  it('creates the config dir, saves without a first backup, then backs up on overwrite', async () => {
    const configDir = path.join(await makeTempDir(), 'new', 'config');
    expect(await saveShortcuts(configDir, [entry], new Date('2026-01-02T03:04:05.678Z'))).toBeUndefined();
    expect(await loadShortcuts(configDir)).toEqual([entry]);

    const before = await readFile(shortcutsPath(configDir));
    const backup = await saveShortcuts(configDir, [], new Date('2026-01-02T03:04:05.678Z'));
    expect(backup).toBe(`${shortcutsPath(configDir)}.2026-01-02T03-04-05-678Z.bak`);
    expect(await readFile(backup as string)).toEqual(before);
    expect(await loadShortcuts(configDir)).toEqual([]);
    expect((await readdir(configDir)).sort()).toEqual(['shortcuts.vdf', 'shortcuts.vdf.2026-01-02T03-04-05-678Z.bak']);
  });

  it('defaults the backup timestamp to now', async () => {
    const configDir = await makeTempDir();
    await saveShortcuts(configDir, [entry]);
    expect(await saveShortcuts(configDir, [entry])).toMatch(/shortcuts\.vdf\..+\.bak$/);
  });

  it('propagates unexpected read errors', async () => {
    const configDir = await makeTempDir();
    await mkdir(shortcutsPath(configDir));
    await expect(loadShortcuts(configDir)).rejects.toThrow();
  });

  it('writes valid files even for shortcuts we did not build', async () => {
    const configDir = await makeTempDir();
    await writeFile(shortcutsPath(configDir), Buffer.alloc(0));
    await saveShortcuts(configDir, [entry]);
    expect(await loadShortcuts(configDir)).toEqual([entry]);
  });
});
