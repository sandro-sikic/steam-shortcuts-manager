/// <reference types="vite/client" />

import type { SteamManagerApi } from '../ipc.js';

declare global {
  interface Window {
    /** Exposed by the Electron preload script. */
    steamManager: SteamManagerApi;
  }
}
