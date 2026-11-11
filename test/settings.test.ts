import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applySettings, DEFAULT_SETTINGS, loadSettings, resetSettings, updateSettings } from '../src/settings.js';
import { makeTempDir, cleanupTempDirs } from './helpers.js';

afterEach(cleanupTempDirs);

const read = async (dir: string) => JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'));

describe('defaults', () => {
  it('are safe: preview first, nothing removed, auto-detect Steam, all artwork, system theme', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      steam: { dir: '', user: '', allowRunning: false },
      artwork: { kinds: ['poster', 'wide', 'hero', 'logo', 'icon'], auto: true, options: 5, nsfw: false },
      sync: { mode: 'preview', prune: false, includeMaybe: false, artwork: true, autoApply: false },
      launchers: { disabled: [] },
      ui: { theme: 'system', cardSize: 'medium' },
    });
  });
});

describe('applySettings', () => {
  it('changes only the given fields, leaves the base untouched and returns a new object', () => {
    const next = applySettings(DEFAULT_SETTINGS, { sync: { mode: 'apply' }, ui: { theme: 'dark' } });
    expect(next.sync).toEqual({ ...DEFAULT_SETTINGS.sync, mode: 'apply' });
    expect(next.ui).toEqual({ theme: 'dark', cardSize: 'medium' });
    expect(next.steam).toEqual(DEFAULT_SETTINGS.steam);
    expect(DEFAULT_SETTINGS.sync.mode).toBe('preview');
    expect(applySettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS);
    expect(applySettings(DEFAULT_SETTINGS, {})).not.toBe(DEFAULT_SETTINGS);
  });

  it('accepts valid values of every kind', () => {
    const next = applySettings(DEFAULT_SETTINGS, {
      steam: { dir: '  /games/Steam ', user: '12345', allowRunning: true },
      artwork: { kinds: ['hero', 'poster', 'hero'], auto: false, options: 20, nsfw: true },
      sync: { prune: true, includeMaybe: true, artwork: false, autoApply: true },
      launchers: { disabled: ['riot', 'riot', 'ea'] },
      ui: { cardSize: 'large' },
    });
    expect(next.steam).toEqual({ dir: '/games/Steam', user: '12345', allowRunning: true });
    expect(next.artwork).toEqual({ kinds: ['hero', 'poster'], auto: false, options: 20, nsfw: true });
    expect(applySettings(DEFAULT_SETTINGS, { artwork: { options: 1 } }).artwork.options).toBe(1);
    expect(next.launchers.disabled).toEqual(['riot', 'ea']);
    expect(next.sync).toMatchObject({ prune: true, includeMaybe: true, artwork: false, autoApply: true });
    expect(applySettings(DEFAULT_SETTINGS, { steam: { user: '' } }).steam.user).toBe('');
    expect(applySettings(DEFAULT_SETTINGS, { artwork: { kinds: [] } }).artwork.kinds).toEqual([]);
  });

  it.each([
    [{ steam: { dir: 5 } }, 'steam.dir must be text'],
    [{ steam: { user: 'abc' } }, 'steam.user must be a number'],
    [{ steam: { user: 7 } }, 'steam.user must be text'],
    [{ steam: { allowRunning: 'yes' } }, 'steam.allowRunning must be true or false'],
    [{ artwork: { auto: 'yes' } }, 'artwork.auto must be true or false'],
    [{ artwork: { nsfw: 'yes' } }, 'artwork.nsfw must be true or false'],
    [{ artwork: { options: 0 } }, 'artwork.options must be a whole number from 1 to 20'],
    [{ artwork: { options: 21 } }, 'artwork.options must be a whole number from 1 to 20'],
    [{ artwork: { options: 2.5 } }, 'artwork.options must be a whole number from 1 to 20'],
    [{ artwork: { options: '5' } }, 'artwork.options must be a whole number from 1 to 20'],
    [{ sync: { mode: 'later' } }, 'sync.mode must be one of: preview, apply'],
    [{ sync: { mode: 3 } }, 'sync.mode must be one of'],
    [{ ui: { theme: 'neon' } }, 'ui.theme must be one of: system, light, dark'],
    [{ artwork: { kinds: ['poster', 'banner'] } }, 'artwork.kinds must be a list of: poster, wide, hero, logo, icon'],
    [{ artwork: { kinds: 'poster' } }, 'artwork.kinds must be a list of'],
    [{ launchers: { disabled: [1] } }, 'launchers.disabled must be a list of text'],
    [{ launchers: { disabled: 'riot' } }, 'launchers.disabled must be a list of text'],
  ])('rejects %j', (patch, message) => {
    expect(() => applySettings(DEFAULT_SETTINGS, patch)).toThrow(message);
  });

  it('rejects unknown sections and settings, and values of the wrong shape', () => {
    expect(() => applySettings(DEFAULT_SETTINGS, { colors: {} })).toThrow('unknown settings section "colors"');
    expect(() => applySettings(DEFAULT_SETTINGS, { ui: { font: 'x' } })).toThrow('unknown setting "ui.font"');
    expect(() => applySettings(DEFAULT_SETTINGS, { ui: 'dark' })).toThrow('ui must be an object');
    expect(() => applySettings(DEFAULT_SETTINGS, { ui: null })).toThrow('ui must be an object');
    expect(() => applySettings(DEFAULT_SETTINGS, { ui: [] })).toThrow('ui must be an object');
    expect(() => applySettings(DEFAULT_SETTINGS, null)).toThrow('settings must be an object');
    expect(() => applySettings(DEFAULT_SETTINGS, [])).toThrow('settings must be an object');
    expect(() => applySettings(DEFAULT_SETTINGS, 'x')).toThrow('settings must be an object');
  });
});

