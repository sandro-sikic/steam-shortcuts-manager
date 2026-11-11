import { useCallback, useEffect, useState } from 'react';
import type { GamesReport, IntegrationInfo, ShortcutInfo, StatusInfo } from '../ipc.js';
import { api, errorMessage } from './api.js';
import { Header } from './Header.js';
import { Library } from './Library.js';
import { SyncPanel } from './SyncPanel.js';

const NO_GAMES: GamesReport = { games: [], duplicates: [], warnings: [] };

export function App() {
  const [status, setStatus] = useState<StatusInfo>();
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [report, setReport] = useState<GamesReport>(NO_GAMES);
  const [includeMaybe, setIncludeMaybe] = useState(false);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const [nextStatus, nextIntegrations, nextReport] = await Promise.all([api().status(), api().integrations(), api().games({ includeMaybe })]);
      setStatus(nextStatus);
      setIntegrations(nextIntegrations);
      setReport(nextReport);
      setShortcuts(nextStatus.error ? [] : await api().shortcuts());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [includeMaybe]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Ticks games on or off: shown at once, saved in the background. */
  async function toggle(keys: string[], include: boolean): Promise<void> {
    setReport((current) => ({ ...current, games: current.games.map((game) => (keys.includes(game.key) ? { ...game, excluded: !include } : game)) }));
    try {
      await api().setExcluded(keys, !include);
    } catch (failure) {
      await load(); // put the checkboxes back to what is really saved; this clears any error, so show ours after
      setError(errorMessage(failure));
    }
  }

  const pending = {
    add: report.games.filter((game) => !game.excluded && !game.inSteam).length,
    remove: report.games.filter((game) => game.excluded && game.inSteam).length,
  };

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
      {report.warnings.map((warning) => (
        <p key={warning} className="callout warn" role="status">{warning}</p>
      ))}
      {status && !status.error && (
        <p className="steam-info">
          <code>{status.steamRoot}</code>
          <span>account {status.accountId}</span>
          <span>{status.platform}</span>
        </p>
      )}
      <main className="layout">
        <Library report={report} shortcuts={shortcuts} loading={loading} onToggle={(keys, include) => void toggle(keys, include)} />
        <SyncPanel
          integrations={integrations}
          disabled={!status || Boolean(status.error)}
          includeMaybe={includeMaybe}
          onIncludeMaybe={setIncludeMaybe}
          pending={pending}
          onChanged={() => void load()}
        />
      </main>
    </div>
  );
}
