import { useCallback, useEffect, useState } from 'react';
import type { IntegrationInfo, ShortcutInfo, StatusInfo } from '../ipc.js';
import { api, errorMessage } from './api.js';
import { Header } from './Header.js';
import { Library } from './Library.js';
import { SyncPanel } from './SyncPanel.js';

export function App() {
  const [status, setStatus] = useState<StatusInfo>();
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const [nextStatus, nextIntegrations] = await Promise.all([api().status(), api().integrations()]);
      setStatus(nextStatus);
      setIntegrations(nextIntegrations);
      setShortcuts(nextStatus.error ? [] : await api().shortcuts());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app">
      <Header status={status} loading={loading} onRefresh={() => void load()} />
      {error && <p className="callout danger" role="alert">{error}</p>}
      {status?.error && (
        <div className="callout danger" role="alert">
          <b>Can’t reach Steam</b>
          <span>{status.error}</span>
        </div>
      )}
      {status && !status.error && status.steamRunning && (
        <div className="callout warn" role="status">
          <b>Steam is running</b>
          <span>Close it before applying changes. Steam rewrites its files when it exits, which would undo them.</span>
        </div>
      )}
      {status && !status.error && (
        <p className="steam-info">
          <code>{status.steamRoot}</code>
          <span>account {status.accountId}</span>
          <span>{status.platform}</span>
        </p>
      )}
      <main className="layout">
        <Library shortcuts={shortcuts} loading={loading} />
        <SyncPanel integrations={integrations} disabled={!status || Boolean(status.error)} onChanged={() => void load()} />
      </main>
    </div>
  );
}
