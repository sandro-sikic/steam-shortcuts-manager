import { crc32 } from 'node:zlib';
import { parseBinaryVdf, serializeBinaryVdf } from '../vdf/binary.js';
import type { VdfMap, VdfValue } from '../vdf/types.js';

/** Tag added to every shortcut we create, so we never touch the user's own entries. */
export const MANAGED_TAG = 'steam-manager';

export interface ShortcutInput {
  title: string;
  /** Unquoted path of the executable. */
  exe: string;
  startDir?: string;
  launchOptions?: string;
  tags: string[];
}

/** Steam stores the executable and start dir wrapped in double quotes. */
export function quote(value: string): string {
  return `"${value}"`;
}

/** The ID Steam derives for a non-Steam shortcut; also the prefix of its artwork file names. */
export function computeAppId(quotedExe: string, title: string): number {
  return (crc32(Buffer.from(quotedExe + title, 'utf8')) | 0x80000000) >>> 0;
}

/** Case-insensitive field lookup (Steam has written both `AppName` and `appname`). */
export function findKey(entry: VdfMap, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of entry.keys()) {
    if (key.toLowerCase() === lower) return key;
  }
  return undefined;
}

export function getField(entry: VdfMap, name: string): VdfValue | undefined {
  const key = findKey(entry, name);
  return key === undefined ? undefined : entry.get(key);
}

export function setField(entry: VdfMap, name: string, value: VdfValue): void {
  entry.set(findKey(entry, name) ?? name, value);
}

function tagsMap(tags: string[]): VdfMap {
  return new Map(tags.map((tag, index) => [String(index), tag]));
}

export function buildShortcut(input: ShortcutInput): VdfMap {
  const exe = quote(input.exe);
  return new Map<string, VdfValue>([
    ['appid', computeAppId(exe, input.title)],
    ['AppName', input.title],
    ['Exe', exe],
    ['StartDir', quote(input.startDir ?? '')],
    ['icon', ''],
    ['ShortcutPath', ''],
    ['LaunchOptions', input.launchOptions ?? ''],
    ['IsHidden', 0],
    ['AllowDesktopConfig', 1],
    ['AllowOverlay', 1],
    ['OpenVR', 0],
    ['Devkit', 0],
    ['DevkitGameID', ''],
    ['DevkitOverrideAppID', 0],
    ['LastPlayTime', 0],
    ['FlatpakAppID', ''],
    ['tags', tagsMap(input.tags)],
  ]);
}

function stringField(entry: VdfMap, name: string): string {
  const value = getField(entry, name);
  return typeof value === 'string' ? value : '';
}

export function shortcutTitle(entry: VdfMap): string {
  return stringField(entry, 'AppName');
}

export function shortcutAppId(entry: VdfMap): number {
  const value = getField(entry, 'appid');
  if (typeof value === 'number') return value >>> 0;
  return computeAppId(stringField(entry, 'Exe'), shortcutTitle(entry));
}

export function shortcutTags(entry: VdfMap): string[] {
  const value = getField(entry, 'tags');
  if (!(value instanceof Map)) return [];
  return [...value.values()].filter((tag): tag is string => typeof tag === 'string');
}

export function isManaged(entry: VdfMap): boolean {
  return shortcutTags(entry).includes(MANAGED_TAG);
}

/** Parses the contents of a `shortcuts.vdf`. An empty or missing file has no shortcuts. */
export function parseShortcuts(buf: Buffer | undefined): VdfMap[] {
  if (buf === undefined || buf.length === 0) return [];
  const root = parseBinaryVdf(buf);
  const key = findKey(root, 'shortcuts');
  const list = key === undefined ? undefined : root.get(key);
  if (list === undefined) return [];
  if (!(list instanceof Map)) throw new Error('Malformed shortcuts.vdf: "shortcuts" is not a map');
  const entries: VdfMap[] = [];
  for (const entry of list.values()) {
    if (!(entry instanceof Map)) throw new Error('Malformed shortcuts.vdf: shortcut is not a map');
    entries.push(entry);
  }
  return entries;
}

/** Serializes shortcuts back to `shortcuts.vdf`, renumbering the entries 0..n-1. */
export function serializeShortcuts(entries: VdfMap[]): Buffer {
  const list: VdfMap = new Map(entries.map((entry, index) => [String(index), entry]));
  return serializeBinaryVdf(new Map([['shortcuts', list]]));
}

export function entriesEqual(a: VdfMap, b: VdfMap): boolean {
  return serializeBinaryVdf(a).equals(serializeBinaryVdf(b));
}
