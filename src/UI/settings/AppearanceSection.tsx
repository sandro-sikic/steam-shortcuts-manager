import { useState } from 'react';
import { Segmented } from '../Segmented.js';
import { errorMessage } from '../api.js';
import type { SectionProps } from './types.js';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

const CARD_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
] as const;

export function AppearanceSection({ settings, update }: SectionProps) {
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Parameters<SectionProps['update']>[0]) => {
    setError(null);
    try {
      await update(patch);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="panel settings-section" aria-label="Appearance">
      <h2>Appearance</h2>
      <p className="help">How the app looks.</p>
      <div className="field">
        <span>Theme</span>
        <Segmented label="Theme" value={settings.ui.theme} options={THEMES} onChange={(theme) => void save({ ui: { theme } })} />
        <p className="help">System follows your computer&apos;s light or dark setting.</p>
      </div>
      <div className="field">
        <span>Card size</span>
        <Segmented label="Card size" value={settings.ui.cardSize} options={CARD_SIZES} onChange={(cardSize) => void save({ ui: { cardSize } })} />
        <p className="help">How big the game cards are in the library.</p>
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
