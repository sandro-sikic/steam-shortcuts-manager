import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { listDir } from '../integrations/shared/fs.js';
import { ARTWORK_KINDS, ARTWORK_SUFFIXES, type ArtworkKind } from './kinds.js';

/** The URL scheme the desktop app serves grid images from, so the page never touches the file system. */
export const ARTWORK_SCHEME = 'steam-manager-art';

const FILE = /^(\d+)(p|_hero|_logo|_icon)?\.(png|jpe?g|webp|ico)$/i;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

/** The content type for a file extension, with or without the dot. */
export function mimeOf(extension: string): string {
  return MIME[extension.replace(/^\./, '').toLowerCase()] as string;
}

const KIND_BY_SUFFIX = new Map(ARTWORK_KINDS.map((kind) => [ARTWORK_SUFFIXES[kind], kind]));

export interface ArtworkFile {
  appId: number;
  kind: ArtworkKind;
  file: string;
  /** Modification time, so a re-downloaded image is not shown from cache. */
  version: number;
}

/** Reads a grid file name like `123p.png` into the shortcut ID and kind it belongs to. */
export function parseArtworkFile(name: string): { appId: number; kind: ArtworkKind } | undefined {
  const match = FILE.exec(name);
  if (!match) return undefined;
  return { appId: Number(match[1]), kind: KIND_BY_SUFFIX.get((match[2] ?? '').toLowerCase()) as ArtworkKind };
}

/** The images in Steam's grid folder for the given shortcuts (the newest file when a kind has several). */
export async function listArtwork(gridDir: string, appIds: ReadonlySet<number>): Promise<ArtworkFile[]> {
  const newest = new Map<string, ArtworkFile>();
  for (const file of await listDir(gridDir)) {
    const parsed = parseArtworkFile(file);
    if (!parsed || !appIds.has(parsed.appId)) continue;
    const version = Math.round((await stat(path.join(gridDir, file))).mtimeMs);
    const key = `${parsed.appId}:${parsed.kind}`;
    if (version >= (newest.get(key)?.version ?? 0)) newest.set(key, { ...parsed, file, version });
  }
  return [...newest.values()];
}

export function artworkUrl(file: string, version: number): string {
  return `${ARTWORK_SCHEME}://grid/${file}?v=${version}`;
}

/** The URL of an image in the app's own artwork cache. */
export function cacheArtworkUrl(key: string, file: string, version: number): string {
  return `${ARTWORK_SCHEME}://cache/${encodeURIComponent(key)}/${file}?v=${version}`;
}

export type ArtworkResponse = { status: 200; contentType: string; data: Buffer } | { status: 400 | 404 };

/** Reads one grid image by file name. Only names that look like grid images are accepted (no paths). */
export async function readArtworkFile(gridDir: string, name: string): Promise<ArtworkResponse> {
  if (!parseArtworkFile(name)) return { status: 400 };
  try {
    const data = await readFile(path.join(gridDir, name));
    return { status: 200, contentType: mimeOf(path.extname(name)), data };
  } catch {
    return { status: 404 };
  }
}
