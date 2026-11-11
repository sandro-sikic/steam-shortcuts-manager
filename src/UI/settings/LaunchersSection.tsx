import { useState } from 'react';
import type { IntegrationInfo } from '../../ipc.js';
import { errorMessage } from '../api.js';
import { Switch } from '../Switch.js';
import type { SectionProps } from './types.js';

export function LaunchersSection({ settings, update, integrations }: SectionProps & { integrations: IntegrationInfo[] }) {
  const { disabled } = settings.launchers;
  const [error, setError] = useState('');

  const toggle = async (id: string, on: boolean) => {
    setError('');
    const next = on ? disabled.filter((item) => item !== id) : [...disabled, id];
    try {
      await update({ launchers: { disabled: next } });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="panel settings-section" aria-label="Launchers">
      <h2>Launchers</h2>
      <p className="help">Choose which launchers are scanned for games.</p>
      {integrations.length === 0 ? (
        <p className="muted">No launchers on this platform.</p>
      ) : (
        integrations.map((integration) => (
          <Switch key={integration.id} checked={!disabled.includes(integration.id)} onChange={(on) => void toggle(integration.id, on)}>
            {integration.label}
          </Switch>
        ))
      )}
      <p className="help">Launchers that are turned off are skipped when scanning for games.</p>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
