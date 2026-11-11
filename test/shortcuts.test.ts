import { describe, expect, it } from 'vitest';
import {
  buildShortcut,
  computeAppId,
  entriesEqual,
  findKey,
  getField,
  isManaged,
  MANAGED_TAG,
  parseShortcuts,
  quote,
  serializeShortcuts,
  setField,
  shortcutAppId,
  shortcutTags,
  shortcutTitle,
} from '../src/steam/shortcuts.js';
import { serializeBinaryVdf } from '../src/vdf/binary.js';
import type { VdfMap } from '../src/vdf/types.js';

/** Independent bitwise CRC-32 (IEEE) used to cross-check the zlib-based implementation. */
function referenceCrc32(text: string): number {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const input = { title: 'Fortnite', exe: '/games/fortnite', startDir: '/games', launchOptions: '--fast', tags: ['Epic Games', MANAGED_TAG] };

describe('app IDs', () => {
  it('is the CRC32 of exe+title with the high bit set', () => {
    const exe = quote('/games/fortnite');
    expect(computeAppId(exe, 'Fortnite')).toBe((referenceCrc32(exe + 'Fortnite') | 0x80000000) >>> 0);
    expect(computeAppId(exe, 'Fortnite')).toBeGreaterThanOrEqual(0x80000000);
  });
});

describe('field helpers', () => {
  const entry: VdfMap = new Map<string, string | number>([['appname', 'x']]);

  it('looks fields up case-insensitively', () => {
    expect(findKey(entry, 'AppName')).toBe('appname');
    expect(getField(entry, 'AppName')).toBe('x');
    expect(findKey(entry, 'Exe')).toBeUndefined();
    expect(getField(entry, 'Exe')).toBeUndefined();
  });

  it('sets existing fields under their existing spelling and adds new ones', () => {
    setField(entry, 'AppName', 'y');
    setField(entry, 'Exe', 'z');
    expect([...entry]).toEqual([['appname', 'y'], ['Exe', 'z']]);
  });
});

describe('buildShortcut', () => {
  it('builds a Steam-shaped entry', () => {
    const entry = buildShortcut(input);
    expect(entry.get('AppName')).toBe('Fortnite');
    expect(entry.get('Exe')).toBe('"/games/fortnite"');
    expect(entry.get('StartDir')).toBe('"/games"');
    expect(entry.get('LaunchOptions')).toBe('--fast');
    expect(shortcutTags(entry)).toEqual(['Epic Games', MANAGED_TAG]);
    expect(shortcutAppId(entry)).toBe(computeAppId('"/games/fortnite"', 'Fortnite'));
    expect(isManaged(entry)).toBe(true);
  });

  it('defaults optional fields', () => {
    const entry = buildShortcut({ title: 'T', exe: '/e', tags: [] });
    expect(entry.get('StartDir')).toBe('""');
    expect(entry.get('LaunchOptions')).toBe('');
    expect(isManaged(entry)).toBe(false);
  });
});

describe('accessors on foreign entries', () => {
  it('falls back to a computed app ID and tolerates odd shapes', () => {
    const entry: VdfMap = new Map<string, string | number>([['AppName', 'G'], ['Exe', '"/g"'], ['tags', 'oops']]);
    expect(shortcutAppId(entry)).toBe(computeAppId('"/g"', 'G'));
    expect(shortcutTags(entry)).toEqual([]);
    expect(shortcutTitle(new Map())).toBe('');
  });

  it('reads an explicit app ID as unsigned', () => {
    expect(shortcutAppId(new Map([['appid', 0x80000001]]))).toBe(0x80000001);
  });

  it('ignores non-string tags', () => {
    const tags: VdfMap = new Map<string, string | number>([['0', 'a'], ['1', 5]]);
    expect(shortcutTags(new Map([['tags', tags]]))).toEqual(['a']);
  });
});

describe('parse/serialize shortcuts', () => {
  it('round-trips and renumbers entries', () => {
    const a = buildShortcut(input);
    const b = buildShortcut({ ...input, title: 'Other' });
    const parsed = parseShortcuts(serializeShortcuts([a, b]));
    expect(parsed).toEqual([a, b]);
  });

  it('treats a missing or empty file as no shortcuts', () => {
    expect(parseShortcuts(undefined)).toEqual([]);
    expect(parseShortcuts(Buffer.alloc(0))).toEqual([]);
    expect(parseShortcuts(serializeBinaryVdf(new Map()))).toEqual([]);
  });

  it('finds the shortcuts key case-insensitively', () => {
    const buf = serializeBinaryVdf(new Map([['Shortcuts', new Map([['0', buildShortcut(input)]])]]));
    expect(parseShortcuts(buf)).toHaveLength(1);
  });

  it('rejects malformed files', () => {
    expect(() => parseShortcuts(serializeBinaryVdf(new Map([['shortcuts', 'x']])))).toThrow('"shortcuts" is not a map');
    expect(() => parseShortcuts(serializeBinaryVdf(new Map([['shortcuts', new Map([['0', 'x']])]])))).toThrow('shortcut is not a map');
  });
});

describe('entriesEqual', () => {
  it('compares by content', () => {
    expect(entriesEqual(buildShortcut(input), buildShortcut(input))).toBe(true);
    expect(entriesEqual(buildShortcut(input), buildShortcut({ ...input, title: 'x' }))).toBe(false);
  });
});
