import path from 'node:path';
import { normalizeTitle } from '../../dedupe.js';
import type { InstalledApp, Signal } from './types.js';

export type Verdict = 'game' | 'maybe' | 'no';

export interface Classification {
  app: InstalledApp;
  verdict: Verdict;
  reason: string;
}

export interface Rules {
  /** Normalized titles/ids that are always games. */
  allow: ReadonlySet<string>;
  /** Normalized titles/ids that are never games. */
  deny: ReadonlySet<string>;
}

const STRONG: readonly Signal[] = ['freedesktop-game', 'game-bar'];
const WEAK: readonly Signal[] = ['unity', 'unreal'];

/** Categories that mark something as a tool around games, not a game (Lutris, emulators, ...). */
const NOT_GAME_CATEGORIES = ['Emulator', 'Utility', 'System', 'Settings', 'Development', 'PackageManager', 'Network', 'Monitor'];

/** Launchers and game tools that carry a "Game" category or sit next to games, but are not games. */
const NOT_GAME_APPS = new Set(
  [
    'Steam', 'Lutris', 'Heroic Games Launcher', 'itch', 'itch.io', 'Bottles', 'ProtonUp-Qt', 'Protontricks', 'GOverlay',
    'MangoHud', 'GameMode', 'Playnite', 'Epic Games Launcher', 'GOG Galaxy', 'Battle.net', 'Ubisoft Connect', 'EA app',
    'Riot Client', 'Xbox', 'Amazon Games', 'Minecraft Launcher', 'Steam Rom Manager', 'Discord', 'OBS Studio',
  ].map(normalizeTitle),
);

/** Words that mean "not a game itself" in an application's name. */
const NOT_GAME_WORDS = /\b(launcher|emulator|redistributable|runtime|updater|uninstall(?:er)?|installer|setup|driver)\b/i;

function isSteamEntry(app: InstalledApp): boolean {
  if (app.id.startsWith('steam_app_')) return true;
  const { launch } = app;
  if (launch.kind === 'uri') return launch.uri.startsWith('steam://');
  return path.basename(launch.exe) === 'steam' || (launch.args ?? '').includes('steam://') || /[\\/]steamapps[\\/]/i.test(launch.exe);
}

function notGameReason(app: InstalledApp): string | undefined {
  if (isSteamEntry(app)) return 'already managed by Steam';
  if (NOT_GAME_APPS.has(normalizeTitle(app.name))) return 'a launcher or game tool, not a game';
  if (NOT_GAME_WORDS.test(app.name)) return 'the name says it is not a game itself';
  const category = app.categories?.find((c) => NOT_GAME_CATEGORIES.includes(c));
  if (category !== undefined) return `categorized as ${category}`;
  return undefined;
}

/** Decides whether an installed app is a game, and why. Pure; the strictest rule wins. */
export function classifyApp(app: InstalledApp, rules: Rules): Classification {
  const keys = [normalizeTitle(app.name), normalizeTitle(app.id)];
  if (keys.some((key) => rules.deny.has(key))) return { app, verdict: 'no', reason: 'denied by config' };
  if (keys.some((key) => rules.allow.has(key))) return { app, verdict: 'game', reason: 'allowed by config' };

  const blocked = notGameReason(app);
  if (blocked !== undefined) return { app, verdict: 'no', reason: blocked };

  const strong = app.signals.find((signal) => STRONG.includes(signal));
  if (strong !== undefined) return { app, verdict: 'game', reason: strong };
  const weak = app.signals.find((signal) => WEAK.includes(signal));
  if (weak !== undefined) return { app, verdict: 'maybe', reason: weak };
  return { app, verdict: 'no', reason: 'no sign that it is a game' };
}
