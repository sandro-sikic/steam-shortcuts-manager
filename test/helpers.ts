import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FetchLike, FetchResponse } from '../src/artwork/steamgriddb.js';

const tempDirs: string[] = [];

export async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'steam-manager-test-'));
  tempDirs.push(dir);
  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

/** Builds a minimal fake Steam installation: `<root>/userdata/<id>/config` for each account. */
export async function makeSteamRoot(accountIds: string[], loginUsers?: string): Promise<string> {
  const root = await makeTempDir();
  await mkdir(path.join(root, 'userdata'), { recursive: true });
  for (const id of accountIds) await mkdir(path.join(root, 'userdata', id, 'config'), { recursive: true });
  if (loginUsers !== undefined) {
    await mkdir(path.join(root, 'config'), { recursive: true });
    await writeFile(path.join(root, 'config', 'loginusers.vdf'), loginUsers);
  }
  return root;
}

/** loginusers.vdf in which the given SteamID64 is the most recent user. */
export function loginUsersVdf(mostRecentSteamId: string, otherSteamId = '76561190000000001'): string {
  return `"users"
{
\t"${otherSteamId}"
\t{
\t\t"AccountName"\t\t"other"
\t\t"MostRecent"\t\t"0"
\t}
\t"${mostRecentSteamId}"
\t{
\t\t"AccountName"\t\t"me"
\t\t"MostRecent"\t\t"1"
\t}
}
`;
}

export interface FakeResponse {
  status?: number;
  json?: unknown;
  body?: Buffer;
}

/** A fetch stand-in serving canned responses by URL; unknown URLs answer 404. Records requests. */
export function fakeFetch(routes: Record<string, FakeResponse>): FetchLike & { requests: { url: string; auth?: string }[] } {
  const requests: { url: string; auth?: string }[] = [];
  const fn = (async (url: string, init?: { headers?: Record<string, string> }): Promise<FetchResponse> => {
    requests.push({ url, auth: init?.headers?.['Authorization'] });
    const route = routes[url];
    const status = route?.status ?? (route ? 200 : 404);
    const body = route?.body ?? Buffer.alloc(0);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route?.json,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    };
  }) as FetchLike & { requests: { url: string; auth?: string }[] };
  fn.requests = requests;
  return fn;
}

/** A fake Linux desktop with a few .desktop files, wired into env so the OS scan sees only them. */
export async function desktopEnv(entries: Record<string, string>): Promise<NodeJS.ProcessEnv> {
  const data = await makeTempDir();
  const bin = await makeTempDir();
  await mkdir(path.join(data, 'applications'));
  for (const [name, categories] of Object.entries(entries)) {
    const exe = path.join(bin, name.replace(/\W/g, ''));
    await writeFile(exe, '#!/bin/sh\n');
    await chmod(exe, 0o755);
    const body = `[Desktop Entry]\nType=Application\nName=${name}\nExec=${exe}\nCategories=${categories}\n`;
    await writeFile(path.join(data, 'applications', `${name.replace(/\W/g, '')}.desktop`), body);
  }
  return { XDG_DATA_HOME: data, XDG_DATA_DIRS: data, PATH: bin };
}


// ---- a fake SteamGridDB -----------------------------------------------------------------------------------------

export const SGDB = 'https://www.steamgriddb.com/api/v2';

const LIST_PATHS = {
  poster: 'grids/game/{id}?dimensions=600x900&types=static',
  wide: 'grids/game/{id}?dimensions=920x430,460x215&types=static',
  hero: 'heroes/game/{id}?types=static',
  logo: 'logos/game/{id}?types=static',
  icon: 'icons/game/{id}?types=static',
} as const;

type Kind = keyof typeof LIST_PATHS;

/** The ids of fake images: 1000.. for posters, 2000.. wide, 3000.. hero, 4000.. logo, 5000.. icon. */
export const IMAGE_BASE: Record<Kind, number> = { poster: 1000, wide: 2000, hero: 3000, logo: 4000, icon: 5000 };

export const sgdbSearch = (title: string): string => `${SGDB}/search/autocomplete/${encodeURIComponent(title)}`;
export const sgdbList = (kind: Kind, gameId: number, nsfw = false): string =>
  `${SGDB}/${LIST_PATHS[kind].replace('{id}', String(gameId))}&nsfw=${nsfw ? 'any' : 'false'}`;
export const fullUrl = (kind: Kind, index: number): string => `https://img.test/full/${IMAGE_BASE[kind] + index}.${kind === 'icon' ? 'ico' : kind === 'wide' ? 'jpg' : 'png'}`;
export const thumbUrl = (kind: Kind, index: number): string => `https://img.test/thumb/${IMAGE_BASE[kind] + index}.jpg`;

/** What SteamGridDB returns for one image. */
export function sgdbImage(kind: Kind, index: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: IMAGE_BASE[kind] + index,
    url: fullUrl(kind, index),
    thumb: thumbUrl(kind, index),
    width: 600,
    height: 900,
    mime: 'image/png',
    style: 'alternate',
    nsfw: false,
    ...over,
  };
}

/**
 * Routes for a game SteamGridDB knows: the search, a list of `counts[kind]` images (3 by default) per image type,
 * and every image and preview, whose bytes are `IMG:<url>`.
 */
export function sgdbRoutes(options: { title: string; gameId?: number; counts?: Partial<Record<Kind, number>>; nsfw?: boolean; extra?: Record<string, FakeResponse> }): Record<string, FakeResponse> {
  const { title, gameId = 1, counts = {}, nsfw = false, extra = {} } = options;
  const routes: Record<string, FakeResponse> = { [sgdbSearch(title)]: { json: { success: true, data: [{ id: gameId, name: title }] } } };
  for (const kind of Object.keys(LIST_PATHS) as Kind[]) {
    const count = counts[kind] ?? 3;
    routes[sgdbList(kind, gameId, nsfw)] = { json: { success: true, data: Array.from({ length: count }, (_, index) => sgdbImage(kind, index)) } };
    for (let index = 0; index < count; index++) {
      for (const url of [fullUrl(kind, index), thumbUrl(kind, index)]) routes[url] = { body: Buffer.from(`IMG:${url}`) };
    }
  }
  return { ...routes, ...extra };
}
