import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ArtworkChoices } from '../config.js';
import { listDir, readJsonIfExists } from '../integrations/shared/fs.js';
import { mimeOf, parseArtworkFile, type ArtworkResponse } from './files.js';
import { ARTWORK_KINDS, ARTWORK_SUFFIXES, type ArtworkKind } from './kinds.js';
import { titleKey, type ArtworkCandidate, type FetchLike, type SteamGridDbClient } from './steamgriddb.js';
import { readTag, tagImage } from './tag.js';

/** How long "SteamGridDB has nothing" (no such game, or no images of a type) is trusted before asking again. */
export const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ENTRY_DIR = /^[\p{L}\p{N}]{1,48}-[0-9a-f]{8}$/u;
/** `thumb-<kind>-<imageId>.<ext>` and `full-<kind>-<imageId>.<ext>`. */
const CACHE_FILE = /^(thumb|full)-(poster|wide|hero|logo|icon)-(\d+)\.(png|jpe?g|webp|ico)$/i;
/** Files from before options existed: one image per kind, `<kind>.<ext>`. */
const LEGACY_FILE = /^(poster|wide|hero|logo|icon)\.(png|jpe?g|webp|ico)$/i;

export type ArtworkStatus = 'saved' | 'exists' | 'missing' | 'failed' | 'none';

export interface ArtworkOutcome {
  kind: ArtworkKind;
  status: ArtworkStatus;
  file?: string;
  error?: string;
}

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

/** What SteamGridDB offered for one image type, as of `fetchedAt`. */
export interface KindOptions {
  fetchedAt: number;
  /** How many were asked for, and whether adult images were included; used to tell when the list is out of date. */
  limit: number;
  nsfw: boolean;
  candidates: ArtworkCandidate[];
}

export interface CacheMeta {
  title: string;
  /** The SteamGridDB game this title matched, once searched. */
  sgdbId?: number;
  /** When SteamGridDB was last found not to have this game. */
  notFound?: number;
  options: Partial<Record<ArtworkKind, KindOptions>>;
}

export interface CacheEntry {
  key: string;
  dir: string;
  meta: CacheMeta;
  /** Previews and full images by `fileKey(kind, imageId)`. */
  thumbs: Map<string, CachedFile>;
  full: Map<string, CachedFile>;
  /** The single image per kind kept by earlier versions. */
  legacy: Map<ArtworkKind, CachedFile>;
}

/** How many options to offer and whether to include adult ones (from settings). */
export interface ArtworkPrefs {
  options: number;
  nsfw: boolean;
}

/** The user's picks for a game, by its title. */
export function choicesFor(all: ArtworkChoices, title: string): ArtworkChoices[string] | undefined {
  const key = cacheKey(title);
  return key === undefined ? undefined : all[key];
}

export function fileKey(kind: ArtworkKind, imageId: number): string {
  return `${kind}:${imageId}`;
}

function parseCandidate(value: unknown): ArtworkCandidate | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const c = value as Record<string, unknown>;
  const valid =
    Number.isInteger(c['id']) &&
    typeof c['url'] === 'string' &&
    typeof c['thumb'] === 'string' &&
    typeof c['width'] === 'number' &&
    typeof c['height'] === 'number' &&
    typeof c['mime'] === 'string' &&
    typeof c['style'] === 'string' &&
    typeof c['nsfw'] === 'boolean';
  return valid ? (c as unknown as ArtworkCandidate) : undefined;
}

function parseOptions(value: unknown): KindOptions | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const o = value as Record<string, unknown>;
  if (typeof o['fetchedAt'] !== 'number' || typeof o['limit'] !== 'number' || typeof o['nsfw'] !== 'boolean' || !Array.isArray(o['candidates'])) return undefined;
  const candidates = o['candidates'].map(parseCandidate).filter((c): c is ArtworkCandidate => c !== undefined);
  return { fetchedAt: o['fetchedAt'], limit: o['limit'], nsfw: o['nsfw'], candidates };
}

function parseMeta(raw: unknown, title: string): CacheMeta {
  const meta: CacheMeta = { title, options: {} };
  if (typeof raw !== 'object' || raw === null) return meta;
  const r = raw as Record<string, unknown>;
  if (Number.isInteger(r['sgdbId'])) meta.sgdbId = r['sgdbId'] as number;
  if (typeof r['notFound'] === 'number') meta.notFound = r['notFound'];
  const options = r['options'];
  if (typeof options === 'object' && options !== null) {
    for (const kind of ARTWORK_KINDS) {
      const parsed = parseOptions((options as Record<string, unknown>)[kind]);
      if (parsed) meta.options[kind] = parsed;
    }
  }
  return meta;
}

