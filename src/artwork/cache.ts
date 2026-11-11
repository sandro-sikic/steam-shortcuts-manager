import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listDir, readJsonIfExists } from '../integrations/shared/fs.js';
import { listArtwork, mimeOf, type ArtworkResponse } from './files.js';
import { type ArtworkOutcome, installArtwork } from './install.js';
import { ARTWORK_KINDS, ARTWORK_SUFFIXES, type ArtworkKind } from './kinds.js';
import { tagImage } from './tag.js';
import { titleKey, type FetchLike, type SteamGridDbClient } from './steamgriddb.js';

/** How long "SteamGridDB has no such image" is trusted before asking again. */
export const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ENTRY_DIR = /^[\p{L}\p{N}]{1,48}-[0-9a-f]{8}$/u;
const ENTRY_FILE = /^(poster|wide|hero|logo|icon)\.(png|jpe?g|webp|ico)$/i;

/** The folder inside the config folder where this app keeps its own copy of every game's artwork. */
export function artworkCacheDir(configDir: string): string {
  return path.join(configDir, 'artwork-cache');
}

/** The folder name for a game: its title reduced to letters and digits plus a short hash. Undefined for untitled games. */
export function cacheKey(title: string): string | undefined {
  const key = titleKey(title);
  return key === '' ? undefined : `${key.slice(0, 48)}-${createHash('sha1').update(key).digest('hex').slice(0, 8)}`;
}

export interface CachedFile {
  file: string;
  /** Modification time, so a re-downloaded image is not shown from the browser cache. */
  version: number;
}

export interface CacheEntry {
  key: string;
  dir: string;
  files: Map<ArtworkKind, CachedFile>;
  /** Kinds SteamGridDB did not have, with when we last asked. */
  missing: Partial<Record<ArtworkKind, number>>;
}

/** What the cache holds for a game; undefined when the title cannot be used as a key. */
export async function readCache(cacheRoot: string, title: string): Promise<CacheEntry | undefined> {
  const key = cacheKey(title);
  if (key === undefined) return undefined;
  const dir = path.join(cacheRoot, key);
  const files = new Map<ArtworkKind, CachedFile>();
  for (const file of await listDir(dir)) {
    const match = ENTRY_FILE.exec(file);
    if (!match) continue;
    const kind = (match[1] as string).toLowerCase() as ArtworkKind;
    const version = Math.round((await stat(path.join(dir, file))).mtimeMs);
    if (version >= (files.get(kind)?.version ?? 0)) files.set(kind, { file, version });
  }
  const meta = await readJsonIfExists(path.join(dir, 'meta.json'));
  const recorded = typeof meta === 'object' && meta !== null ? (meta as { missing?: unknown }).missing : undefined;
  const missing: CacheEntry['missing'] = {};
  if (typeof recorded === 'object' && recorded !== null) {
    for (const kind of ARTWORK_KINDS) {
      const asked = (recorded as Record<string, unknown>)[kind];
      if (typeof asked === 'number') missing[kind] = asked;
    }
  }
  return { key, dir, files, missing };
}

function knownMissing(entry: CacheEntry, kind: ArtworkKind, now: number): boolean {
  const asked = entry.missing[kind];
  return asked !== undefined && now - asked < MISSING_TTL_MS;
}

/** Whether anything about this game's artwork still has to be fetched (an image neither cached nor known to be missing). */
export function isPending(entry: CacheEntry | undefined, now: number): boolean {
  return entry !== undefined && ARTWORK_KINDS.some((kind) => !entry.files.has(kind) && !knownMissing(entry, kind, now));
}

export interface FillCacheOptions {
  cacheRoot: string;
  title: string;
  client: Pick<SteamGridDbClient, 'searchGame' | 'findArtworkUrl'>;
  fetchFn: FetchLike;
  /** Download every kind again, replacing what is cached. */
  force?: boolean;
  now?: number;
}

