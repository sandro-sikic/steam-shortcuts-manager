import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDesktopEntry, parseExec, scanLinuxApps } from '../../src/integrations/os/linux.js';
import type { ScanContext } from '../../src/integrations/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers.js';

afterEach(cleanupTempDirs);

const linuxOnly = describe.skipIf(process.platform === 'win32');

describe('parseDesktopEntry', () => {
  it('reads only the [Desktop Entry] group, ignoring comments, localized keys and later duplicates', () => {
    const entry = parseDesktopEntry(
      '# comment\n[Desktop Entry]\nName=Hades\nName[de]=Hades DE\nExec=hades %U\r\nName=Second\n\n[Desktop Action x]\nName=Action\nExec=nope\n',
    );
    expect([...entry]).toEqual([['Name', 'Hades'], ['Exec', 'hades %U']]);
  });

  it('returns nothing for text without a Desktop Entry group', () => {
    expect(parseDesktopEntry('[Other]\nName=x\n').size).toBe(0);
  });
});

describe('parseExec', () => {
  it('splits on whitespace and honors quotes and escapes', () => {
    expect(parseExec('/usr/bin/game --name "My Game" "a\\"b" plain')).toEqual(['/usr/bin/game', '--name', 'My Game', 'a"b', 'plain']);
    expect(parseExec('  game   ""  x ')).toEqual(['game', 'x']);
  });

  it('removes field codes but keeps literal percent signs and unknown codes', () => {
    expect(parseExec('game %U %f --url=%u 100%% %z')).toEqual(['game', '--url=', '100%', '%z']);
  });

  it('handles an unterminated quote and trailing backslash inside quotes', () => {
    expect(parseExec('game "abc')).toEqual(['game', 'abc']);
    expect(parseExec('game "abc\\')).toEqual(['game', 'abc\\']);
  });

  it('returns nothing for an empty value', () => {
    expect(parseExec('')).toEqual([]);
  });
});

linuxOnly('scanLinuxApps', () => {
  async function setup() {
    const home = await makeTempDir();
    const dataHome = await makeTempDir();
    const system = await makeTempDir();
    const bin = await makeTempDir();
    const exe = path.join(bin, 'hades');
    await writeFile(exe, '#!/bin/sh\n');
    await chmod(exe, 0o755);
    const ctx: ScanContext = {
      platform: 'linux',
      home,
      env: { XDG_DATA_HOME: dataHome, XDG_DATA_DIRS: system, PATH: bin },
      run: async () => '',
    };
    const write = async (base: string, file: string, content: string) => {
      const dir = path.join(base, 'applications');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, file), content);
    };
    return { ctx, dataHome, system, bin, exe, write };
  }
  const desktop = (lines: string[]) => `[Desktop Entry]\nType=Application\n${lines.join('\n')}\n`;

  it('lists visible applications, flagging the Game category and resolving Exec through PATH', async () => {
    const { ctx, dataHome, system, exe, write } = await setup();
    await write(dataHome, 'hades.desktop', desktop(['Name=Hades', 'Exec=hades --fullscreen "my save" %U', 'Categories=Game;ActionGame;', 'Path=/opt/hades']));
    await write(system, 'editor.desktop', desktop(['Name=Editor', `Exec=${exe}`, 'Categories=Utility;TextEditor;']));
    await write(system, 'nocat.desktop', desktop(['Name=No Categories', `Exec=${exe}`]));

    const apps = await scanLinuxApps(ctx);
    const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
    expect(Object.keys(byId).sort()).toEqual(['editor', 'hades', 'nocat']);
    expect(byId['hades']).toEqual({
      id: 'hades',
      name: 'Hades',
      categories: ['Game', 'ActionGame'],
      signals: ['freedesktop-game'],
      launch: { kind: 'exe', exe, args: "--fullscreen 'my save'", startDir: '/opt/hades' },
    });
    expect(byId['editor']?.signals).toEqual([]);
    expect(byId['nocat']?.categories).toEqual([]);
    expect(byId['nocat']?.launch).toEqual({ kind: 'exe', exe, args: undefined, startDir: undefined });
  });

  it('lets earlier directories override later ones with the same desktop id', async () => {
    const { ctx, dataHome, system, exe, write } = await setup();
    await write(dataHome, 'g.desktop', desktop(['Name=User Copy', `Exec=${exe}`]));
    await write(system, 'g.desktop', desktop(['Name=System Copy', `Exec=${exe}`]));
    expect((await scanLinuxApps(ctx)).map((a) => a.name)).toEqual(['User Copy']);
  });

  it('skips hidden, non-application, incomplete and unlaunchable entries', async () => {
    const { ctx, dataHome, bin, exe, write } = await setup();
    await write(dataHome, 'nodisplay.desktop', desktop(['Name=A', `Exec=${exe}`, 'NoDisplay=true']));
    await write(dataHome, 'hidden.desktop', desktop(['Name=B', `Exec=${exe}`, 'Hidden=true']));
    await write(dataHome, 'link.desktop', `[Desktop Entry]\nType=Link\nName=C\nExec=${exe}\n`);
    await write(dataHome, 'notype.desktop', `[Desktop Entry]\nName=D\nExec=${exe}\n`);
    await write(dataHome, 'noname.desktop', desktop([`Exec=${exe}`]));
    await write(dataHome, 'noexec.desktop', desktop(['Name=E']));
    await write(dataHome, 'missing.desktop', desktop(['Name=F', 'Exec=does-not-exist-anywhere']));
    await write(dataHome, 'abs-missing.desktop', desktop(['Name=G', `Exec=${path.join(bin, 'nope')}`]));
    await write(dataHome, 'plain.txt', 'not a desktop file');
    await mkdir(path.join(dataHome, 'applications', 'dir.desktop'));
    const plain = path.join(bin, 'plain');
    await writeFile(plain, 'x');
    await chmod(plain, 0o644);
    await write(dataHome, 'notexec.desktop', desktop(['Name=H', `Exec=${plain}`]));
    expect(await scanLinuxApps(ctx)).toEqual([]);
  });

  it('works with the default data dirs and an unset PATH, and with no applications at all', async () => {
    const home = await makeTempDir();
    const apps = await scanLinuxApps({ platform: 'linux', home, env: {}, run: async () => '' });
    expect(Array.isArray(apps)).toBe(true);
  });
});
