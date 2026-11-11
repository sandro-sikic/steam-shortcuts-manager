import { describe, expect, it } from 'vitest';
import { dedupeGames, gameKey, launchKey, normalizeExe, normalizeTitle, type KnownGames } from '../src/dedupe.js';
import type { Game } from '../src/types.js';

const game = (title: string, exe = `/games/${title}`, store = 'Epic Games'): Game => ({
  store,
  id: title,
  title,
  installed: true,
  launch: { kind: 'exe', exe },
});

const none: KnownGames = { titles: new Map(), launchKeys: new Map() };

describe('normalizeTitle', () => {
  it('ignores case, punctuation, symbols, accents and spacing', () => {
    expect(normalizeTitle('Hades™')).toBe('hades');
    expect(normalizeTitle(' HADES ')).toBe('hades');
    expect(normalizeTitle("Marvel's Spider-Man: Remastered")).toBe('marvelsspidermanremastered');
    expect(normalizeTitle('Rock & Roll')).toBe('rockandroll');
    expect(normalizeTitle('Café Ünïcode')).toBe('cafeunicode');
    expect(normalizeTitle('!!!')).toBe('');
  });
});

describe('gameKey', () => {
  it('joins the store and the store-specific id', () => {
    expect(gameKey({ store: 'Epic Games', id: 'fn' })).toBe('Epic Games:fn');
    expect(gameKey(game('Hades', '/x', 'GOG Galaxy'))).toBe('GOG Galaxy:Hades');
  });
});

describe('launch keys', () => {
  it('normalizes executable paths (quotes, slashes, case, dot segments)', () => {
    expect(normalizeExe('"C:\\Games\\Hades\\Hades.exe"')).toBe('c:/games/hades/hades.exe');
    expect(normalizeExe('/a/b/../c')).toBe('/a/c');
  });

  it('distinguishes executables from URIs', () => {
    expect(launchKey(game('X', '/G/X'))).toBe('exe:/g/x|');
    const withArgs: Game = { ...game('X', '/G/X'), launch: { kind: 'exe', exe: '/G/X', args: '--launch-product=valorant' } };
    expect(launchKey(withArgs)).toBe('exe:/g/x|--launch-product=valorant');
    const uri: Game = { ...game('X'), launch: { kind: 'uri', uri: 'Heroic://Launch/legendary/X' } };
    expect(launchKey(uri)).toBe('uri:heroic://launch/legendary/x');
  });
});

describe('dedupeGames', () => {
  it('keeps unique games untouched', () => {
    const games = [game('A'), game('B')];
    expect(dedupeGames(games, none)).toEqual({ unique: games, duplicates: [] });
  });

  it('drops a later game with the same title, naming what it duplicates (first wins)', () => {
    const first = game('Hades', '/epic/hades', 'Epic Games');
    const second = game('HADES™', '/gog/hades', 'GOG Galaxy');
    const { unique, duplicates } = dedupeGames([first, second], none);
    expect(unique).toEqual([first]);
    expect(duplicates).toEqual([{ game: second, of: 'Hades [Epic Games]' }]);
  });

  it('drops a later game with the same launch target even when the titles differ', () => {
    const first = game('Hades', '/same/exe');
    const second = game('Hades (copy)', '/SAME/exe', 'Installed Apps');
    expect(dedupeGames([first, second], none).duplicates).toEqual([{ game: second, of: 'Hades [Epic Games]' }]);
  });

  it('keeps games that share an executable but start different things (different arguments)', () => {
    const lol: Game = { ...game('League', '/riot/client.exe'), launch: { kind: 'exe', exe: '/riot/client.exe', args: '--launch-product=lol' } };
    const val: Game = { ...game('Valorant', '/riot/client.exe'), launch: { kind: 'exe', exe: '/riot/client.exe', args: '--launch-product=valorant' } };
    expect(dedupeGames([lol, val], none).unique).toEqual([lol, val]);
  });

  it('drops games that are already known (Steam library, existing shortcuts)', () => {
    const known: KnownGames = {
      titles: new Map([[normalizeTitle('Portal 2'), 'Portal 2 (installed in Steam)']]),
      launchKeys: new Map([['exe:/mine/game|', 'Mine (your own shortcut)']]),
    };
    const byTitle = game('Portal 2');
    const byExe = game('Whatever', '/mine/game');
    const fresh = game('Fresh');
    const result = dedupeGames([byTitle, byExe, fresh], known);
    expect(result.unique).toEqual([fresh]);
    expect(result.duplicates).toEqual([
      { game: byTitle, of: 'Portal 2 (installed in Steam)' },
      { game: byExe, of: 'Mine (your own shortcut)' },
    ]);
  });

  it('does not mutate the known maps, and compares titleless games by launch target only', () => {
    const known: KnownGames = { titles: new Map(), launchKeys: new Map() };
    const a = game('!!!', '/a');
    const b = game('???', '/b');
    expect(dedupeGames([a, b], known).unique).toEqual([a, b]);
    expect(known.titles.size).toBe(0);
    expect(known.launchKeys.size).toBe(0);
  });
});
