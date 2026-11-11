import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SteamGridDbClient } from '../src/artwork/steamgriddb.js';
import { cleanupTempDirs, fakeFetch, fullUrl, sgdbImage, sgdbList, sgdbRoutes, thumbUrl } from './helpers.js';

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

  it('lists the images of each type with the right endpoint, dimensions and adult filter', async () => {
    const fetchFn = fakeFetch(sgdbRoutes({ title: 'x', gameId: 7, counts: { poster: 2, wide: 1, hero: 4, logo: 0, icon: 3 } }));
    const client = new SteamGridDbClient('k', fetchFn);
    const counts = await Promise.all(['poster', 'wide', 'hero', 'logo', 'icon'].map(async (kind) => (await client.findArtwork(7, kind as never, { limit: 20, nsfw: false })).length));
    expect(counts).toEqual([2, 1, 4, 0, 3]);
    expect(fetchFn.requests.map((r) => r.url)).toEqual([
      sgdbList('poster', 7), sgdbList('wide', 7), sgdbList('hero', 7), sgdbList('logo', 7), sgdbList('icon', 7),
    ]);
    expect(sgdbList('wide', 7)).toBe(`${API}/grids/game/7?dimensions=920x430,460x215&types=static&nsfw=false`);
  });

  it('reads what each result says about itself', async () => {
    const data = [sgdbImage('hero', 0, { width: 1920, height: 620, style: 'material', mime: 'image/jpeg', nsfw: true }), sgdbImage('hero', 1)];
    const client = new SteamGridDbClient('k', fakeFetch({ [sgdbList('hero', 1)]: ok(data) }));
    expect(await client.findArtwork(1, 'hero', { limit: 5, nsfw: false })).toEqual([
      { id: 3000, url: fullUrl('hero', 0), thumb: thumbUrl('hero', 0), width: 1920, height: 620, mime: 'image/jpeg', style: 'material', nsfw: true },
      { id: 3001, url: fullUrl('hero', 1), thumb: thumbUrl('hero', 1), width: 600, height: 900, mime: 'image/png', style: 'alternate', nsfw: false },
    ]);
  });

  it('treats a result without an adult flag as not adult', async () => {
    const { nsfw: _dropped, ...withoutFlag } = sgdbImage('logo', 0);
    const client = new SteamGridDbClient('k', fakeFetch({ [sgdbList('logo', 1)]: ok([withoutFlag]) }));
    expect((await client.findArtwork(1, 'logo', { limit: 5, nsfw: false }))[0]?.nsfw).toBe(false);
  });

  it('returns only as many as asked for, and asks to include adult images only when allowed', async () => {
    const fetchFn = fakeFetch({ [sgdbList('poster', 1, true)]: ok(Array.from({ length: 10 }, (_, i) => sgdbImage('poster', i))) });
    const client = new SteamGridDbClient('k', fetchFn);
    expect(await client.findArtwork(1, 'poster', { limit: 3, nsfw: true })).toHaveLength(3);
    expect(fetchFn.requests[0]?.url).toBe(`${API}/grids/game/1?dimensions=600x900&types=static&nsfw=any`);
  });

  it('reports HTTP and API failures', async () => {
    const client = new SteamGridDbClient('k', fakeFetch({ [`${API}/search/autocomplete/a`]: { status: 401 }, [`${API}/search/autocomplete/b`]: { json: { success: false } } }));
    await expect(client.searchGame('a')).rejects.toThrow('HTTP 401');
    await expect(client.searchGame('b')).rejects.toThrow('not successful');
  });
});
