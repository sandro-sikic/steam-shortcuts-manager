import { mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  artworkCacheDir,
  cacheKey,
  choicesFor,
  copyCachedToGrid,
  ensureArtwork,
  fileKey,
  isPending,
  MISSING_TTL_MS,
  optionsReady,
  readCache,
  readCachedArtwork,
  selection,
  visibleCandidates,
  type CacheEntry,
  type KindOptions,
} from '../src/artwork/cache.js';
import { cacheArtworkUrl, mimeOf } from '../src/artwork/files.js';
import { ARTWORK_KINDS } from '../src/artwork/kinds.js';
import { SteamGridDbClient } from '../src/artwork/steamgriddb.js';
import { readTag, tagImage } from '../src/artwork/tag.js';
import { cleanupTempDirs, fakeFetch, fullUrl, IMAGE_BASE, makeTempDir, sgdbImage, sgdbList, sgdbRoutes, sgdbSearch, thumbUrl } from './helpers.js';

afterEach(cleanupTempDirs);

const NOW = 1_700_000_000_000;
const PREFS = { options: 5, nsfw: false };
const KEY = cacheKey('Hades') as string;

const candidate = (id: number, over: Record<string, unknown> = {}) => ({ id, url: `https://i/${id}.png`, thumb: `https://i/${id}.jpg`, width: 1, height: 2, mime: 'image/png', style: 'alternate', nsfw: false, ...over });
const options = (ids: number[], over: Partial<KindOptions> = {}): KindOptions => ({ fetchedAt: NOW, limit: 5, nsfw: false, candidates: ids.map((id) => candidate(id)), ...over });

/** A cache entry built in memory, for the pure functions. */
function entryOf(opts: Partial<Record<(typeof ARTWORK_KINDS)[number], KindOptions>>, files: { full?: string[]; thumbs?: string[]; meta?: Partial<CacheEntry['meta']> } = {}): CacheEntry {
  const map = (keys: string[] = []) => new Map(keys.map((key) => [key, { file: `${key}.png`, version: 1 }]));
  return { key: 'k', dir: '/x', meta: { title: 'Hades', options: opts, ...files.meta }, full: map(files.full), thumbs: map(files.thumbs), legacy: new Map() };
}

const all = (id: number) => Object.fromEntries(ARTWORK_KINDS.map((kind) => [kind, options([id])])) as Record<(typeof ARTWORK_KINDS)[number], KindOptions>;
const allFull = (id: number) => ARTWORK_KINDS.map((kind) => fileKey(kind, id));

async function put(root: string, title: string, files: Record<string, number | undefined>, meta?: unknown): Promise<string> {
  const dir = path.join(root, cacheKey(title) as string);
  await mkdir(dir, { recursive: true });
  for (const [name, time] of Object.entries(files)) {
    await writeFile(path.join(dir, name), 'x');
    if (time !== undefined) await utimes(path.join(dir, name), time, time);
  }
  if (meta !== undefined) await writeFile(path.join(dir, 'meta.json'), typeof meta === 'string' ? meta : JSON.stringify(meta));
  return dir;
}

describe('cacheKey and choicesFor', () => {
  it('is the title reduced to letters and digits plus a short hash, the same for the same game', () => {
    expect(cacheKey('Hades')).toMatch(/^hades-[0-9a-f]{8}$/);
    expect(cacheKey('Hades')).toBe(cacheKey('HADES™'));
    expect(cacheKey('Hades')).not.toBe(cacheKey('Hades II'));
    expect(cacheKey('Doom II')).toBe(cacheKey('Doom 2'));
    expect(cacheKey('Ünïcode 游戏')).toMatch(/^[\p{L}\p{N}]+-[0-9a-f]{8}$/u);
  });

  it('shortens long titles, and has no key for an untitled game', () => {
    expect((cacheKey('a'.repeat(200)) as string).length).toBe(48 + 1 + 8);
    expect(cacheKey('a'.repeat(200))).not.toBe(cacheKey('a'.repeat(201)));
    expect(cacheKey('!!!')).toBeUndefined();
  });

  it('finds the picks of a game by its title', () => {
    const picks = { [KEY]: { poster: 5 } };
    expect(choicesFor(picks, 'hades')).toEqual({ poster: 5 });
    expect(choicesFor(picks, 'Other')).toBeUndefined();
    expect(choicesFor(picks, '!!!')).toBeUndefined();
  });
});

