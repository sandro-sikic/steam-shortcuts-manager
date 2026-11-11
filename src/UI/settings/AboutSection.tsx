import { useEffect, useState } from 'react';
import type { AboutInfo } from '../../ipc.js';
import { api, errorMessage } from '../api.js';

interface Message {
  tone: 'ok' | 'error';
  text: string;
}

export function AboutSection({ onReset }: { onReset: () => Promise<void> }) {
  const [info, setInfo] = useState<AboutInfo | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<Message | undefined>();

  useEffect(() => {
    api()
      .about()
      .then(setInfo)
      .catch((error: unknown) => setLoadError(errorMessage(error)));
  }, []);

  const openFolder = async () => {
    setMessage(undefined);
    try {
      await api().openConfigFolder();
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error) });
    }
  };

  const reset = async () => {
    setMessage(undefined);
    try {
      await onReset();
      setConfirming(false);
      setMessage({ tone: 'ok', text: 'Settings reset.' });
    } catch (error) {
      setMessage({ tone: 'error', text: errorMessage(error) });
    }
  };

  return (
    <section className="panel settings-section" aria-label="About">
      <h2>About</h2>
      <p className="help">Details about this installation.</p>

      {loadError && (
        <p className="status error" role="alert">
          {loadError}
        </p>
      )}
      {!info && !loadError && <p className="muted">Loading...</p>}
      {info && (
        <dl>
          <dt>Version</dt>
          <dd>{info.version}</dd>
          <dt>Platform</dt>
          <dd>{info.platform}</dd>
          <dt>Config file</dt>
          <dd>
            <code style={{ overflowWrap: 'anywhere' }}>{info.configFile}</code>
          </dd>
          <dt>Steam folder</dt>
          <dd>{info.steamRoot ?? 'Not found'}</dd>
          <dt>Secure storage</dt>
          <dd>{info.secureStorage ? 'Available' : 'Not available'}</dd>
        </dl>
      )}

      <div className="row">
        <button type="button" className="button" onClick={openFolder}>
          Open config folder
        </button>
        <button type="button" className="button danger" onClick={() => setConfirming(true)}>
          Reset settings
        </button>
      </div>

      {confirming && (
        <div className="row">
          <span>Reset every setting to its default? Your game choices are kept.</span>
          <button type="button" className="button danger" onClick={reset}>
            Reset
          </button>
          <button type="button" className="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      )}
      {message && (
        <p className={`status ${message.tone}`} role={message.tone === 'ok' ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </section>
  );
}
