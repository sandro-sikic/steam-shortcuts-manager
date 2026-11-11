import type { SteamManagerApi } from '../ipc.js';

/** The bridge to the Steam Manager core, provided by the Electron preload script. */
export function api(): SteamManagerApi {
  return window.steamManager;
}

/** Electron prefixes errors thrown in the main process; show only the actual message. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}
