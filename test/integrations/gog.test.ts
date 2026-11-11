import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gogIntegration } from '../../src/integrations/gog.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const ROOT = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games';

type Entry = { key: string; values: Record<string, string> };

/** Renders entries like `reg query /s` output. */
function regOutput(entries: Entry[]): string {
  const blocks = entries.map(({ key, values }) =>
    [`${ROOT}\\${key}`, ...Object.entries(values).map(([name, value]) => `    ${name}    REG_SZ    ${value}`)].join('\r\n'),
  );
  return [ROOT, '', ...blocks.flatMap((block) => [block, ''])].join('\r\n');
}

function ctx(output: (args: string[]) => string, platform: NodeJS.Platform = 'win32'): ScanContext & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    platform,
    home: '/home/test',
    env: {},
    calls,
    run: async (_command, args) => {
      calls.push(args);
      return output(args);
    },
  };
}

async function install(name: string, files: Record<string, unknown> = {}): Promise<string> {
  const dir = path.join(await makeTempDir(), name);
  await mkdir(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    await writeFile(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

describe('gogIntegration', () => {
  it('describes itself', () => {
    expect(gogIntegration).toMatchObject({ id: 'gog', label: 'GOG Galaxy', platforms: ['win32'] });
  });

  it('returns nothing on other platforms without querying', async () => {
    const context = ctx(() => '', 'linux');
    expect(await gogIntegration.scan(context)).toEqual([]);
    expect(context.calls).toEqual([]);
  });

  it('returns nothing when GOG is not installed', async () => {
    const context = ctx(() => '');
    expect(await gogIntegration.scan(context)).toEqual([]);
    expect(context.calls).toEqual([['query', ROOT, '/s', '/reg:32'], ['query', ROOT, '/s']]);
  });

  it('reads games from the registry, sorted by title, with every optional field', async () => {
    const witcher = await install('The Witcher', {});
    const alpha = await install('alpha');
    const context = ctx(() =>
      regOutput([
        { key: '1207658924', values: { gameID: '1207658924', gameName: 'The Witcher', path: witcher, exe: path.join(witcher, 'w.exe'), launchCommand: `"${path.join(witcher, 'witcher.exe')}"`, launchParam: '--windowed', workingDir: 'bin' } },
        { key: '42', values: { gameID: '42', gameName: 'alpha game', path: alpha, exe: 'alpha.exe' } },
      ]),
    );
    const games = await gogIntegration.scan(context);
    expect(games).toEqual([
      { store: 'GOG Galaxy', id: '42', title: 'alpha game', installed: true, launch: { kind: 'exe', exe: path.join(alpha, 'alpha.exe'), startDir: alpha } },
      {
        store: 'GOG Galaxy',
        id: '1207658924',
        title: 'The Witcher',
        installed: true,
        launch: { kind: 'exe', exe: path.join(witcher, 'witcher.exe'), startDir: path.join(witcher, 'bin'), args: '--windowed' },
      },
    ]);
    expect(context.calls).toHaveLength(1);
  });

  it('falls back to the default registry view when the 32-bit view is empty', async () => {
    const dir = await install('g');
    const context = ctx((args) => (args.includes('/reg:32') ? '' : regOutput([{ key: '7', values: { gameID: '7', gameName: 'G', path: dir, exe: 'g.exe' } }])));
    expect(await gogIntegration.scan(context)).toHaveLength(1);
  });

  it('falls back to goggame info for the title and primary play task', async () => {
    const dir = await install('Info Game', {
      'goggame-9.info': {
        name: 'Info Title',
        playTasks: [{ path: 'secondary.exe' }, { path: 'bin\\primary.exe', isPrimary: true, arguments: '-gog', workingDir: 'bin' }, {}],
      },
      'goggame-other.txt': 'ignored',
    });
    const games = await gogIntegration.scan(ctx(() => regOutput([{ key: '9', values: { gameID: '9', path: dir } }])));
    expect(games).toEqual([
      { store: 'GOG Galaxy', id: '9', title: 'Info Title', installed: true, launch: { kind: 'exe', exe: path.join(dir, 'bin\\primary.exe'), startDir: path.join(dir, 'bin'), args: '-gog' } },
    ]);
  });

  it('uses the first play task when none is primary and the install folder as start dir', async () => {
    const dir = await install('First', { 'goggame-5.info': { playTasks: [{ path: path.join('/abs', 'first.exe') }] } });
    const [game] = await gogIntegration.scan(ctx(() => regOutput([{ key: '5', values: { gameID: '5', gameName: 'First', path: dir } }])));
    expect(game?.launch).toEqual({ kind: 'exe', exe: path.join('/abs', 'first.exe'), startDir: dir });
  });

  it('prefers the info file named after the game id and otherwise takes any goggame info', async () => {
    const dir = await install('Two', {
      'goggame-1.info': { name: 'Wrong' },
      'GOGGAME-2.info': { name: 'Right' },
    });
    const other = await install('Three', { 'goggame-77.info': { name: 'Any' } });
    const games = await gogIntegration.scan(
      ctx(() =>
        regOutput([
          { key: '2', values: { gameID: '2', path: dir, exe: 'a.exe' } },
          { key: '3', values: { gameID: '3', path: other, exe: 'b.exe' } },
        ]),
      ),
    );
    expect(games.map((game) => game.title)).toEqual(['Any', 'Right']);
  });

  it('uses the key name as id and title when nothing else is known', async () => {
    const dir = await install('Bare', { 'goggame-bare.info': '{broken' });
    const [game] = await gogIntegration.scan(ctx(() => regOutput([{ key: 'bare', values: { path: dir, exe: 'bare.exe' } }])));
    expect(game).toMatchObject({ id: 'bare', title: 'bare' });
  });

  it('ignores a non-object info file and non-array play tasks', async () => {
    const list = await install('List', { 'goggame-1.info': '[1]' });
    const bad = await install('Bad', { 'goggame-2.info': { playTasks: 'nope' } });
    const nul = await install('Null', { 'goggame-3.info': 'null' });
    const games = await gogIntegration.scan(
      ctx(() =>
        regOutput([
          { key: '1', values: { gameID: '1', path: list } },
          { key: '2', values: { gameID: '2', path: bad } },
          { key: '3', values: { gameID: '3', path: nul, exe: 'n.exe' } },
        ]),
      ),
    );
    expect(games.map((game) => game.id)).toEqual(['3']);
  });

  it('skips entries without a path or launchable executable and the root key', async () => {
    const dir = await install('NoExe');
    const games = await gogIntegration.scan(
      ctx(() =>
        regOutput([
          { key: '1', values: { gameID: '1', gameName: 'No path' } },
          { key: '2', values: { gameID: '2', gameName: 'No exe', path: dir } },
          { key: '3', values: { gameID: '3', gameName: 'Blank', path: dir, exe: '   ' } },
        ]),
      ),
    );
    expect(games).toEqual([]);
  });

  it('de-duplicates by game id, keeping the first entry', async () => {
    const dir = await install('Dup');
    const games = await gogIntegration.scan(
      ctx(() =>
        regOutput([
          { key: 'a', values: { gameID: '8', gameName: 'First', path: dir, exe: 'a.exe' } },
          { key: 'b', values: { gameID: '8', gameName: 'Second', path: dir, exe: 'b.exe' } },
        ]),
      ),
    );
    expect(games.map((game) => game.title)).toEqual(['First']);
  });
});
