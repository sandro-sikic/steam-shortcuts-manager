import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript build script
import { buildVersion, run } from '../scripts/version.mjs';

describe('buildVersion', () => {
  it('keeps major.minor and uses the number of commits as the patch', () => {
    expect(buildVersion('0.1.0', 18)).toBe('0.1.18');
    expect(buildVersion('2.10.7', 1)).toBe('2.10.1');
  });

  it('rejects a version it cannot read and a bad commit count', () => {
    expect(() => buildVersion('next', 5)).toThrow('Cannot read a major.minor version');
    expect(() => buildVersion('0.1.0', 0)).toThrow('Invalid commit count');
    expect(() => buildVersion('0.1.0', Number.NaN)).toThrow('Invalid commit count');
  });
});

describe('run', () => {
  const files = (): { read: () => string; write: (name: string, text: string) => void; written: string[] } => {
    const written: string[] = [];
    return { read: () => '{"name":"x","version":"0.3.0"}', write: (_name, text) => void written.push(text), written };
  };

  it('prints the version without changing package.json', () => {
    const io = files();
    expect(run([], { ...io, count: () => '42\n' })).toBe('0.3.42');
    expect(io.written).toEqual([]);
  });

  it('writes it into package.json, keeping the other fields, when asked', () => {
    const io = files();
    expect(run(['--write'], { ...io, count: () => '42\n' })).toBe('0.3.42');
    expect(JSON.parse(io.written[0] as string)).toEqual({ name: 'x', version: '0.3.42' });
    expect(io.written[0]?.endsWith('\n')).toBe(true);
  });

  it('counts the commits of the repository by default', () => {
    expect(run([], { read: () => '{"version":"1.2.0"}' })).toMatch(/^1\.2\.[1-9]\d*$/);
  });
});