/**
 * Downloads the images a game is missing into the cache (all of them when forced). Images already
 * cached, and kinds SteamGridDB recently said it does not have, are not asked for again.
 */
export async function fillCache(options: FillCacheOptions): Promise<ArtworkOutcome[]> {
  const { cacheRoot, title, client, fetchFn, force = false, now = Date.now() } = options;
  const entry = await readCache(cacheRoot, title);
  if (entry === undefined) return ARTWORK_KINDS.map((kind) => ({ kind, status: 'missing' }));

  const wanted = ARTWORK_KINDS.filter((kind) => force || (!entry.files.has(kind) && !knownMissing(entry, kind, now)));
  const fetched = new Map<ArtworkKind, ArtworkOutcome>();
  if (wanted.length > 0) {
    const outcomes = await installArtwork({
      gridDir: entry.dir,
      appId: 0,
      title,
      client,
      fetchFn,
      force,
      kinds: wanted,
      fileName: (kind, ext) => `${kind}${ext}`,
    });
    for (const outcome of outcomes) fetched.set(outcome.kind, outcome);

    const missing = { ...entry.missing };
    for (const { kind, status } of outcomes) {
      if (status === 'missing') missing[kind] = now;
      else if (status !== 'failed') delete missing[kind];
    }
    await mkdir(entry.dir, { recursive: true });
    await writeFile(path.join(entry.dir, 'meta.json'), `${JSON.stringify({ title, missing }, null, 2)}\n`);
  }

  return ARTWORK_KINDS.map((kind): ArtworkOutcome => fetched.get(kind) ?? (entry.files.has(kind) ? { kind, status: 'exists' } : { kind, status: 'missing' }));
}

/**
 * Copies a game's cached images into Steam's grid folder under its shortcut ID. A kind that already has an
 * image there is kept unless forced. `failed` lists kinds whose download failed, reported as failures.
 */
export async function copyCachedToGrid(options: {
  cacheRoot: string;
  title: string;
  gridDir: string;
  appId: number;
  kinds: readonly ArtworkKind[];
  force?: boolean;
  failed?: ReadonlyMap<ArtworkKind, string>;
}): Promise<ArtworkOutcome[]> {
  const { cacheRoot, title, gridDir, appId, kinds, force = false, failed = new Map() } = options;
  const entry = await readCache(cacheRoot, title);
  const present = new Set((await listArtwork(gridDir, new Set([appId]))).map((file) => file.kind));
  const outcomes: ArtworkOutcome[] = [];
  for (const kind of kinds) {
    const cached = entry?.files.get(kind);
    if (present.has(kind) && !force) outcomes.push({ kind, status: 'exists' });
    else if (cached !== undefined && entry !== undefined) {
      await mkdir(gridDir, { recursive: true });
      const target = path.join(gridDir, `${appId}${ARTWORK_SUFFIXES[kind]}${path.extname(cached.file)}`);
      // Tagging is idempotent; it marks images cached before tagging existed, so Steam's copies are always ours to recognise.
      await writeFile(target, tagImage(await readFile(path.join(entry.dir, cached.file))));
      outcomes.push({ kind, status: 'saved', file: target });
    } else if (failed.has(kind)) outcomes.push({ kind, status: 'failed', error: failed.get(kind) });
    else outcomes.push({ kind, status: 'missing' });
  }
  return outcomes;
}

/** Reads one cached image for the app's own scheme. Only a cache folder name and an image file name are accepted. */
export async function readCachedArtwork(cacheRoot: string, dir: string, file: string): Promise<ArtworkResponse> {
  if (!ENTRY_DIR.test(dir) || !ENTRY_FILE.test(file)) return { status: 400 };
  try {
    return { status: 200, contentType: mimeOf(path.extname(file)), data: await readFile(path.join(cacheRoot, dir, file)) };
  } catch {
    return { status: 404 };
  }
}
