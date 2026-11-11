import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTaggedArtwork } from '../src/artwork/grid.js';
import { isTagged, TAG_TEXT, tagImage } from '../src/artwork/tag.js';
import { cleanupTempDirs, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]));
const IDAT = chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0])));
const IEND = chunk('IEND', Buffer.alloc(0));
const png = (...middle: Buffer[]) => Buffer.concat([SIGNATURE, IHDR, ...middle, IEND]);

/** The chunks of a PNG as [type, whole chunk bytes], checking their CRCs on the way. */
function chunksOf(data: Buffer): [string, Buffer][] {
  const out: [string, Buffer][] = [];
  for (let position = 8; position < data.length; ) {
    const length = data.readUInt32BE(position);
    const whole = data.subarray(position, position + 12 + length);
    expect(whole.readUInt32BE(8 + length)).toBe(crc32(whole.subarray(4, 8 + length)));
    out.push([whole.toString('latin1', 4, 8), whole]);
    position += whole.length;
  }
  return out;
}

const jpegSegment = (marker: number, payload: Buffer) => {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(0xff00 | marker, 0);
  header.writeUInt16BE(2 + payload.length, 2);
  return Buffer.concat([header, payload]);
};
const SOI = Buffer.from([0xff, 0xd8]);
const SOS_AND_DATA = Buffer.concat([jpegSegment(0xda, Buffer.from([1, 2, 3])), Buffer.from([0x11, 0x22, 0x33]), Buffer.from([0xff, 0xd9])]);
const FOOTER_TEXT = Buffer.from(`\0${TAG_TEXT}`, 'latin1');

