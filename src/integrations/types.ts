import type { Runner } from '../steam/running.js';
import type { Game } from '../types.js';

/** User-controlled knobs for the installed-apps scan. */
export interface ScanOptions {
  /** Also include apps with only a weak signal (e.g. a Unity/Unreal install). */
  includeMaybe?: boolean;
  /** Titles or ids that are always games. */
  allow?: string[];
  /** Titles or ids that are never games. */
  deny?: string[];
}

/** Everything an integration may touch; injected so scans are testable without the real launcher. */
export interface ScanContext {
  platform: NodeJS.Platform;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Runs a command and returns its stdout ('' on failure), e.g. `reg query`. */
  run: Runner;
  options?: ScanOptions;
}

/** One launcher (Epic, GOG, ...). Scans the machine locally; no login or network involved. */
export interface Integration {
  /** Short identifier used on the command line, e.g. "epic". */
  readonly id: string;
  /** Name shown to the user and used as the Steam tag/collection, e.g. "Epic Games". */
  readonly label: string;
  /** Platforms on which this launcher exists. */
  readonly platforms: readonly NodeJS.Platform[];
  /** Returns the installed games. Should return [] (not throw) when the launcher is absent. */
  scan(ctx: ScanContext): Promise<Game[]>;
}
