import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseCatalog, parseEpicManifest } from '../../src/integrations/shared/epicManifest.js';

const fstring = (value: string): Buffer => {
  const bytes = Buffer.from(`${value}\0`, 'latin1');
  const length = Buffer.alloc(4);
  length.writeInt32LE(value === '' ? 0 : bytes.length);
  return value === '' ? length : Buffer.concat([length, bytes]);
};

const utf16 = (value: string): Buffer => {
  const bytes = Buffer.from(`${value}\0`, 'utf16le');
  const length = Buffer.alloc(4);
  length.writeInt32LE(-(bytes.length / 2));
  return Buffer.concat([length, bytes]);
};

/** The meta block of a binary manifest: sizes and versions, then the strings we read. */
function meta(appName: Buffer, launchExe: Buffer): Buffer {
  const fixed = Buffer.alloc(14); // data size, data version, feature level, file-data flag, app id
  fixed.writeUInt8(1, 4);
  return Buffer.concat([fixed, appName, fstring('1.0.0'), launchExe, fstring('')]);
}

/** A binary manifest as the launcher writes it: 41-byte header, then the (compressed) body. */
function binary(body: Buffer, compressed = true): Buffer {
  const stored = compressed ? deflateSync(body) : body;
  const header = Buffer.alloc(41);
  header.writeUInt32LE(0x44bec00c, 0);
  header.writeUInt32LE(41, 4);
  header.writeUInt32LE(body.length, 8);
  header.writeUInt32LE(stored.length, 12);
  header.writeUInt8(compressed ? 1 : 0, 36);
  header.writeUInt32LE(21, 37);
  return Buffer.concat([header, stored]);
}

describe('parseEpicManifest', () => {
  it('reads the app name and launch executable from a compressed binary manifest', () => {
    expect(parseEpicManifest(binary(meta(fstring('Salt'), fstring('Automachef.exe'))))).toEqual({ appName: 'Salt', launchExe: 'Automachef.exe' });
  });

  it('reads an uncompressed one and UTF-16 strings', () => {
    expect(parseEpicManifest(binary(meta(utf16('Zażółć'), utf16('Gra.exe')), false))).toEqual({ appName: 'Zażółć', launchExe: 'Gra.exe' });
  });

  it('reads an empty launch executable, as in a redistributable', () => {
    expect(parseEpicManifest(binary(meta(fstring('Redist'), fstring(''))))).toEqual({ appName: 'Redist', launchExe: '' });
  });

  it('reads the older JSON manifest, with or without a byte order mark', () => {
    const json = JSON.stringify({ AppNameString: 'Old', LaunchExeString: 'Old.exe' });
    expect(parseEpicManifest(Buffer.from(json))).toEqual({ appName: 'Old', launchExe: 'Old.exe' });
    expect(parseEpicManifest(Buffer.from(`﻿${json}`))).toEqual({ appName: 'Old', launchExe: 'Old.exe' });
    expect(parseEpicManifest(Buffer.from('{"AppNameString":"Only"}'))).toEqual({ appName: 'Only', launchExe: '' });
  });

  it('gives up on anything else', () => {
    expect(parseEpicManifest(undefined)).toBeUndefined();
    expect(parseEpicManifest(Buffer.alloc(0))).toBeUndefined();
    expect(parseEpicManifest(Buffer.from('not a manifest at all, just some text.......'))).toBeUndefined();
    expect(parseEpicManifest(Buffer.from('{broken'))).toBeUndefined();
    expect(parseEpicManifest(Buffer.from('{"AppNameString":""}'))).toBeUndefined();
    expect(parseEpicManifest(Buffer.from('{"AppNameString":5}'))).toBeUndefined();
    expect(parseEpicManifest(binary(meta(fstring(''), fstring('x.exe'))))).toBeUndefined(); // no app name
    expect(parseEpicManifest(binary(Buffer.from([1, 2, 3])))).toBeUndefined(); // truncated body
    expect(parseEpicManifest(binary(Buffer.alloc(40), false).subarray(0, 60))).toBeUndefined(); // truncated strings
    const corrupt = binary(meta(fstring('Salt'), fstring('a.exe')));
    expect(parseEpicManifest(Buffer.concat([corrupt.subarray(0, 41), Buffer.from('garbage')]))).toBeUndefined(); // bad zlib
    const negative = Buffer.concat([Buffer.alloc(14), Buffer.from([0xf0, 0xff, 0xff, 0xff])]);
    expect(parseEpicManifest(binary(negative, false))).toBeUndefined(); // a string longer than the data
    const huge = Buffer.concat([Buffer.alloc(14), Buffer.from([0xff, 0xff, 0xff, 0x7f])]);
    expect(parseEpicManifest(binary(huge, false))).toBeUndefined();
  });
});

describe('parseCatalog', () => {
  const encode = (value: unknown): Buffer => Buffer.from(Buffer.from(JSON.stringify(value)).toString('base64'));
  const item = (over: Record<string, unknown> = {}) => ({ id: 'item1', namespace: 'ns1', title: 'Automachef', ...over });

  it('indexes titles by the app names they release and by their folder name', () => {
    const catalog = parseCatalog(
      encode([
        item({ releaseInfo: [{ appId: 'Salt' }, { appId: 'Pepper' }], customAttributes: { FolderName: { type: 'STRING', value: 'Automachef' } } }),
        item({ id: 'item2', title: 'Other', releaseInfo: [{ appId: 'Salt' }], customAttributes: { FolderName: { value: 'automachef' } } }),
      ]),
    );
    expect(catalog.byAppName.get('Salt')).toEqual({ title: 'Automachef', namespace: 'ns1', id: 'item1' });
    expect(catalog.byAppName.get('Pepper')?.id).toBe('item1');
    expect(catalog.byFolder.get('automachef')?.id).toBe('item1'); // the first one wins
  });

  it('ignores entries that lack a title, namespace or id, and ones that are not objects', () => {
    const catalog = parseCatalog(
      encode([null, 'x', 5, item({ title: '' }), item({ namespace: undefined }), item({ id: 3 }), item({ releaseInfo: 'none', customAttributes: 'none' }), item({ releaseInfo: [null, { appId: 4 }, {}], customAttributes: { FolderName: 'flat' } })]),
    );
    expect([catalog.byAppName.size, catalog.byFolder.size]).toEqual([0, 0]);
  });

  it('is empty when the cache is missing, not base64 JSON, or not a list', () => {
    for (const data of [undefined, Buffer.from(''), Buffer.from('%%%'), Buffer.from(Buffer.from('{').toString('base64')), encode({ title: 'x' })]) {
      const catalog = parseCatalog(data);
      expect([catalog.byAppName.size, catalog.byFolder.size]).toEqual([0, 0]);
    }
  });
});
