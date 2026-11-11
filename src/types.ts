/** Start a program directly. */
export interface ExeLaunch {
  kind: 'exe';
  /** Absolute path of the executable. */
  exe: string;
  startDir?: string;
  args?: string;
}

/**
 * Open a launcher URI (e.g. `uplay://launch/...`). Steam cannot start a URI itself, so a
 * wrapper script is generated for it.
 */
export interface UriLaunch {
  kind: 'uri';
  uri: string;
  /** Process name of the game, so the wrapper can wait for it and Steam sees the game as running. */
  waitFor?: string;
}

export type LaunchSpec = ExeLaunch | UriLaunch;

/** An installed game found by an integration. */
export interface Game {
  /** Display name of the store; used as the Steam tag/collection, e.g. "Epic Games". */
  store: string;
  /** The store's own identifier for the game. */
  id: string;
  title: string;
  installed: boolean;
  /** Only a weak guess that this is a game (e.g. a Unity install), so it is off by default. */
  weak?: boolean;
  launch: LaunchSpec;
}
