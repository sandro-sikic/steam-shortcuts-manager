import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ARTWORK_KINDS, installArtwork } from '../src/artwork/install.js';
import { SteamGridDbClient } from '../src/artwork/steamgriddb.js';
import { isTagged } from '../src/artwork/tag.js';
import { cleanupTempDirs, fakeFetch, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

const API = 'https://www.steamgriddb.com/api/v2';
const ok = (data: unknown) => ({ json: { success: true, data } });

describe('SteamGridDbClient', () => {
  it('searches games with the bearer token and URL-encoded title', async () => {
    const fetchFn = fakeFetch({ [`${API}/search/autocomplete/Half%20Life%3A%202`]: ok([{ id: 7, name: 'Half Life: 2' }, { id: 8, name: 'Half Life: 2 Mod' }]) });
    const client = new SteamGridDbClient('key', fetchFn);
    expect(await client.searchGame('Half Life: 2')).toBe(7);
    expect(fetchFn.requests[0]?.auth).toBe('Bearer key');
  });

  it('accepts only the game with exactly this title, whatever its position in the results', async () => {
    const results = ok([{ id: 1, name: "Hades' Star" }, { id: 2, name: 'HADES™' }, { id: 3, name: 'Hades' }]);
    expect(await new SteamGridDbClient('k', fakeFetch({ [`${API}/search/autocomplete/Hades`]: results })).searchGame('Hades')).toBe(2);
    const spider = ok([{ id: 9, name: 'Marvel’s Spider-Man Remastered' }]);
    expect(await new SteamGridDbClient('k', fakeFetch({ [`${API}/search/autocomplete/Marvel's%20Spider-Man%3A%20Remastered`]: spider })).searchGame("Marvel's Spider-Man: Remastered")).toBe(9);
  });

  it('treats Roman numerals II to IX like digits, but not I, V or X', async () => {
    const find = async (query: string, name: string) =>
      new SteamGridDbClient('k', fakeFetch({ [`${API}/search/autocomplete/${encodeURIComponent(query)}`]: ok([{ id: 1, name }]) })).searchGame(query);
    expect(await find('Red Dead Redemption 2', 'Red Dead Redemption II')).toBe(1);
    expect(await find('Doom II', 'Doom 2')).toBe(1);
    expect(await find('Final Fantasy VII', 'Final Fantasy 7')).toBe(1);
    expect(await find('Final Fantasy IV', 'FINAL FANTASY 4')).toBe(1);
    expect(await find('Sid Meier’s Civilization VI', 'Sid Meier\'s Civilization 6')).toBe(1);
    expect(await find('Mega Man X', 'Mega Man 10')).toBeUndefined();
    expect(await find('Fallout V', 'Fallout 5')).toBeUndefined();
    expect(await find('Grand Theft Auto I', 'Grand Theft Auto 1')).toBeUndefined();
  });

  it('does not take a near miss: the search always returns something, even for games it does not have', async () => {
    const fuzzy = { [`${API}/search/autocomplete/Some%20Obscure%20Game`]: ok([{ id: 4, name: 'Some Distant Memory' }, { id: 5, name: 'Some Like It Hot' }]) };
    expect(await new SteamGridDbClient('k', fakeFetch(fuzzy)).searchGame('Some Obscure Game')).toBeUndefined();
  });

  it('queries each artwork kind with the right endpoint and dimensions', async () => {
    const routes = {
      [`${API}/grids/game/1?dimensions=600x900&types=static`]: ok([{ url: 'https://c/poster.png' }]),
      [`${API}/grids/game/1?dimensions=920x430,460x215&types=static`]: ok([{ url: 'https://c/wide.png' }]),
      [`${API}/heroes/game/1?types=static`]: ok([{ url: 'https://c/hero.png' }]),
      [`${API}/logos/game/1?types=static`]: ok([{ url: 'https://c/logo.png' }]),
      [`${API}/icons/game/1?types=static`]: ok([{ url: 'https://c/icon.png' }]),
    };
    const client = new SteamGridDbClient('k', fakeFetch(routes));
    const urls = await Promise.all(ARTWORK_KINDS.map((kind) => client.findArtworkUrl(1, kind)));
    expect(urls).toEqual(['https://c/poster.png', 'https://c/wide.png', 'https://c/hero.png', 'https://c/logo.png', 'https://c/icon.png']);
  });

  it('reports HTTP and API failures', async () => {
    const client = new SteamGridDbClient('k', fakeFetch({ [`${API}/search/autocomplete/a`]: { status: 401 }, [`${API}/search/autocomplete/b`]: { json: { success: false } } }));
    await expect(client.searchGame('a')).rejects.toThrow('HTTP 401');
    await expect(client.searchGame('b')).rejects.toThrow('not successful');
  });
});

describe('installArtwork', () => {
  const image = Buffer.from('IMG');
  const base = {
    poster: 'https://c/p.png',
    wide: 'https://c/w.jpg',
    hero: 'https://c/h.png?x=1',
    logo: 'https://c/l', // no extension -> .png
    icon: 'https://c/i.png',
  };
  const stubClient = (urls: Partial<Record<string, string>>, gameId: number | null = 5) => ({
    searchGame: async () => gameId ?? undefined,
    findArtworkUrl: async (_id: number, kind: string) => urls[kind],
  });
  const images = Object.fromEntries(Object.values(base).map((url) => [url, { body: image }]));

  it('downloads every kind into the grid folder with Steam file names', async () => {
    const gridDir = path.join(await makeTempDir(), 'grid');
    const outcomes = await installArtwork({ gridDir, appId: 42, title: 'T', client: stubClient(base), fetchFn: fakeFetch(images) });
    expect(outcomes.map((o) => o.status)).toEqual(['saved', 'saved', 'saved', 'saved', 'saved']);
    expect((await readdir(gridDir)).sort()).toEqual(['42.jpg', '42_hero.png', '42_icon.png', '42_logo.png', '42p.png']);
    const saved = await readFile(path.join(gridDir, '42p.png'));
    expect(saved.subarray(0, image.length)).toEqual(image);
    expect(isTagged(saved)).toBe(true);
  });

  it('skips files that already exist unless forced', async () => {
    const gridDir = await makeTempDir();
    await writeFile(path.join(gridDir, '42p.png'), 'old');
    const fetchFn = fakeFetch(images);
    const urls = { poster: base.poster };

    const skipped = await installArtwork({ gridDir, appId: 42, title: 'T', client: stubClient(urls), fetchFn });
    expect(skipped[0]).toMatchObject({ kind: 'poster', status: 'exists' });
    expect(await readFile(path.join(gridDir, '42p.png'), 'utf8')).toBe('old');
    expect(fetchFn.requests).toHaveLength(0);

    const forced = await installArtwork({ gridDir, appId: 42, title: 'T', client: stubClient(urls), fetchFn, force: true });
    expect(forced[0]).toMatchObject({ status: 'saved' });
    const saved = await readFile(path.join(gridDir, '42p.png'));
    expect(saved.subarray(0, image.length)).toEqual(image);
    expect(isTagged(saved)).toBe(true);
  });

  it('reports kinds SteamGridDB has no image for', async () => {
    const outcomes = await installArtwork({ gridDir: await makeTempDir(), appId: 1, title: 'T', client: stubClient({ hero: base.hero }), fetchFn: fakeFetch(images) });
    expect(outcomes.map((o) => o.status)).toEqual(['missing', 'missing', 'saved', 'missing', 'missing']);
  });

  it('downloads only the chosen kinds', async () => {
    const gridDir = await makeTempDir();
    const fetchFn = fakeFetch(images);
    const outcomes = await installArtwork({ gridDir, appId: 9, title: 'T', client: stubClient(base), fetchFn, kinds: ['hero', 'icon'] });
    expect(outcomes.map((o) => o.kind)).toEqual(['hero', 'icon']);
    expect((await readdir(gridDir)).sort()).toEqual(['9_hero.png', '9_icon.png']);
    expect(fetchFn.requests).toHaveLength(2);
  });

  it('reports only the chosen kinds as missing or failed', async () => {
    const missing = await installArtwork({ gridDir: await makeTempDir(), appId: 1, title: 'T', client: stubClient({}, null), fetchFn: fakeFetch({}), kinds: ['logo'] });
    expect(missing).toEqual([{ kind: 'logo', status: 'missing' }]);
    const client = { searchGame: async () => { throw new Error('boom'); }, findArtworkUrl: async () => undefined };
    const failed = await installArtwork({ gridDir: await makeTempDir(), appId: 1, title: 'T', client, fetchFn: fakeFetch({}), kinds: [] });
    expect(failed).toEqual([]);
  });

  it('reports every kind missing when the game is unknown, without creating the folder', async () => {
    const gridDir = path.join(await makeTempDir(), 'grid');
    const outcomes = await installArtwork({ gridDir, appId: 1, title: 'T', client: stubClient({}, null), fetchFn: fakeFetch({}) });
    expect(outcomes.every((o) => o.status === 'missing')).toBe(true);
    await expect(readdir(gridDir)).rejects.toThrow();
  });

  it('reports a failed search for every kind', async () => {
    const client = { searchGame: async () => { throw new Error('boom'); }, findArtworkUrl: async () => undefined };
    const outcomes = await installArtwork({ gridDir: await makeTempDir(), appId: 1, title: 'T', client, fetchFn: fakeFetch({}) });
    expect(outcomes.every((o) => o.status === 'failed' && o.error === 'boom')).toBe(true);
  });

  it('isolates failed downloads and lookups to the image concerned', async () => {
    const gridDir = await makeTempDir();
    const client = {
      searchGame: async () => 5,
      findArtworkUrl: async (_id: number, kind: string) => {
        if (kind === 'logo') throw new Error('lookup failed');
        return kind === 'poster' ? base.poster : kind === 'hero' ? base.hero : undefined;
      },
    };
    const fetchFn = fakeFetch({ [base.hero]: { body: image } }); // poster URL -> 404
    const outcomes = await installArtwork({ gridDir, appId: 1, title: 'T', client, fetchFn });
    expect(outcomes.map((o) => o.status)).toEqual(['failed', 'missing', 'saved', 'failed', 'missing']);
    expect(outcomes[0]?.error).toContain('HTTP 404');
    expect(outcomes[3]?.error).toBe('lookup failed');
  });

  it('works when the grid folder already exists', async () => {
    const gridDir = path.join(await makeTempDir(), 'grid');
    await mkdir(gridDir);
    const outcomes = await installArtwork({ gridDir, appId: 1, title: 'T', client: stubClient({ icon: base.icon }), fetchFn: fakeFetch(images) });
    expect(outcomes[4]?.status).toBe('saved');
  });
});
