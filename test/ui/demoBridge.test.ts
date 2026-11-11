// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDemoBridge, installDemoBridge } from '../../src/UI/demoBridge.js';

const request = { dryRun: true, prune: false, includeMaybe: false, artwork: false };

describe('demo bridge', () => {
  it('describes a demo Steam installation and its launchers', async () => {
    const bridge = createDemoBridge();
    expect(await bridge.status()).toEqual({ platform: 'demo', steamRunning: false, steamRoot: '/demo/Steam', accountId: '1' });
    expect((await bridge.integrations()).map((i) => i.id)).toEqual(['epic', 'gog', 'os']);
  });

  it('returns only games, or with `all` the rejected apps too', async () => {
    const bridge = createDemoBridge();
    expect((await bridge.apps(false)).every((app) => app.verdict === 'game')).toBe(true);
    expect((await bridge.apps(true)).map((app) => app.verdict)).toEqual(['game', 'game', 'game', 'no']);
  });

  it('previews a sync without changing anything', async () => {
    const bridge = createDemoBridge();
    const report = await bridge.sync(request);
    expect(report.added.map((item) => item.title)).toEqual(['Hades', 'Stardew Valley', 'Valorant']);
    expect(report.log).toEqual(['[dry run] Added:', '  Hades [GOG Galaxy]', '  Stardew Valley [Installed Apps]', '  Valorant [Riot Games]', '[dry run] 3 added, 0 updated, 0 removed, 1 unchanged']);
    expect(await bridge.shortcuts()).toHaveLength(2);
  });

  it('adds the games on a real sync, then finds nothing new', async () => {
    const bridge = createDemoBridge();
    await bridge.sync({ ...request, dryRun: false });
    const shortcuts = await bridge.shortcuts();
    expect(shortcuts.map((s) => s.title)).toEqual(['Fortnite', 'My Own Game', 'Hades', 'Stardew Valley', 'Valorant']);
    expect(new Set(shortcuts.map((s) => s.appId)).size).toBe(shortcuts.length);

    const again = await bridge.sync({ ...request, dryRun: false });
    expect(again.added).toEqual([]);
    expect(again.log).toEqual(['0 added, 0 updated, 0 removed, 4 unchanged']);
  });

  it('hands out copies, so callers cannot change its state', async () => {
    const bridge = createDemoBridge();
    (await bridge.shortcuts())[0]!.title = 'Changed';
    expect((await bridge.shortcuts())[0]?.title).toBe('Fortnite');
  });

  it('installs itself on window', async () => {
    installDemoBridge();
    expect((await window.steamManager.status()).platform).toBe('demo');
  });
});