describe('readCache', () => {
  it('is undefined for an untitled game and empty for a game that was never cached', async () => {
    const root = await makeTempDir();
    expect(await readCache(root, '!!!')).toBeUndefined();
    const entry = await readCache(root, 'Hades');
    expect([entry?.full.size, entry?.thumbs.size, entry?.legacy.size, entry?.meta]).toEqual([0, 0, 0, { title: 'Hades', options: {} }]);
    expect(entry?.dir).toBe(path.join(root, KEY));
  });

  it('reads previews, full images and old single images by kind, keeping the newest file of each, ignoring other files', async () => {
    const root = await makeTempDir();
    await put(root, 'Hades', {
      'thumb-poster-7.jpg': 1, 'THUMB-hero-8.png': 1, 'full-poster-7.png': 100, 'full-poster-7.jpg': 300, 'full-logo-9.webp': 1,
      'poster.png': 100, 'poster.jpg': 300, 'ICON.ico': 1,
      'meta.json': 1, 'notes.txt': 1, 'full-poster-x.png': 1, 'full-banner-1.png': 1, 'thumb-poster-1.gif': 1,
    });
    const entry = await readCache(root, 'Hades');
    expect([...(entry?.thumbs.keys() ?? [])].sort()).toEqual(['hero:8', 'poster:7']);
    expect([...(entry?.full ?? [])].map(([key, f]) => [key, f.file]).sort()).toEqual([['logo:9', 'full-logo-9.webp'], ['poster:7', 'full-poster-7.jpg']]);
    expect([...(entry?.legacy ?? [])].map(([kind, f]) => [kind, f.file]).sort()).toEqual([['icon', 'ICON.ico'], ['poster', 'poster.jpg']]);
    expect(entry?.full.get('poster:7')?.version).toBe(300_000);
  });

  it('reads the lists of options and what is known about the game, ignoring anything malformed', async () => {
    const root = await makeTempDir();
    const good = { fetchedAt: 5, limit: 3, nsfw: true, candidates: [candidate(1), candidate(2, { nsfw: true })] };
    await put(root, 'Hades', {}, {
      title: 'Hades', sgdbId: 42, notFound: 7,
      options: {
        poster: good,
        hero: { ...good, candidates: [candidate(1), { id: 'x' }, null, 'junk', { ...candidate(2), nsfw: 'no' }, { ...candidate(3), thumb: 5 }] },
        wide: { fetchedAt: 'now', limit: 3, nsfw: true, candidates: [] },
        logo: { ...good, limit: 'many' },
        icon: { ...good, nsfw: 'yes' },
        bogus: good,
      },
    });
    const meta = (await readCache(root, 'Hades'))?.meta;
    expect([meta?.sgdbId, meta?.notFound]).toEqual([42, 7]);
    expect(Object.keys(meta?.options ?? {}).sort()).toEqual(['hero', 'poster']);
    expect(meta?.options.poster?.candidates.map((c) => c.id)).toEqual([1, 2]);
    expect(meta?.options.hero?.candidates.map((c) => c.id)).toEqual([1]);
  });

  it('copes with a bad meta.json, a missing one, other shapes, and bad options', async () => {
    const root = await makeTempDir();
    for (const [title, meta] of [['A', '{broken'], ['B', 'null'], ['C', '[]'], ['D', { sgdbId: 1.5, notFound: 'x', options: 5 }], ['E', { options: { poster: 'x', hero: null, wide: { fetchedAt: 1, limit: 1, nsfw: false, candidates: 'no' } } }]] as const) {
      await put(root, title, {}, meta);
      expect((await readCache(root, title))?.meta).toEqual({ title, options: {} });
    }
    await put(root, 'F', {});
    expect((await readCache(root, 'F'))?.meta).toEqual({ title: 'F', options: {} });
  });
});

describe('selection', () => {
  const opts = options([10, 11, 12, 13], { candidates: [candidate(10), candidate(11, { nsfw: true }), candidate(12), candidate(13)] });

  it('is the first option unless the user picked one that is still on offer', () => {
    expect(selection(opts, undefined, PREFS)).toEqual({ candidate: opts.candidates[0], none: false });
    expect(selection(opts, 12, PREFS).candidate?.id).toBe(12);
    expect(selection(opts, 999, PREFS).candidate?.id).toBe(10);
  });

  it('is "none" when the user said so, and has nothing when there are no options', () => {
    expect(selection(opts, null, PREFS)).toEqual({ none: true });
    expect(selection(undefined, undefined, PREFS)).toEqual({ candidate: undefined, none: false });
    expect(selection(options([]), 5, PREFS).candidate).toBeUndefined();
  });

  it('leaves out adult options unless allowed, and offers no more than the preferred number', () => {
    expect(visibleCandidates(opts, PREFS).map((c) => c.id)).toEqual([10, 12, 13]);
    expect(visibleCandidates(opts, { options: 5, nsfw: true }).map((c) => c.id)).toEqual([10, 11, 12, 13]);
    expect(visibleCandidates(opts, { options: 2, nsfw: true }).map((c) => c.id)).toEqual([10, 11]);
    expect(visibleCandidates(opts, { options: 2, nsfw: false }).map((c) => c.id)).toEqual([10, 12]);
    expect(visibleCandidates(undefined, PREFS)).toEqual([]);
    expect(selection(opts, 11, PREFS).candidate?.id).toBe(10); // an adult pick is not on offer while adult images are off
  });
});

