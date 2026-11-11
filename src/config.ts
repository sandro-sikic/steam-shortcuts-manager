import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTWORK_KINDS, type ArtworkKind } from './artwork/kinds.js';
import { readTextIfExists } from './integrations/shared/fs.js';

/** `<config home>/steam-manager`: where wrapper scripts and the config file live. */
export function configDir(platform: NodeJS.Platform, home: string, env: NodeJS.ProcessEnv): string {
  if (platform === 'win32') {
    return path.win32.join(env['APPDATA'] || path.win32.join(home, 'AppData', 'Roaming'), 'steam-manager');
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', 'steam-manager');
  }
  return path.posix.join(env['XDG_CONFIG_HOME'] || path.posix.join(home, '.config'), 'steam-manager');
}

/** The images the user picked for a game: a SteamGridDB image id per type, or `null` for "none". Keyed by the game's cache key. */
export type ArtworkChoices = Record<string, Partial<Record<ArtworkKind, number | null>>>;

/** User choices, stored in `config.json`. */
export interface Config {
  /** Installed apps (by title or id) that are always games. */
  allow: string[];
  /** Installed apps (by title or id) that are never games. */
  deny: string[];
  /** Keys of games (`store:id`) the user switched off: they are not added to Steam, and ours are removed. */
  exclude: string[];
  /** The artwork the user picked per game and image type; without a pick the first result is used. */
  artworkChoices: ArtworkChoices;
}

function stringList(value: unknown, name: string, file: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid config file ${file}: "${name}" must be a list of strings`);
  }
  return value as string[];
}

function readArtworkChoices(value: unknown, file: string): ArtworkChoices {
  if (value === undefined) return {};
  const invalid = () => new Error(`Invalid config file ${file}: "artworkChoices" must map each game to image ids per type`);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid();
  const choices: ArtworkChoices = {};
  for (const [game, picks] of Object.entries(value)) {
    if (typeof picks !== 'object' || picks === null || Array.isArray(picks)) throw invalid();
    const entry: ArtworkChoices[string] = {};
    for (const [kind, id] of Object.entries(picks)) {
      const validId = id === null || (typeof id === 'number' && Number.isInteger(id) && id >= 0);
      if (!ARTWORK_KINDS.includes(kind as ArtworkKind) || !validId) throw invalid();
      entry[kind as ArtworkKind] = id as number | null;
    }
    choices[game] = entry;
  }
  return choices;
}

export function configFile(dir: string): string {
  return path.join(dir, 'config.json');
}

/** Parses the raw config; a missing file is an empty object, an unreadable one an error. */
export async function readRaw(dir: string): Promise<Record<string, unknown>> {
  const file = configFile(dir);
  const text = await readTextIfExists(file);
  if (text === undefined) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid config file ${file}: ${(error as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Invalid config file ${file}: expected a JSON object`);
  }
  return data as Record<string, unknown>;
}

/** Writes the whole `config.json`, creating the folder. */
export async function writeRaw(dir: string, record: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(configFile(dir), `${JSON.stringify(record, null, 2)}\n`);
}

/** Loads `config.json` from the config dir; a missing file means no overrides. */
export async function loadConfig(dir: string): Promise<Config> {
  const record = await readRaw(dir);
  const file = configFile(dir);
  return {
    allow: stringList(record['allow'], 'allow', file),
    deny: stringList(record['deny'], 'deny', file),
    exclude: stringList(record['exclude'], 'exclude', file),
    artworkChoices: readArtworkChoices(record['artworkChoices'], file),
  };
}

/** Saves some of the user's choices, keeping everything else in the file. Refuses to overwrite an invalid file. */
export async function updateConfig(dir: string, patch: Partial<Config>): Promise<Config> {
  const raw = await readRaw(dir);
  const next = { ...(await loadConfig(dir)), ...patch };
  await writeRaw(dir, { ...raw, ...next });
  return next;
}
