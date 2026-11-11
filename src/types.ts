/** A game discovered by a provider (Epic, GOG, Ubisoft, ...). */
export interface Game {
  /** Display name of the store; used as the Steam tag/collection, e.g. "Epic Games". */
  store: string;
  /** The store's own identifier for the game. */
  id: string;
  title: string;
  installed: boolean;
  /** Absolute path of the executable (or launcher binary) Steam should start. */
  exe: string;
  startDir?: string;
  launchOptions?: string;
}

/** A source of games. Implementations (login + library) are added later. */
export interface Provider {
  readonly name: string;
  listGames(): Promise<Game[]>;
}
