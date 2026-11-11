import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript build script
import { buildVersion, run } from '../scripts/version.mjs';
import { displayVersion } from '../src/version.js';

describe('buildVersion', () => {
  it('uses the number of commits as the patch of 0.0', () => {
    expect(buildVersion(18)).toBe('0.0.18');
    expect(buildVersion(1)).toBe('0.0.1');
  });

  it('rejects a bad commit count', () => {
    expect(() => buildVersion(0)).toThrow('Invalid commit count');
    expect(() => buildVersion(Number.NaN)).toThrow('Invalid commit count');
  });
});

describe('run', () => {
  const files = (): { read: () => string; write: (name: string, text: string) => void; written: string[] } => {
    const written: string[] = [];
    return { read: () => '{"name":"x","version":"0.0.0"}', write: (_name, text) => void written.push(text), written };
  };

  it('prints the version without changing package.json', () => {
    const io = files();
    expect(run([], { ...io, count: () => '42\n' })).toBe('0.0.42');
    expect(io.written).toEqual([]);
  });

  it('writes it into package.json, keeping the other fields, when asked', () => {
    const io = files();
    expect(run(['--write'], { ...io, count: () => '42\n' })).toBe('0.0.42');
    expect(JSON.parse(io.written[0] as string)).toEqual({ name: 'x', version: '0.0.42' });
    expect(io.written[0]?.endsWith('\n')).toBe(true);
  });

  it('counts the commits of the repository by default', () => {
    expect(run([], { read: () => '{"version":"0.0.0"}' })).toMatch(/^0\.0\.[1-9]\d*$/);
  });
});

describe('displayVersion', () => {
  it('shows the commit count of a release build', () => {
    expect(displayVersion('0.0.19')).toBe('19');
    expect(displayVersion('0.0.1203')).toBe('1203');
  });

  it('shows "dev" for anything else, such as a local run', () => {
    for (const version of ['0.0.0', '0.1.0', '1.0.5', '0.0.05', '0.0.x', '']) expect(displayVersion(version)).toBe('dev');
  });
});
