import { normalizeTitle } from '../../dedupe.js';
import type { Game } from '../../types.js';
import type { Integration, ScanContext } from '../types.js';
import { classifyApp, type Classification } from './classify.js';
import { scanLinuxApps } from './linux.js';
import type { InstalledApp } from './types.js';
import { scanWindowsApps } from './windows.js';

const LABEL = 'Installed Apps';

async function scanApps(ctx: ScanContext): Promise<InstalledApp[]> {
  if (ctx.platform === 'win32') return scanWindowsApps(ctx);
  if (ctx.platform === 'linux') return scanLinuxApps(ctx);
  return [];
}

/** Every installed app with the verdict on whether it is a game, sorted by name. */
export async function classifyInstalledApps(ctx: ScanContext): Promise<Classification[]> {
  const rules = {
    allow: new Set((ctx.options?.allow ?? []).map(normalizeTitle)),
    deny: new Set((ctx.options?.deny ?? []).map(normalizeTitle)),
  };
  return (await scanApps(ctx)).map((app) => classifyApp(app, rules)).sort((a, b) => a.app.name.localeCompare(b.app.name));
}

/**
 * Best-guess scan of the operating system's installed applications. Strict by default: only apps
 * the OS or the user marks as games are returned; weaker guesses need `includeMaybe`.
 */
export const osIntegration: Integration = {
  id: 'os',
  label: LABEL,
  platforms: ['linux', 'win32'],
  async scan(ctx) {
    const includeMaybe = ctx.options?.includeMaybe === true;
    const games: Game[] = [];
    for (const { app, verdict } of await classifyInstalledApps(ctx)) {
      if (verdict === 'game' || (includeMaybe && verdict === 'maybe')) {
        games.push({ store: LABEL, id: app.id, title: app.name, installed: true, launch: app.launch });
      }
    }
    return games;
  },
};
