import { describe, expect, it } from 'vitest';
import { classifyApp, type Rules } from '../../src/integrations/os/classify.js';
import type { InstalledApp } from '../../src/integrations/os/types.js';

const app = (over: Partial<InstalledApp> = {}): InstalledApp => ({
  id: 'hades',
  name: 'Hades',
  launch: { kind: 'exe', exe: '/opt/hades/hades' },
  signals: ['freedesktop-game'],
  ...over,
});
const rules = (allow: string[] = [], deny: string[] = []): Rules => ({ allow: new Set(allow), deny: new Set(deny) });

describe('classifyApp', () => {
  it('accepts strong signals', () => {
    expect(classifyApp(app(), rules())).toMatchObject({ verdict: 'game', reason: 'freedesktop-game' });
    expect(classifyApp(app({ signals: ['game-bar'] }), rules())).toMatchObject({ verdict: 'game', reason: 'game-bar' });
  });

  it('treats engine fingerprints as only a maybe', () => {
    expect(classifyApp(app({ signals: ['unity'] }), rules())).toMatchObject({ verdict: 'maybe', reason: 'unity' });
    expect(classifyApp(app({ signals: ['unreal'] }), rules())).toMatchObject({ verdict: 'maybe', reason: 'unreal' });
  });

  it('prefers a strong signal over a weak one', () => {
    expect(classifyApp(app({ signals: ['unity', 'game-bar'] }), rules()).verdict).toBe('game');
  });

  it('rejects apps with no signal', () => {
    expect(classifyApp(app({ signals: [] }), rules())).toMatchObject({ verdict: 'no', reason: 'no sign that it is a game' });
  });

  it('lets the config deny or allow by title or id, and deny wins', () => {
    expect(classifyApp(app(), rules([], ['hades']))).toMatchObject({ verdict: 'no', reason: 'denied by config' });
    expect(classifyApp(app({ id: 'org.x.Solitaire', name: 'Other' }), rules([], ['orgxsolitaire'])).verdict).toBe('no');
    expect(classifyApp(app({ signals: [] }), rules(['hades']))).toMatchObject({ verdict: 'game', reason: 'allowed by config' });
    expect(classifyApp(app({ signals: [], id: 'abc', name: 'Z' }), rules(['abc'])).verdict).toBe('game');
    expect(classifyApp(app(), rules(['hades'], ['hades'])).verdict).toBe('no');
  });

  it('lets an allow entry override the category and name filters', () => {
    expect(classifyApp(app({ name: 'My Launcher Game', signals: [] }), rules(['mylaunchergame'])).verdict).toBe('game');
  });

  it.each([
    ['Steam entries by id', { id: 'steam_app_620' }, 'already managed by Steam'],
    ['Steam URIs', { launch: { kind: 'uri' as const, uri: 'steam://rungameid/620' } }, 'already managed by Steam'],
    ['the steam binary', { launch: { kind: 'exe' as const, exe: '/usr/bin/steam' } }, 'already managed by Steam'],
    ['steam:// arguments', { launch: { kind: 'exe' as const, exe: '/usr/bin/x', args: 'steam://run/1' } }, 'already managed by Steam'],
    ['games inside steamapps', { launch: { kind: 'exe' as const, exe: 'C:\\Steam\\steamapps\\common\\G\\g.exe' } }, 'already managed by Steam'],
    ['known launchers', { name: 'Heroic Games Launcher' }, 'a launcher or game tool, not a game'],
    ['known tools', { name: 'Lutris' }, 'a launcher or game tool, not a game'],
    ['launcher-like names', { name: 'Foo Launcher' }, 'the name says it is not a game itself'],
    ['emulator-like names', { name: 'Some Emulator' }, 'the name says it is not a game itself'],
    ['emulator category', { categories: ['Game', 'Emulator'] }, 'categorized as Emulator'],
    ['utility category', { categories: ['Game', 'Utility'] }, 'categorized as Utility'],
  ])('rejects %s even with a strong signal', (_label, over, reason) => {
    expect(classifyApp(app(over), rules())).toMatchObject({ verdict: 'no', reason });
  });

  it('accepts ordinary game categories and apps without categories', () => {
    expect(classifyApp(app({ categories: ['Game', 'ActionGame'] }), rules()).verdict).toBe('game');
    expect(classifyApp(app({ categories: undefined }), rules()).verdict).toBe('game');
    expect(classifyApp(app({ launch: { kind: 'uri', uri: 'uplay://launch/1/0' } }), rules()).verdict).toBe('game');
    expect(classifyApp(app({ launch: { kind: 'exe', exe: '/usr/bin/x', args: '--fast' } }), rules()).verdict).toBe('game');
  });
});
