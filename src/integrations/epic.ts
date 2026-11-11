import path from 'node:path';
import type { Game, LaunchSpec } from '../types.js';
import { listDir, readJsonIfExists } from './shared/fs.js';
import type { Integration, ScanContext } from './types.js';

// Unverified: manifest directories and field names are from memory of the Epic Games Launcher
// (one JSON `*.item` per installed game); the launcher URI form is the commonly used
// `com.epicgames.launcher://apps/<namespace>%3A<itemId>%3A<appName>?action=launch&silent=true`.

const LABEL = 'Epic Games';

function manifestDir(ctx: ScanContext): string {
  if (ctx.platform === 'win32') {
    return path.join(ctx.env['ProgramData'] ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  }
  return path.join(ctx.home, 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function launchFor(manifest: Record<string, unknown>, appName: string): LaunchSpec | undefined {
  const executable = str(manifest['LaunchExecutable']);
  const namespace = str(manifest['CatalogNamespace']);
  const itemId = str(manifest['CatalogItemId']);
  const installDir = str(manifest['InstallLocation']);
  // Process image name; only kept when it is safe for the wrapper script.
  const base = executable?.split(/[\\/]/).pop();
  const waitFor = base !== undefined && /^[\w .()-]+$/.test(base) ? base : undefined;

  if (namespace !== undefined && itemId !== undefined) {
    const uri = `com.epicgames.launcher://apps/${namespace}%3A${itemId}%3A${appName}?action=launch&silent=true`;
    return waitFor === undefined ? { kind: 'uri', uri } : { kind: 'uri', uri, waitFor };
  }
  if (installDir !== undefined && executable !== undefined) {
    return { kind: 'exe', exe: path.join(installDir, executable), startDir: installDir };
  }
  return undefined;
}

function toGame(raw: unknown): Game | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const manifest = raw as Record<string, unknown>;
  const appName = str(manifest['AppName']);
  const title = str(manifest['DisplayName']);
  if (appName === undefined || title === undefined) return undefined;
  if (manifest['bIsIncompleteInstall'] === true) return undefined;
  const mainGame = str(manifest['MainGameAppName']);
  if (mainGame !== undefined && mainGame !== appName) return undefined; // DLC / add-on
  const launch = launchFor(manifest, appName);
  if (launch === undefined) return undefined;
  return { store: LABEL, id: appName, title, installed: true, launch };
}

export const epicIntegration: Integration = {
  id: 'epic',
  label: LABEL,
  platforms: ['win32', 'darwin'],
  async scan(ctx) {
    const dir = manifestDir(ctx);
    const files = (await listDir(dir)).filter((name) => name.toLowerCase().endsWith('.item'));
    const games = new Map<string, Game>();
    for (const file of files) {
      const game = toGame(await readJsonIfExists(path.join(dir, file)));
      if (game && !games.has(game.id)) games.set(game.id, game);
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
