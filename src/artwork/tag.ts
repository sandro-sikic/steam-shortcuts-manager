import { crc32 } from 'node:zlib';

/** The machine-readable part of the tag; images carrying it were downloaded by this app. */
const MARKER = 'steam-manager:artwork';

/** What is written into the image: readable in any metadata viewer. */
export const TAG_TEXT = `Steam Manager (${MARKER})`;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TEXT_KEYWORD = 'Comment';
/** For formats without a metadata place we can safely write to (ICO, WebP): a footer after the image data. */
const FOOTER = Buffer.from(`\0${TAG_TEXT}`, 'latin1');

interface PngChunk {
  type: string;
  /** Start of the chunk (its length field) and the end of it (after its CRC). */
  start: number;
  end: number;
}

/** The chunks of a well-formed PNG (from IHDR to IEND), or undefined if the data is not one. */
function pngChunks(data: Buffer): PngChunk[] | undefined {
  if (data.length < 8 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
  const chunks: PngChunk[] = [];
  let position = 8;
  while (position + 12 <= data.length) {
    const end = position + 12 + data.readUInt32BE(position);
    if (end > data.length) return undefined;
    const type = data.toString('latin1', position + 4, position + 8);
    chunks.push({ type, start: position, end });
    if (type === 'IEND') break; // anything after the end marker is not part of the image
    position = end;
  }
  return chunks[0]?.type === 'IHDR' && chunks.at(-1)?.type === 'IEND' ? chunks : undefined;
}

function pngTagged(data: Buffer): boolean {
  return (pngChunks(data) ?? []).some((chunk) => chunk.type === 'tEXt' && data.subarray(chunk.start + 8, chunk.end - 4).includes(MARKER));
}

function tagPng(data: Buffer, chunks: PngChunk[]): Buffer {
  const body = Buffer.concat([Buffer.from('tEXt', 'latin1'), Buffer.from(`${PNG_TEXT_KEYWORD}\0${TAG_TEXT}`, 'latin1')]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  const after = (chunks[0] as PngChunk).end; // right after IHDR
  return Buffer.concat([data.subarray(0, after), length, body, crc, data.subarray(after)]);
}

/** Position just after the start marker and any leading APPn segments (JFIF/Exif must stay first), or undefined if not a JPEG. */
function jpegInsertionPoint(data: Buffer): number | undefined {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let position = 2;
  while (position + 4 <= data.length && data[position] === 0xff && (data[position + 1] as number) >= 0xe0 && (data[position + 1] as number) <= 0xef) {
    position += 2 + data.readUInt16BE(position + 2);
  }
  return position <= data.length ? position : undefined;
}

function jpegTagged(data: Buffer): boolean {
  if (jpegInsertionPoint(data) === undefined) return false;
  let position = 2;
  while (position + 4 <= data.length && data[position] === 0xff) {
    const marker = data[position + 1] as number;
    const length = data.readUInt16BE(position + 2);
    if (marker === 0xda || marker === 0xd9 || length < 2) return false; // image data starts, or something we cannot walk
    if (marker === 0xfe && data.subarray(position + 4, position + 2 + length).includes(MARKER)) return true;
    position += 2 + length;
  }
  return false;
}

function tagJpeg(data: Buffer, at: number): Buffer {
  const text = Buffer.from(TAG_TEXT, 'latin1');
  const segment = Buffer.alloc(4 + text.length);
  segment.writeUInt16BE(0xfffe, 0); // COM
  segment.writeUInt16BE(2 + text.length, 2);
  text.copy(segment, 4);
  return Buffer.concat([data.subarray(0, at), segment, data.subarray(at)]);
}

function footerTagged(data: Buffer): boolean {
  return data.length >= FOOTER.length && data.subarray(data.length - FOOTER.length).equals(FOOTER);
}

/** Whether this image carries our tag (PNG text chunk, JPEG comment, or the footer used for other formats). */
export function isTagged(data: Buffer): boolean {
  return pngTagged(data) || jpegTagged(data) || footerTagged(data);
}

/**
 * Marks an image as downloaded by Steam Manager, so we can later tell our images from the user's own.
 * PNG gets a standard text chunk and JPEG a standard comment; formats without a safe place for metadata
 * get a footer, which decoders ignore. Tagging twice changes nothing.
 */
export function tagImage(data: Buffer): Buffer {
  if (isTagged(data)) return data;
  const chunks = pngChunks(data);
  if (chunks) return tagPng(data, chunks);
  const at = jpegInsertionPoint(data);
  if (at !== undefined) return tagJpeg(data, at);
  return Buffer.concat([data, FOOTER]);
}
