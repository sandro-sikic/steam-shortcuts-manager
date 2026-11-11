import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { xboxIntegration } from '../../src/integrations/xbox.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);


async function install(root: string, folder: string, files: { config?: string; manifest?: string }): Promise<string> {
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  if (files.config !== undefined) await writeFile(path.join(dir, 'MicrosoftGame.config'), files.config);
  if (files.manifest !== undefined) await writeFile(path.join(dir, 'appxmanifest.xml'), files.manifest);
  return dir;
}

const config = (name: string, exe = 'Game.exe') =>
  `<Game configVersion="1"><Identity Name="x" Publisher="CN=x"/><ShellVisuals DefaultDisplayName="${name}"/><ExecutableList><Executable Name="${exe}" Id="Game"/></ExecutableList></Game>`;
const manifest = (id: string) => `<Package><Applications><Application Id="${id}" Executable="x.exe"/></Applications></Package>`;

function ctxWith(output: string, calls: { command: string; args: string[] }[] = []): ScanContext {
  return {
    platform: 'win32',
    home: 'C:\\Users\\me',
    env: {},
    run: async (command, args) => {
      calls.push({ command, args });
      return output;
    },
  };
}

describe('xbox integration', () => {
  it('describes itself', () => {
    expect(xboxIntegration).toMatchObject({ id: 'xbox', label: 'Xbox', platforms: ['win32'] });
  });

  it('returns nothing when PowerShell output is empty or not JSON', async () => {
    expect(await xboxIntegration.scan(ctxWith(''))).toEqual([]);
    expect(await xboxIntegration.scan(ctxWith('not json'))).toEqual([]);
    expect(await xboxIntegration.scan(ctxWith('null'))).toEqual([]);
  });

  it('asks PowerShell for appx packages with a MicrosoftGame.config', async () => {
    const calls: { command: string; args: string[] }[] = [];
    await xboxIntegration.scan(ctxWith('', calls));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('powershell');
    expect(calls[0]?.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command']);
    expect(calls[0]?.args[3]).toContain('Get-AppxPackage');
    expect(calls[0]?.args[3]).toContain('MicrosoftGame.config');
  });

  it('lists several games sorted by title, launching via shell:AppsFolder and waiting for the game exe', async () => {
    const root = await makeTempDir();
    const zed = await install(root, 'Zed', { config: config('Zed &amp; Co'), manifest: manifest('App') });
    const alpha = await install(root, 'Alpha', { config: config('alpha game', 'bin\\Alpha.exe'), manifest: manifest('Game') });
    const json = JSON.stringify([
      { Name: 'Pub.Zed', PackageFamilyName: 'Pub.Zed_abc', InstallLocation: zed },
      { Name: 'Pub.Alpha', PackageFamilyName: 'Pub.Alpha_abc', InstallLocation: alpha },
    ]);
    expect(await xboxIntegration.scan(ctxWith(json))).toEqual([
      { store: 'Xbox', id: 'Pub.Alpha_abc', title: 'alpha game', installed: true, launch: { kind: 'uri', uri: 'shell:AppsFolder\\Pub.Alpha_abc!Game', waitFor: 'Alpha.exe' } },
      { store: 'Xbox', id: 'Pub.Zed_abc', title: 'Zed & Co', installed: true, launch: { kind: 'uri', uri: 'shell:AppsFolder\\Pub.Zed_abc!App', waitFor: 'Game.exe' } },
    ]);
  });

  it('handles the single-object form that ConvertTo-Json emits for one package', async () => {
    const root = await makeTempDir();
    const dir = await install(root, 'One', { config: config('One'), manifest: manifest('G') });
    const json = JSON.stringify({ Name: 'Pub.One', PackageFamilyName: 'Pub.One_x', InstallLocation: dir });
    const games = await xboxIntegration.scan(ctxWith(json));
    expect(games.map((g) => g.id)).toEqual(['Pub.One_x']);
  });

  it('falls back to a cleaned package name for ms-resource or missing display names', async () => {
    const root = await makeTempDir();
    const a = await install(root, 'A', { config: config('ms-resource:AppName'), manifest: manifest('Game') });
    const b = await install(root, 'B', { config: '<Game/>', manifest: manifest('Game') });
    const c = await install(root, 'C', { config: '<Game/>' });
    const json = JSON.stringify([
      { Name: 'Contoso.SpaceGameHD', PackageFamilyName: 'A_1', InstallLocation: a },
      { Name: 'PlainName', PackageFamilyName: 'B_1', InstallLocation: b },
      { Name: 'Contoso.', PackageFamilyName: 'C_1', InstallLocation: c },
    ]);
    const games = await xboxIntegration.scan(ctxWith(json));
    expect(games.map((g) => g.title)).toEqual(['Contoso.', 'Plain Name', 'Space Game HD']);
  });

  it('defaults the application id to Game and omits waitFor when the executable is missing or unsafe', async () => {
    const root = await makeTempDir();
    const a = await install(root, 'A', { config: '<ShellVisuals DefaultDisplayName="A"/>' });
    const b = await install(root, 'B', { config: config('B', 'bad$name.exe'), manifest: '<Package/>' });
    const json = JSON.stringify([
      { Name: 'P.A', PackageFamilyName: 'A_1', InstallLocation: a },
      { Name: 'P.B', PackageFamilyName: 'B_1', InstallLocation: b },
    ]);
    const games = await xboxIntegration.scan(ctxWith(json));
    expect(games.map((g) => g.launch)).toEqual([
      { kind: 'uri', uri: 'shell:AppsFolder\\A_1!Game' },
      { kind: 'uri', uri: 'shell:AppsFolder\\B_1!Game' },
    ]);
  });

  it('skips malformed entries, packages without a readable config, and duplicates', async () => {
    const root = await makeTempDir();
    const ok = await install(root, 'Ok', { config: config('Ok'), manifest: manifest('Game') });
    const noConfig = await install(root, 'NoConfig', {});
    const json = JSON.stringify([
      null,
      'text',
      { Name: 'P.NoId', InstallLocation: ok },
      { Name: 'P.NoLoc', PackageFamilyName: 'X_1' },
      { Name: '', PackageFamilyName: 'X_2', InstallLocation: ok },
      { Name: 'P.Gone', PackageFamilyName: 'Gone_1', InstallLocation: noConfig },
      { Name: 'P.Ok', PackageFamilyName: 'Ok_1', InstallLocation: ok },
      { Name: 'P.Ok', PackageFamilyName: 'Ok_1', InstallLocation: ok },
    ]);
    const games = await xboxIntegration.scan(ctxWith(json));
    expect(games.map((g) => g.id)).toEqual(['Ok_1']);
  });
});
