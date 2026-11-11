import { useEffect, useState } from 'react';
import type { ArtworkEntry, ArtworkKind, ArtworkResult, GameInfo } from '../ipc.js';
import { api, errorMessage } from './api.js';
import { ArtworkGallery } from './ArtworkGallery.js';
import { stateOf } from './gameState.js';
import { ArrowLeftIcon } from './icons.js';
import { Switch } from './Switch.js';

function summary(outcomes: ArtworkResult['outcomes']): { text: string; error?: string } {
  const count = (status: ArtworkResult['outcomes'][number]['status']): number => outcomes.filter((outcome) => outcome.status === status).length;
  const failed = outcomes.find((outcome) => outcome.status === 'failed');
  return {
    text: `${count('saved')} downloaded, ${count('exists')} already cached, ${count('missing')} not on SteamGridDB, ${count('failed')} failed.`,
    error: failed?.error,
  };
}

export function GamePage({
  game,
  entry,
  onBack,
  onToggle,
  onOpenSettings,
  onArtworkChanged,
}: {
  game: GameInfo;
  /** What is known about the game's artwork; undefined until it has been read. */
  entry?: ArtworkEntry;
  onBack: () => void;
  /** Ticks the game on or off for Steam. */
  onToggle: (include: boolean) => void;
  onOpenSettings: () => void;
  onArtworkChanged: (appId: number, entry: ArtworkEntry) => void;
}) {
  const [hasKey, setHasKey] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<ArtworkKind>();
  const [result, setResult] = useState<ReturnType<typeof summary>>();
  const [failure, setFailure] = useState<string>();
  const state = stateOf(game);
  const optionsReady = entry?.optionsReady === true;
  const fetching = busy || (hasKey === true && !optionsReady && failure === undefined);

  /** Lists the options of every image type and downloads their previews. */
  async function load(force: boolean): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      const loaded = await api().loadArtworkOptions({ appId: game.appId, title: game.title, force });
      setResult(force ? summary(loaded.outcomes) : undefined);
      onArtworkChanged(game.appId, loaded.entry);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    api()
      .apiKeyStatus()
      .then((status) => {
        setHasKey(status.set);
        if (status.set && !optionsReady) void load(false);
      })
      .catch((error: unknown) => setFailure(errorMessage(error)));
    // Options are fetched once, when the game is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(kind: ArtworkKind, imageId: number | null): Promise<void> {
    setPicking(kind);
    setFailure(undefined);
    try {
      const picked = await api().chooseArtwork({ appId: game.appId, title: game.title, kind, imageId });
      onArtworkChanged(game.appId, picked.entry);
      setFailure(picked.downloadError);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setPicking(undefined);
    }
  }

  return (
    <div className="game-page">
      <div className="settings-head">
        <button type="button" className="button" onClick={onBack}>
          <ArrowLeftIcon />
          Library
        </button>
        <h2>{game.title}</h2>
      </div>

      <section className="panel game-details" aria-label="Game">
        <div className="row">
          <span className="chip">{game.store}</span>
          {state && <span className={`origin inline ${state.tone}`}>{state.label}</span>}
          {game.weak && <span className="chip">Guess</span>}
          <span className="muted">
            Shortcut ID <code>{game.appId}</code>
          </span>
        </div>
        <Switch checked={!game.excluded} onChange={onToggle}>
          Add to Steam
        </Switch>
      </section>

      <section className="panel game-art" aria-label="Artwork">
        <div className="section-head">
          <h2>Artwork</h2>
          <button type="button" className="button" disabled={busy || hasKey !== true} onClick={() => void load(true)}>
            {busy ? 'Fetching…' : 'Refresh options'}
          </button>
        </div>

        <p className="help">
          Pick the image to use for each type. Your picks are copied into Steam’s grid folder the next time the game is synced.
        </p>

        {hasKey === false && (
          <div className="callout warn" role="status">
            <b>No SteamGridDB key</b>
            <span>Artwork comes from SteamGridDB and needs a free API key.</span>
            <button type="button" className="button" onClick={onOpenSettings}>
              Open settings
            </button>
          </div>
        )}
        {failure && <p className="status error" role="alert">{failure}</p>}
        {result && <p className="status" role="status">{result.text}{result.error ? ` ${result.error}` : ''}</p>}

        <ArtworkGallery entry={entry} loading={fetching} picking={picking} onPick={(kind, imageId) => void pick(kind, imageId)} />
      </section>
    </div>
  );
}