describe('isPending', () => {
  it('is false when there is nothing to look up, or the game was recently found not to exist', () => {
    expect(isPending(undefined, undefined, PREFS, NOW)).toBe(false);
    expect(isPending(entryOf({}, { meta: { notFound: NOW - 1000 } }), undefined, PREFS, NOW)).toBe(false);
  });

  it('is true while a list is missing, or a selected image is not downloaded', () => {
    expect(isPending(entryOf({}), undefined, PREFS, NOW)).toBe(true);
    expect(isPending(entryOf(all(1), { full: allFull(1).slice(1) }), undefined, PREFS, NOW)).toBe(true);
    expect(isPending(entryOf({}, { meta: { notFound: NOW - MISSING_TTL_MS - 1 } }), undefined, PREFS, NOW)).toBe(true);
  });

  it('is false once every list is fetched and every selected image is cached', () => {
    expect(isPending(entryOf(all(1), { full: allFull(1) }), undefined, PREFS, NOW)).toBe(false);
  });

  it('looks at the image the user picked, and ignores types set to none', () => {
    const picked = { poster: 2, hero: null };
    const opts = { ...all(1), poster: options([1, 2]), hero: options([1]) };
    const files = ARTWORK_KINDS.filter((k) => k !== 'hero').map((k) => fileKey(k, 1));
    expect(isPending(entryOf(opts, { full: files }), picked, PREFS, NOW)).toBe(true); // poster 2 is not cached
    expect(isPending(entryOf(opts, { full: [...files.filter((f) => f !== 'poster:1'), 'poster:2'] }), picked, PREFS, NOW)).toBe(false);
  });

  it('does not wait for a type SteamGridDB has no images of', () => {
    const opts = { ...all(1), logo: options([]) };
    expect(isPending(entryOf(opts, { full: ARTWORK_KINDS.filter((k) => k !== 'logo').map((k) => fileKey(k, 1)) }), undefined, PREFS, NOW)).toBe(false);
  });

  it('wants a list again when it was asked for fewer options than now, or without adult images that are now allowed', () => {
    const files = { full: allFull(1) };
    expect(isPending(entryOf({ ...all(1), poster: options([1, 2, 3, 4, 5], { limit: 5 }) }, files), undefined, { options: 8, nsfw: false }, NOW)).toBe(true);
    expect(isPending(entryOf({ ...all(1), poster: options([1, 2], { limit: 5 }) }, files), undefined, { options: 8, nsfw: false }, NOW)).toBe(false); // SteamGridDB only had 2
    expect(isPending(entryOf(all(1), files), undefined, { options: 5, nsfw: true }, NOW)).toBe(true);
    const adult = Object.fromEntries(ARTWORK_KINDS.map((k) => [k, options([1], { nsfw: true })]));
    expect(isPending(entryOf(adult, files), undefined, { options: 5, nsfw: true }, NOW)).toBe(false);
    expect(isPending(entryOf({ ...all(1), poster: options([1], { nsfw: true }) }, files), undefined, { options: 5, nsfw: false }, NOW)).toBe(false);
  });

  it('asks again for an empty list after a week', () => {
    const files = { full: allFull(1) };
    expect(isPending(entryOf({ ...all(1), icon: options([], { fetchedAt: NOW - 1000 }) }, files), undefined, PREFS, NOW)).toBe(false);
    expect(isPending(entryOf({ ...all(1), icon: options([], { fetchedAt: NOW - MISSING_TTL_MS - 1 }) }, files), undefined, PREFS, NOW)).toBe(true);
  });
});

describe('optionsReady', () => {
  it('is true when there is nothing to fetch', () => {
    expect(optionsReady(undefined, PREFS, NOW)).toBe(true);
    expect(optionsReady(entryOf({}, { meta: { notFound: NOW - 5 } }), PREFS, NOW)).toBe(true);
  });

  it('needs every list and a preview of every option', () => {
    const thumbs = ARTWORK_KINDS.map((k) => fileKey(k, 1));
    expect(optionsReady(entryOf({}), PREFS, NOW)).toBe(false);
    expect(optionsReady(entryOf(all(1)), PREFS, NOW)).toBe(false);
    expect(optionsReady(entryOf(all(1), { thumbs: thumbs.slice(1) }), PREFS, NOW)).toBe(false);
    expect(optionsReady(entryOf(all(1), { thumbs }), PREFS, NOW)).toBe(true);
    expect(optionsReady(entryOf({ ...all(1), icon: options([]) }, { thumbs: thumbs.slice(0, 4) }), PREFS, NOW)).toBe(true);
  });
});

