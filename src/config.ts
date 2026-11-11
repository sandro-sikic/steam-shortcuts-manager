import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

/** User choices, stored in `config.json`. */
export interface Config {
  /** Installed apps (by title or id) that are always games. */
  allow: string[];
  /** Installed apps (by title or id) that are never games. */
  deny: string[];
  /** Keys of games (`store:id`) the user switched off: they are not added to Steam, and ours are removed. */
  exclude: string[];
}

function stringList(value: unknown, name: string, file: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid config file ${file}: "${name}" must be a list of strings`);
  }
  return value as string[];
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
  };
}

/** Saves some of the user's choices, keeping everything else in the file. Refuses to overwrite an invalid file. */
export async function updateConfig(dir: string, patch: Partial<Config>): Promise<Config> {
  const raw = await readRaw(dir);
  const next = { ...(await loadConfig(dir)), ...patch };
  await writeRaw(dir, { ...raw, ...next });
  return next;
}
