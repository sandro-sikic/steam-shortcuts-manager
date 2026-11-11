import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { amazonIntegration } from '../../src/integrations/amazon.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const UNINSTALL = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';

function regKey(hive: string, title: string, values: Record<string, string>): string {
  const lines = Object.entries(values).map(([k, v]) => `    ${k}    REG_SZ    ${v}`);
  return [`${hive}\\${UNINSTALL}\\AmazonGames/${title}`, ...lines, ''].join('\r\n');
}

async function writeGame(dir: string, manifest: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'fuel.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
}

function ctx(library: string, outputs: Record<string, string> = {}, platform: NodeJS.Platform = 'win32'): ScanContext {
  return {
    platform,
    home: library,
    env: { AMAZON_GAMES_LIBRARY: library },
    run: async (_command, args) => outputs[`${args[1]}${args[3] ?? ''}`] ?? '',
  };
}

describe('amazonIntegration', () => {
  it('has the expected metadata', () => {
    expect(amazonIntegration).toMatchObject({ id: 'amazon', label: 'Amazon Games', platforms: ['win32'] });
  });

  it('returns nothing on other platforms', async () => {
    expect(await amazonIntegration.scan(ctx('/nope', {}, 'linux'))).toEqual([]);
  });

  it('returns nothing when the launcher is absent', async () => {
    const root = await makeTempDir();
    expect(await amazonIntegration.scan(ctx(path.join(root, 'missing')))).toEqual([]);
  });

  it('finds games from all registry hives and the default library, sorted and de-duplicated', async () => {
    const root = await makeTempDir();
    const lib = path.join(root, 'Library');
    const elsewhere = path.join(root, 'D', 'Zeta Game');
    const hklm = path.join(root, 'H', 'Beta');
    const wow = path.join(root, 'W', 'Gamma');
    await writeGame(elsewhere, { Main: { Command: 'Zeta.exe', Args: ['-windowed', 'two words'], WorkingSubdirOverride: 'bin' } });
    await writeGame(hklm, { Main: { Command: 'bin/Beta.exe' } });
    await writeGame(wow, { Main: { Command: 'Gamma.exe', Args: 'nope' } });
    await writeGame(path.join(lib, 'alpha'), { Main: { Command: 'a.exe', Args: ['', 1, '-x'] } });
    // Already known from the registry: the library copy must not replace it.
    await writeGame(path.join(lib, 'Zeta'), { Main: { Command: 'other.exe' } });

    const outputs = {
      [`HKCU\\${UNINSTALL}`]: regKey('HKEY_CURRENT_USER', 'Zeta', { DisplayName: 'Zeta Game', InstallLocation: elsewhere }),
      [`HKLM\\${UNINSTALL}`]: regKey('HKEY_LOCAL_MACHINE', 'Beta', { DisplayName: 'Beta', InstallLocation: hklm }),
      [`HKLM\\${UNINSTALL}/reg:32`]: regKey('HKEY_LOCAL_MACHINE', 'Gamma', { InstallLocation: wow }),
    };
    const games = await amazonIntegration.scan(ctx(lib, outputs));

    expect(games).toEqual([
      { store: 'Amazon Games', id: 'alpha', title: 'alpha', installed: true, launch: { kind: 'exe', exe: path.join(lib, 'alpha', 'a.exe'), startDir: path.join(lib, 'alpha'), args: '-x' } },
      { store: 'Amazon Games', id: 'Beta', title: 'Beta', installed: true, launch: { kind: 'exe', exe: path.join(hklm, 'bin', 'Beta.exe'), startDir: hklm } },
      { store: 'Amazon Games', id: 'Gamma', title: 'Gamma', installed: true, launch: { kind: 'exe', exe: path.join(wow, 'Gamma.exe'), startDir: wow } },
      { store: 'Amazon Games', id: 'Zeta', title: 'Zeta Game', installed: true, launch: { kind: 'exe', exe: path.join(elsewhere, 'Zeta.exe'), startDir: path.join(elsewhere, 'bin'), args: '-windowed "two words"' } },
    ]);
  });

  it('skips entries without InstallLocation, foreign keys, and missing or malformed manifests', async () => {
    const root = await makeTempDir();
    const lib = path.join(root, 'Library');
    const noManifest = path.join(root, 'NoManifest');
    await mkdir(noManifest, { recursive: true });
    await writeGame(path.join(lib, 'Broken'), '{not json');
    await writeGame(path.join(lib, 'NoMain'), { SchemaVersion: '2' });
    await writeGame(path.join(lib, 'NoCommand'), { Main: { Command: 7 } });
    await writeGame(path.join(lib, 'Good'), { Main: { Command: 'Good.exe', WorkingSubdirOverride: 3 } });
    const outputs = {
      [`HKCU\\${UNINSTALL}`]: [
        regKey('HKEY_CURRENT_USER', 'NoLocation', { DisplayName: 'x' }),
        regKey('HKEY_CURRENT_USER', 'NoManifest', { InstallLocation: noManifest }),
        `HKEY_CURRENT_USER\\${UNINSTALL}\\Other App\r\n    InstallLocation    REG_SZ    ${lib}\r\n`,
      ].join('\r\n'),
    };
    const games = await amazonIntegration.scan(ctx(lib, outputs));
    expect(games.map((g) => g.id)).toEqual(['Good']);
    expect(games[0]?.launch).toEqual({ kind: 'exe', exe: path.join(lib, 'Good', 'Good.exe'), startDir: path.join(lib, 'Good') });
  });

  it('uses the default library root when AMAZON_GAMES_LIBRARY is not set', async () => {
    const context: ScanContext = { platform: 'win32', home: '/h', env: {}, run: async () => '' };
    expect(await amazonIntegration.scan(context)).toEqual([]);
  });
});
