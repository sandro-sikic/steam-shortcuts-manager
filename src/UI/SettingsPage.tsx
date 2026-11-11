import { useState } from 'react';
import type { GameInfo, IntegrationInfo, Settings, SettingsPatch } from '../ipc.js';
import { ArrowLeftIcon } from './icons.js';
import { AboutSection } from './settings/AboutSection.js';
import { AppearanceSection } from './settings/AppearanceSection.js';
import { ArtworkSection } from './settings/ArtworkSection.js';
import { LaunchersSection } from './settings/LaunchersSection.js';
import { LibrarySection } from './settings/LibrarySection.js';
import { SteamSection } from './settings/SteamSection.js';
import { SyncSection } from './settings/SyncSection.js';

const SECTIONS = [
  { id: 'artwork', label: 'Artwork' },
  { id: 'steam', label: 'Steam' },
  { id: 'sync', label: 'Sync' },
  { id: 'launchers', label: 'Launchers' },
  { id: 'library', label: 'Library' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'about', label: 'About' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export function SettingsPage({
  settings,
  update,
  reset,
  integrations,
  games,
  onLibraryChanged,
  onBack,
}: {
  settings: Settings;
  update: (patch: SettingsPatch) => Promise<void>;
  reset: () => Promise<void>;
  integrations: IntegrationInfo[];
  games: GameInfo[];
  onLibraryChanged: () => void;
  onBack: () => void;
}) {
  const [active, setActive] = useState<SectionId>('artwork');

  let section;
  switch (active) {
    case 'artwork':
      section = <ArtworkSection settings={settings} update={update} />;
      break;
    case 'steam':
      section = <SteamSection settings={settings} update={update} />;
      break;
    case 'sync':
      section = <SyncSection settings={settings} update={update} />;
      break;
    case 'launchers':
      section = <LaunchersSection settings={settings} update={update} integrations={integrations} />;
      break;
    case 'library':
      section = <LibrarySection games={games} onChanged={onLibraryChanged} />;
      break;
    case 'appearance':
      section = <AppearanceSection settings={settings} update={update} />;
      break;
    case 'about':
      section = <AboutSection onReset={reset} />;
      break;
  }

  return (
    <div className="settings-page">
      <div className="settings-head">
        <button type="button" className="button" onClick={onBack}>
          <ArrowLeftIcon />
          Library
        </button>
        <h2>Settings</h2>
      </div>
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(({ id, label }) => (
            <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => setActive(id)}>
              {label}
            </button>
          ))}
        </nav>
        {section}
      </div>
    </div>
  );
}
