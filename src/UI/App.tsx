import { useCallback, useEffect, useState } from 'react';
import type { ArtworkEntry, GamesReport, IntegrationInfo, Settings, SettingsPatch, ShortcutInfo, StatusInfo } from '../ipc.js';
import { DEFAULT_SETTINGS } from '../settingsModel.js';
import { api, errorMessage } from './api.js';
import { GamePage } from './GamePage.js';
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
  const [art, setArt] = useState<Record<number, ArtworkEntry>>({});
  /** Counts how many times the library's artwork has been looked up; each one starts a background download run. */
  const [artRun, setArtRun] = useState(0);
  const [artProgress, setArtProgress] = useState<{ done: number; total: number }>();
  const [view, setView] = useState<'library' | 'settings' | 'game'>('library');
  const [openKey, setOpenKey] = useState<string>();
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
      const nextShortcuts = nextStatus.error ? [] : await api().shortcuts();
      setShortcuts(nextShortcuts);
      setArt(await api().artwork([...nextReport.games, ...nextShortcuts].map(({ appId, title }) => ({ appId, title }))));
      setArtRun((run) => run + 1);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, [maybeChoice]);

  useEffect(() => {
    void load();
  }, [load]);

  // Once the library is ready, download the artwork of every game that has none cached yet, one game at a time.
  useEffect(() => {
    if (artRun === 0 || !settings?.artwork.auto) return undefined;
    const queue = report.games.filter((game) => art[game.appId]?.pending);
    if (queue.length === 0) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        if (!(await api().apiKeyStatus()).set) return;
        for (const [index, game] of queue.entries()) {
          if (cancelled) return;
          setArtProgress({ done: index, total: queue.length });
          try {
            const result = await api().downloadArtwork({ appId: game.appId, title: game.title, force: false });
            if (!cancelled) setArt((current) => ({ ...current, [game.appId]: { items: result.items, pending: result.pending } }));
          } catch {
            // this game is tried again the next time the library loads
          }
        }
      } catch {
        // without a key status there is nothing to do
      } finally {
        if (!cancelled) setArtProgress(undefined);
      }
    })();
    return () => {
      cancelled = true;
      setArtProgress(undefined);
    };
    // Only a newly looked-up library starts a run; progress updates to `art` must not restart it.
  }, [artRun]);

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

  const openGame = view === 'game' ? report.games.find((game) => game.key === openKey) : undefined;

  const pending = {
    add: report.games.filter((game) => !game.excluded && !game.inSteam).length,
    remove: report.games.filter((game) => game.excluded && game.inSteam).length,
  };

  return (
    <div className="app">
      <Header status={status} loading={loading} settingsOpen={view === 'settings'} onRefresh={() => void load()} onToggleSettings={() => (view === 'settings' ? showLibrary() : setView('settings'))} />
      {openGame && (
        <GamePage
          game={openGame}
          items={art[openGame.appId]?.items ?? []}
          onBack={() => setView('library')}
          onToggle={(include) => void toggle([openGame.key], include)}
          onOpenSettings={() => setView('settings')}
          onArtworkChanged={(appId, entry) => setArt((current) => ({ ...current, [appId]: entry }))}
        />
      )}
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
      {!openGame && view !== 'settings' && (
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
            <Library
              report={report}
              shortcuts={shortcuts}
              art={art}
              artProgress={artProgress}
              loading={loading}
              onToggle={(keys, include) => void toggle(keys, include)}
              onOpen={(key) => {
                setOpenKey(key);
                setView('game');
              }}
            />
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
