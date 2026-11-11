import { crc32 } from 'node:zlib';

/** The machine-readable part of the tag; images carrying it were downloaded by this app. */
const MARKER = 'steam-manager:artwork';

const BASE_TEXT = `Steam Manager (${MARKER})`;

/** What is written into the image (readable in any metadata viewer), with the SteamGridDB image id when known. */
export function tagText(id?: number): string {
  return id === undefined ? BASE_TEXT : `${BASE_TEXT} id=${id}`;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_TEXT_KEYWORD = 'Comment';
/** For formats without a metadata place we can safely write to (ICO, WebP): a footer after the image data. */
const FOOTER = /\0Steam Manager \(steam-manager:artwork\)(?: id=\d+)?$/;
const FOOTER_WINDOW = 96;

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

/** Position just after the start marker and any leading APPn segments (JFIF/Exif must stay first), or undefined if not a JPEG. */
function jpegInsertionPoint(data: Buffer): number | undefined {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let position = 2;
  while (position + 4 <= data.length && data[position] === 0xff && (data[position + 1] as number) >= 0xe0 && (data[position + 1] as number) <= 0xef) {
    position += 2 + data.readUInt16BE(position + 2);
  }
  return position <= data.length ? position : undefined;
}

interface Located {
  /** The tag text as written, and the byte range that holds it (a PNG chunk, a JPEG segment, or the footer). */
  text: string;
  start: number;
  end: number;
}

function locatePng(data: Buffer): Located | undefined {
  for (const chunk of pngChunks(data) ?? []) {
    const body = data.toString('latin1', chunk.start + 8, chunk.end - 4);
    if (chunk.type === 'tEXt' && body.includes(MARKER)) return { text: body, start: chunk.start, end: chunk.end };
  }
  return undefined;
}

function locateJpeg(data: Buffer): Located | undefined {
  if (jpegInsertionPoint(data) === undefined) return undefined;
  let position = 2;
  while (position + 4 <= data.length && data[position] === 0xff) {
    const marker = data[position + 1] as number;
    const length = data.readUInt16BE(position + 2);
    if (marker === 0xda || marker === 0xd9 || length < 2) return undefined; // image data starts, or something we cannot walk
    const body = data.toString('latin1', position + 4, position + 2 + length);
    if (marker === 0xfe && body.includes(MARKER)) return { text: body, start: position, end: position + 2 + length };
    position += 2 + length;
  }
  return undefined;
}

function locateFooter(data: Buffer): Located | undefined {
  const from = Math.max(0, data.length - FOOTER_WINDOW);
  const tail = data.toString('latin1', from);
  const match = FOOTER.exec(tail);
  return match ? { text: match[0].slice(1), start: from + match.index, end: data.length } : undefined;
}

function locate(data: Buffer): Located | undefined {
  return locatePng(data) ?? locateJpeg(data) ?? locateFooter(data);
}

/** Whether this image carries our tag (PNG text chunk, JPEG comment, or the footer used for other formats). */
export function isTagged(data: Buffer): boolean {
  return locate(data) !== undefined;
}

/**
 * Reads our tag: undefined when the image is not ours; otherwise an object, with the SteamGridDB image id
 * when the tag has one (tags written by earlier versions do not).
 */
export function readTag(data: Buffer): { id?: number } | undefined {
  const found = locate(data);
  if (!found) return undefined;
  const id = /id=(\d+)/.exec(found.text)?.[1];
  return id === undefined ? {} : { id: Number(id) };
}

/** The image without our tag (unchanged if it has none). */
export function untagImage(data: Buffer): Buffer {
  const found = locate(data);
  return found ? Buffer.concat([data.subarray(0, found.start), data.subarray(found.end)]) : data;
}

function insertPng(data: Buffer, chunks: PngChunk[], text: string): Buffer {
  const body = Buffer.concat([Buffer.from('tEXt', 'latin1'), Buffer.from(`${PNG_TEXT_KEYWORD}\0${text}`, 'latin1')]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length - 4);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  const after = (chunks[0] as PngChunk).end; // right after IHDR
  return Buffer.concat([data.subarray(0, after), length, body, crc, data.subarray(after)]);
}

function insertJpeg(data: Buffer, at: number, text: string): Buffer {
  const bytes = Buffer.from(text, 'latin1');
  const segment = Buffer.alloc(4 + bytes.length);
  segment.writeUInt16BE(0xfffe, 0); // COM
  segment.writeUInt16BE(2 + bytes.length, 2);
  bytes.copy(segment, 4);
  return Buffer.concat([data.subarray(0, at), segment, data.subarray(at)]);
}

/**
 * Marks an image as downloaded by Steam Manager, so we can later tell our images from the user's own, and
 * records which SteamGridDB image it is. PNG gets a standard text chunk and JPEG a standard comment; formats
 * without a safe place for metadata get a footer, which decoders ignore. Tagging twice with the same id changes
 * nothing; a different id (or an old tag without one) replaces the tag.
 */
export function tagImage(data: Buffer, id?: number): Buffer {
  const current = readTag(data);
  if (current && current.id === id) return data;
  const base = untagImage(data);
  const text = tagText(id);
  const chunks = pngChunks(base);
  if (chunks) return insertPng(base, chunks, text);
  const at = jpegInsertionPoint(base);
  if (at !== undefined) return insertJpeg(base, at, text);
  return Buffer.concat([base, Buffer.from(`\0${text}`, 'latin1')]);
}
