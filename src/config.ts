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

/** User overrides for the installed-apps scan, matched against an app's title or id. */
export interface Config {
  /** Always treat these as games. */
  allow: string[];
  /** Never treat these as games. */
  deny: string[];
}

function stringList(value: unknown, name: string, file: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Invalid config file ${file}: "${name}" must be a list of strings`);
  }
  return value as string[];
}

/** Loads `config.json` from the config dir; a missing file means no overrides. */
export async function loadConfig(dir: string): Promise<Config> {
  const file = path.join(dir, 'config.json');
  const text = await readTextIfExists(file);
  if (text === undefined) return { allow: [], deny: [] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid config file ${file}: ${(error as Error).message}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error(`Invalid config file ${file}: expected a JSON object`);
  }
  const record = data as Record<string, unknown>;
  return { allow: stringList(record['allow'], 'allow', file), deny: stringList(record['deny'], 'deny', file) };
}
