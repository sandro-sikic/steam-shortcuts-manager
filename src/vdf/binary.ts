import type { VdfMap, VdfValue } from './types.js';

const TYPE_MAP = 0x00;
const TYPE_STRING = 0x01;
const TYPE_INT32 = 0x02;
const TYPE_END = 0x08;

class Reader {
  private pos = 0;

  constructor(private readonly buf: Buffer) {}

  byte(): number {
    const value = this.buf[this.pos];
    if (value === undefined) throw new Error('Unexpected end of binary VDF data');
    this.pos += 1;
    return value;
  }

  uint32(): number {
    if (this.pos + 4 > this.buf.length) throw new Error('Unexpected end of binary VDF data');
    const value = this.buf.readUInt32LE(this.pos);
    this.pos += 4;
    return value;
  }

  cstring(): string {
    const end = this.buf.indexOf(0, this.pos);
    if (end === -1) throw new Error('Unterminated string in binary VDF data');
    const value = this.buf.toString('utf8', this.pos, end);
    this.pos = end + 1;
    return value;
  }
}

function readMap(reader: Reader): VdfMap {
  const map: VdfMap = new Map();
  for (;;) {
    const type = reader.byte();
    if (type === TYPE_END) return map;
    const key = reader.cstring();
    switch (type) {
      case TYPE_MAP:
        map.set(key, readMap(reader));
        break;
      case TYPE_STRING:
        map.set(key, reader.cstring());
        break;
      case TYPE_INT32:
        map.set(key, reader.uint32());
        break;
      default:
        throw new Error(`Unsupported binary VDF type 0x${type.toString(16).padStart(2, '0')}`);
    }
  }
}

/** Parses Steam's binary VDF format (as used by `shortcuts.vdf`). */
export function parseBinaryVdf(buf: Buffer): VdfMap {
  return readMap(new Reader(buf));
}

function writeMap(map: VdfMap, out: Buffer[]): void {
  for (const [key, value] of map) {
    writeEntry(key, value, out);
  }
  out.push(Buffer.from([TYPE_END]));
}

function writeEntry(key: string, value: VdfValue, out: Buffer[]): void {
  const keyBytes = Buffer.from(`${key}\0`, 'utf8');
  if (typeof value === 'string') {
    out.push(Buffer.from([TYPE_STRING]), keyBytes, Buffer.from(`${value}\0`, 'utf8'));
  } else if (typeof value === 'number') {
    const int = Buffer.alloc(4);
    int.writeUInt32LE(value);
    out.push(Buffer.from([TYPE_INT32]), keyBytes, int);
  } else {
    out.push(Buffer.from([TYPE_MAP]), keyBytes);
    writeMap(value, out);
  }
}

/** Serializes a map to Steam's binary VDF format. */
export function serializeBinaryVdf(map: VdfMap): Buffer {
  const out: Buffer[] = [];
  writeMap(map, out);
  return Buffer.concat(out);
}
