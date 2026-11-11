// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDemoBridge, installDemoBridge } from '../../src/UI/demoBridge.js';

const request = { dryRun: true, prune: false, includeMaybe: false, artwork: false };
const fresh = { includeMaybe: false };

describe('demo bridge', () => {
  it('describes a demo Steam installation and its launchers', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    expect(await bridge.status()).toEqual({ platform: 'demo', steamRunning: false, steamRoot: '/demo/Steam', accountId: '1' });
    expect((await bridge.integrations()).map((i) => i.id)).toEqual(['epic', 'gog', 'heroic', 'os']);
  });

  it('returns only games, or with `all` the rejected apps too', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    expect((await bridge.apps(false)).every((app) => app.verdict === 'game')).toBe(true);
    expect((await bridge.apps(true)).at(-1)?.verdict).toBe('no');
  });

  it('lists the found games grouped by launcher, with what is already in Steam', async () => {
    const { games, duplicates, warnings } = await createDemoBridge({ delayMs: 0 }).games(fresh);
    expect(games.map((g) => g.store)).toEqual(['Epic Games', 'Epic Games', 'GOG Galaxy', 'GOG Galaxy', 'Heroic (Epic Games)', 'Installed Apps']);
    expect(games.filter((g) => g.inSteam).map((g) => g.title)).toEqual(['Fortnite', 'Hades']);
    expect(games.every((g) => !g.excluded && !g.weak)).toBe(true);
    expect(new Set(games.map((g) => g.key)).size).toBe(games.length);
    expect(duplicates).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('adds the weak guess only when asked', async () => {
    const { games } = await createDemoBridge({ delayMs: 0 }).games({ includeMaybe: true });
    expect(games.at(-1)).toMatchObject({ title: 'Tiny Unity Game', weak: true });
    expect(games).toHaveLength(7);
  });

  it('remembers which games are switched off', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await bridge.setExcluded(['Epic Games:rl', 'GOG Galaxy:hades'], true);
    expect((await bridge.games(fresh)).games.filter((g) => g.excluded).map((g) => g.title)).toEqual(['Rocket League', 'Hades']);
    await bridge.setExcluded(['Epic Games:rl'], false);
    expect((await bridge.games(fresh)).games.filter((g) => g.excluded).map((g) => g.title)).toEqual(['Hades']);
  });

  it('previews a sync without changing anything', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    const report = await bridge.sync(request);
    expect(report.added.map((item) => item.title)).toEqual(['Rocket League', 'Cyberpunk 2077', 'Control', 'Stardew Valley']);
    expect(report.unchanged.map((item) => item.title)).toEqual(['Fortnite', 'Hades']);
    expect(report.removed).toEqual([]);
    expect(report.log).toEqual([
      '[dry run] Added:',
      '  Rocket League [Epic Games]',
      '  Cyberpunk 2077 [GOG Galaxy]',
      '  Control [Heroic (Epic Games)]',
      '  Stardew Valley [Installed Apps]',
      '[dry run] 4 added, 0 updated, 0 removed, 2 unchanged',
    ]);
    expect(await bridge.shortcuts()).toHaveLength(4);
  });

  it('removes our shortcut for a switched-off game, and stale ones only when pruning', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await bridge.setExcluded(['Epic Games:fn'], true);
    const plain = await bridge.sync(request);
    expect(plain.removed.map((r) => r.title)).toEqual(['Fortnite']);
    expect(plain.log).toContain('[dry run] Removed:');
    expect(plain.log).toContain('  Fortnite [Epic Games]');
    const pruning = await bridge.sync({ ...request, prune: true });
    expect(pruning.removed.map((r) => r.title)).toEqual(['Fortnite', 'Old Game']);
  });

  it('applies for real: adds, removes, and then has nothing left to do', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await bridge.setExcluded(['GOG Galaxy:hades'], true);
    await bridge.sync({ ...request, dryRun: false });
    const titles = (await bridge.shortcuts()).map((s) => s.title);
    expect(titles).toEqual(['Fortnite', 'My Own Game', 'Old Game', 'Rocket League', 'Cyberpunk 2077', 'Control', 'Stardew Valley']);
    expect((await bridge.games(fresh)).games.find((g) => g.title === 'Hades')?.inSteam).toBe(false);

    const again = await bridge.sync({ ...request, dryRun: false });
    expect(again.added).toEqual([]);
    expect(again.log).toEqual(['0 added, 0 updated, 0 removed, 5 unchanged']);
  });

  it('syncs the weak guess too when asked', async () => {
    const report = await createDemoBridge({ delayMs: 0 }).sync({ ...request, includeMaybe: true });
    expect(report.added.map((item) => item.title)).toContain('Tiny Unity Game');
  });

  it('hands out copies, so callers cannot change its state', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    (await bridge.shortcuts())[0]!.title = 'Changed';
    expect((await bridge.shortcuts())[0]?.title).toBe('Fortnite');
  });

  it('waits a moment while downloading when given a delay, so progress can be seen', async () => {
    const bridge = createDemoBridge({ delayMs: 15 });
    await bridge.setApiKey('demo-key-12345');
    const started = Date.now();
    await bridge.downloadArtwork({ appId: 1003, title: 'x', force: false });
    expect(Date.now() - started).toBeGreaterThanOrEqual(10);
  });

  it('installs itself on window', async () => {
    installDemoBridge();
    expect((await window.steamManager.status()).platform).toBe('demo');
  });

  it('keeps settings in memory, validating changes, and can reset them', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    expect((await bridge.settings()).ui.theme).toBe('system');
    expect((await bridge.updateSettings({ ui: { theme: 'dark' } })).ui.theme).toBe('dark');
    expect((await bridge.settings()).ui.theme).toBe('dark');
    await expect(bridge.updateSettings({ ui: { theme: 'neon' } } as never)).rejects.toThrow('ui.theme must be one of');
    expect((await bridge.resetSettings()).ui.theme).toBe('system');
    const copy = await bridge.settings();
    copy.ui.theme = 'light';
    expect((await bridge.settings()).ui.theme).toBe('system');
  });

  it('shows launchers as switched off when settings say so', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await bridge.updateSettings({ launchers: { disabled: ['gog'] } });
    expect((await bridge.integrations()).map((i) => [i.id, i.enabled])).toEqual([['epic', true], ['gog', false], ['heroic', true], ['os', true]]);
  });

  it('keeps the allow, deny and exclude lists, and the exclusions drive the library', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    expect(await bridge.lists()).toEqual({ allow: [], deny: ['Some Tool'], exclude: [] });
    expect(await bridge.setLists({ allow: ['Hades'] })).toEqual({ allow: ['Hades'], deny: ['Some Tool'], exclude: [] });
    expect((await bridge.setLists({ deny: [], exclude: ['Epic Games:rl', 'GOG Galaxy:hades'] })).exclude).toEqual(['Epic Games:rl', 'GOG Galaxy:hades']);
    expect((await bridge.games(fresh)).games.filter((g) => g.excluded).map((g) => g.title)).toEqual(['Rocket League', 'Hades']);
    await bridge.setLists({ exclude: [] });
    expect((await bridge.games(fresh)).games.some((g) => g.excluded)).toBe(false);
  });

  it('keeps an API key in memory and tests it', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    expect(await bridge.apiKeyStatus()).toEqual({ set: false, source: 'none', secureStorage: true });
    expect(await bridge.testApiKey()).toEqual({ ok: false, message: 'There is no API key to test.' });
    expect(await bridge.testApiKey('short')).toEqual({ ok: false, message: 'SteamGridDB rejected this key.' });
    expect(await bridge.testApiKey('long-enough-key')).toEqual({ ok: true, message: 'The key works.' });
    expect(await bridge.setApiKey('  my-demo-key  ')).toEqual({ set: true, source: 'saved', secureStorage: true });
    expect((await bridge.testApiKey()).ok).toBe(true);
    expect((await bridge.testApiKey('  ')).ok).toBe(true);
    expect(await bridge.setApiKey('')).toEqual({ set: false, source: 'none', secureStorage: true });
  });

  it('describes the demo Steam accounts and the app', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    expect((await bridge.steamAccounts()).map((a) => [a.accountId, a.mostRecent])).toEqual([['1', true], ['2', false]]);
    expect(await bridge.about()).toMatchObject({ version: 'demo', steamRoot: '/demo/Steam', artworkCache: '/demo/steam-manager/artwork-cache', secureStorage: true });
    await expect(bridge.openConfigFolder()).resolves.toBeUndefined();
  });

  it('lists generated images for the games that have artwork, in the usual order, and what is still pending', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    const found = await bridge.artwork([{ appId: 1000, title: 'Fortnite' }, { appId: 1002, title: 'Hades' }, { appId: 1003, title: 'Cyberpunk 2077' }]);
    expect(found[1000]?.items.map((i) => i.kind)).toEqual(['poster', 'wide', 'hero', 'logo', 'icon']);
    expect(found[1002]?.items.map((i) => i.kind)).toEqual(['poster', 'hero']);
    expect(found[1003]).toEqual({ items: [], choices: {}, pending: true, optionsReady: false });
    expect([found[1000]?.pending, found[1002]?.pending]).toEqual([false, true]);
    const svg = decodeURIComponent((found[1000]?.items[0]?.url ?? '').replace('data:image/svg+xml;utf8,', ''));
    expect(svg).toContain('>Fortnite<');
    expect(svg).toContain("viewBox='0 0 600 900'");
    expect(decodeURIComponent(found[1000]?.items[3]?.url ?? '').includes("fill='url(#g)'")).toBe(false);
    expect(decodeURIComponent(found[1000]?.items[4]?.url ?? '')).toContain('>F<');
  });

  it('needs a key to download, then fills in what is missing', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await expect(bridge.downloadArtwork({ appId: 1002, title: 'Hades', force: false })).rejects.toThrow('Add a SteamGridDB API key in Settings');
    await bridge.setApiKey('demo-key-12345');
    const partial = await bridge.downloadArtwork({ appId: 1002, title: 'Hades', force: false });
    expect(partial.outcomes.map((o) => o.status)).toEqual(['exists', 'saved', 'exists', 'saved', 'saved']);
    expect(partial.entry.items).toHaveLength(5);
    expect(partial.entry.pending).toBe(false);
    expect(partial.entry.choices).toEqual({});
    expect((await bridge.downloadArtwork({ appId: 1002, title: 'Hades', force: true })).outcomes.every((o) => o.status === 'saved')).toBe(true);
  });

  it('can download for a game that had no artwork at all, cleaning odd characters out of the title', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await bridge.setApiKey('demo-key-12345');
    const result = await bridge.downloadArtwork({ appId: 1003, title: 'Cyber <b>& Co', force: false });
    expect(result.outcomes.every((o) => o.status === 'saved')).toBe(true);
    expect(decodeURIComponent(result.entry.items[0]?.url ?? '')).toContain('>Cyber b Co<');
    expect((await bridge.artwork([{ appId: 1003, title: 'x' }]))[1003]?.items).toHaveLength(5);
  });

  it('lists the options of every type when asked, five by default, the first selected, with a different image for each', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await expect(bridge.loadArtworkOptions({ appId: 1002, title: 'Hades', force: false })).rejects.toThrow('Add a SteamGridDB API key in Settings');
    await bridge.setApiKey('demo-key-12345');
    const { entry } = await bridge.loadArtworkOptions({ appId: 1002, title: 'Hades', force: false });
    expect(entry.optionsReady).toBe(true);
    expect(Object.keys(entry.choices).sort()).toEqual(['hero', 'icon', 'logo', 'poster', 'wide']);
    const poster = entry.choices.poster;
    expect(poster?.options).toHaveLength(4); // five were asked for and the fourth is marked adult, so it is left out
    expect(poster?.options.map((o) => o.id)).toEqual([1000, 1001, 1002, 1004]);
    expect(poster?.selected).toBe(1000);
    expect(new Set(poster?.options.map((o) => o.thumbUrl)).size).toBe(4);
    expect(decodeURIComponent(poster?.options[1]?.thumbUrl ?? '')).toContain('>Hades 2<');
    expect(poster?.options.map((o) => o.style)).toEqual(['alternate', 'material', 'alternate', 'alternate']);
  });

  it('shows adult options only when allowed, and as many as the setting says', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await bridge.setApiKey('demo-key-12345');
    await bridge.updateSettings({ artwork: { options: 8, nsfw: true } });
    const { entry } = await bridge.loadArtworkOptions({ appId: 1002, title: 'Hades', force: false });
    expect(entry.choices.hero?.options).toHaveLength(8);
    expect(entry.choices.hero?.options.filter((o) => o.nsfw)).toHaveLength(2);
    await bridge.updateSettings({ artwork: { nsfw: false } });
    expect((await bridge.artwork([{ appId: 1002, title: 'Hades' }]))[1002]?.choices.hero?.options).toHaveLength(6);
  });

  it('remembers picks: another image, none, and a pick that is no longer offered falls back to the first', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    await bridge.setApiKey('demo-key-12345');
    await bridge.loadArtworkOptions({ appId: 1002, title: 'Hades', force: false });
    const picked = await bridge.chooseArtwork({ appId: 1002, title: 'Hades', kind: 'poster', imageId: 1002 });
    expect(picked.entry.choices.poster?.selected).toBe(1002);
    expect(decodeURIComponent(picked.entry.items.find((i) => i.kind === 'poster')?.url ?? '')).toContain('>Hades 3<');
    const none = await bridge.chooseArtwork({ appId: 1002, title: 'Hades', kind: 'hero', imageId: null });
    expect(none.entry.choices.hero?.selected).toBeNull();
    expect(none.entry.items.some((i) => i.kind === 'hero')).toBe(false);
    const stale = await bridge.chooseArtwork({ appId: 1002, title: 'Hades', kind: 'logo', imageId: 9999 });
    expect(stale.entry.choices.logo?.selected).toBe(4000);
    expect((await bridge.artwork([{ appId: 1002, title: 'Hades' }]))[1002]?.choices.poster?.selected).toBe(1002);
  });

  it('can take a pick for a game it knows nothing about yet', async () => {
    const bridge = createDemoBridge({ delayMs: 0 });
    const result = await bridge.chooseArtwork({ appId: 1005, title: 'Stardew Valley', kind: 'icon', imageId: 5001 });
    expect(result.entry.optionsReady).toBe(false);
    expect(result.entry.items.map((i) => i.kind)).toEqual(['icon']);
    expect(result.entry.choices).toEqual({});
  });
});
