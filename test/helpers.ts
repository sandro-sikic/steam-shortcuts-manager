import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