/** What the cache holds for a game; undefined when the title cannot be used as a key. */
export async function readCache(cacheRoot: string, title: string): Promise<CacheEntry | undefined> {
  const key = cacheKey(title);
  if (key === undefined) return undefined;
  const dir = path.join(cacheRoot, key);
  const thumbs = new Map<string, CachedFile>();
  const full = new Map<string, CachedFile>();
  const legacy = new Map<ArtworkKind, CachedFile>();
  const keep = <K>(map: Map<K, CachedFile>, id: K, file: CachedFile) => {
    if (file.version >= (map.get(id)?.version ?? 0)) map.set(id, file);
  };
  for (const file of await listDir(dir)) {
    const cached = CACHE_FILE.exec(file);
    const old = LEGACY_FILE.exec(file);
    if (!cached && !old) continue;
    const entry = { file, version: Math.round((await stat(path.join(dir, file))).mtimeMs) };
    if (cached) {
      keep(cached[1]?.toLowerCase() === 'thumb' ? thumbs : full, fileKey((cached[2] as string).toLowerCase() as ArtworkKind, Number(cached[3])), entry);
    } else {
      keep(legacy, ((old as RegExpExecArray)[1] as string).toLowerCase() as ArtworkKind, entry);
    }
  }
  return { key, dir, meta: parseMeta(await readJsonIfExists(path.join(dir, 'meta.json')), title), thumbs, full, legacy };
}

/** The options to show: adult ones only when allowed, and no more than the user wants. */
export function visibleCandidates(options: KindOptions | undefined, prefs: ArtworkPrefs): ArtworkCandidate[] {
  return (options?.candidates ?? []).filter((candidate) => prefs.nsfw || !candidate.nsfw).slice(0, prefs.options);
}

/**
 * Which image of a kind is selected: the one the user picked if it is still on offer, else the first. A pick of
 * `null` means "none". `candidate` is undefined when there is nothing to select.
 */
export function selection(options: KindOptions | undefined, choice: number | null | undefined, prefs: ArtworkPrefs): { candidate?: ArtworkCandidate; none: boolean } {
  if (choice === null) return { none: true };
  const visible = visibleCandidates(options, prefs);
  return { candidate: visible.find((candidate) => candidate.id === choice) ?? visible[0], none: false };
}

/** Whether the list of options for a kind can still be used with the current preferences. */
function listFresh(options: KindOptions | undefined, prefs: ArtworkPrefs, now: number): boolean {
  if (options === undefined) return false;
  if (options.candidates.length === 0) return now - options.fetchedAt < MISSING_TTL_MS;
  const complete = options.candidates.length < options.limit; // SteamGridDB had fewer than we asked for, so asking for more adds nothing
  return (complete || options.limit >= prefs.options) && (options.nsfw || !prefs.nsfw);
}

function gameNotFound(meta: CacheMeta, now: number): boolean {
  return meta.notFound !== undefined && now - meta.notFound < MISSING_TTL_MS;
}

/**
 * Whether the background download still has something to do for a game: a list of options is missing or out of
 * date, or the selected image of some type has not been downloaded.
 */
export function isPending(entry: CacheEntry | undefined, choices: ArtworkChoices[string] | undefined, prefs: ArtworkPrefs, now: number): boolean {
  if (entry === undefined || gameNotFound(entry.meta, now)) return false;
  return ARTWORK_KINDS.some((kind) => {
    const options = entry.meta.options[kind];
    if (!listFresh(options, prefs, now)) return true;
    const { candidate } = selection(options, choices?.[kind], prefs);
    return candidate !== undefined && !entry.full.has(fileKey(kind, candidate.id));
  });
}

/** Whether everything the game page shows (every list, and a preview of each option) is cached. */
export function optionsReady(entry: CacheEntry | undefined, prefs: ArtworkPrefs, now: number): boolean {
  if (entry === undefined || gameNotFound(entry.meta, now)) return true;
  return ARTWORK_KINDS.every((kind) => {
    const options = entry.meta.options[kind];
    return listFresh(options, prefs, now) && visibleCandidates(options, prefs).every((candidate) => entry.thumbs.has(fileKey(kind, candidate.id)));
  });
}

function extensionOf(url: string): string {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return ext === '' ? '.png' : ext;
}

async function download(fetchFn: FetchLike, url: string, target: string, imageId: number): Promise<void> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  await writeFile(target, tagImage(Buffer.from(await response.arrayBuffer()), imageId));
}

/** Runs `task` over the items with at most `limit` running side by side. */
async function pool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++] as T);
    }),
  );
}

