/** The settings model: types, defaults and validation. Pure (no file access), so the UI can use it too. */
import { ARTWORK_KINDS, type ArtworkKind } from './artwork/kinds.js';

export type SyncMode = 'preview' | 'apply';
export type Theme = 'system' | 'light' | 'dark';
export type CardSize = 'small' | 'medium' | 'large';

/** The user's preferences, stored under `settings` in `config.json`. */
export interface Settings {
  steam: {
    /** Steam installation folder; empty means auto-detect. */
    dir: string;
    /** Steam account ID; empty means the most recent user. */
    user: string;
    /** Write even while Steam is running (Steam may then overwrite the changes). */
    allowRunning: boolean;
  };
  artwork: {
    /** Which images to copy into Steam's grid folder on sync. */
    kinds: ArtworkKind[];
    /** Download artwork for every game in the library in the background, into the app's own cache. */
    auto: boolean;
  };
  /** Defaults for the sync panel. */
  sync: {
    mode: SyncMode;
    prune: boolean;
    includeMaybe: boolean;
    artwork: boolean;
    /** Apply to Steam as soon as a game is ticked or unticked. */
    autoApply: boolean;
  };
  launchers: {
    /** Ids of launchers that are not scanned. */
    disabled: string[];
  };
  ui: {
    theme: Theme;
    cardSize: CardSize;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  steam: { dir: '', user: '', allowRunning: false },
  artwork: { kinds: [...ARTWORK_KINDS], auto: true },
  sync: { mode: 'preview', prune: false, includeMaybe: false, artwork: true, autoApply: false },
  launchers: { disabled: [] },
  ui: { theme: 'system', cardSize: 'medium' },
};

/** A partial update: any section, any field. */
export type SettingsPatch = { [S in keyof Settings]?: Partial<Settings[S]> };

type Field = (value: unknown, name: string) => unknown;

const text: Field = (value, name) => {
  if (typeof value !== 'string') throw new Error(`${name} must be text`);
  return value.trim();
};
const flag: Field = (value, name) => {
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`);
  return value;
};
const choice =
  (options: readonly string[]): Field =>
  (value, name) => {
    if (typeof value !== 'string' || !options.includes(value)) throw new Error(`${name} must be one of: ${options.join(', ')}`);
    return value;
  };
const list =
  (allowed?: readonly string[]): Field =>
  (value, name) => {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || (allowed && !allowed.includes(item)))) {
      throw new Error(allowed ? `${name} must be a list of: ${allowed.join(', ')}` : `${name} must be a list of text`);
    }
    return [...new Set(value as string[])];
  };

/** How each field is validated, mirroring `Settings`. */
const FIELDS: { [S in keyof Settings]: { [K in keyof Settings[S]]: Field } } = {
  steam: {
    dir: text,
    user: (value, name) => {
      const user = text(value, name) as string;
      if (!/^\d*$/.test(user)) throw new Error(`${name} must be a number`);
      return user;
    },
    allowRunning: flag,
  },
  artwork: { kinds: list(ARTWORK_KINDS), auto: flag },
  sync: { mode: choice(['preview', 'apply']), prune: flag, includeMaybe: flag, artwork: flag, autoApply: flag },
  launchers: { disabled: list() },
  ui: { theme: choice(['system', 'light', 'dark']), cardSize: choice(['small', 'medium', 'large']) },
};

/** Applies a (possibly partial) update to settings, validating every field it touches. */
export function applySettings(base: Settings, patch: unknown): Settings {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) throw new Error('settings must be an object');
  const result = structuredClone(base) as unknown as Record<string, Record<string, unknown>>;
  for (const [section, values] of Object.entries(patch)) {
    const fields = (FIELDS as unknown as Record<string, Record<string, Field>>)[section];
    if (!fields) throw new Error(`unknown settings section "${section}"`);
    if (typeof values !== 'object' || values === null || Array.isArray(values)) throw new Error(`${section} must be an object`);
    for (const [key, value] of Object.entries(values)) {
      const validate = fields[key];
      if (!validate) throw new Error(`unknown setting "${section}.${key}"`);
      (result[section] as Record<string, unknown>)[key] = validate(value, `${section}.${key}`);
    }
  }
  return result as unknown as Settings;
}

