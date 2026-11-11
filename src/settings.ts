import { readRaw, writeRaw } from './config.js';
import { applySettings, DEFAULT_SETTINGS } from './settingsModel.js';
import type { Settings } from './settingsModel.js';

export * from './settingsModel.js';

/** Reads `settings` from `config.json`; missing values take their defaults, bad values are an error. */
export async function loadSettings(dir: string): Promise<Settings> {
  const raw = (await readRaw(dir))['settings'];
  if (raw === undefined) return structuredClone(DEFAULT_SETTINGS);
  try {
    return applySettings(DEFAULT_SETTINGS, raw);
  } catch (error) {
    throw new Error(`Invalid settings in config file: ${(error as Error).message}`);
  }
}

/** Saves a settings update, keeping everything else in `config.json`. Refuses to overwrite invalid settings. */
export async function updateSettings(dir: string, patch: unknown): Promise<Settings> {
  const next = applySettings(await loadSettings(dir), patch);
  await writeRaw(dir, { ...(await readRaw(dir)), settings: next });
  return next;
}

/** Puts every setting back to its default (the game lists in `config.json` are kept). */
export async function resetSettings(dir: string): Promise<Settings> {
  await writeRaw(dir, { ...(await readRaw(dir)), settings: structuredClone(DEFAULT_SETTINGS) });
  return structuredClone(DEFAULT_SETTINGS);
}
