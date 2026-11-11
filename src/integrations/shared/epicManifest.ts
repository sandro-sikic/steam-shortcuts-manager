import { inflateSync } from 'node:zlib';

/** What the Epic Games Launcher keeps in `<game>/.egstore/*.manifest` that we need. */
export interface EpicManifest {
  /** Epic's internal app name (the id used in launcher links). */
  appName: string;
  /** The game's executable, relative to its install folder; '' for redistributables. */
  launchExe: string;
}

const MAGIC = 0x44bec00c;
const HEADER_SIZE_AT = 4;
const STORED_AT = 36;

class Reader {
  position = 0;
  constructor(private readonly data: Buffer) {}

  private take(length: number): Buffer {
    if (length < 0 || this.position + length > this.data.length) throw new RangeError('manifest is truncated');
    const slice = this.data.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }

  u8(): number {
    return (this.take(1)[0] as number);
  }

  u32(): number {
    return this.take(4).readUInt32LE(0);
  }

  i32(): number {
    return this.take(4).readInt32LE(0);
  }

  /** A string stored as a length, then the characters and a terminator; a negative length means UTF-16. */
  string(): string {
    const length = this.i32();
    if (length === 0) return '';
    if (length < 0) return this.take(-length * 2).toString('utf16le').replace(/\0+$/, '');
    return this.take(length).toString('utf8').replace(/\0+$/, '');
  }
}

/** Older launchers wrote the manifest as JSON. */
function parseJson(text: string): EpicManifest | undefined {
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>;
    const appName = manifest['AppNameString'];
    const launchExe = manifest['LaunchExeString'];
    return typeof appName === 'string' && appName !== '' ? { appName, launchExe: typeof launchExe === 'string' ? launchExe : '' } : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the app name and launch executable from an Epic manifest, binary or JSON; undefined if it is neither. */
export function parseEpicManifest(data: Buffer | undefined): EpicManifest | undefined {
  if (data === undefined) return undefined;
  if (data[0] === 0x7b || data.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return parseJson(data.toString('utf8').replace(/^﻿/, ''));
  try {
    if (data.length < 41 || data.readUInt32LE(0) !== MAGIC) return undefined;
    const body = data.subarray(data.readUInt32LE(HEADER_SIZE_AT));
    const reader = new Reader((data[STORED_AT] as number) & 1 ? inflateSync(body) : body);
    reader.u32(); // size of the meta block
    reader.u8(); // data version
    reader.i32(); // feature level
    reader.u8(); // whether the build is file data
    reader.i32(); // app id
    const appName = reader.string();
    reader.string(); // build version
    const launchExe = reader.string();
    return appName === '' ? undefined : { appName, launchExe };
  } catch {
    return undefined;
  }
}

/** A catalog entry from `Data/Catalog/catcache.bin` (base64 of a JSON list of items). */
export interface CatalogItem {
  title: string;
  namespace: string;
  id: string;
}

export interface Catalog {
  byAppName: Map<string, CatalogItem>;
  byFolder: Map<string, CatalogItem>;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

/** Indexes the launcher's catalog by app name and by install folder name; empty when it cannot be read. */
export function parseCatalog(data: Buffer | undefined): Catalog {
  const catalog: Catalog = { byAppName: new Map(), byFolder: new Map() };
  let items: unknown;
  try {
    items = JSON.parse(Buffer.from(data?.toString('latin1') ?? '', 'base64').toString('utf8'));
  } catch {
    return catalog;
  }
  if (!Array.isArray(items)) return catalog;
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const entry = { title: text(item['title']), namespace: text(item['namespace']), id: text(item['id']) };
    if (entry.title === undefined || entry.namespace === undefined || entry.id === undefined) continue;
    const found: CatalogItem = { title: entry.title, namespace: entry.namespace, id: entry.id };
    const releases = Array.isArray(item['releaseInfo']) ? (item['releaseInfo'] as unknown[]) : [];
    for (const release of releases) {
      const appId = text((release as Record<string, unknown> | null)?.['appId']);
      if (appId !== undefined && !catalog.byAppName.has(appId)) catalog.byAppName.set(appId, found);
    }
    const attributes = item['customAttributes'];
    const folder = text(((attributes as Record<string, unknown> | null)?.['FolderName'] as Record<string, unknown> | undefined)?.['value']);
    if (folder !== undefined && !catalog.byFolder.has(folder.toLowerCase())) catalog.byFolder.set(folder.toLowerCase(), found);
  }
  return catalog;
}
