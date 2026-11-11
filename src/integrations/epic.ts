import path from 'node:path';
import type { Game, LaunchSpec } from '../types.js';
import { parseCatalog, parseEpicManifest, type Catalog } from './shared/epicManifest.js';
import { listDir, readBytesIfExists, readJsonIfExists } from './shared/fs.js';
import type { Integration, ScanContext } from './types.js';

// Manifest directories and `*.item` field names are from memory of the Epic Games Launcher (one JSON file per
// installed game); the launcher URI form is `com.epicgames.launcher://apps/<namespace>%3A<itemId>%3A<appName>?action=launch&silent=true`
// (or just `apps/<appName>`). The install-folder scan was checked against a real install: binary `.egstore` manifests
// (magic 0x44BEC00C, zlib body) and the base64 JSON catalog `Data/Catalog/catcache.bin`.

const LABEL = 'Epic Games';

function dataDir(ctx: ScanContext): string {
  if (ctx.platform === 'win32') return path.join(ctx.env['ProgramData'] ?? 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data');
  return path.join(ctx.home, 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher', 'Data');
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The process image name to wait for; only kept when it is safe for the wrapper script. */
function waitForOf(executable: string | undefined): string | undefined {
  const base = executable?.split(/[\\/]/).pop();
  return base !== undefined && /^[\w .()-]+$/.test(base) ? base : undefined;
}

function launchFor(manifest: Record<string, unknown>, appName: string): LaunchSpec | undefined {
  const executable = str(manifest['LaunchExecutable']);
  const namespace = str(manifest['CatalogNamespace']);
  const itemId = str(manifest['CatalogItemId']);
  const installDir = str(manifest['InstallLocation']);
  const waitFor = waitForOf(executable);

  if (namespace !== undefined && itemId !== undefined) {
    const uri = `com.epicgames.launcher://apps/${namespace}%3A${itemId}%3A${appName}?action=launch&silent=true`;
    return { kind: 'uri', uri, ...(waitFor === undefined ? {} : { waitFor }), ...(installDir === undefined ? {} : { installDir }) };
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

/** Folders Epic installs games into that are not games. */
const NOT_GAMES = new Set(['launcher', 'directxredist', 'gameinputredist']);

/** Where games are installed on Windows: the Program Files folders, and the usual places on every drive. */
function installRoots(ctx: ScanContext): string[] {
  const roots = new Set<string>();
  for (const name of ['ProgramFiles', 'ProgramW6432', 'ProgramFiles(x86)']) {
    const folder = ctx.env[name];
    if (folder) roots.add(path.join(folder, 'Epic Games'));
  }
  const drives = ctx.drives ?? Array.from({ length: 24 }, (_, i) => `${String.fromCharCode(67 + i)}:\\`);
  for (const drive of drives) {
    roots.add(path.join(drive, 'Program Files', 'Epic Games'));
    roots.add(path.join(drive, 'Epic Games'));
  }
  return [...roots];
}

/** "AstroDuel2" becomes "Astro Duel 2"; used only when the catalog has no title. */
function titleFromFolder(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2');
}

/**
 * Finds games from their install folders, for launchers that keep no list of installed games: every game has a
 * `.egstore` folder whose manifest names the game and its executable; the launcher's catalog gives the title.
 */
async function scanInstallFolders(ctx: ScanContext, catalog: Catalog): Promise<Game[]> {
  const games: Game[] = [];
  for (const root of installRoots(ctx)) {
    for (const name of await listDir(root)) {
      if (NOT_GAMES.has(name.toLowerCase())) continue;
      const store = path.join(root, name, '.egstore');
      const file = (await listDir(store)).find((entry) => entry.toLowerCase().endsWith('.manifest'));
      const manifest = file === undefined ? undefined : parseEpicManifest(await readBytesIfExists(path.join(store, file)));
      if (manifest === undefined || manifest.launchExe === '') continue; // not a game (a redistributable has no executable)
      const item = catalog.byAppName.get(manifest.appName) ?? catalog.byFolder.get(name.toLowerCase());
      const target = item === undefined ? manifest.appName : `${item.namespace}%3A${item.id}%3A${manifest.appName}`;
      const uri = `com.epicgames.launcher://apps/${target}?action=launch&silent=true`;
      const waitFor = waitForOf(manifest.launchExe);
      games.push({
        store: LABEL,
        id: manifest.appName,
        title: item?.title ?? titleFromFolder(name),
        installed: true,
        launch: { kind: 'uri', uri, ...(waitFor === undefined ? {} : { waitFor }), installDir: path.join(root, name) },
      });
    }
  }
  return games;
}

export const epicIntegration: Integration = {
  id: 'epic',
  label: LABEL,
  platforms: ['win32', 'darwin'],
  async scan(ctx) {
    const data = dataDir(ctx);
    const dir = path.join(data, 'Manifests');
    const files = (await listDir(dir)).filter((name) => name.toLowerCase().endsWith('.item'));
    const games = new Map<string, Game>();
    for (const file of files) {
      const game = toGame(await readJsonIfExists(path.join(dir, file)));
      if (game && !games.has(game.id)) games.set(game.id, game);
    }
    // Newer launchers may keep no manifests, so also look at the installed games' own folders.
    if (ctx.platform === 'win32') {
      const catalog = parseCatalog(await readBytesIfExists(path.join(data, 'Catalog', 'catcache.bin')));
      for (const game of await scanInstallFolders(ctx, catalog)) if (!games.has(game.id)) games.set(game.id, game);
    }
    return [...games.values()].sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  },
};
