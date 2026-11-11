import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listInstalledSteamTitles } from '../src/steam/library.js';
import { cleanupTempDirs, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

const manifest = (name: string) => `"AppState"\n{\n\t"appid"\t"1"\n\t"name"\t"${name}"\n}\n`;

async function addManifest(library: string, file: string, content: string): Promise<void> {
  const apps = path.join(library, 'steamapps');
  await mkdir(apps, { recursive: true });
  await writeFile(path.join(apps, file), content);
}

describe('listInstalledSteamTitles', () => {
  it('finds titles in the main library and every extra library folder', async () => {
    const root = await makeTempDir();
    const extra = await makeTempDir();
    await addManifest(root, 'appmanifest_10.acf', manifest('Portal 2'));
    await addManifest(extra, 'appmanifest_20.acf', manifest('Hades'));
    await writeFile(
      path.join(root, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"\n{\n\t"0" { "path" "${root.replace(/\\/g, '\\\\')}" }\n\t"1" { "path" "${extra.replace(/\\/g, '\\\\')}" }\n}\n`,
    );
    expect((await listInstalledSteamTitles(root)).sort()).toEqual(['Hades', 'Portal 2']);
  });

  it('ignores non-manifest files, manifests without a name and unreadable VDF', async () => {
    const root = await makeTempDir();
    await addManifest(root, 'appmanifest_1.acf', manifest('Good'));
    await addManifest(root, 'appmanifest_2.acf', '"AppState" { "appid" "2" }');
    await addManifest(root, 'appmanifest_3.acf', '"AppState" { "name" "" }');
    await addManifest(root, 'appmanifest_4.acf', '"AppState" { "name" ');
    await addManifest(root, 'appmanifest_5.acf', '"AppState" "oops"');
    await addManifest(root, 'notes.txt', 'hi');
    await mkdir(path.join(root, 'steamapps', 'appmanifest_6.acf'));
    expect(await listInstalledSteamTitles(root)).toEqual(['Good']);
  });

  it('tolerates a missing library, a broken libraryfolders.vdf and odd entries', async () => {
    expect(await listInstalledSteamTitles(await makeTempDir())).toEqual([]);

    const root = await makeTempDir();
    await addManifest(root, 'libraryfolders.vdf', '"libraryfolders" {');
    expect(await listInstalledSteamTitles(root)).toEqual([]);

    await addManifest(root, 'libraryfolders.vdf', `"libraryfolders" { "0" "text" "1" { "path" { } } "2" { "path" "${root.replace(/\\/g, '\\\\')}" } }`);
    expect(await listInstalledSteamTitles(root)).toEqual([]);

    await addManifest(root, 'libraryfolders.vdf', '"other" { }');
    expect(await listInstalledSteamTitles(root)).toEqual([]);
  });
});