/** The image kept by earlier versions was the first result; it becomes the full image of that option. */
async function adoptLegacy(entry: CacheEntry, kind: ArtworkKind, prefs: ArtworkPrefs): Promise<void> {
  const legacy = entry.legacy.get(kind) as CachedFile;
  const first = visibleCandidates(entry.meta.options[kind], prefs)[0];
  if (first === undefined) return;
  if (!entry.full.has(fileKey(kind, first.id))) {
    const file = `full-${kind}-${first.id}${path.extname(legacy.file)}`;
    await writeFile(path.join(entry.dir, file), tagImage(await readFile(path.join(entry.dir, legacy.file)), first.id));
    entry.full.set(fileKey(kind, first.id), { file, version: Date.now() });
  }
  await unlink(path.join(entry.dir, legacy.file));
  entry.legacy.delete(kind);
}

export interface EnsureOptions {
  cacheRoot: string;
  title: string;
  client: Pick<SteamGridDbClient, 'searchGame' | 'findArtwork'>;
  fetchFn: FetchLike;
  prefs: ArtworkPrefs;
  /** The user's picks for this game. */
  choices?: ArtworkChoices[string];
  /** Look everything up and download the selected images again. */
  force?: boolean;
  /** Also download a preview of every option (for the game page). */
  thumbs?: boolean;
  now?: number;
}

/**
 * Makes the cache complete for a game: finds it on SteamGridDB, lists the options of every image type, downloads
 * the selected image of each type in full and, when asked, a preview of every option. Anything already cached
 * is not asked for again. Returns what happened to the selected image of each type.
 */
