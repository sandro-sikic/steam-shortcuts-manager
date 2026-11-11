// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDemoBridge, installDemoBridge } from '../../src/UI/demoBridge.js';

const request = { dryRun: true, prune: false, includeMaybe: false, artwork: false };
const fresh = { includeMaybe: false };

describe('demo bridge', () => {
  it('describes a demo Steam installation and its launchers', async () => {
    const bridge = createDemoBridge();
    expect(await bridge.status()).toEqual({ platform: 'demo', steamRunning: false, steamRoot: '/demo/Steam', accountId: '1' });
    expect((await bridge.integrations()).map((i) => i.id)).toEqual(['epic', 'gog', 'heroic', 'os']);
  });

  it('returns only games, or with `all` the rejected apps too', async () => {
    const bridge = createDemoBridge();
    expect((await bridge.apps(false)).every((app) => app.verdict === 'game')).toBe(true);
    expect((await bridge.apps(true)).at(-1)?.verdict).toBe('no');
  });

  it('lists the found games grouped by launcher, with what is already in Steam', async () => {
    const { games, duplicates, warnings } = await createDemoBridge().games(fresh);
    expect(games.map((g) => g.store)).toEqual(['Epic Games', 'Epic Games', 'GOG Galaxy', 'GOG Galaxy', 'Heroic (Epic Games)', 'Installed Apps']);
    expect(games.filter((g) => g.inSteam).map((g) => g.title)).toEqual(['Fortnite', 'Hades']);
    expect(games.every((g) => !g.excluded && !g.weak)).toBe(true);
    expect(new Set(games.map((g) => g.key)).size).toBe(games.length);
    expect(duplicates).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('adds the weak guess only when asked', async () => {
    const { games } = await createDemoBridge().games({ includeMaybe: true });
    expect(games.at(-1)).toMatchObject({ title: 'Tiny Unity Game', weak: true });
    expect(games).toHaveLength(7);
  });

  it('remembers which games are switched off', async () => {
    const bridge = createDemoBridge();
    await bridge.setExcluded(['Epic Games:rl', 'GOG Galaxy:hades'], true);
    expect((await bridge.games(fresh)).games.filter((g) => g.excluded).map((g) => g.title)).toEqual(['Rocket League', 'Hades']);
    await bridge.setExcluded(['Epic Games:rl'], false);
    expect((await bridge.games(fresh)).games.filter((g) => g.excluded).map((g) => g.title)).toEqual(['Hades']);
  });

  it('previews a sync without changing anything', async () => {
    const bridge = createDemoBridge();
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
    const bridge = createDemoBridge();
    await bridge.setExcluded(['Epic Games:fn'], true);
    const plain = await bridge.sync(request);
    expect(plain.removed.map((r) => r.title)).toEqual(['Fortnite']);
    expect(plain.log).toContain('[dry run] Removed:');
    expect(plain.log).toContain('  Fortnite [Epic Games]');
    const pruning = await bridge.sync({ ...request, prune: true });
    expect(pruning.removed.map((r) => r.title)).toEqual(['Fortnite', 'Old Game']);
  });

  it('applies for real: adds, removes, and then has nothing left to do', async () => {
    const bridge = createDemoBridge();
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
    const report = await createDemoBridge().sync({ ...request, includeMaybe: true });
    expect(report.added.map((item) => item.title)).toContain('Tiny Unity Game');
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
