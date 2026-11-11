import { mkdir, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artworkCacheDir, cacheKey, copyCachedToGrid, fillCache, isPending, MISSING_TTL_MS, readCache, readCachedArtwork } from '../src/artwork/cache.js';
import { cacheArtworkUrl, mimeOf } from '../src/artwork/files.js';
import { ARTWORK_KINDS } from '../src/artwork/kinds.js';
import { cleanupTempDirs, fakeFetch, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

const NOW = 1_700_000_000_000;
const URLS = { poster: 'https://c/p.png', wide: 'https://c/w.jpg', hero: 'https://c/h.png', logo: 'https://c/l.png', icon: 'https://c/i.ico' } as const;
const images = Object.fromEntries(Object.values(URLS).map((url) => [url, { body: Buffer.from(`IMG:${url}`) }]));

/** A client that knows a game, with images for the kinds in `have`. */
const client = (have: readonly (keyof typeof URLS)[] = ARTWORK_KINDS, found = true) => ({
  searchGame: async () => (found ? 5 : undefined),
  findArtworkUrl: async (_id: number, kind: keyof typeof URLS) => (have.includes(kind) ? URLS[kind] : undefined),
});

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

describe('cacheKey', () => {
  it('is the title reduced to letters and digits plus a short hash', () => {
    expect(cacheKey('Hades')).toMatch(/^hades-[0-9a-f]{8}$/);
    expect(cacheKey('Hades')).toBe(cacheKey('HADES™'));
    expect(cacheKey('Hades')).not.toBe(cacheKey('Hades II'));
  });

  it('treats Roman numerals II to IX like digits, keeps other scripts, and shortens long titles', () => {
    expect(cacheKey('Doom II')).toBe(cacheKey('Doom 2'));
    expect(cacheKey('Ünïcode 游戏')).toMatch(/^[\p{L}\p{N}]+-[0-9a-f]{8}$/u);
    const long = cacheKey('a'.repeat(200)) as string;
    expect(long.length).toBe(48 + 1 + 8);
    expect(cacheKey('a'.repeat(200))).not.toBe(cacheKey('a'.repeat(201)));
  });

  it('is undefined when nothing identifies the game', () => {
    expect(cacheKey('!!!')).toBeUndefined();
    expect(cacheKey('')).toBeUndefined();
  });
});

describe('readCache', () => {
  it('is undefined for an untitled game and empty for a game that was never cached', async () => {
    const root = await makeTempDir();
    expect(await readCache(root, '!!!')).toBeUndefined();
    const entry = await readCache(root, 'Hades');
    expect(entry?.files.size).toBe(0);
    expect(entry?.missing).toEqual({});
    expect(entry?.dir).toBe(path.join(root, cacheKey('Hades') as string));
  });

  it('reads the images by kind, keeping the newest file of a kind, and ignoring other files', async () => {
    const root = await makeTempDir();
    await put(root, 'Hades', { 'poster.png': 100, 'poster.jpg': 300, 'HERO.webp': 200, 'icon.ico': 100, 'notes.txt': 100, 'logo.gif': 100, 'meta.json': 100 });
    const entry = await readCache(root, 'Hades');
    expect([...(entry?.files ?? [])].map(([kind, f]) => [kind, f.file]).sort()).toEqual([['hero', 'HERO.webp'], ['icon', 'icon.ico'], ['poster', 'poster.jpg']]);
    expect(entry?.files.get('poster')?.version).toBe(300_000);
  });

  it('reads which kinds were found missing, ignoring anything malformed', async () => {
    const root = await makeTempDir();
    await put(root, 'A', {}, { missing: { logo: 123, icon: 'yesterday', hero: null, bogus: 5 } });
    expect((await readCache(root, 'A'))?.missing).toEqual({ logo: 123 });
    await put(root, 'B', {}, { missing: 'all of them' });
    expect((await readCache(root, 'B'))?.missing).toEqual({});
    await put(root, 'C', {}, { title: 'C' });
    expect((await readCache(root, 'C'))?.missing).toEqual({});
    await put(root, 'D', {}, '{broken');
    expect((await readCache(root, 'D'))?.missing).toEqual({});
    await put(root, 'E', {}, 'null');
    expect((await readCache(root, 'E'))?.missing).toEqual({});
  });
});

describe('isPending', () => {
  const entry = (files: string[], missing: Record<string, number>) =>
    ({ key: 'k', dir: '/x', files: new Map(files.map((kind) => [kind, { file: `${kind}.png`, version: 1 }])), missing }) as never;

  it('is false when there is nothing to fetch for the title', () => {
    expect(isPending(undefined, NOW)).toBe(false);
  });

  it('is true while an image is neither cached nor known to be missing', () => {
    expect(isPending(entry([], {}), NOW)).toBe(true);
    expect(isPending(entry(['poster', 'wide', 'hero', 'logo'], {}), NOW)).toBe(true);
  });

  it('is false when every image is cached or was recently found missing', () => {
    expect(isPending(entry(ARTWORK_KINDS as never, {}), NOW)).toBe(false);
    expect(isPending(entry(['poster'], { wide: NOW - 1000, hero: NOW - 1000, logo: NOW - 1000, icon: NOW - 1000 }), NOW)).toBe(false);
  });

  it('is true again once a "missing" answer is older than a week', () => {
    expect(isPending(entry(['poster', 'wide', 'hero', 'logo'], { icon: NOW - MISSING_TTL_MS - 1 }), NOW)).toBe(true);
    expect(isPending(entry(['poster', 'wide', 'hero', 'logo'], { icon: NOW - MISSING_TTL_MS + 1000 }), NOW)).toBe(false);
  });
});

describe('fillCache', () => {
  const base = async () => ({ cacheRoot: await makeTempDir(), title: 'Hades', fetchFn: fakeFetch(images), now: NOW });

  it('downloads every image into the game folder under its kind name, and notes what is missing', async () => {
    const o = await base();
    const outcomes = await fillCache({ ...o, client: client(['poster', 'hero', 'icon']) });
    expect(outcomes.map((x) => [x.kind, x.status])).toEqual([['poster', 'saved'], ['wide', 'missing'], ['hero', 'saved'], ['logo', 'missing'], ['icon', 'saved']]);
    const dir = path.join(o.cacheRoot, cacheKey('Hades') as string);
    expect((await readdir(dir)).sort()).toEqual(['hero.png', 'icon.ico', 'meta.json', 'poster.png']);
    expect(await readFile(path.join(dir, 'poster.png'), 'utf8')).toBe('IMG:https://c/p.png');
    expect(JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'))).toEqual({ title: 'Hades', missing: { wide: NOW, logo: NOW } });
  });

  it('asks for nothing again while the cache is complete and the missing answers are fresh', async () => {
    const o = await base();
    await fillCache({ ...o, client: client(['poster', 'hero', 'icon']) });
    const requests = o.fetchFn.requests.length;
    const again = await fillCache({ ...o, client: { searchGame: async () => { throw new Error('should not ask'); }, findArtworkUrl: async () => undefined } });
    expect(again.map((x) => x.status)).toEqual(['exists', 'missing', 'exists', 'missing', 'exists']);
    expect(o.fetchFn.requests).toHaveLength(requests);
  });

  it('asks again for kinds that were missing a week ago, and forgets them once they turn up', async () => {
    const o = await base();
    await fillCache({ ...o, client: client(['poster']) });
    const later = await fillCache({ ...o, now: NOW + MISSING_TTL_MS + 1, client: client(['poster', 'logo']) });
    expect(later.map((x) => [x.kind, x.status])).toEqual([['poster', 'exists'], ['wide', 'missing'], ['hero', 'missing'], ['logo', 'saved'], ['icon', 'missing']]);
    const meta = JSON.parse(await readFile(path.join(o.cacheRoot, cacheKey('Hades') as string, 'meta.json'), 'utf8'));
    expect(meta.missing.logo).toBeUndefined();
    expect(meta.missing.wide).toBe(NOW + MISSING_TTL_MS + 1);
  });

  it('downloads everything again when forced', async () => {
    const o = await base();
    await fillCache({ ...o, client: client() });
    const dir = path.join(o.cacheRoot, cacheKey('Hades') as string);
    await writeFile(path.join(dir, 'poster.png'), 'OLD');
    const forced = await fillCache({ ...o, force: true, client: client() });
    expect(forced.every((x) => x.status === 'saved')).toBe(true);
    expect(await readFile(path.join(dir, 'poster.png'), 'utf8')).toBe('IMG:https://c/p.png');
  });

  it('does not record failures as missing, so they are retried', async () => {
    const o = await base();
    const failing = { searchGame: async () => { throw new Error('offline'); }, findArtworkUrl: async () => undefined };
    const outcomes = await fillCache({ ...o, client: failing });
    expect(outcomes.every((x) => x.status === 'failed' && x.error === 'offline')).toBe(true);
    const entry = await readCache(o.cacheRoot, 'Hades');
    expect(entry?.missing).toEqual({});
    expect(isPending(entry, NOW)).toBe(true);
  });

  it('records a game SteamGridDB does not know as missing in every kind', async () => {
    const o = await base();
    const outcomes = await fillCache({ ...o, client: client([], false) });
    expect(outcomes.every((x) => x.status === 'missing')).toBe(true);
    expect(isPending(await readCache(o.cacheRoot, 'Hades'), NOW)).toBe(false);
  });

  it('has nothing to do for an untitled game', async () => {
    const o = await base();
    expect((await fillCache({ ...o, title: '???', client: client() })).every((x) => x.status === 'missing')).toBe(true);
    expect(o.fetchFn.requests).toHaveLength(0);
  });
});

describe('copyCachedToGrid', () => {
  async function setup() {
    const root = await makeTempDir();
    const gridDir = path.join(await makeTempDir(), 'grid');
    await put(root, 'Hades', { 'poster.png': 1, 'hero.jpg': 1, 'icon.ico': 1 });
    return { cacheRoot: root, gridDir, title: 'Hades', appId: 42, kinds: ARTWORK_KINDS };
  }

  it('copies the cached images into Steam’s grid folder under the shortcut ID, keeping their extensions', async () => {
    const o = await setup();
    const outcomes = await copyCachedToGrid(o);
    expect(outcomes.map((x) => [x.kind, x.status])).toEqual([['poster', 'saved'], ['wide', 'missing'], ['hero', 'saved'], ['logo', 'missing'], ['icon', 'saved']]);
    expect((await readdir(o.gridDir)).sort()).toEqual(['42_hero.jpg', '42_icon.ico', '42p.png']);
  });

  it('keeps an image Steam already has (whatever its format) unless forced', async () => {
    const o = await setup();
    await mkdir(o.gridDir, { recursive: true });
    await writeFile(path.join(o.gridDir, '42p.jpg'), 'MINE');
    const kept = await copyCachedToGrid({ ...o, kinds: ['poster'] });
    expect(kept).toEqual([{ kind: 'poster', status: 'exists' }]);
    expect(await readdir(o.gridDir)).toEqual(['42p.jpg']);
    const forced = await copyCachedToGrid({ ...o, kinds: ['poster'], force: true });
    expect(forced[0]?.status).toBe('saved');
    expect((await readdir(o.gridDir)).sort()).toEqual(['42p.jpg', '42p.png']);
  });

  it('copies only the kinds asked for', async () => {
    const o = await setup();
    expect((await copyCachedToGrid({ ...o, kinds: ['icon'] })).map((x) => x.kind)).toEqual(['icon']);
    expect(await readdir(o.gridDir)).toEqual(['42_icon.ico']);
  });

  it('reports failed downloads as failures and everything else not cached as missing', async () => {
    const o = await setup();
    const outcomes = await copyCachedToGrid({ ...o, failed: new Map([['logo', 'HTTP 500'], ['poster', 'ignored: it is cached']]) });
    expect(outcomes.find((x) => x.kind === 'logo')).toEqual({ kind: 'logo', status: 'failed', error: 'HTTP 500' });
    expect(outcomes.find((x) => x.kind === 'poster')?.status).toBe('saved');
    expect(outcomes.find((x) => x.kind === 'wide')?.status).toBe('missing');
  });

  it('reports missing for an untitled game and for a game that was never cached', async () => {
    const o = await setup();
    expect((await copyCachedToGrid({ ...o, title: '???' })).every((x) => x.status === 'missing')).toBe(true);
    expect((await copyCachedToGrid({ ...o, title: 'Never Cached' })).every((x) => x.status === 'missing')).toBe(true);
    await expect(stat(o.gridDir)).rejects.toThrow();
  });
});

describe('readCachedArtwork', () => {
  it('serves a cached image with its content type', async () => {
    const root = await makeTempDir();
    const dir = await put(root, 'Hades', { 'poster.png': 1, 'hero.JPG': 1 });
    const key = path.basename(dir);
    expect(await readCachedArtwork(root, key, 'poster.png')).toMatchObject({ status: 200, contentType: 'image/png' });
    expect(await readCachedArtwork(root, key, 'hero.JPG')).toMatchObject({ status: 200, contentType: 'image/jpeg' });
  });

  it('refuses anything that is not a cache folder name and an image name, and says when it is not there', async () => {
    const root = await makeTempDir();
    const key = path.basename(await put(root, 'Hades', { 'poster.png': 1 }));
    for (const [dir, file] of [['..', 'poster.png'], [`../${key}`, 'poster.png'], [key, '../meta.json'], [key, 'meta.json'], [key, 'poster.gif'], ['x', 'poster.png'], ['', 'poster.png'], [key, '']]) {
      expect(await readCachedArtwork(root, dir as string, file as string)).toEqual({ status: 400 });
    }
    expect(await readCachedArtwork(root, key, 'logo.png')).toEqual({ status: 404 });
  });
});

describe('helpers', () => {
  it('puts the cache in a folder of its own inside the config folder', () => {
    expect(artworkCacheDir('/c/steam-manager')).toBe(path.join('/c/steam-manager', 'artwork-cache'));
  });

  it('builds cache URLs with the folder encoded, and knows content types', () => {
    expect(cacheArtworkUrl('hades-1234abcd', 'poster.png', 9)).toBe('steam-manager-art://cache/hades-1234abcd/poster.png?v=9');
    expect(cacheArtworkUrl('游戏-1234abcd', 'hero.jpg', 1)).toBe(`steam-manager-art://cache/${encodeURIComponent('游戏-1234abcd')}/hero.jpg?v=1`);
    expect([mimeOf('.PNG'), mimeOf('jpeg'), mimeOf('.webp'), mimeOf('ico')]).toEqual(['image/png', 'image/jpeg', 'image/webp', 'image/x-icon']);
  });
});