describe('ensureArtwork', () => {
  const setup = async (over: { title?: string; counts?: Parameters<typeof sgdbRoutes>[0]['counts']; extra?: Record<string, never>; nsfw?: boolean } = {}) => {
    const cacheRoot = await makeTempDir();
    const title = over.title ?? 'Hades';
    const fetchFn = fakeFetch(sgdbRoutes({ title, counts: over.counts, nsfw: over.nsfw, extra: over.extra }));
    return { cacheRoot, title, fetchFn, client: new SteamGridDbClient('k', fetchFn), prefs: PREFS, now: NOW };
  };
  const dirOf = (root: string) => path.join(root, KEY);

  it('finds the game, lists every type, and downloads the first image of each in full, tagged with its id', async () => {
    const o = await setup();
    const outcomes = await ensureArtwork(o);
    expect(outcomes.map((x) => [x.kind, x.status])).toEqual(ARTWORK_KINDS.map((kind) => [kind, 'saved']));
    expect((await readdir(dirOf(o.cacheRoot))).sort()).toEqual([
      'full-hero-3000.png', 'full-icon-5000.ico', 'full-logo-4000.png', 'full-poster-1000.png', 'full-wide-2000.jpg', 'meta.json',
    ]);
    const poster = await readFile(path.join(dirOf(o.cacheRoot), 'full-poster-1000.png'));
    expect(poster.toString('latin1')).toContain(`IMG:${fullUrl('poster', 0)}`);
    expect(readTag(poster)).toEqual({ id: 1000 });
    const meta = JSON.parse(await readFile(path.join(dirOf(o.cacheRoot), 'meta.json'), 'utf8'));
    expect(meta.sgdbId).toBe(1);
    expect(meta.options.hero.candidates.map((c: { id: number }) => c.id)).toEqual([3000, 3001, 3002]);
    expect(meta.options.hero).toMatchObject({ fetchedAt: NOW, limit: 5, nsfw: false });
  });

  it('downloads previews of every option as well when asked, and not otherwise', async () => {
    const o = await setup({ counts: { poster: 2, wide: 1, hero: 3, logo: 0, icon: 1 } });
    await ensureArtwork(o);
    expect((await readdir(dirOf(o.cacheRoot))).some((f) => f.startsWith('thumb-'))).toBe(false);
    await ensureArtwork({ ...o, thumbs: true });
    const thumbs = (await readdir(dirOf(o.cacheRoot))).filter((f) => f.startsWith('thumb-')).sort();
    expect(thumbs).toEqual(['thumb-hero-3000.jpg', 'thumb-hero-3001.jpg', 'thumb-hero-3002.jpg', 'thumb-icon-5000.jpg', 'thumb-poster-1000.jpg', 'thumb-poster-1001.jpg', 'thumb-wide-2000.jpg']);
    expect(readTag(await readFile(path.join(dirOf(o.cacheRoot), thumbs[0] as string)))).toEqual({ id: 3000 });
  });

  it('asks for nothing again when everything is cached', async () => {
    const o = await setup();
    await ensureArtwork({ ...o, thumbs: true });
    const requests = o.fetchFn.requests.length;
    const again = await ensureArtwork({ ...o, thumbs: true });
    expect(again.every((x) => x.status === 'exists')).toBe(true);
    expect(o.fetchFn.requests).toHaveLength(requests);
  });

  it('lists the options with the adult filter off or on, and with the number of options wanted', async () => {
    const o = await setup({ nsfw: true });
    await ensureArtwork({ ...o, prefs: { options: 2, nsfw: true } });
    const meta = JSON.parse(await readFile(path.join(dirOf(o.cacheRoot), 'meta.json'), 'utf8'));
    expect(meta.options.poster).toMatchObject({ limit: 2, nsfw: true });
    expect(meta.options.poster.candidates).toHaveLength(2);
    expect(o.fetchFn.requests.map((r) => r.url)).toContain(sgdbList('poster', 1, true));
  });

  it('lists again, without downloading images twice, when more options are wanted', async () => {
    const o = await setup({ counts: { poster: 8, wide: 8, hero: 8, logo: 8, icon: 8 } });
    await ensureArtwork({ ...o, prefs: { options: 2, nsfw: false } });
    const before = o.fetchFn.requests.length;
    const outcomes = await ensureArtwork({ ...o, prefs: { options: 6, nsfw: false } });
    expect(outcomes.every((x) => x.status === 'exists')).toBe(true);
    const meta = JSON.parse(await readFile(path.join(dirOf(o.cacheRoot), 'meta.json'), 'utf8'));
    expect(meta.options.poster.candidates).toHaveLength(6);
    expect(o.fetchFn.requests.length - before).toBe(5); // only the five lists
  });

  it('downloads the image the user picked, or none, instead of the first', async () => {
    const o = await setup();
    const picked = await ensureArtwork({ ...o, choices: { poster: 1002, hero: null, wide: 999 } });
    expect(picked.map((x) => [x.kind, x.status])).toEqual([['poster', 'saved'], ['wide', 'saved'], ['hero', 'none'], ['logo', 'saved'], ['icon', 'saved']]);
    const files = await readdir(dirOf(o.cacheRoot));
    expect(files).toContain('full-poster-1002.png');
    expect(files).not.toContain('full-poster-1000.png');
    expect(files).toContain('full-wide-2000.jpg'); // an unknown pick falls back to the first
    expect(files.some((f) => f.startsWith('full-hero-'))).toBe(false);
  });

  it('remembers a game SteamGridDB does not know, and asks again after a week', async () => {
    const cacheRoot = await makeTempDir();
    const fetchFn = fakeFetch({ [sgdbSearch('Hades')]: { json: { success: true, data: [] } } });
    const base = { cacheRoot, title: 'Hades', client: new SteamGridDbClient('k', fetchFn), fetchFn, prefs: PREFS };
    expect((await ensureArtwork({ ...base, now: NOW })).every((x) => x.status === 'missing')).toBe(true);
    expect((await readCache(cacheRoot, 'Hades'))?.meta.notFound).toBe(NOW);
    await ensureArtwork({ ...base, now: NOW + 1000 });
    expect(fetchFn.requests).toHaveLength(1);
    await ensureArtwork({ ...base, now: NOW + MISSING_TTL_MS + 1 });
    expect(fetchFn.requests).toHaveLength(2);
    await ensureArtwork({ ...base, now: NOW + 5, force: true });
    expect(fetchFn.requests).toHaveLength(3);
  });

  it('forgets that a game was missing once it turns up', async () => {
    const o = await setup();
    await put(o.cacheRoot, 'Hades', {}, { title: 'Hades', notFound: 5, options: {} });
    await ensureArtwork({ ...o, now: NOW + MISSING_TTL_MS + 5 });
    const meta = (await readCache(o.cacheRoot, 'Hades'))?.meta;
    expect([meta?.sgdbId, meta?.notFound]).toEqual([1, undefined]);
  });

  it('records a type with no images as an empty list and reports it missing', async () => {
    const o = await setup({ counts: { logo: 0 } });
    const outcomes = await ensureArtwork(o);
    expect(outcomes.find((x) => x.kind === 'logo')?.status).toBe('missing');
    const entry = await readCache(o.cacheRoot, 'Hades');
    expect(entry?.meta.options.logo?.candidates).toEqual([]);
    expect(isPending(entry, undefined, PREFS, NOW)).toBe(false);
  });

  it('reports a failed search for every type, writes nothing about the game and retries next time', async () => {
    const cacheRoot = await makeTempDir();
    const fetchFn = fakeFetch({});
    const o = { cacheRoot, title: 'Hades', client: new SteamGridDbClient('k', fetchFn), fetchFn, prefs: PREFS, now: NOW };
    const outcomes = await ensureArtwork(o);
    expect(outcomes.every((x) => x.status === 'failed' && x.error?.includes('HTTP 404'))).toBe(true);
    const entry = await readCache(cacheRoot, 'Hades');
    expect(entry?.meta).toEqual({ title: 'Hades', options: {} });
    expect(isPending(entry, undefined, PREFS, NOW)).toBe(true);
  });

  it('isolates a failed list or download to its own image type', async () => {
    const o = await setup({ extra: { [sgdbList('hero', 1)]: { status: 500 }, [fullUrl('logo', 0)]: { status: 404 } } as never });
    const outcomes = await ensureArtwork(o);
    expect(outcomes.map((x) => [x.kind, x.status])).toEqual([['poster', 'saved'], ['wide', 'saved'], ['hero', 'failed'], ['logo', 'failed'], ['icon', 'saved']]);
    expect(outcomes.find((x) => x.kind === 'logo')?.error).toContain('HTTP 404');
    expect(outcomes.find((x) => x.kind === 'hero')?.error).toContain('HTTP 500');
    const entry = await readCache(o.cacheRoot, 'Hades');
    expect(entry?.meta.options.hero).toBeUndefined();
    expect(isPending(entry, undefined, PREFS, NOW)).toBe(true);
  });

  it('ignores a preview that cannot be downloaded and fetches it again next time', async () => {
    const o = await setup({ counts: { poster: 2 }, extra: { [thumbUrl('poster', 1)]: { status: 500 } } as never });
    await ensureArtwork({ ...o, thumbs: true });
    expect((await readCache(o.cacheRoot, 'Hades'))?.thumbs.has(fileKey('poster', 1001))).toBe(false);
    expect(optionsReady(await readCache(o.cacheRoot, 'Hades'), PREFS, NOW)).toBe(false);
  });

  it('downloads everything again when forced', async () => {
    const o = await setup({ counts: { poster: 1, wide: 1, hero: 1, logo: 1, icon: 1 } });
    await ensureArtwork({ ...o, thumbs: true });
    const file = path.join(dirOf(o.cacheRoot), 'full-poster-1000.png');
    await writeFile(file, 'OLD');
    const forced = await ensureArtwork({ ...o, thumbs: true, force: true });
    expect(forced.every((x) => x.status === 'saved')).toBe(true);
    expect((await readFile(file)).toString('latin1')).toContain('IMG:');
  });

  it('turns the image kept by earlier versions into the full image of the first option, tagged with its id', async () => {
    const o = await setup({ counts: { poster: 2, wide: 1, hero: 1, logo: 1, icon: 1 } });
    await put(o.cacheRoot, 'Hades', { 'poster.png': 1, 'hero.jpg': 1 });
    await writeFile(path.join(dirOf(o.cacheRoot), 'poster.png'), 'OLD POSTER');
    const outcomes = await ensureArtwork(o);
    expect(outcomes.find((x) => x.kind === 'poster')?.status).toBe('exists'); // nothing was downloaded for it
    const files = await readdir(dirOf(o.cacheRoot));
    expect(files).toContain('full-poster-1000.png');
    expect(files).toContain('full-hero-3000.jpg');
    expect(files).not.toContain('poster.png');
    expect(files).not.toContain('hero.jpg');
    const adopted = await readFile(path.join(dirOf(o.cacheRoot), 'full-poster-1000.png'));
    expect(adopted.toString('latin1')).toContain('OLD POSTER');
    expect(readTag(adopted)).toEqual({ id: 1000 });
  });

  it('keeps the old image when SteamGridDB now has nothing of that type, and drops it when the first option is already cached', async () => {
    const o = await setup({ counts: { poster: 0, wide: 1, hero: 1, logo: 1, icon: 1 } });
    await put(o.cacheRoot, 'Hades', { 'poster.png': 1, 'wide.png': 1, 'full-wide-2000.jpg': 1 });
    await ensureArtwork(o);
    const files = await readdir(dirOf(o.cacheRoot));
    expect(files).toContain('poster.png');
    expect(files).not.toContain('wide.png');
  });

  it('saves an image whose address has no file extension as a png', async () => {
    const url = 'https://img.test/full/noext';
    const o = await setup({ extra: { [sgdbList('poster', 1)]: { json: { success: true, data: [sgdbImage('poster', 0, { url })] } }, [url]: { body: Buffer.from('X') } } as never });
    await ensureArtwork(o);
    expect(await readdir(dirOf(o.cacheRoot))).toContain('full-poster-1000.png');
  });

  it('has nothing to do for an untitled game', async () => {
    const o = await setup();
    expect((await ensureArtwork({ ...o, title: '???' })).every((x) => x.status === 'missing')).toBe(true);
    expect(o.fetchFn.requests).toHaveLength(0);
  });
});

