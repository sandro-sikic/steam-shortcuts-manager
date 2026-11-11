import { useState } from 'react';
import type { SettingsPatch, Settings } from '../../ipc.js';
import { errorMessage } from '../api.js';
import { Segmented } from '../Segmented.js';
import { Switch } from '../Switch.js';
import type { SectionProps } from './types.js';

export function SyncSection({ settings, update }: SectionProps) {
  const { mode, prune, includeMaybe, autoApply } = settings.sync;
  const [error, setError] = useState('');

  const save = async (sync: SettingsPatch['sync']) => {
    setError('');
    try {
      await update({ sync });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="panel settings-section" aria-label="Sync defaults">
      <h2>Sync defaults</h2>
      <p className="help">How the sync panel starts and what it does by default.</p>
      <Segmented<Settings['sync']['mode']>
        label="Start in"
        value={mode}
        options={[
          { value: 'preview', label: 'Preview' },
          { value: 'apply', label: 'Apply' },
        ]}
        onChange={(next) => void save({ mode: next })}
      />
      <Switch checked={prune} onChange={(next) => void save({ prune: next })}>
        Remove shortcuts for games that are gone
      </Switch>
      <Switch checked={includeMaybe} onChange={(next) => void save({ includeMaybe: next })}>
        List weak guesses (Unity/Unreal installs)
      </Switch>
      <div>
        <Switch checked={autoApply} onChange={(next) => void save({ autoApply: next })}>
          Apply to Steam as soon as I tick or untick a game
        </Switch>
        <p className="help">Changes reach Steam immediately, so Steam must be closed.</p>
      </div>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
