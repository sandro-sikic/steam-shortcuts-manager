import { useCallback, useEffect, useState } from 'react';
import type { GamesReport, IntegrationInfo, Settings, SettingsPatch, ShortcutInfo, StatusInfo } from '../ipc.js';
import { DEFAULT_SETTINGS } from '../settingsModel.js';
import { api, errorMessage } from './api.js';
import { Header } from './Header.js';
import { Library } from './Library.js';
import { SettingsPage } from './SettingsPage.js';
import { SyncPanel } from './SyncPanel.js';

const NO_GAMES: GamesReport = { games: [], duplicates: [], warnings: [] };

export function App() {
  const [status, setStatus] = useState<StatusInfo>();
  const [settings, setSettings] = useState<Settings>();
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [report, setReport] = useState<GamesReport>(NO_GAMES);
  /** Set when the user flips the switch in the sync panel; until then the saved setting decides. */
  const [maybeChoice, setMaybeChoice] = useState<boolean>();
  const [view, setView] = useState<'library' | 'settings'>('library');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setError(undefined);
      const nextSettings = await api().settings();
      const includeMaybe = maybeChoice ?? nextSettings.sync.includeMaybe;
      const [nextStatus, nextIntegrations, nextReport] = await Promise.all([api().status(), api().integrations(), api().games({ includeMaybe })]);
      setSettings(nextSettings);
      setStatus(nextStatus);
      setIntegrations(nextIntegrations);
      setReport(nextReport);
      setShortcuts(nextStatus.error ? [] : await api().shortcuts());
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [maybeChoice]);

  useEffect(() => {
    void load();
  }, [load]);

  // Theme and card size are applied to the whole page.
  useEffect(() => {
    const root = document.documentElement;
    if (!settings || settings.ui.theme === 'system') delete root.dataset['theme'];
    else root.dataset['theme'] = settings.ui.theme;
    root.dataset['card'] = settings?.ui.cardSize ?? 'medium';
  }, [settings]);

  async function updateSettings(patch: SettingsPatch): Promise<void> {
    setSettings(await api().updateSettings(patch));
  }

  async function resetSettings(): Promise<void> {
    setSettings(await api().resetSettings());
  }

  function showLibrary(): void {
    setView('library');
    void load();
  }

  /** Ticks games on or off: shown at once, saved in the background, and applied if the user wants that. */
  async function toggle(keys: string[], include: boolean): Promise<void> {
    setReport((current) => ({ ...current, games: current.games.map((game) => (keys.includes(game.key) ? { ...game, excluded: !include } : game)) }));
    try {
      await api().setExcluded(keys, !include);
      if (settings?.sync.autoApply && status && !status.error) {
        const result = await api().sync({ dryRun: false, prune: settings.sync.prune, includeMaybe: maybeChoice ?? settings.sync.includeMaybe, artwork: settings.sync.artwork });
        await load();
        if (result.error) setError(result.error);
      }
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
      <Header status={status} loading={loading} settingsOpen={view === 'settings'} onRefresh={() => void load()} onToggleSettings={() => (view === 'settings' ? showLibrary() : setView('settings'))} />
      {error && <p className="callout danger" role="alert">{error}</p>}
      {view === 'settings' && settings && (
        <SettingsPage
          settings={settings}
          update={updateSettings}
          reset={resetSettings}
          integrations={integrations}
          games={report.games}
          onLibraryChanged={() => void load()}
          onBack={showLibrary}
        />
      )}
      {view === 'library' && (
        <>
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
              key={settings ? 'ready' : 'loading'}
              integrations={integrations}
              defaults={settings?.sync ?? DEFAULT_SETTINGS.sync}
              disabled={!status || Boolean(status.error)}
              includeMaybe={maybeChoice ?? settings?.sync.includeMaybe ?? false}
              onIncludeMaybe={setMaybeChoice}
              pending={pending}
              onChanged={() => void load()}
            />
          </main>
        </>
      )}
    </div>
  );
}
