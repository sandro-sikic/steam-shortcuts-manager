import path from 'node:path';
import type { Game } from '../types.js';
import type { Integration } from './types.js';
import { listDir, readJsonIfExists } from './shared/fs.js';
import { queryRegistry, type RegistryKey } from './shared/registry.js';

// Unverified: layout is from memory of GOG Galaxy's installer registration, not checked on a real machine.
// Installed games are assumed at HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<gameId> (values gameID, gameName, path,
// exe, launchCommand, launchParam, workingDir); goggame-*.info (JSON with playTasks) in the install folder is
// used as fallback/enrichment. The plain 64-bit view is tried when the 32-bit view is empty.
const GAMES_KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';

interface PlayTask {
  path?: string;
  arguments?: string;
  workingDir?: string;
  isPrimary?: boolean;
}

interface GameInfo {
  name?: string;
  playTasks?: PlayTask[];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().replace(/^"(.*)"$/, '$1') : undefined;
}

/** Reads the install folder's goggame-*.info, preferring the one named after the game id. */
async function readInfo(dir: string, id: string): Promise<GameInfo> {
  const files = (await listDir(dir)).filter((name) => /^goggame-.*\.info$/i.test(name));
  const file = files.find((name) => name.toLowerCase() === `goggame-${id}.info`) ?? files[0];
  const data = file === undefined ? undefined : await readJsonIfExists(path.join(dir, file));
  return typeof data === 'object' && data !== null ? (data as GameInfo) : {};
}

async function toGame(label: string, key: RegistryKey): Promise<Game | undefined> {
  const value = (name: string): string | undefined => text(key.values.get(name));
  const dir = value('path');
  if (dir === undefined) return undefined;

  const id = value('gameID') ?? key.path.slice(key.path.lastIndexOf('\\') + 1);
  const info = await readInfo(dir, id);
  const tasks = Array.isArray(info.playTasks) ? info.playTasks.filter((task) => text(task?.path) !== undefined) : [];
  const task = tasks.find((candidate) => candidate.isPrimary === true) ?? tasks[0];

  const registryExe = value('launchCommand') ?? value('exe');
  const exe = registryExe ?? text(task?.path);
  if (exe === undefined) return undefined;

  const resolve = (file: string): string => (path.isAbsolute(file) ? file : path.join(dir, file));
  const workingDir = registryExe === undefined ? text(task?.workingDir) : value('workingDir');
  const args = registryExe === undefined ? text(task?.arguments) : value('launchParam');
  return {
    store: label,
    id,
    title: value('gameName') ?? text(info.name) ?? id,
    installed: true,
    launch: {
      kind: 'exe',
      exe: resolve(exe),
      startDir: workingDir === undefined ? dir : resolve(workingDir),
      ...(args === undefined ? {} : { args }),
    },
  };
}

export const gogIntegration: Integration = {
  id: 'gog',
  label: 'GOG Galaxy',
  platforms: ['win32'],
  async scan(ctx) {
    if (ctx.platform !== 'win32') return [];
    let keys = await queryRegistry(ctx.run, GAMES_KEY, { view: 32 });
    if (keys.length === 0) keys = await queryRegistry(ctx.run, GAMES_KEY);

    const games = new Map<string, Game>();
    for (const key of keys) {
      const game = await toGame(this.label, key);
      if (game && !games.has(game.id)) games.set(game.id, game);
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
