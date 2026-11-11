// Unverified: Battle.net keeps its install database in a protobuf file (product.db) that is not parsed here.
// Instead this relies on the Windows uninstall entries Blizzard games create under
// HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall (Publisher "Blizzard Entertainment",
// with InstallLocation and DisplayName). Not every title is guaranteed to register one, and the exact
// DisplayName values, `battlenet://` product codes and process names below are from memory.
import path from 'node:path';
import type { Game, LaunchSpec } from '../types.js';
import { listDir, pathExists } from './shared/fs.js';
import { queryRegistry } from './shared/registry.js';
import type { Integration } from './types.js';

const UNINSTALL_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const UNINSTALL_KEY_PLAIN = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const PUBLISHER = 'Blizzard Entertainment';
const NOT_A_GAME = /uninstall|unins\d|crash|helper|launcher|agent|setup|update|repair|reporter/i;

interface KnownTitle {
  /** Product code in `battlenet://<code>`. */
  code: string;
  /** Game process image name, used to wait for the game. */
  exe: string;
}

/** Keyed by lowercased DisplayName. */
const KNOWN_TITLES: Readonly<Record<string, KnownTitle>> = {
  'world of warcraft': { code: 'WoW', exe: 'Wow.exe' },
  'diablo iii': { code: 'D3', exe: 'Diablo III64.exe' },
  'diablo iv': { code: 'Fen', exe: 'Diablo IV.exe' },
  overwatch: { code: 'Pro', exe: 'Overwatch.exe' },
  'overwatch 2': { code: 'Pro', exe: 'Overwatch.exe' },
  'starcraft ii': { code: 'S2', exe: 'SC2_x64.exe' },
  hearthstone: { code: 'WTCG', exe: 'Hearthstone.exe' },
  'heroes of the storm': { code: 'Hero', exe: 'HeroesOfTheStorm_x64.exe' },
};

/** The single plausible game executable directly inside `dir`, if there is exactly one. */
async function findGameExe(dir: string): Promise<string | undefined> {
  const candidates = (await listDir(dir)).filter((name) => /\.exe$/i.test(name) && !NOT_A_GAME.test(name));
  return candidates.length === 1 ? path.join(dir, candidates[0] as string) : undefined;
}

export const battlenetIntegration: Integration = {
  id: 'battlenet',
  label: 'Battle.net',
  platforms: ['win32'],

  async scan(ctx) {
    let keys = await queryRegistry(ctx.run, UNINSTALL_KEY, { view: 32 });
    if (keys.length === 0) keys = await queryRegistry(ctx.run, UNINSTALL_KEY_PLAIN);

    const games = new Map<string, Game>();
    for (const key of keys) {
      const id = key.path.split('\\').pop() as string;
      const title = key.values.get('DisplayName');
      const dir = key.values.get('InstallLocation');
      if (key.values.get('Publisher') !== PUBLISHER || !title || !dir) continue;
      if (title === 'Battle.net' || games.has(id) || !(await pathExists(dir))) continue;

      const known = KNOWN_TITLES[title.toLowerCase()];
      let launch: LaunchSpec;
      if (known) {
        launch = { kind: 'uri', uri: `battlenet://${known.code}`, waitFor: known.exe };
      } else {
        const exe = await findGameExe(dir);
        if (!exe) continue;
        launch = { kind: 'exe', exe, startDir: dir };
      }
      games.set(id, { store: 'Battle.net', id, title, installed: true, launch });
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