describe('copyCachedToGrid', () => {
  const base = async () => {
    const cacheRoot = await makeTempDir();
    const gridDir = path.join(await makeTempDir(), 'grid');
    const fetchFn = fakeFetch(sgdbRoutes({ title: 'Hades' }));
    await ensureArtwork({ cacheRoot, title: 'Hades', client: new SteamGridDbClient('k', fetchFn), fetchFn, prefs: PREFS, now: NOW });
    return { cacheRoot, gridDir, title: 'Hades', appId: 42, kinds: ARTWORK_KINDS, prefs: PREFS };
  };
  const names = async (dir: string) => (await readdir(dir)).sort();

  it('copies the selected image of each type under the shortcut ID, tagged with its id', async () => {
    const o = await base();
    const outcomes = await copyCachedToGrid(o);
    expect(outcomes.map((x) => [x.kind, x.status])).toEqual(ARTWORK_KINDS.map((kind) => [kind, 'saved']));
    expect(await names(o.gridDir)).toEqual(['42.jpg', '42_hero.png', '42_icon.ico', '42_logo.png', '42p.png']);
    expect(readTag(await readFile(path.join(o.gridDir, '42p.png')))).toEqual({ id: 1000 });
    expect(readTag(await readFile(path.join(o.gridDir, '42_hero.png')))).toEqual({ id: 3000 });
  });

  it('copies the picked image instead, once it is downloaded', async () => {
    const o = await base();
    const fetchFn = fakeFetch(sgdbRoutes({ title: 'Hades' }));
    await ensureArtwork({ cacheRoot: o.cacheRoot, title: 'Hades', client: new SteamGridDbClient('k', fetchFn), fetchFn, prefs: PREFS, choices: { poster: 1002 }, now: NOW });
    await copyCachedToGrid({ ...o, choices: { poster: 1002 }, kinds: ['poster'] });
    expect(readTag(await readFile(path.join(o.gridDir, '42p.png')))).toEqual({ id: 1002 });
  });

  it('keeps an image that is not ours, and one of ours that already is the selected image', async () => {
    const o = await base();
    await mkdir(o.gridDir, { recursive: true });
    await writeFile(path.join(o.gridDir, '42p.jpg'), 'MINE');
    await writeFile(path.join(o.gridDir, '42_hero.png'), tagImage(Buffer.from('already'), 3000));
    const outcomes = await copyCachedToGrid({ ...o, kinds: ['poster', 'hero'] });
    expect(outcomes.map((x) => x.status)).toEqual(['exists', 'exists']);
    expect(await readFile(path.join(o.gridDir, '42p.jpg'), 'utf8')).toBe('MINE');
    expect((await readFile(path.join(o.gridDir, '42_hero.png'))).toString('latin1')).toContain('already');
    expect(await names(o.gridDir)).toEqual(['42_hero.png', '42p.jpg']);
  });

  it('replaces one of ours when another image is selected now, even in another format, and when it has an old tag without an id', async () => {
    const o = await base();
    await mkdir(o.gridDir, { recursive: true });
    await writeFile(path.join(o.gridDir, '42p.jpg'), tagImage(Buffer.from('other image'), 1001));
    await writeFile(path.join(o.gridDir, '42_hero.png'), tagImage(Buffer.from('old style tag')));
    const outcomes = await copyCachedToGrid({ ...o, kinds: ['poster', 'hero'] });
    expect(outcomes.map((x) => x.status)).toEqual(['saved', 'saved']);
    expect(await names(o.gridDir)).toEqual(['42_hero.png', '42p.png']);
    expect(readTag(await readFile(path.join(o.gridDir, '42p.png')))).toEqual({ id: 1000 });
    expect((await readFile(path.join(o.gridDir, '42_hero.png'))).toString('latin1')).toContain('IMG:');
  });

  it('replaces what is there when forced, but never deletes an image that is not ours', async () => {
    const o = await base();
    await mkdir(o.gridDir, { recursive: true });
    await writeFile(path.join(o.gridDir, '42p.png'), tagImage(Buffer.from('ours'), 1000));
    await writeFile(path.join(o.gridDir, '42_hero.jpg'), 'MINE');
    const outcomes = await copyCachedToGrid({ ...o, kinds: ['poster', 'hero'], force: true });
    expect(outcomes.map((x) => x.status)).toEqual(['saved', 'saved']);
    expect((await readFile(path.join(o.gridDir, '42p.png'))).toString('latin1')).toContain('IMG:');
    expect(await readFile(path.join(o.gridDir, '42_hero.jpg'), 'utf8')).toBe('MINE');
  });

  it('leaves out a type the user set to none, and copies only the kinds asked for', async () => {
    const o = await base();
    const outcomes = await copyCachedToGrid({ ...o, kinds: ['poster', 'hero'], choices: { hero: null } });
    expect(outcomes.map((x) => [x.kind, x.status])).toEqual([['poster', 'saved'], ['hero', 'none']]);
    expect(await names(o.gridDir)).toEqual(['42p.png']);
  });

  it('uses the image kept by earlier versions while no options are known', async () => {
    const cacheRoot = await makeTempDir();
    const gridDir = path.join(await makeTempDir(), 'grid');
    await put(cacheRoot, 'Hades', { 'poster.png': 1 });
    await writeFile(path.join(cacheRoot, KEY, 'poster.png'), 'OLD POSTER');
    const outcomes = await copyCachedToGrid({ cacheRoot, gridDir, title: 'Hades', appId: 42, kinds: ['poster', 'hero'], prefs: PREFS });
    expect(outcomes.map((x) => x.status)).toEqual(['saved', 'missing']);
    const copied = await readFile(path.join(gridDir, '42p.png'));
    expect(copied.toString('latin1')).toContain('OLD POSTER');
    expect(readTag(copied)).toEqual({}); // tagged as ours, without an id because it is not known
    const again = await copyCachedToGrid({ cacheRoot, gridDir, title: 'Hades', appId: 42, kinds: ['poster'], prefs: PREFS });
    expect(again[0]?.status).toBe('saved'); // an id-less tag cannot be told apart, so it is refreshed
  });

  it('copies nothing for an image that is selected but not downloaded yet', async () => {
    const o = await base();
    const outcomes = await copyCachedToGrid({ ...o, kinds: ['poster'], choices: { poster: 1002 } });
    expect(outcomes[0]?.status).toBe('missing');
  });

  it('ignores other games and other files in the grid folder', async () => {
    const o = await base();
    await mkdir(o.gridDir, { recursive: true });
    await writeFile(path.join(o.gridDir, '7p.png'), 'OTHER');
    await writeFile(path.join(o.gridDir, 'readme.txt'), 'x');
    await copyCachedToGrid({ ...o, kinds: ['poster'] });
    expect(await names(o.gridDir)).toEqual(['42p.png', '7p.png', 'readme.txt']);
  });

  it('reports failures and missing images, for untitled and never-cached games too', async () => {
    const o = await base();
    const missing = await copyCachedToGrid({ ...o, title: 'Never Cached', failed: new Map([['logo', 'HTTP 500']]) });
    expect(missing.map((x) => x.status)).toEqual(['missing', 'missing', 'missing', 'failed', 'missing']);
    expect(missing.find((x) => x.kind === 'logo')?.error).toBe('HTTP 500');
    expect((await copyCachedToGrid({ ...o, title: '???' })).every((x) => x.status === 'missing')).toBe(true);
    await expect(stat(o.gridDir)).rejects.toThrow();
  });
});

