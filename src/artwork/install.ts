import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTWORK_KINDS, ARTWORK_SUFFIXES as SUFFIXES, type ArtworkKind } from './kinds.js';
import type { FetchLike, SteamGridDbClient } from './steamgriddb.js';

export { ARTWORK_KINDS };

export type ArtworkStatus = 'saved' | 'exists' | 'missing' | 'failed';

export interface ArtworkOutcome {
  kind: ArtworkKind;
  status: ArtworkStatus;
  file?: string;
  error?: string;
}

export interface InstallArtworkOptions {
  gridDir: string;
  appId: number;
  title: string;
  client: Pick<SteamGridDbClient, 'searchGame' | 'findArtworkUrl'>;
  fetchFn: FetchLike;
  /** Re-download images even if the file already exists. */
  force?: boolean;
  /** Which kinds to download; all when omitted. */
  kinds?: readonly ArtworkKind[];
}

function extensionOf(url: string): string {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  return ext === '' ? '.png' : ext;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads poster, wide capsule, hero, logo and icon for a game into Steam's grid folder.
 * Failures are reported per image rather than thrown, so one bad download never aborts a sync.
 */
export async function installArtwork(options: InstallArtworkOptions): Promise<ArtworkOutcome[]> {
  const { gridDir, appId, title, client, fetchFn, force = false, kinds = ARTWORK_KINDS } = options;
  let gameId: number | undefined;
  try {
    gameId = await client.searchGame(title);
  } catch (error) {
    const message = (error as Error).message;
    return kinds.map((kind) => ({ kind, status: 'failed', error: message }));
  }
  if (gameId === undefined) return kinds.map((kind) => ({ kind, status: 'missing' }));

  await mkdir(gridDir, { recursive: true });
  const outcomes: ArtworkOutcome[] = [];
  for (const kind of kinds) {
    try {
      const url = await client.findArtworkUrl(gameId, kind);
      if (url === undefined) {
        outcomes.push({ kind, status: 'missing' });
        continue;
      }
      const file = path.join(gridDir, `${appId}${SUFFIXES[kind]}${extensionOf(url)}`);
      if (!force && (await exists(file))) {
        outcomes.push({ kind, status: 'exists', file });
        continue;
      }
      const response = await fetchFn(url);
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      outcomes.push({ kind, status: 'saved', file });
    } catch (error) {
      outcomes.push({ kind, status: 'failed', error: (error as Error).message });
    }
  }
  return outcomes;
}
