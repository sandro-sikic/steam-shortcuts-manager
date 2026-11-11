import type { VdfMap } from './types.js';

type Token = { kind: 'string'; value: string } | { kind: 'open' } | { kind: 'close' };

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', '"': '"' };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
    } else if (ch === '{') {
      tokens.push({ kind: 'open' });
      i += 1;
    } else if (ch === '}') {
      tokens.push({ kind: 'close' });
      i += 1;
    } else if (ch === '"') {
      let value = '';
      i += 1;
      for (;;) {
        if (i >= text.length) throw new Error('Unterminated string in VDF text');
        const c = text[i] as string;
        if (c === '"') break;
        if (c === '\\' && i + 1 < text.length) {
          const next = text[i + 1] as string;
          value += ESCAPES[next] ?? next;
          i += 2;
        } else {
          value += c;
          i += 1;
        }
      }
      i += 1;
      tokens.push({ kind: 'string', value });
    } else {
      throw new Error(`Unexpected character '${ch}' in VDF text`);
    }
  }
  return tokens;
}

/** Parses Steam's text VDF format (as used by `loginusers.vdf`). Leaf values are strings. */
export function parseTextVdf(text: string): VdfMap {
  const tokens = tokenize(text);
  let pos = 0;

  const readMap = (nested: boolean): VdfMap => {
    const map: VdfMap = new Map();
    for (;;) {
      const token = tokens[pos];
      if (token === undefined) {
        if (nested) throw new Error('Unexpected end of VDF text');
        return map;
      }
      pos += 1;
      if (token.kind === 'close') {
        if (!nested) throw new Error('Unexpected closing brace in VDF text');
        return map;
      }
      if (token.kind === 'open') throw new Error('Unexpected opening brace in VDF text');
      const next = tokens[pos];
      if (next === undefined) throw new Error('Unexpected end of VDF text');
      pos += 1;
      if (next.kind === 'string') {
        map.set(token.value, next.value);
      } else if (next.kind === 'open') {
        map.set(token.value, readMap(true));
      } else {
        throw new Error('Unexpected closing brace in VDF text');
      }
    }
  };

  return readMap(false);
}
