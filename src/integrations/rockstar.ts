import path from 'node:path';
import type { Game } from '../types.js';
import { listDir, pathExists } from './shared/fs.js';
import { queryRegistry } from './shared/registry.js';
import type { Integration } from './types.js';

// Unverified: the registry layout (HKLM\SOFTWARE\WOW6432Node\Rockstar Games\<Title>\InstallFolder) and the
// main-exe mapping are from memory. Both the 32-bit view and the plain key are queried; titles missing from
// the mapping are launched via their only top-level .exe that does not look like a helper.

const LABEL = 'Rockstar Games Launcher';
const ROOTS = [
  { key: 'HKLM\\SOFTWARE\\Rockstar Games', view: 32 as const },
  { key: 'HKLM\\SOFTWARE\\WOW6432Node\\Rockstar Games', view: undefined },
];
const NOT_GAMES = new Set(['launcher', 'rockstar games social club', 'social club', 'rockstar games launcher']);
const KNOWN_EXES: Record<string, string> = {
  'Grand Theft Auto V': 'PlayGTAV.exe',
  'Red Dead Redemption 2': 'RDR2.exe',
  'Max Payne 3': 'MaxPayne3.exe',
  'L.A. Noire': 'LANoire.exe',
  'Grand Theft Auto IV': 'GTAIV.exe',
};
const HELPER_EXE = /unins|uninst|launcher|crash|setup|redist|helper|report/i;

async function findExe(title: string, folder: string): Promise<string | undefined> {
  const known = KNOWN_EXES[title];
  if (known && (await pathExists(path.join(folder, known)))) return path.join(folder, known);
  const candidates = (await listDir(folder)).filter((name) => /\.exe$/i.test(name) && !HELPER_EXE.test(name));
  return candidates.length === 1 ? path.join(folder, candidates[0] as string) : undefined;
}

export const rockstarIntegration: Integration = {
  id: 'rockstar',
  label: LABEL,
  platforms: ['win32'],
  async scan(ctx) {
    const games = new Map<string, Game>();
    for (const root of ROOTS) {
      for (const key of await queryRegistry(ctx.run, root.key, root.view ? { view: root.view } : {})) {
        const title = /\\Rockstar Games\\([^\\]+)$/i.exec(key.path)?.[1];
        const folder = key.values.get('InstallFolder');
        if (!title || !folder || NOT_GAMES.has(title.toLowerCase()) || games.has(title)) continue;
        if (!(await pathExists(folder))) continue;
        const exe = await findExe(title, folder);
        if (!exe) continue;
        games.set(title, {
          store: LABEL,
          id: title,
          title,
          installed: true,
          launch: { kind: 'exe', exe, startDir: folder },
        });
      }
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