export async function ensureArtwork(options: EnsureOptions): Promise<ArtworkOutcome[]> {
  const { cacheRoot, title, client, fetchFn, prefs, choices, force = false, thumbs = false, now = Date.now() } = options;
  const entry = await readCache(cacheRoot, title);
  if (entry === undefined) return ARTWORK_KINDS.map((kind) => ({ kind, status: 'missing' }));
  const { meta } = entry;
  const outcomes = new Map<ArtworkKind, ArtworkOutcome>();
  let dirty = false;
  await mkdir(entry.dir, { recursive: true });

  // 1. Find the game and list the options of every type whose list is missing or out of date.
  const stale = ARTWORK_KINDS.filter((kind) => force || !listFresh(meta.options[kind], prefs, now));
  if (stale.length > 0) {
    if (meta.sgdbId === undefined && (force || !gameNotFound(meta, now))) {
      try {
        const found = await client.searchGame(title);
        dirty = true;
        if (found === undefined) meta.notFound = now;
        else {
          meta.sgdbId = found;
          delete meta.notFound;
        }
      } catch (error) {
        for (const kind of stale) outcomes.set(kind, { kind, status: 'failed', error: (error as Error).message });
      }
    }
    const gameId = meta.sgdbId;
    await Promise.all(
      stale
        .filter((kind) => !outcomes.has(kind))
        .map(async (kind) => {
          if (gameId === undefined) return void outcomes.set(kind, { kind, status: 'missing' });
          try {
            const candidates = await client.findArtwork(gameId, kind, { limit: prefs.options, nsfw: prefs.nsfw });
            meta.options[kind] = { fetchedAt: now, limit: prefs.options, nsfw: prefs.nsfw, candidates };
            dirty = true;
          } catch (error) {
            outcomes.set(kind, { kind, status: 'failed', error: (error as Error).message });
          }
        }),
    );
  }

  // 2. Images kept by earlier versions become the full image of the first option.
  for (const kind of ARTWORK_KINDS) {
    if (entry.legacy.has(kind) && meta.options[kind]) await adoptLegacy(entry, kind, prefs);
  }

  // 3. The selected image of each type, in full.
  await Promise.all(
    ARTWORK_KINDS.filter((kind) => !outcomes.has(kind)).map(async (kind) => {
      const { candidate, none } = selection(meta.options[kind], choices?.[kind], prefs);
      if (none) return void outcomes.set(kind, { kind, status: 'none' });
      if (candidate === undefined) return void outcomes.set(kind, { kind, status: 'missing' });
      const have = entry.full.get(fileKey(kind, candidate.id));
      if (have && !force) return void outcomes.set(kind, { kind, status: 'exists', file: have.file });
      const file = `full-${kind}-${candidate.id}${extensionOf(candidate.url)}`;
      try {
        await download(fetchFn, candidate.url, path.join(entry.dir, file), candidate.id);
        outcomes.set(kind, { kind, status: 'saved', file });
      } catch (error) {
        outcomes.set(kind, { kind, status: 'failed', error: (error as Error).message });
      }
    }),
  );

  // 4. A preview of every option, a few at a time. A preview that fails is simply fetched again next time.
  if (thumbs) {
    const wanted = ARTWORK_KINDS.flatMap((kind) =>
      visibleCandidates(meta.options[kind], prefs)
        .filter((candidate) => force || !entry.thumbs.has(fileKey(kind, candidate.id)))
        .map((candidate) => ({ kind, candidate })),
    );
    await pool(wanted, 6, async ({ kind, candidate }) => {
      try {
        await download(fetchFn, candidate.thumb, path.join(entry.dir, `thumb-${kind}-${candidate.id}${extensionOf(candidate.thumb)}`), candidate.id);
      } catch {
        // not cached; tried again next time
      }
    });
  }

  if (dirty) await writeFile(path.join(entry.dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  return ARTWORK_KINDS.map((kind) => outcomes.get(kind) as ArtworkOutcome);
}

/** The names of the grid files for one shortcut, with the kind each is for. */
async function gridFiles(gridDir: string, appId: number): Promise<{ name: string; kind: ArtworkKind }[]> {
  const files: { name: string; kind: ArtworkKind }[] = [];
  for (const name of await listDir(gridDir)) {
    const parsed = parseArtworkFile(name);
    if (parsed?.appId === appId) files.push({ name, kind: parsed.kind });
  }
  return files;
}

/**
 * Copies the selected images of a game into Steam's grid folder under its shortcut ID, tagged as ours. Rules for
 * what is already there: an image that is not ours (the user's) is kept; one of ours for the same SteamGridDB
 * image is kept; one of ours for another image is replaced. `force` replaces regardless. A type the user set to
 * "none" is left out. `failed` lists kinds whose download failed, reported as failures.
 */
export async function copyCachedToGrid(options: {
  cacheRoot: string;
  title: string;
  gridDir: string;
  appId: number;
  kinds: readonly ArtworkKind[];
  prefs: ArtworkPrefs;
  choices?: ArtworkChoices[string];
  force?: boolean;
  failed?: ReadonlyMap<ArtworkKind, string>;
}): Promise<ArtworkOutcome[]> {
  const { cacheRoot, title, gridDir, appId, kinds, prefs, choices, force = false, failed = new Map() } = options;
  const entry = await readCache(cacheRoot, title);
  const inGrid = await gridFiles(gridDir, appId);
  const outcomes: ArtworkOutcome[] = [];
  for (const kind of kinds) {
    const { candidate, none } = selection(entry?.meta.options[kind], choices?.[kind], prefs);
    if (none) {
      outcomes.push({ kind, status: 'none' });
      continue;
    }
    const full = candidate === undefined ? undefined : entry?.full.get(fileKey(kind, candidate.id));
    const source = full ?? (candidate === undefined ? entry?.legacy.get(kind) : undefined);
    if (entry === undefined || source === undefined) {
      outcomes.push(failed.has(kind) ? { kind, status: 'failed', error: failed.get(kind) } : { kind, status: 'missing' });
      continue;
    }
    const ours: string[] = [];
    let kept = false;
    for (const { name } of inGrid.filter((file) => file.kind === kind)) {
      const tag = readTag(await readFile(path.join(gridDir, name)));
      if (tag === undefined) kept = true; // the user's own image
      else if (tag.id !== undefined && tag.id === candidate?.id) kept = true; // already the one selected
      else ours.push(name); // ours, but another image or an old tag without an id
    }
    if (kept && !force) {
      outcomes.push({ kind, status: 'exists' });
      continue;
    }
    for (const name of ours) await unlink(path.join(gridDir, name));
    await mkdir(gridDir, { recursive: true });
    const target = path.join(gridDir, `${appId}${ARTWORK_SUFFIXES[kind]}${path.extname(source.file)}`);
    await writeFile(target, tagImage(await readFile(path.join(entry.dir, source.file)), candidate?.id));
    outcomes.push({ kind, status: 'saved', file: target });
  }
  return outcomes;
}

/** Reads one cached image for the app's own scheme. Only a cache folder name and a cache image name are accepted. */
export async function readCachedArtwork(cacheRoot: string, dir: string, file: string): Promise<ArtworkResponse> {
  if (!ENTRY_DIR.test(dir) || !(CACHE_FILE.test(file) || LEGACY_FILE.test(file))) return { status: 400 };
  try {
    return { status: 200, contentType: mimeOf(path.extname(file)), data: await readFile(path.join(cacheRoot, dir, file)) };
  } catch {
    return { status: 404 };
  }
}
