import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { artworkUrl, ARTWORK_SCHEME, listArtwork, parseArtworkFile, readArtworkFile } from '../src/artwork/files.js';
import { cleanupTempDirs, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

describe('parseArtworkFile', () => {
  it.each([
    ['123.png', 123, 'wide'],
    ['123p.jpg', 123, 'poster'],
    ['123_hero.webp', 123, 'hero'],
    ['123_logo.PNG', 123, 'logo'],
    ['3615746838_icon.ico', 3615746838, 'icon'],
    ['123p.jpeg', 123, 'poster'],
  ])('reads %s', (name, appId, kind) => {
    expect(parseArtworkFile(name)).toEqual({ appId, kind });
  });

  it.each(['../123p.png', 'abc.png', '123x.png', '123p.gif', '123p.png.bak', '123_hero', 'p.png', '/etc/passwd', '123p.png/../x'])('rejects %s', (name) => {
    expect(parseArtworkFile(name)).toBeUndefined();
  });
});

describe('listArtwork', () => {
  async function grid(files: Record<string, number | undefined>): Promise<string> {
    const dir = path.join(await makeTempDir(), 'grid');
    await mkdir(dir);
    for (const [name, time] of Object.entries(files)) {
      await writeFile(path.join(dir, name), 'x');
      if (time !== undefined) await utimes(dir + path.sep + name, time, time);
    }
    return dir;
  }

  it('lists the images of the requested shortcuts only, ignoring other files', async () => {
    const dir = await grid({ '1p.png': 100, '1_hero.jpg': 100, '2p.png': 100, '3p.png': 100, 'notes.txt': 100, '1p.gif': 100 });
    const found = await listArtwork(dir, new Set([1, 2]));
    expect(found.map((f) => [f.appId, f.kind, f.file]).sort()).toEqual([[1, 'hero', '1_hero.jpg'], [1, 'poster', '1p.png'], [2, 'poster', '2p.png']]);
    expect(found[0]?.version).toBe(100_000);
  });

  it('keeps the newest file when a kind has several', async () => {
    const dir = await grid({ '1p.png': 100, '1p.jpg': 300, '1p.webp': 200 });
    expect((await listArtwork(dir, new Set([1]))).map((f) => f.file)).toEqual(['1p.jpg']);
  });

  it('is empty for a missing folder or no wanted shortcuts', async () => {
    expect(await listArtwork(path.join(await makeTempDir(), 'missing'), new Set([1]))).toEqual([]);
    expect(await listArtwork(await grid({ '1p.png': 1 }), new Set())).toEqual([]);
  });
});

describe('artworkUrl', () => {
  it('uses the app scheme and the file version, so changed images are not shown from cache', () => {
    expect(artworkUrl('1p.png', 123)).toBe(`${ARTWORK_SCHEME}://grid/1p.png?v=123`);
  });
});

describe('readArtworkFile', () => {
  it('returns the bytes with the right content type', async () => {
    const dir = await makeTempDir();
    for (const [name, type] of [['1p.png', 'image/png'], ['1_hero.JPG', 'image/jpeg'], ['1_logo.jpeg', 'image/jpeg'], ['1.webp', 'image/webp'], ['1_icon.ico', 'image/x-icon']] as const) {
      await writeFile(path.join(dir, name), 'DATA');
      const result = await readArtworkFile(dir, name);
      expect(result).toMatchObject({ status: 200, contentType: type });
      expect((result as { data: Buffer }).data.toString()).toBe('DATA');
    }
  });

  it('refuses names that are not grid images, including paths', async () => {
    const dir = await makeTempDir();
    for (const name of ['../secret.png', 'a/1p.png', '1p.png/../../x', 'notes.txt', '']) {
      expect(await readArtworkFile(dir, name)).toEqual({ status: 400 });
    }
  });

  it('says when the image does not exist', async () => {
    expect(await readArtworkFile(await makeTempDir(), '9p.png')).toEqual({ status: 404 });
  });
});
