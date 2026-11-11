import { normalizeTitle } from '../dedupe.js';
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

/** A game resolved to what its Steam shortcut should run. */
export interface SyncGame {
  /** Display name of the store; used as the tag/collection. */
  store: string;
  title: string;
  installed: boolean;
  exe: string;
  startDir?: string;
  launchOptions?: string;
}

export interface SyncItem {
  appId: number;
  title: string;
  store: string;
}

export interface SyncOptions {
  /** Remove managed shortcuts whose game is no longer provided (e.g. uninstalled). */
  prune: boolean;
  /** App IDs of games the user switched off: our shortcuts for them are removed even without `prune`. */
  remove?: ReadonlySet<number>;
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
 * of shortcuts. Only shortcuts carrying MANAGED_TAG are ever modified or removed. A game whose
 * title matches one of our shortcuts with a different launch target replaces it (no duplicates).
 */
export function planSync(existing: VdfMap[], games: SyncGame[], options: SyncOptions): SyncResult {
  const result: SyncResult = { entries: [], added: [], updated: [], unchanged: [], removed: [], skipped: [] };
  const byId = new Map(existing.map((entry) => [shortcutAppId(entry), entry]));
  const desired = games
    .filter((game) => game.installed)
    .map((game) => {
      const built = buildShortcut({
        title: game.title,
        exe: game.exe,
        startDir: game.startDir,
        launchOptions: game.launchOptions,
        tags: [game.store, MANAGED_TAG],
      });
      return { game, built, appId: shortcutAppId(built) };
    });
  const desiredIds = new Set(desired.map((d) => d.appId));
  const ownByTitle = new Map(existing.filter(isManaged).map((entry) => [normalizeTitle(shortcutTitle(entry)), entry]));
  const handled = new Set<number>();
  const replaced = new Set<number>();
  const replacements = new Map<number, VdfMap>();
  const additions: VdfMap[] = [];

  for (const { game, built, appId } of desired) {
    const item = describe(appId, game.title, game.store);
    const current = byId.get(appId);

    if (handled.has(appId) || (current !== undefined && !isManaged(current))) {
      result.skipped.push(item);
      continue;
    }
    handled.add(appId);

    if (current === undefined) {
      const stale = ownByTitle.get(normalizeTitle(game.title));
      const staleId = stale === undefined ? undefined : shortcutAppId(stale);
      if (stale !== undefined && staleId !== undefined && !desiredIds.has(staleId) && !replaced.has(staleId)) {
        replaced.add(staleId);
        result.removed.push(describe(staleId, shortcutTitle(stale), storeOf(stale)));
      }
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
    if (replaced.has(appId)) continue;
    if (isManaged(entry) && !handled.has(appId) && (options.prune || options.remove?.has(appId))) {
      result.removed.push(describe(appId, shortcutTitle(entry), storeOf(entry)));
      continue;
    }
    result.entries.push(replacements.get(appId) ?? entry);
  }
  result.entries.push(...additions);
  return result;
}

function storeOf(entry: VdfMap): string {
  return shortcutTags(entry).find((tag) => tag !== MANAGED_TAG) ?? '';
}
