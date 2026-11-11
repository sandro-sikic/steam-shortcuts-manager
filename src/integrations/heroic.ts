// Unverified: file names inside Heroic's config root vary between Heroic versions and were written from
// memory (never checked against a real install), so every known alternative is tried and absent or
// unparsable files are skipped. Unsure about: the GOG/Nile installed.json shapes (array vs object vs
// {installed: [...]}), the field names inside them, and the `heroic://launch/<runner>/<appName>` URI form
// (newer Heroic versions may use `heroic://launch?appName=..&runner=..`).
import path from 'node:path';
import type { Game } from '../types.js';
import type { Integration, ScanContext } from './types.js';
import { readJsonIfExists } from './shared/fs.js';

type Rec = Record<string, unknown>;

interface Runner {
  /** Runner name used in the launch URI. */
  runner: string;
  /** Steam tag for games of this store. */
  store: string;
  /** Candidate installed-game lists, relative to the Heroic config root. */
  installed: string[][];
  /** Candidate library caches (used only for titles). */
  libraries: string[][];
}

const RUNNERS: Runner[] = [
  {
    runner: 'legendary',
    store: 'Heroic (Epic Games)',
    installed: [['legendaryConfig', 'legendary', 'installed.json']],
    libraries: [['store_cache', 'legendary_library.json']],
  },
  {
    runner: 'gog',
    store: 'Heroic (GOG)',
    installed: [
      ['gog_store', 'installed.json'],
      ['gogdlConfig', 'heroic_gogdl', 'installed.json'],
    ],
    libraries: [['store_cache', 'gog_library.json']],
  },
  {
    runner: 'nile',
    store: 'Heroic (Amazon Games)',
    installed: [['nile_config', 'nile', 'installed.json']],
    libraries: [['store_cache', 'nile_library.json']],
  },
];

const LIST_KEYS = ['installed', 'library', 'games'];

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Last path segment, for either separator style. */
function lastSegment(file: string): string {
  return file.replace(/[\\/]+$/, '').split(/[\\/]/).pop() as string;
}

/** Normalizes an array, a keyed object, or an object wrapping a list into [key, record] pairs. */
function entries(data: unknown): [string | undefined, Rec][] {
  if (Array.isArray(data)) return data.filter(isRec).map((rec) => [undefined, rec]);
  if (!isRec(data)) return [];
  const wrapped = LIST_KEYS.map((key) => data[key]).find(Array.isArray);
  if (wrapped) return entries(wrapped);
  return Object.entries(data).flatMap(([key, rec]): [string, Rec][] => (isRec(rec) ? [[key, rec]] : []));
}

function entryId(key: string | undefined, rec: Rec): string | undefined {
  return str(rec['appName']) ?? str(rec['app_name']) ?? str(rec['id']) ?? key;
}

function configRoots(ctx: ScanContext): string[] {
  switch (ctx.platform) {
    case 'linux':
      return [
        path.join(ctx.env['XDG_CONFIG_HOME'] || path.join(ctx.home, '.config'), 'heroic'),
        path.join(ctx.home, '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic'),
      ];
    case 'win32':
      return [path.join(ctx.env['APPDATA'] || path.join(ctx.home, 'AppData', 'Roaming'), 'heroic')];
    case 'darwin':
      return [path.join(ctx.home, 'Library', 'Application Support', 'heroic')];
    default:
      return [];
  }
}

async function readEntries(root: string, files: string[][]): Promise<[string | undefined, Rec][]> {
  const lists = await Promise.all(files.map(async (file) => entries(await readJsonIfExists(path.join(root, ...file)))));
  return lists.flat();
}

async function scanRunner(root: string, def: Runner): Promise<Game[]> {
  const installed = await readEntries(root, def.installed);
  if (installed.length === 0) return [];
  const titles = new Map<string, string>();
  for (const [key, rec] of await readEntries(root, def.libraries)) {
    const id = entryId(key, rec);
    const title = str(rec['title']);
    if (id !== undefined && title !== undefined) titles.set(id, title);
  }

  const games: Game[] = [];
  for (const [key, rec] of installed) {
    const id = entryId(key, rec);
    if (id === undefined || rec['is_dlc'] === true) continue;
    const installPath = str(rec['install_path']) ?? str(rec['path']);
    const title = str(rec['title']) ?? titles.get(id) ?? (installPath === undefined ? id : lastSegment(installPath));
    const executable = str(rec['executable']);
    const waitFor = executable === undefined ? undefined : lastSegment(executable);
    games.push({
      store: def.store,
      id: `${def.runner}:${id}`,
      title,
      installed: true,
      launch: {
        kind: 'uri',
        uri: `heroic://launch/${def.runner}/${encodeURIComponent(id)}`,
        ...(waitFor !== undefined && /^[\w .()-]+$/.test(waitFor) ? { waitFor } : {}),
      },
    });
  }
  return games;
}

/** Epic, GOG and Amazon games installed through the Heroic Games Launcher; Heroic itself launches them. */
export const heroicIntegration: Integration = {
  id: 'heroic',
  label: 'Heroic Games Launcher',
  platforms: ['linux', 'win32', 'darwin'],
  async scan(ctx) {
    const byId = new Map<string, Game>();
    for (const root of configRoots(ctx)) {
      for (const def of RUNNERS) {
        for (const game of await scanRunner(root, def)) if (!byId.has(game.id)) byId.set(game.id, game);
      }
    }
    return [...byId.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
