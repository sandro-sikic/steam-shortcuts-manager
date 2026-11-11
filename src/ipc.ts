/**
 * The contract between the Electron main process and the UI. Types only plus the channel names,
 * so both sides (and the preload script) can agree without sharing any Node code.
 */

import type { ArtworkKind } from './artwork/kinds.js';
import type { Settings, SettingsPatch } from './settingsModel.js';

export type { ArtworkKind, Settings, SettingsPatch };

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
  /** Scanned by sync; switched off in settings when false. */
  enabled: boolean;
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

/** The user's own lists in `config.json`. */
export interface Lists {
  /** Installed apps (title or id) that are always games. */
  allow: string[];
  /** Installed apps (title or id) that are never games. */
  deny: string[];
  /** Games (`store:id`) switched off in the library. */
  exclude: string[];
}

export interface ApiKeyStatus {
  /** Whether any key is available to download artwork. */
  set: boolean;
  /** Where it comes from: saved in the app, the STEAMGRIDDB_API_KEY environment variable, or nowhere. */
  source: 'saved' | 'environment' | 'none';
  /** Whether keys can be stored encrypted on this system. */
  secureStorage: boolean;
}

export interface ApiKeyTest {
  ok: boolean;
  message: string;
}

export interface SteamAccountInfo {
  accountId: string;
  /** Display name, or '' when Steam does not remember one. */
  name: string;
  mostRecent: boolean;
}

export interface AboutInfo {
  version: string;
  platform: string;
  /** The config file that holds settings and game choices. */
  configFile: string;
  /** The folder with the app's own copy of every game's artwork. */
  artworkCache: string;
  steamRoot?: string;
  secureStorage: boolean;
}

/** One image for a game, ready for an `<img src>`. */
export interface ArtworkItem {
  kind: ArtworkKind;
  url: string;
}

/** A game to look up artwork for. */
export interface ArtworkGame {
  /** The Steam shortcut ID (see `GameInfo.appId`). */
  appId: number;
  title: string;
}

/** The images a game has: what is in Steam's grid folder, else what the app has cached. */
export interface ArtworkEntry {
  items: ArtworkItem[];
  /** Something is neither cached nor known to be missing, so the background download still has work to do. */
  pending: boolean;
}

export interface ArtworkRequest {
  /** The game's Steam shortcut ID (see `GameInfo.appId`). */
  appId: number;
  title: string;
  /** Download again even if the image exists. */
  force: boolean;
}

export interface ArtworkResult {
  /** What happened for each kind. */
  outcomes: { kind: ArtworkKind; status: 'saved' | 'exists' | 'missing' | 'failed'; error?: string }[];
  /** All images the game has now. */
  items: ArtworkItem[];
  pending: boolean;
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
  settings(): Promise<Settings>;
  /** Changes some settings; returns all of them. Invalid values are rejected. */
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  resetSettings(): Promise<Settings>;
  lists(): Promise<Lists>;
  /** Replaces the given lists; returns all of them. */
  setLists(patch: Partial<Lists>): Promise<Lists>;
  apiKeyStatus(): Promise<ApiKeyStatus>;
  /** Saves the SteamGridDB key encrypted; an empty key removes it. */
  setApiKey(key: string): Promise<ApiKeyStatus>;
  /** Checks a key (or the one in use when omitted) against SteamGridDB. */
  testApiKey(key?: string): Promise<ApiKeyTest>;
  steamAccounts(): Promise<SteamAccountInfo[]>;
  about(): Promise<AboutInfo>;
  openConfigFolder(): Promise<void>;
  /** The images these games have, by shortcut ID. Reads local files only; never downloads. */
  artwork(games: ArtworkGame[]): Promise<Record<number, ArtworkEntry>>;
  /** Downloads what a game is missing from SteamGridDB into the app's cache. Needs an API key. */
  downloadArtwork(request: ArtworkRequest): Promise<ArtworkResult>;
}

export const CHANNELS = {
  status: 'steam-manager:status',
  shortcuts: 'steam-manager:shortcuts',
  integrations: 'steam-manager:integrations',
  apps: 'steam-manager:apps',
  games: 'steam-manager:games',
  setExcluded: 'steam-manager:set-excluded',
  sync: 'steam-manager:sync',
  settings: 'steam-manager:settings',
  updateSettings: 'steam-manager:update-settings',
  resetSettings: 'steam-manager:reset-settings',
  lists: 'steam-manager:lists',
  setLists: 'steam-manager:set-lists',
  apiKeyStatus: 'steam-manager:api-key-status',
  setApiKey: 'steam-manager:set-api-key',
  testApiKey: 'steam-manager:test-api-key',
  steamAccounts: 'steam-manager:steam-accounts',
  about: 'steam-manager:about',
  openConfigFolder: 'steam-manager:open-config-folder',
  artwork: 'steam-manager:artwork',
  downloadArtwork: 'steam-manager:download-artwork',
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
