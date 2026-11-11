import type { LaunchSpec } from '../../types.js';

/**
 * Why we think an app is a game. `freedesktop-game` and `game-bar` are strong (the OS or the user
 * says it is a game); `unity` and `unreal` are weak (the install looks like a game engine's).
 */
export type Signal = 'freedesktop-game' | 'game-bar' | 'unity' | 'unreal';

/** An application found on the system, before deciding whether it is a game. */
export interface InstalledApp {
  /** Stable identifier: desktop file id on Linux, Game Bar key on Windows. */
  id: string;
  name: string;
  launch: LaunchSpec;
  /** freedesktop `Categories` (Linux only). */
  categories?: string[];
  signals: Signal[];
}
