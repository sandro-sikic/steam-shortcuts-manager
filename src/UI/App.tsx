import { useCallback, useEffect, useState } from 'react';
import type { IntegrationInfo, ShortcutInfo, StatusInfo } from '../ipc.js';
import { api, errorMessage } from './api.js';
import { ShortcutList } from './ShortcutList.js';
import { StatusCard } from './StatusCard.js';
import { SyncPanel } from './SyncPanel.js';

export function App() {
  const [status, setStatus] = useState<StatusInfo>();
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const [nextStatus, nextIntegrations] = await Promise.all([api().status(), api().integrations()]);
      setStatus(nextStatus);
      setIntegrations(nextIntegrations);
      setShortcuts(nextStatus.error ? [] : await api().shortcuts());
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main>
      <header>
        <h1>Steam Manager</h1>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      {status && <StatusCard status={status} />}
      <SyncPanel integrations={integrations} disabled={!status || Boolean(status.error)} onChanged={() => void load()} />
      <ShortcutList shortcuts={shortcuts} />
    </main>
  );
}
