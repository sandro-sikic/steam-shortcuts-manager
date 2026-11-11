import { useEffect, useState } from 'react';
import type { ApiKeyStatus } from '../../ipc.js';
import { ARTWORK_KINDS, type ArtworkKind } from '../../artwork/kinds.js';
import { api, errorMessage } from '../api.js';
import { Check } from '../Check.js';
import { Switch } from '../Switch.js';
import type { SectionProps } from './types.js';

const KIND_LABELS: Record<ArtworkKind, string> = {
  poster: 'Poster',
  wide: 'Wide capsule',
  hero: 'Hero banner',
  logo: 'Logo',
  icon: 'Icon',
};

interface Message {
  tone: 'ok' | 'error';
  text: string;
}

export function ArtworkSection({ settings, update }: SectionProps) {
  const [status, setStatus] = useState<ApiKeyStatus | undefined>();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | undefined>();
  const [saveError, setSaveError] = useState<string | undefined>();

  useEffect(() => {
    api()
      .apiKeyStatus()
      .then(setStatus)
      .catch((error: unknown) => setMessage({ tone: 'error', text: errorMessage(error) }));
  }, []);

  /** Runs one key request: marks busy, shows its outcome, reports failures. */
  const run = async (action: () => Promise<Message | undefined>) => {
    setBusy(true);
    setMessage(undefined);
    try {
      setMessage(await action());
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await api().setApiKey(input);
      setInput('');
      setStatus(await api().apiKeyStatus());
      return { tone: 'ok', text: 'Saved.' };
    });

  const test = () =>
    run(async () => {
      const result = await api().testApiKey(input.trim() || undefined);
      return { tone: result.ok ? 'ok' : 'error', text: result.message };
    });

  const remove = () =>
    run(async () => {
      await api().setApiKey('');
      setStatus(await api().apiKeyStatus());
      return { tone: 'ok', text: 'Key removed.' };
    });

  const toggleKind = (kind: ArtworkKind, on: boolean) => {
    const kinds = ARTWORK_KINDS.filter((k) => (k === kind ? on : settings.artwork.kinds.includes(k)));
    setSaveError(undefined);
    update({ artwork: { kinds } }).catch((error: unknown) => setSaveError(errorMessage(error)));
  };

  const toggleAuto = (next: boolean) => {
    setSaveError(undefined);
    update({ artwork: { auto: next } }).catch((error: unknown) => setSaveError(errorMessage(error)));
  };

  const toggleNsfw = (next: boolean) => {
    setSaveError(undefined);
    update({ artwork: { nsfw: next } }).catch((error: unknown) => setSaveError(errorMessage(error)));
  };

  const saved = settings.artwork.options;
  const [draft, setDraft] = useState(String(saved));
  const [draftInvalid, setDraftInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(saved));
    setDraftInvalid(false);
  }, [saved]);

  /** Saves the draft when it is a whole number from 1 to 20 that differs from the saved value. */
  const commitOptions = (resetIfInvalid: boolean) => {
    const n = Number(draft);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      setDraftInvalid(true);
      if (resetIfInvalid) setDraft(String(saved));
      return;
    }
    setDraftInvalid(false);
    if (n === saved) return;
    setSaveError(undefined);
    update({ artwork: { options: n } }).catch((error: unknown) => setSaveError(errorMessage(error)));
  };

  const toggleSync = (next: boolean) => {
    setSaveError(undefined);
    update({ sync: { artwork: next } }).catch((error: unknown) => setSaveError(errorMessage(error)));
  };

  return (
    <section className="panel settings-section" aria-label="Artwork">
      <h2>Artwork</h2>
      <p className="help">Choose where artwork comes from and which images are downloaded.</p>

      <div className="field">
        <label htmlFor="settings-artwork-key">SteamGridDB API key</label>
        {status?.source === 'saved' && <p className="help">A key is saved in this app.</p>}
        {status?.source === 'environment' && <p className="help">Using the STEAMGRIDDB_API_KEY environment variable.</p>}
        {status?.source === 'none' && (
          <p className="help">
            No key set. Artwork needs a free SteamGridDB key.{' '}
            <a href="https://www.steamgriddb.com/profile/preferences/api" target="_blank" rel="noreferrer">
              Get a key
            </a>
          </p>
        )}
        {status && !status.secureStorage && (
          <div className="callout warn" role="status">
            Secure storage is not available on this system, so a key cannot be saved here. Set the STEAMGRIDDB_API_KEY environment variable instead.
          </div>
        )}
        <div className="row">
          <input
            id="settings-artwork-key"
            className="input"
            type="password"
            aria-label="SteamGridDB API key"
            autoComplete="off"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <button type="button" className="button primary" disabled={busy || input === '' || status?.secureStorage === false} onClick={save}>
            Save
          </button>
          <button type="button" className="button" disabled={busy} onClick={test}>
            Test
          </button>
          {status?.source === 'saved' && (
            <button type="button" className="button" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
        </div>
        {message && (
          <p className={`status ${message.tone}`} role={message.tone === 'ok' ? 'status' : 'alert'}>
            {message.text}
          </p>
        )}
      </div>

      <fieldset className="field">
        <legend>Images to copy into Steam</legend>
        {ARTWORK_KINDS.map((kind) => (
          <label key={kind} className="check-row">
            <Check checked={settings.artwork.kinds.includes(kind)} onChange={(next) => toggleKind(kind, next)} />
            <span>{KIND_LABELS[kind]}</span>
          </label>
        ))}
        {settings.artwork.kinds.length === 0 && <p className="help">No images will be copied into Steam.</p>}
      </fieldset>

      <Switch checked={settings.artwork.auto} onChange={toggleAuto}>
        Download artwork for my games automatically
      </Switch>
      <p className="help">When the library is ready, the app downloads the images of every game it finds into its own cache.</p>
      <div className="field">
        <label htmlFor="settings-artwork-options">Options per image type</label>
        <input
          id="settings-artwork-options"
          className="input"
          type="number"
          min="1"
          max="20"
          step="1"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setDraftInvalid(false);
          }}
          onBlur={() => commitOptions(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commitOptions(false);
          }}
        />
        <p className="help">How many SteamGridDB images to offer for each image type on a game's page (1 to 20).</p>
        {draftInvalid && (
          <p className="status error" role="alert">
            Enter a whole number from 1 to 20.
          </p>
        )}
      </div>
      <Switch checked={settings.artwork.nsfw} onChange={toggleNsfw}>
        Show adult (NSFW) artwork
      </Switch>
      <p className="help">When off, SteamGridDB is asked to leave adult images out. Turning it on also offers adult images.</p>
      <Switch checked={settings.sync.artwork} onChange={toggleSync}>
        Copy artwork into Steam when syncing
      </Switch>
      {saveError && (
        <p className="status error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
