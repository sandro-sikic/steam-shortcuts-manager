import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseTextVdf } from '../vdf/text.js';

export interface LocateOptions {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
}

export interface SteamUser {
  /** The Steam installation directory. */
  root: string;
  /** The 32-bit account ID, which is the name of the `userdata` sub-directory. */
  accountId: string;
  configDir: string;
  gridDir: string;
}

/** SteamID64 of account ID 0; subtracting it from a SteamID64 gives the account ID. */
const STEAM_ID_BASE = 76561197960265728n;

export function steamRootCandidates({ platform, home, env }: LocateOptions): string[] {
  if (platform === 'win32') {
    const roots = [env['ProgramFiles(x86)'], env['ProgramFiles'], 'C:\\Program Files (x86)'];
    return roots.filter((root): root is string => Boolean(root)).map((root) => path.win32.join(root, 'Steam'));
  }
  if (platform === 'darwin') {
    return [path.posix.join(home, 'Library', 'Application Support', 'Steam')];
  }
  return [
    path.posix.join(home, '.steam', 'steam'),
    path.posix.join(home, '.local', 'share', 'Steam'),
    path.posix.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ];
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Returns the first candidate that looks like a Steam installation (has a `userdata` folder). */
export async function findSteamRoot(options: LocateOptions): Promise<string> {
  const candidates = steamRootCandidates(options);
  for (const candidate of candidates) {
    if (await isDirectory(path.join(candidate, 'userdata'))) return candidate;
  }
  throw new Error(`Steam installation not found. Looked in: ${candidates.join(', ')}. Use --steam-dir.`);
}

interface LoginUser {
  accountId: string;
  /** Display name (persona), else the login name. */
  name: string;
  mostRecent: boolean;
}

/** The accounts Steam remembers, from `config/loginusers.vdf`; none if the file is missing or unusable. */
async function readLoginUsers(root: string): Promise<LoginUser[]> {
  let text: string;
  try {
    text = await readFile(path.join(root, 'config', 'loginusers.vdf'), 'utf8');
  } catch {
    return [];
  }
  const users = parseTextVdf(text).get('users');
  if (!(users instanceof Map)) return [];
  const found: LoginUser[] = [];
  for (const [steamId, info] of users) {
    if (!/^\d+$/.test(steamId) || !(info instanceof Map)) continue;
    const name = info.get('PersonaName') ?? info.get('AccountName');
    found.push({ accountId: String(BigInt(steamId) - STEAM_ID_BASE), name: typeof name === 'string' ? name : '', mostRecent: info.get('MostRecent') === '1' });
  }
  return found;
}

async function mostRecentAccountId(root: string): Promise<string | undefined> {
  return (await readLoginUsers(root)).find((user) => user.mostRecent)?.accountId;
}

export interface SteamAccount {
  accountId: string;
  /** Display name, or '' when Steam does not remember one. */
  name: string;
  mostRecent: boolean;
}

/** The Steam accounts that have data on this computer, with their names. */
export async function listAccounts(root: string): Promise<SteamAccount[]> {
  const users = await readLoginUsers(root);
  return (await listAccountIds(root)).map((accountId) => {
    const user = users.find((candidate) => candidate.accountId === accountId);
    return { accountId, name: user?.name ?? '', mostRecent: user?.mostRecent === true };
  });
}

export async function listAccountIds(root: string): Promise<string[]> {
  const names = await readdir(path.join(root, 'userdata'));
  return names.filter((name) => /^\d+$/.test(name) && name !== '0').sort();
}

/** Picks the Steam user to operate on: the requested one, else the most recently logged in. */
export async function resolveUser(root: string, requested?: string): Promise<SteamUser> {
  const accountIds = await listAccountIds(root);
  let accountId: string | undefined;
  if (requested !== undefined) {
    if (!accountIds.includes(requested)) {
      throw new Error(`Steam user ${requested} not found. Available: ${accountIds.join(', ') || 'none'}`);
    }
    accountId = requested;
  } else {
    const recent = await mostRecentAccountId(root);
    accountId = recent !== undefined && accountIds.includes(recent) ? recent : undefined;
    if (accountId === undefined && accountIds.length === 1) accountId = accountIds[0];
    if (accountId === undefined) {
      throw new Error(`Could not determine the Steam user. Use --user with one of: ${accountIds.join(', ') || 'none'}`);
    }
  }
  const configDir = path.join(root, 'userdata', accountId, 'config');
  return { root, accountId, configDir, gridDir: path.join(configDir, 'grid') };
}
