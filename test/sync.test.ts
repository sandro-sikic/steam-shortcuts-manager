import { describe, expect, it } from 'vitest';
import { buildShortcut, getField, MANAGED_TAG, setField, shortcutAppId, shortcutTags } from '../src/steam/shortcuts.js';
import { planSync, type SyncGame } from '../src/steam/sync.js';

const game = (over: Partial<SyncGame> = {}): SyncGame => ({
  store: 'Epic Games',
  title: 'Fortnite',
  installed: true,
  exe: '/games/fortnite',
  ...over,
});

const managed = (g: SyncGame) => buildShortcut({ title: g.title, exe: g.exe, startDir: g.startDir, launchOptions: g.launchOptions, tags: [g.store, MANAGED_TAG] });

describe('planSync', () => {
  it('adds installed games and ignores uninstalled ones', () => {
    const result = planSync([], [game(), game({ title: 'Gone', installed: false })], { prune: false });
    expect(result.added).toEqual([{ appId: expect.any(Number), title: 'Fortnite', store: 'Epic Games' }]);
    expect(result.entries).toHaveLength(1);
    expect(shortcutTags(result.entries[0]!)).toEqual(['Epic Games', MANAGED_TAG]);
  });

  it('leaves identical managed shortcuts unchanged', () => {
    const existing = [managed(game())];
    const result = planSync(existing, [game()], { prune: false });
    expect(result.unchanged).toHaveLength(1);
    expect(result.added).toHaveLength(0);
    expect(result.entries).toEqual(existing);
  });

  it('updates owned fields in place and preserves the rest', () => {
    const existing = managed(game());
    setField(existing, 'LastPlayTime', 1234);
    setField(existing, 'icon', '/icon.png');
    const result = planSync([existing], [game({ store: 'GOG', launchOptions: '-x', startDir: '/games' })], { prune: false });
    expect(result.updated).toHaveLength(1);
    const updated = result.entries[0]!;
    expect(shortcutTags(updated)).toEqual(['GOG', MANAGED_TAG]);
    expect(getField(updated, 'LaunchOptions')).toBe('-x');
    expect(getField(updated, 'StartDir')).toBe('"/games"');
    expect(getField(updated, 'LastPlayTime')).toBe(1234);
    expect(getField(updated, 'icon')).toBe('/icon.png');
    expect(shortcutAppId(updated)).toBe(shortcutAppId(existing));
    // the input entry was not mutated
    expect(shortcutTags(existing)).toEqual(['Epic Games', MANAGED_TAG]);
  });

  it('never touches shortcuts it does not manage', () => {
    const foreign = buildShortcut({ title: 'Fortnite', exe: '/games/fortnite', tags: ['Mine'] });
    const result = planSync([foreign], [game()], { prune: true });
    expect(result.skipped).toHaveLength(1);
    expect(result.entries).toEqual([foreign]);
  });

  it('skips duplicate games', () => {
    const result = planSync([], [game(), game()], { prune: false });
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('prunes only managed shortcuts that are no longer provided', () => {
    const stale = managed(game({ title: 'Old', exe: '/old' }));
    const foreign = buildShortcut({ title: 'Mine', exe: '/mine', tags: [] });
    const kept = managed(game());
    const noTag = buildShortcut({ title: 'Tagless', exe: '/t', tags: [MANAGED_TAG] });

    const pruned = planSync([stale, foreign, kept, noTag], [game()], { prune: true });
    expect(pruned.removed.map((r) => [r.title, r.store])).toEqual([['Old', 'Epic Games'], ['Tagless', '']]);
    expect(pruned.entries).toEqual([foreign, kept]);

    const notPruned = planSync([stale, foreign, kept], [game()], { prune: false });
    expect(notPruned.removed).toHaveLength(0);
    expect(notPruned.entries).toEqual([stale, foreign, kept]);
  });

  it('keeps order: existing entries first, additions last', () => {
    const first = buildShortcut({ title: 'A', exe: '/a', tags: [] });
    const result = planSync([first], [game()], { prune: false });
    expect(result.entries[0]).toBe(first);
    expect(result.entries).toHaveLength(2);
  });
});