describe('PNG', () => {
  it('gets a standard text chunk right after the header, leaving every other chunk as it was', () => {
    const original = png(IDAT);
    const tagged = tagImage(original);
    const chunks = chunksOf(tagged);
    expect(chunks.map(([type]) => type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
    expect(chunks[1]?.[1].subarray(8, -4).toString('latin1')).toBe(`Comment\0${TAG_TEXT}`);
    expect(chunks[0]?.[1].equals(IHDR)).toBe(true);
    expect(chunks[2]?.[1].equals(IDAT)).toBe(true);
    expect(tagged.subarray(0, 8).equals(SIGNATURE)).toBe(true);
    expect(isTagged(original)).toBe(false);
    expect(isTagged(tagged)).toBe(true);
  });

  it('is only tagged once', () => {
    const tagged = tagImage(png(IDAT));
    expect(tagImage(tagged)).toBe(tagged);
    expect(chunksOf(tagImage(tagged)).filter(([type]) => type === 'tEXt')).toHaveLength(1);
  });

  it('does not mistake someone else\'s text chunk for our tag, and keeps it', () => {
    const theirs = chunk('tEXt', Buffer.from('Software\0Photoshop', 'latin1'));
    const original = png(theirs, IDAT);
    expect(isTagged(original)).toBe(false);
    const tagged = tagImage(original);
    expect(chunksOf(tagged).map(([type]) => type)).toEqual(['IHDR', 'tEXt', 'tEXt', 'IDAT', 'IEND']);
    expect(chunksOf(tagged)[2]?.[1].equals(theirs)).toBe(true);
    expect(isTagged(tagged)).toBe(true);
  });

  it('falls back to the footer when the data only looks like a PNG', () => {
    const noHeader = Buffer.concat([SIGNATURE, IDAT, IEND]); // first chunk is not IHDR
    const truncated = png(IDAT).subarray(0, png(IDAT).length - 5);
    const signatureOnly = Buffer.from(SIGNATURE);
    for (const broken of [noHeader, truncated, signatureOnly]) {
      expect(isTagged(broken)).toBe(false);
      const tagged = tagImage(broken);
      expect(tagged.subarray(broken.length).equals(FOOTER_TEXT)).toBe(true);
      expect(isTagged(tagged)).toBe(true);
      expect(tagImage(tagged)).toBe(tagged);
    }
  });

  it('tags a PNG that has extra bytes after its end marker, in the usual place', () => {
    const withJunk = Buffer.concat([png(IDAT), Buffer.from('trailing junk')]);
    const tagged = tagImage(withJunk);
    expect(chunksOf(tagged.subarray(0, tagged.length - 'trailing junk'.length)).map(([type]) => type)).toEqual(['IHDR', 'tEXt', 'IDAT', 'IEND']);
    expect(isTagged(tagged)).toBe(true);
  });

  it('does not find our text in chunks that are not text', () => {
    const sneaky = chunk('IDAT', Buffer.from(TAG_TEXT, 'latin1'));
    expect(isTagged(png(sneaky))).toBe(false);
  });
});

describe('JPEG', () => {
  const jfif = jpegSegment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'));
  const exif = jpegSegment(0xe1, Buffer.from('Exif\0\0data', 'latin1'));

  it('gets a standard comment segment after the JFIF and Exif headers, which must stay first', () => {
    const original = Buffer.concat([SOI, jfif, exif, SOS_AND_DATA]);
    const tagged = tagImage(original);
    const at = SOI.length + jfif.length + exif.length;
    expect(tagged.subarray(0, at).equals(original.subarray(0, at))).toBe(true);
    expect(tagged.subarray(at, at + 4).toString('hex')).toBe('fffe' + (2 + TAG_TEXT.length).toString(16).padStart(4, '0'));
    expect(tagged.subarray(at + 4, at + 4 + TAG_TEXT.length).toString('latin1')).toBe(TAG_TEXT);
    expect(tagged.subarray(at + 4 + TAG_TEXT.length).equals(SOS_AND_DATA)).toBe(true);
    expect(isTagged(original)).toBe(false);
    expect(isTagged(tagged)).toBe(true);
  });

  it('goes right after the start marker when there are no headers, and is only tagged once', () => {
    const original = Buffer.concat([SOI, SOS_AND_DATA]);
    const tagged = tagImage(original);
    expect(tagged.subarray(2, 4).toString('hex')).toBe('fffe');
    expect(tagImage(tagged)).toBe(tagged);
    expect(isTagged(tagged)).toBe(true);
  });

  it('does not mistake someone else\'s comment, or our text inside the image data, for our tag', () => {
    const theirs = jpegSegment(0xfe, Buffer.from('shot on a phone', 'latin1'));
    const original = Buffer.concat([SOI, theirs, SOS_AND_DATA]);
    expect(isTagged(original)).toBe(false);
    const tagged = tagImage(original);
    expect(isTagged(tagged)).toBe(true);
    expect(tagged.includes('shot on a phone')).toBe(true);

    const inData = Buffer.concat([SOI, jpegSegment(0xda, Buffer.from([1])), Buffer.from(TAG_TEXT, 'latin1'), Buffer.from([0xff, 0xd9])]);
    expect(isTagged(inData)).toBe(false);
  });

  it('copes with segments it cannot walk', () => {
    const zeroLength = Buffer.concat([SOI, Buffer.from([0xff, 0xdb, 0x00, 0x00, 0x01])]);
    expect(isTagged(zeroLength)).toBe(false);
    const endsEarly = Buffer.concat([SOI, Buffer.from([0xff, 0xdb, 0x00, 0x05, 0x01, 0x02, 0x03, 0x04, 0xff, 0xd9])]);
    expect(isTagged(endsEarly)).toBe(false);
    const overrun = Buffer.concat([SOI, Buffer.from([0xff, 0xe0, 0xff, 0xff, 0x01, 0x02])]); // header claims far more than there is
    const tagged = tagImage(overrun);
    expect(tagged.subarray(overrun.length).equals(FOOTER_TEXT)).toBe(true);
    expect(isTagged(tagged)).toBe(true);
    const noSegments = Buffer.from([0xff, 0xd8, 0x00]);
    expect(isTagged(tagImage(noSegments))).toBe(true);
  });
});

describe('other formats', () => {
  const ico = Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0, 4, 0, 0, 0, 22, 0, 0, 0, 1, 2, 3, 4]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([8, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

  it.each([['an icon', ico], ['a WebP image', webp], ['unknown bytes', Buffer.from('whatever')], ['nothing', Buffer.alloc(0)], ['one byte', Buffer.from([0xff])]])('puts a footer after %s, leaving it intact', (_name, original) => {
    expect(isTagged(original)).toBe(false);
    const tagged = tagImage(original);
    expect(tagged.subarray(0, original.length).equals(original)).toBe(true);
    expect(tagged.subarray(original.length).equals(FOOTER_TEXT)).toBe(true);
    expect(isTagged(tagged)).toBe(true);
    expect(tagImage(tagged)).toBe(tagged);
  });

  it('only counts the footer at the very end, so a file that merely mentions our name is not ours', () => {
    const mentions = Buffer.concat([Buffer.from(`${TAG_TEXT} and then more image data`)]);
    expect(isTagged(mentions)).toBe(false);
    expect(isTagged(Buffer.from(TAG_TEXT.slice(1)))).toBe(false);
  });
});

describe('removeTaggedArtwork', () => {
  async function grid(files: Record<string, Buffer | string>): Promise<string> {
    const dir = path.join(await makeTempDir(), 'grid');
    await mkdir(dir);
    for (const [name, content] of Object.entries(files)) await writeFile(path.join(dir, name), content);
    return dir;
  }
  const ours = (text: string) => tagImage(Buffer.from(text));

  it('deletes the images we put there for a game, and keeps the user\'s own and other games\'', async () => {
    const dir = await grid({
      '42p.png': ours('poster'),
      '42_hero.jpg': ours('hero'),
      '42_logo.png': 'the user made this logo',
      '42_icon.ico': ours('icon'),
      '43p.png': ours('someone else'),
      '420p.png': ours('not 42'),
      'notes.txt': ours('not artwork'),
    });
    expect(await removeTaggedArtwork(dir, 42)).toEqual({ removed: 3, kept: 1 });
    const left = (await (await import('node:fs/promises')).readdir(dir)).sort();
    expect(left).toEqual(['420p.png', '42_logo.png', '43p.png', 'notes.txt']);
    expect(await readFile(path.join(dir, '42_logo.png'), 'utf8')).toBe('the user made this logo');
  });

  it('does nothing when there are no images for the game, or no folder', async () => {
    expect(await removeTaggedArtwork(await grid({ '1p.png': ours('x') }), 2)).toEqual({ removed: 0, kept: 0 });
    expect(await removeTaggedArtwork(path.join(await makeTempDir(), 'missing'), 2)).toEqual({ removed: 0, kept: 0 });
  });

  it('never touches an image without our tag, even with the same name pattern', async () => {
    const dir = await grid({ '7p.png': png(IDAT), '7p.jpg': Buffer.concat([SOI, SOS_AND_DATA]) });
    expect(await removeTaggedArtwork(dir, 7)).toEqual({ removed: 0, kept: 2 });
    await expect(stat(path.join(dir, '7p.png'))).resolves.toBeTruthy();
  });
});
