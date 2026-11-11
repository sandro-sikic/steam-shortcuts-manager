import type { Settings, SettingsPatch } from '../../ipc.js';

/** What every settings section receives. */
export interface SectionProps {
  /** The current settings (already loaded). */
  settings: Settings;
  /** Saves a change right away; resolves with the settings as saved, rejects with a readable error. */
  update: (patch: SettingsPatch) => Promise<void>;
}