describe('readCachedArtwork', () => {
  it('serves previews, full images and old images with their content type', async () => {
    const root = await makeTempDir();
    await put(root, 'Hades', { 'thumb-poster-1.jpg': 1, 'full-hero-2.PNG': 1, 'icon.ico': 1 });
    expect(await readCachedArtwork(root, KEY, 'thumb-poster-1.jpg')).toMatchObject({ status: 200, contentType: 'image/jpeg' });
    expect(await readCachedArtwork(root, KEY, 'full-hero-2.PNG')).toMatchObject({ status: 200, contentType: 'image/png' });
    expect(await readCachedArtwork(root, KEY, 'icon.ico')).toMatchObject({ status: 200, contentType: 'image/x-icon' });
  });

  it('refuses anything that is not a cache folder name and an image name, and says when it is not there', async () => {
    const root = await makeTempDir();
    await put(root, 'Hades', { 'full-poster-1.png': 1 });
    for (const [dir, file] of [['..', 'full-poster-1.png'], [`../${KEY}`, 'full-poster-1.png'], [KEY, '../meta.json'], [KEY, 'meta.json'], [KEY, 'full-poster-1.gif'], [KEY, 'full-poster-x.png'], ['x', 'full-poster-1.png'], ['', 'full-poster-1.png'], [KEY, '']]) {
      expect(await readCachedArtwork(root, dir as string, file as string)).toEqual({ status: 400 });
    }
    expect(await readCachedArtwork(root, KEY, 'full-logo-9.png')).toEqual({ status: 404 });
  });
});

describe('helpers', () => {
  it('puts the cache in a folder of its own inside the config folder', () => {
    expect(artworkCacheDir('/c/steam-manager')).toBe(path.join('/c/steam-manager', 'artwork-cache'));
  });

  it('builds cache URLs with the folder encoded, and knows content types', () => {
    expect(cacheArtworkUrl('hades-1234abcd', 'full-poster-1.png', 9)).toBe('steam-manager-art://cache/hades-1234abcd/full-poster-1.png?v=9');
    expect(cacheArtworkUrl('游戏-1234abcd', 'thumb-hero-1.jpg', 1)).toBe(`steam-manager-art://cache/${encodeURIComponent('游戏-1234abcd')}/thumb-hero-1.jpg?v=1`);
    expect([mimeOf('.PNG'), mimeOf('jpeg'), mimeOf('.webp'), mimeOf('ico')]).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/x-icon']);
    expect(Object.keys(IMAGE_BASE)).toHaveLength(5);
  });
});
