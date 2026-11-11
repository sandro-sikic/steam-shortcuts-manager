import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configDir, loadConfig, updateConfig } from '../src/config.js';
import { cleanupTempDirs, makeTempDir } from './helpers.js';

afterEach(cleanupTempDirs);

describe('configDir', () => {
  it('follows each platform convention', () => {
    expect(configDir('win32', 'C:\\Users\\h', { APPDATA: 'D:\\Roaming' })).toBe('D:\\Roaming\\steam-manager');
    expect(configDir('win32', 'C:\\Users\\h', {})).toBe('C:\\Users\\h\\AppData\\Roaming\\steam-manager');
    expect(configDir('darwin', '/Users/h', {})).toBe('/Users/h/Library/Application Support/steam-manager');
    expect(configDir('linux', '/h', { XDG_CONFIG_HOME: '/x' })).toBe('/x/steam-manager');
    expect(configDir('linux', '/h', {})).toBe('/h/.config/steam-manager');
  });
});

describe('loadConfig', () => {
  async function withConfig(content: string): Promise<string> {
    const dir = await makeTempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'config.json'), content);
    return dir;
  }

  it('means no overrides when there is no file', async () => {
    expect(await loadConfig(await makeTempDir())).toEqual({ allow: [], deny: [], exclude: [] });
  });

  it('reads allow and deny lists, each optional', async () => {
    expect(await loadConfig(await withConfig('{"allow":["Hades"],"deny":["Solitaire","x"],"exclude":["Epic Games:fn"]}'))).toEqual({
      allow: ['Hades'],
      deny: ['Solitaire', 'x'],
      exclude: ['Epic Games:fn'],
    });
    expect(await loadConfig(await withConfig('{"allow":["A"]}'))).toEqual({ allow: ['A'], deny: [], exclude: [] });
    expect(await loadConfig(await withConfig('{}'))).toEqual({ allow: [], deny: [], exclude: [] });
  });

  it('reports invalid files instead of silently ignoring them', async () => {
    await expect(loadConfig(await withConfig('{nope'))).rejects.toThrow('Invalid config file');
    await expect(loadConfig(await withConfig('[]'))).rejects.toThrow('expected a JSON object');
    await expect(loadConfig(await withConfig('null'))).rejects.toThrow('expected a JSON object');
    await expect(loadConfig(await withConfig('"text"'))).rejects.toThrow('expected a JSON object');
    await expect(loadConfig(await withConfig('{"allow":"Hades"}'))).rejects.toThrow('"allow" must be a list of strings');
    await expect(loadConfig(await withConfig('{"deny":[1]}'))).rejects.toThrow('"deny" must be a list of strings');
    await expect(loadConfig(await withConfig('{"exclude":{}}'))).rejects.toThrow('"exclude" must be a list of strings');
  });
});

describe('updateConfig', () => {
  it('creates the config file and folder, returning the new config', async () => {
    const dir = path.join(await makeTempDir(), 'nested', 'steam-manager');
    expect(await updateConfig(dir, { exclude: ['a:1'] })).toEqual({ allow: [], deny: [], exclude: ['a:1'] });
    expect(JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'))).toEqual({ allow: [], deny: [], exclude: ['a:1'] });
    expect(await loadConfig(dir)).toEqual({ allow: [], deny: [], exclude: ['a:1'] });
  });

  it('changes only what it is given and keeps other settings, including unknown ones', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'config.json'), '{"allow":["Hades"],"deny":["x"],"theme":"dark"}');
    await updateConfig(dir, { exclude: ['b:2'] });
    expect(JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'))).toEqual({ allow: ['Hades'], deny: ['x'], exclude: ['b:2'], theme: 'dark' });
    await updateConfig(dir, { allow: [] });
    expect((await loadConfig(dir)).exclude).toEqual(['b:2']);
  });

  it('refuses to overwrite a file it cannot read', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'config.json'), '{broken');
    await expect(updateConfig(dir, { exclude: [] })).rejects.toThrow('Invalid config file');
    expect(await readFile(path.join(dir, 'config.json'), 'utf8')).toBe('{broken');
  });
});
