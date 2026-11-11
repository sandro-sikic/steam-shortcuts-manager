import type { Game } from '../types.js';
import type { VdfMap, VdfValue } from '../vdf/types.js';
import {
  buildShortcut,
  entriesEqual,
  isManaged,
  MANAGED_TAG,
  setField,
  shortcutAppId,
  shortcutTags,
  shortcutTitle,
} from './shortcuts.js';

export interface SyncItem {
  appId: number;
  title: string;
  store: string;
}

export interface SyncOptions {
  /** Remove managed shortcuts whose game is no longer provided (e.g. uninstalled). */
  prune: boolean;
}

export interface SyncResult {
  entries: VdfMap[];
  added: SyncItem[];
  updated: SyncItem[];
  unchanged: SyncItem[];
  removed: SyncItem[];
  /** Games that clash with a shortcut we do not manage, or duplicate another game. */
  skipped: SyncItem[];
}

/** Fields we own on a managed shortcut; everything else (play time, icon, ...) is preserved. */
const OWNED_FIELDS = ['AppName', 'Exe', 'StartDir', 'LaunchOptions', 'tags'];

function describe(appId: number, title: string, store: string): SyncItem {
  return { appId, title, store };
}

/**
 * Pure planner: given the current shortcuts and the installed games, computes the new list
 * of shortcuts. Only shortcuts carrying MANAGED_TAG are ever modified or removed.
 */
export function planSync(existing: VdfMap[], games: Game[], options: SyncOptions): SyncResult {
  const result: SyncResult = { entries: [], added: [], updated: [], unchanged: [], removed: [], skipped: [] };
  const byId = new Map(existing.map((entry) => [shortcutAppId(entry), entry]));
  const handled = new Set<number>();
  const replacements = new Map<number, VdfMap>();
  const additions: VdfMap[] = [];

  for (const game of games.filter((g) => g.installed)) {
    const built = buildShortcut({
      title: game.title,
      exe: game.exe,
      startDir: game.startDir,
      launchOptions: game.launchOptions,
      tags: [game.store, MANAGED_TAG],
    });
    const appId = shortcutAppId(built);
    const item = describe(appId, game.title, game.store);
    const current = byId.get(appId);

    if (handled.has(appId) || (current !== undefined && !isManaged(current))) {
      result.skipped.push(item);
      continue;
    }
    handled.add(appId);

    if (current === undefined) {
      additions.push(built);
      result.added.push(item);
      continue;
    }
    const merged = new Map(current);
    for (const field of OWNED_FIELDS) setField(merged, field, built.get(field) as VdfValue);
    if (entriesEqual(current, merged)) {
      result.unchanged.push(item);
    } else {
      replacements.set(appId, merged);
      result.updated.push(item);
    }
  }

  for (const entry of existing) {
    const appId = shortcutAppId(entry);
    if (options.prune && isManaged(entry) && !handled.has(appId)) {
      result.removed.push(describe(appId, shortcutTitle(entry), shortcutTags(entry).find((tag) => tag !== MANAGED_TAG) ?? ''));
      continue;
    }
    result.entries.push(replacements.get(appId) ?? entry);
  }
  result.entries.push(...additions);
  return result;
}
