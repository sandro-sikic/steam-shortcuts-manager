import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ubisoftIntegration } from '../../src/integrations/ubisoft.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const WOW = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs';
const PLAIN = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Ubisoft\\Launcher\\Installs';

function regOutput(entries: [string, Record<string, string>][]): string {
  return entries
    .map(([key, values]) => [key, ...Object.entries(values).map(([n, v]) => `    ${n}    REG_SZ    ${v}`)].join('\r\n'))
    .join('\r\n\r\n');
}

function ctxWith(outputs: Record<string, string>): { ctx: ScanContext; calls: string[][] } {
  const calls: string[][] = [];
  const ctx: ScanContext = {
    platform: 'win32',
    home: '',
    env: {},
    run: async (command, args) => {
      calls.push([command, ...args]);
      return outputs[args[1] ?? ''] ?? '';
    },
  };
  return { ctx, calls };
}

async function gameDir(root: string, name: string): Promise<string> {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  return dir + path.sep;
}

describe('ubisoftIntegration', () => {
  it('describes itself', () => {
    expect(ubisoftIntegration).toMatchObject({ id: 'ubisoft', label: 'Ubisoft Connect', platforms: ['win32'] });
  });

  it('returns nothing when the launcher is not in the registry', async () => {
    const { ctx, calls } = ctxWith({});
    expect(await ubisoftIntegration.scan(ctx)).toEqual([]);
    expect(calls).toEqual([
      ['reg', 'query', WOW, '/s', '/reg:32'],
      ['reg', 'query', PLAIN, '/s', '/reg:32'],
    ]);
  });

  it('lists installed games sorted by title with a launcher URI', async () => {
    const root = await makeTempDir();
    const zombi = await gameDir(root, 'ZOMBI');
    const anno = await gameDir(root, 'Anno_1800');
    const { ctx } = ctxWith({
      [WOW]: regOutput([
        [WOW, {}],
        [`${WOW}\\5059`, { InstallDir: zombi }],
        [`${WOW}\\720`, { InstallDir: anno }],
      ]),
    });
    expect(await ubisoftIntegration.scan(ctx)).toEqual([
      { store: 'Ubisoft Connect', id: '720', title: 'Anno 1800', installed: true, launch: { kind: 'uri', uri: 'uplay://launch/720/0' } },
      { store: 'Ubisoft Connect', id: '5059', title: 'ZOMBI', installed: true, launch: { kind: 'uri', uri: 'uplay://launch/5059/0' } },
    ]);
  });

  it('falls back to the plain key and de-duplicates ids across both keys', async () => {
    const root = await makeTempDir();
    const a = await gameDir(root, 'Alpha');
    const b = await gameDir(root, 'Beta');
    const { ctx } = ctxWith({
      [WOW]: regOutput([[`${WOW}\\1`, { InstallDir: a }]]),
      [PLAIN]: regOutput([[`${PLAIN}\\1`, { InstallDir: b }], [`${PLAIN}\\2`, { InstallDir: b }]]),
    });
    const games = await ubisoftIntegration.scan(ctx);
    expect(games.map((g) => [g.id, g.title])).toEqual([['1', 'Alpha'], ['2', 'Beta']]);
  });

  it('skips entries that are nested, rootless, missing InstallDir, blank or not on disk', async () => {
    const root = await makeTempDir();
    const ok = await gameDir(root, 'Good');
    const { ctx } = ctxWith({
      [WOW]: regOutput([
        [`${WOW}\\1\\Sub`, { InstallDir: ok }],
        ['HKEY_LOCAL_MACHINE\\SOFTWARE\\Other\\2', { InstallDir: ok }],
        ['\\', { InstallDir: ok }],
        [`${WOW}\\3`, { Other: 'x' }],
        [`${WOW}\\4`, { InstallDir: '   ' }],
        [`${WOW}\\5`, { InstallDir: path.join(root, 'gone') + path.sep }],
        [`${WOW}\\6`, { InstallDir: ok }],
      ]),
    });
    expect((await ubisoftIntegration.scan(ctx)).map((g) => g.id)).toEqual(['6']);
  });

  it('falls back to the id when the folder name yields no title', async () => {
    const root = await makeTempDir();
    const dir = await gameDir(root, '___');
    const { ctx } = ctxWith({ [WOW]: regOutput([[`${WOW}\\9`, { InstallDir: dir }]]) });
    expect((await ubisoftIntegration.scan(ctx)).map((g) => g.title)).toEqual(['9']);
  });
});
