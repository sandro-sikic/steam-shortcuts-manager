import { describe, expect, it } from 'vitest';
import { parseBinaryVdf, serializeBinaryVdf } from '../src/vdf/binary.js';
import { parseTextVdf } from '../src/vdf/text.js';
import type { VdfMap } from '../src/vdf/types.js';

describe('binary VDF', () => {
  const sample: VdfMap = new Map<string, string | number | VdfMap>([
    ['name', 'Tëst ✓'],
    ['count', 4000000000],
    ['nested', new Map<string, string | number | VdfMap>([['0', 'a'], ['1', new Map()]])],
  ]);

  it('round-trips strings, integers and nested maps', () => {
    expect(parseBinaryVdf(serializeBinaryVdf(sample))).toEqual(sample);
  });

  it('uses Steam wire format', () => {
    const bytes = serializeBinaryVdf(new Map<string, string | number | VdfMap>([['k', 'v'], ['n', 1]]));
    expect([...bytes]).toEqual([1, 0x6b, 0, 0x76, 0, 2, 0x6e, 0, 1, 0, 0, 0, 8]);
  });

  it('rejects truncated input', () => {
    expect(() => parseBinaryVdf(Buffer.alloc(0))).toThrow('Unexpected end');
    expect(() => parseBinaryVdf(Buffer.from([2, 0x6b, 0, 1, 0]))).toThrow('Unexpected end');
    expect(() => parseBinaryVdf(Buffer.from([1, 0x6b]))).toThrow('Unterminated string');
  });

  it('rejects unsupported value types', () => {
    expect(() => parseBinaryVdf(Buffer.from([7, 0x6b, 0, 0, 0, 0, 0, 0, 0, 0, 8]))).toThrow('Unsupported binary VDF type 0x07');
  });
});

describe('text VDF', () => {
  it('parses nested maps, comments and escapes', () => {
    const parsed = parseTextVdf(`// comment
"users"
{
  "1" { "name" "a \\"quoted\\" \\\\ \\n\\t\\x" }
}
`);
    const users = parsed.get('users') as VdfMap;
    const one = users.get('1') as VdfMap;
    expect(one.get('name')).toBe('a "quoted" \\ \n\tx');
  });

  it('parses an empty document', () => {
    expect(parseTextVdf('  ').size).toBe(0);
  });

  it.each([
    ['"a', 'Unterminated string'],
    ['"a\\', 'Unterminated string'],
    ['abc', "Unexpected character 'a'"],
    ['"a" {', 'Unexpected end'],
    ['"a"', 'Unexpected end'],
    ['"a" }', 'Unexpected closing brace'],
    ['}', 'Unexpected closing brace'],
    ['{', 'Unexpected opening brace'],
  ])('rejects malformed input %j', (text, message) => {
    expect(() => parseTextVdf(text)).toThrow(message);
  });
});
