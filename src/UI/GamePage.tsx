import { useEffect, useState } from 'react';
import type { ArtworkItem, ArtworkKind, ArtworkResult, GameInfo } from '../ipc.js';
import { api, errorMessage } from './api.js';
import { stateOf } from './gameState.js';
import { ArrowLeftIcon } from './icons.js';
import { Switch } from './Switch.js';

/** How each kind of image is shown: its name, SteamGridDB's usual size, and how it fits its frame. */
const KINDS: Record<ArtworkKind, { label: string; size: string; fit: 'cover' | 'contain' }> = {
  hero: { label: 'Hero', size: '1920 × 620', fit: 'cover' },
  poster: { label: 'Poster', size: '600 × 900', fit: 'cover' },
  wide: { label: 'Wide capsule', size: '920 × 430', fit: 'cover' },
  logo: { label: 'Logo', size: '800 × 310', fit: 'contain' },
  icon: { label: 'Icon', size: '256 × 256', fit: 'contain' },
};

const TILES: ArtworkKind[] = ['poster', 'wide', 'logo', 'icon'];

function Tile({ kind, item }: { kind: ArtworkKind; item?: ArtworkItem }) {
  const { label, size, fit } = KINDS[kind];
  return (
    <figure className={`art-tile ${kind}`}>
      <div className="art-frame">
        {item ? <img src={item.url} alt={`${label} image`} style={{ objectFit: fit }} /> : <span className="muted">Not downloaded</span>}
      </div>
      <figcaption>
        {label} <span className="muted">{size}</span>
      </figcaption>
    </figure>
  );
}

function summary(outcomes: ArtworkResult['outcomes']): { text: string; error?: string } {
  const count = (status: ArtworkResult['outcomes'][number]['status']): number => outcomes.filter((outcome) => outcome.status === status).length;
  const failed = outcomes.find((outcome) => outcome.status === 'failed');
  return {
    text: `${count('saved')} downloaded, ${count('exists')} already there, ${count('missing')} not on SteamGridDB, ${count('failed')} failed.`,
    error: failed?.error,
  };
}

export function GamePage({
  game,
  items,
  onBack,
  onToggle,
  onOpenSettings,
  onArtworkChanged,
}: {
  game: GameInfo;
  items: ArtworkItem[];
  onBack: () => void;
  /** Ticks the game on or off for Steam. */
  onToggle: (include: boolean) => void;
  onOpenSettings: () => void;
  onArtworkChanged: (appId: number, items: ArtworkItem[]) => void;
}) {
  const [hasKey, setHasKey] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof summary>>();
  const [failure, setFailure] = useState<string>();
  const state = stateOf(game);
  const itemOf = (kind: ArtworkKind): ArtworkItem | undefined => items.find((item) => item.kind === kind);

  useEffect(() => {
    api()
      .apiKeyStatus()
      .then((status) => setHasKey(status.set))
      .catch((error: unknown) => setFailure(errorMessage(error)));
  }, []);

  async function download(force: boolean): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      const downloaded = await api().downloadArtwork({ appId: game.appId, title: game.title, force });
      setResult(summary(downloaded.outcomes));
      onArtworkChanged(game.appId, downloaded.items);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
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
          <div className="row">
            <button type="button" className="button primary" disabled={busy || hasKey === false} onClick={() => void download(false)}>
              {busy ? 'Downloading…' : 'Download artwork'}
            </button>
            {items.length > 0 && (
              <button type="button" className="button" disabled={busy || hasKey === false} onClick={() => void download(true)}>
                Download again
              </button>
            )}
          </div>
        </div>

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

        <figure className="art-tile hero">
          <div className="art-frame">
            {itemOf('hero') ? <img src={itemOf('hero')?.url} alt="Hero image" /> : <span className="muted">Not downloaded</span>}
          </div>
          <figcaption>
            Hero <span className="muted">{KINDS.hero.size}</span>
          </figcaption>
        </figure>
        <div className="art-grid">
          {TILES.map((kind) => (
            <Tile key={kind} kind={kind} item={itemOf(kind)} />
          ))}
        </div>
      </section>
    </div>
  );
}
