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

/** One image SteamGridDB offers for a game and image type. */
export interface ArtworkOption {
  /** SteamGridDB's image id; what a pick is stored as. */
  id: number;
  /** SteamGridDB's style label, e.g. `alternate`, `white_logo`, `official`. */
  style: string;
  width: number;
  height: number;
  nsfw: boolean;
  /** Cached preview and full image, once downloaded. */
  thumbUrl?: string;
  fullUrl?: string;
}

/** The options for one image type and which is selected. */
export interface ArtworkChoice {
  /** Empty when SteamGridDB has no image of this type for the game. */
  options: ArtworkOption[];
  /** The selected image id; `null` when the user chose "none"; undefined when there is nothing to select. */
  selected: number | null | undefined;
}

/** What a game has: the selected image of each type, and the options behind them. */
export interface ArtworkEntry {
  /** The selected image of each type that has one, ready to show (full size, else the preview, else Steam's own file). */
  items: ArtworkItem[];
  /** The options per type; a type is missing here until its list has been fetched. */
  choices: Partial<Record<ArtworkKind, ArtworkChoice>>;
  /** The background download still has work to do (a list is missing or a selected image is not downloaded). */
  pending: boolean;
  /** Every list and a preview of every option are cached, so the game page has nothing to fetch. */
  optionsReady: boolean;
}

export interface ArtworkRequest {
  /** The game's Steam shortcut ID (see `GameInfo.appId`). */
  appId: number;
  title: string;
  /** Download again even if the image exists. */
  force: boolean;
}

export interface ArtworkResult {
  /** What happened to the selected image of each type. */
  outcomes: { kind: ArtworkKind; status: 'saved' | 'exists' | 'missing' | 'failed' | 'none'; error?: string }[];
  entry: ArtworkEntry;
}

/** The user picks an image for a game and image type, or "none" (`imageId` null). */
export interface ArtworkPick {
  appId: number;
  title: string;
  kind: ArtworkKind;
  imageId: number | null;
}

export interface ArtworkPickResult {
  entry: ArtworkEntry;
  /** The pick is saved either way; this says why its full image could not be downloaded now. */
  downloadError?: string;
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
  /** Lists a game's options and downloads the selected image of each type into the app's cache. Needs an API key. */
  downloadArtwork(request: ArtworkRequest): Promise<ArtworkResult>;
  /** Like `downloadArtwork`, and also downloads a preview of every option, for the game page. */
  loadArtworkOptions(request: ArtworkRequest): Promise<ArtworkResult>;
  /** Saves the user's pick for a game and type, and downloads that image in full. The pick is kept even if the download fails. */
  chooseArtwork(pick: ArtworkPick): Promise<ArtworkPickResult>;
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
  loadArtworkOptions: 'steam-manager:load-artwork-options',
  chooseArtwork: 'steam-manager:choose-artwork',
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