describe('loadSettings', () => {
  it('gives the defaults when there is no file or no settings in it', async () => {
    const dir = await makeTempDir();
    expect(await loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
    await writeFile(path.join(dir, 'config.json'), '{"allow":["x"]}');
    expect(await loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in what a saved file leaves out', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'config.json'), '{"settings":{"ui":{"theme":"light"}}}');
    const loaded = await loadSettings(dir);
    expect(loaded.ui).toEqual({ theme: 'light', cardSize: 'medium' });
    expect(loaded.sync).toEqual(DEFAULT_SETTINGS.sync);
  });

  it('reports bad settings instead of ignoring them', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'config.json'), '{"settings":{"ui":{"theme":"neon"}}}');
    await expect(loadSettings(dir)).rejects.toThrow('Invalid settings in config file: ui.theme must be one of');
    await writeFile(path.join(dir, 'config.json'), '{"settings":5}');
    await expect(loadSettings(dir)).rejects.toThrow('Invalid settings in config file: settings must be an object');
    await writeFile(path.join(dir, 'config.json'), '{broken');
    await expect(loadSettings(dir)).rejects.toThrow('Invalid config file');
  });
});

describe('updateSettings', () => {
  it('saves into config.json, creating it, and keeps the game lists and unknown keys', async () => {
    const dir = path.join(await makeTempDir(), 'new', 'steam-manager');
    const saved = await updateSettings(dir, { ui: { theme: 'dark' } });
    expect(saved.ui.theme).toBe('dark');
    expect((await read(dir)).settings.ui.theme).toBe('dark');

    await writeFile(path.join(dir, 'config.json'), JSON.stringify({ allow: ['A'], exclude: ['x:1'], extra: 1, settings: { ui: { theme: 'dark' } } }));
    await updateSettings(dir, { sync: { prune: true } });
    const file = await read(dir);
    expect(file).toMatchObject({ allow: ['A'], exclude: ['x:1'], extra: 1 });
    expect(file.settings.ui.theme).toBe('dark');
    expect(file.settings.sync.prune).toBe(true);
  });

  it('refuses a bad patch and a bad existing file, leaving the file alone', async () => {
    const dir = await makeTempDir();
    await expect(updateSettings(dir, { ui: { theme: 'neon' } })).rejects.toThrow('ui.theme must be one of');
    await expect(stat(path.join(dir, 'config.json'))).rejects.toThrow();
    await writeFile(path.join(dir, 'config.json'), '{broken');
    await expect(updateSettings(dir, { ui: { theme: 'dark' } })).rejects.toThrow('Invalid config file');
    expect(await readFile(path.join(dir, 'config.json'), 'utf8')).toBe('{broken');
  });
});

describe('resetSettings', () => {
  it('restores the defaults but keeps the game lists', async () => {
    const dir = await makeTempDir();
    await writeFile(path.join(dir, 'config.json'), JSON.stringify({ exclude: ['x:1'], settings: { ui: { theme: 'dark' } } }));
    expect(await resetSettings(dir)).toEqual(DEFAULT_SETTINGS);
    expect(await read(dir)).toMatchObject({ exclude: ['x:1'], settings: DEFAULT_SETTINGS });
    expect(await loadSettings(dir)).toEqual(DEFAULT_SETTINGS);
  });
});
