/**
 * The contract between the Electron main process and the UI. Types only plus the channel names,
 * so both sides (and the preload script) can agree without sharing any Node code.
 */

export interface StatusInfo {
  platform: string;
  steamRunning: boolean;
  steamRoot?: string;
  accountId?: string;
  /** Why Steam or its user could not be found. */
  error?: string;
}

export interface ShortcutInfo {
  appId: number;
  title: string;
  /** Tags other than our own marker tag. */
  tags: string[];
  /** Created by steam-manager (so it may be updated or pruned). */
  managed: boolean;
}

export interface IntegrationInfo {
  id: string;
  label: string;
}

export interface AppInfo {
  id: string;
  name: string;
  verdict: 'game' | 'maybe' | 'no';
  reason: string;
}

/** A game found on this computer by one of the launcher integrations. */
export interface GameInfo {
  /** Stable identity (`store:id`); what the user's choices are stored against. */
  key: string;
  /** The launcher the game belongs to, e.g. "Epic Games". */
  store: string;
  id: string;
  title: string;
  /** The Steam shortcut ID the game has (or would have). */
  appId: number;
  /** Only a weak guess that this is a game. */
  weak: boolean;
  /** We already added it to Steam. */
  inSteam: boolean;
  /** The user switched it off: it is not added to Steam, and our shortcut for it is removed on the next sync. */
  excluded: boolean;
}

export interface DuplicateInfo {
  title: string;
  store: string;
  /** What it duplicates, e.g. "Hades [GOG Galaxy]". */
  of: string;
}

export interface GamesReport {
  games: GameInfo[];
  /** Games dropped because they duplicate another one. */
  duplicates: DuplicateInfo[];
  /** Launchers that could not be scanned. */
  warnings: string[];
}

export interface GamesRequest {
  /** Also list weak guesses (Unity/Unreal installs). */
  includeMaybe: boolean;
}

export interface SyncRequest {
  /** Show what would change without writing anything. */
  dryRun: boolean;
  prune: boolean;
  includeMaybe: boolean;
  artwork: boolean;
  /** Limit to these integration ids; all when omitted. */
  only?: string[];
}

export interface SyncItemInfo {
  appId: number;
  title: string;
  store: string;
}

export interface SyncReport {
  /** The same lines the CLI prints. */
  log: string[];
  added: SyncItemInfo[];
  updated: SyncItemInfo[];
  removed: SyncItemInfo[];
  unchanged: SyncItemInfo[];
  skipped: SyncItemInfo[];
  /** Set when the sync could not run (e.g. Steam is running); `log` still holds what happened before. */
  error?: string;
}

export interface SteamManagerApi {
  status(): Promise<StatusInfo>;
  shortcuts(): Promise<ShortcutInfo[]>;
  integrations(): Promise<IntegrationInfo[]>;
  /** `all` also returns apps judged not to be games. */
  apps(all: boolean): Promise<AppInfo[]>;
  /** The games found on this computer, ready to be ticked on or off. */
  games(request: GamesRequest): Promise<GamesReport>;
  /** Switches games off (`excluded` true) or back on, by key. The choice is saved and used by every sync. */
  setExcluded(keys: string[], excluded: boolean): Promise<void>;
  sync(request: SyncRequest): Promise<SyncReport>;
}

export const CHANNELS = {
  status: 'steam-manager:status',
  shortcuts: 'steam-manager:shortcuts',
  integrations: 'steam-manager:integrations',
  apps: 'steam-manager:apps',
  games: 'steam-manager:games',
  setExcluded: 'steam-manager:set-excluded',
  sync: 'steam-manager:sync',
} as const satisfies Record<keyof SteamManagerApi, string>;

/** The part of Electron's `ipcMain` we use, so registration can be tested without Electron. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Exposes every API method on its channel; the renderer reaches them through the preload script. */
export function registerIpc(ipcMain: IpcMainLike, api: SteamManagerApi): void {
  for (const method of Object.keys(CHANNELS) as (keyof SteamManagerApi)[]) {
    ipcMain.handle(CHANNELS[method], (_event, ...args) => (api[method] as (...a: unknown[]) => unknown)(...args));
  }
}
