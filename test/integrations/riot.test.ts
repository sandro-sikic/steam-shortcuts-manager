import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { riotIntegration } from '../../src/integrations/riot.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

interface Fixture {
  ctx: ScanContext;
  riot: string;
  client: string;
  games: string;
}

async function setup(): Promise<Fixture> {
  const base = await makeTempDir();
  const riot = path.join(base, 'ProgramData', 'Riot Games');
  const clientDir = path.join(base, 'Riot Client');
  const client = path.join(clientDir, 'RiotClientServices.exe');
  await mkdir(clientDir, { recursive: true });
  await writeFile(client, '');
  const games = path.join(base, 'games');
  await mkdir(games);
  const ctx: ScanContext = {
    platform: 'win32',
    home: base,
    env: { ProgramData: path.join(base, 'ProgramData') },
    run: async () => '',
  };
  return { ctx, riot, client, games };
}

async function writeInstalls(f: Fixture, data: unknown): Promise<void> {
  await mkdir(f.riot, { recursive: true });
  await writeFile(path.join(f.riot, 'RiotClientInstalls.json'), JSON.stringify(data));
}

async function addProduct(f: Fixture, folder: string, yaml: string): Promise<void> {
  const dir = path.join(f.riot, 'Metadata', folder);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${folder}.product_settings.yaml`), yaml);
}

async function installDir(f: Fixture, name: string): Promise<string> {
  const dir = path.join(f.games, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('riot integration', () => {
  it('describes itself', () => {
    expect(riotIntegration).toMatchObject({ id: 'riot', label: 'Riot Games', platforms: ['win32'] });
  });

  it('returns nothing when Riot is not installed, using the default ProgramData', async () => {
    const f = await setup();
    expect(await riotIntegration.scan({ ...f.ctx, env: {} })).toEqual([]);
  });

  it.each([
    ['missing file', undefined],
    ['non-object json', 'text'],
    ['null json', null],
    ['no client keys', { associated_client: 5 }],
    ['non-exe value', { rc_default: 'C:/x/other.exe' }],
    ['exe that does not exist', { rc_default: '/nowhere/RiotClientServices.exe' }],
  ])('returns nothing for unusable RiotClientInstalls.json (%s)', async (_name, data) => {
    const f = await setup();
    if (data !== undefined) await writeInstalls(f, data);
    await addProduct(f, 'valorant.live', `product_install_full_path: "${await installDir(f, 'v')}"\n`);
    expect(await riotIntegration.scan(f.ctx)).toEqual([]);
  });

  it('finds games, sorted by title, launching through the Riot client', async () => {
    const f = await setup();
    await writeInstalls(f, { rc_default: f.client });
    await addProduct(f, 'valorant.live', `product_install_full_path: "${await installDir(f, 'v')}"\n`);
    await addProduct(f, 'league_of_legends.pbe', `product_install_full_path: '${await installDir(f, 'l')}'\n`);
    await addProduct(f, 'bacon.live', `product_install_full_path: ${await installDir(f, 'b')}\n`);
    await addProduct(f, 'some_new_game.live', `product_install_root: ${await installDir(f, 'n')}\n`);
    const games = await riotIntegration.scan(f.ctx);
    expect(games.map((g) => [g.id, g.title])).toEqual([
      ['league_of_legends.pbe', 'League of Legends'],
      ['bacon.live', 'Legends of Runeterra'],
      ['some_new_game.live', 'Some New Game'],
      ['valorant.live', 'VALORANT'],
    ]);
    expect(games[0]).toEqual({
      store: 'Riot Games',
      id: 'league_of_legends.pbe',
      title: 'League of Legends',
      installed: true,
      launch: {
        kind: 'exe',
        exe: f.client,
        startDir: path.dirname(f.client),
        args: '--launch-product=league_of_legends --launch-patchline=pbe',
      },
    });
  });

  it.skipIf(process.platform === 'win32')('falls back to rc_live and associated_client, and unescapes double-quoted backslashes', async () => {
    const f = await setup();
    await writeInstalls(f, { rc_default: 1, rc_live: f.client });
    await addProduct(f, 'valorant', 'product_install_full_path: "' + (await installDir(f, 'v')).replace(/\//g, '\\\\') + '"\n');
    expect(await riotIntegration.scan(f.ctx)).toEqual([]);

    await writeInstalls(f, { associated_client: { 'C:/Riot Games/': f.client } });
    await addProduct(f, 'valorant', `product_install_full_path: "${await installDir(f, 'v')}"\n`);
    const games = await riotIntegration.scan(f.ctx);
    expect(games.map((g) => g.id)).toEqual(['valorant.live']);
    expect(games[0]?.launch).toMatchObject({ args: '--launch-product=valorant --launch-patchline=live' });
  });

  it('skips malformed, empty and missing-path products and tolerates a trailing dot', async () => {
    const f = await setup();
    await writeInstalls(f, { rc_default: f.client });
    await mkdir(path.join(f.riot, 'Metadata', 'no_yaml.live'), { recursive: true });
    await addProduct(f, 'no_path.live', 'other: 1\n');
    await addProduct(f, 'empty_path.live', 'product_install_full_path: ""\n');
    await addProduct(f, 'gone.live', 'product_install_full_path: "/does/not/exist"\n');
    await addProduct(f, '.live', `product_install_full_path: "${await installDir(f, 'x')}"\n`);
    await addProduct(f, 'valorant.', `product_install_full_path: "${await installDir(f, 'v')}"\n`);
    const games = await riotIntegration.scan(f.ctx);
    expect(games.map((g) => g.id)).toEqual(['valorant.live']);
  });

  it('de-duplicates products that map to the same id', async () => {
    const f = await setup();
    await writeInstalls(f, { rc_default: f.client });
    const dir = await installDir(f, 'v');
    await addProduct(f, 'valorant.live', `product_install_full_path: "${dir}"\n`);
    await addProduct(f, 'valorant.', `product_install_full_path: "${dir}"\n`);
    expect(await riotIntegration.scan(f.ctx)).toHaveLength(1);
  });
});
