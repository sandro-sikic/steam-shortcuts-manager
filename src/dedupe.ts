import path from 'node:path';
import type { Game } from './types.js';

/** Lowercased letters and digits only, so "Hades™", "HADES" and "Hades " compare equal. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/[™®©℠]/gu, '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** A stable identity for a game across runs; what the user's include/exclude choices are stored against. */
export function gameKey(game: Pick<Game, 'store' | 'id'>): string {
  return `${game.store}:${game.id}`;
}

/** Normalizes an executable path for comparison (quotes, slashes, case). */
export function normalizeExe(exe: string): string {
  return path.posix.normalize(exe.replace(/^"|"$/g, '').replace(/\\/g, '/')).toLowerCase();
}

/** Key of an executable plus its arguments: one exe can start several games (e.g. a client with --launch-product). */
export function exeKey(exe: string, args: string | undefined): string {
  return `exe:${normalizeExe(exe)}|${args ?? ''}`;
}

/** What a game is started with, normalized; two games with the same key are the same program. */
export function launchKey(game: Game): string {
  return game.launch.kind === 'exe' ? exeKey(game.launch.exe, game.launch.args) : `uri:${game.launch.uri.toLowerCase()}`;
}

/** Games that already exist somewhere (Steam library, existing shortcuts), with where they were found. */
export interface KnownGames {
  /** normalized title -> description of where it exists */
  titles: Map<string, string>;
  /** see `launchKey` -> description of where it exists */
  launchKeys: Map<string, string>;
}

export interface Duplicate {
  game: Game;
  /** Human-readable description of what it duplicates. */
  of: string;
}

/**
 * Drops games that duplicate a known game or an earlier game in the list (first one wins).
 * Order the input by priority: the most specific source first.
 */
export function dedupeGames(games: Game[], known: KnownGames): { unique: Game[]; duplicates: Duplicate[] } {
  const titles = new Map(known.titles);
  const keys = new Map(known.launchKeys);
  const unique: Game[] = [];
  const duplicates: Duplicate[] = [];

  for (const game of games) {
    const title = normalizeTitle(game.title);
    const key = launchKey(game);
    const of = keys.get(key) ?? (title === '' ? undefined : titles.get(title));
    if (of !== undefined) {
      duplicates.push({ game, of });
      continue;
    }
    const origin = `${game.title} [${game.store}]`;
    keys.set(key, origin);
    if (title !== '') titles.set(title, origin);
    unique.push(game);
  }
  return { unique, duplicates };
}
