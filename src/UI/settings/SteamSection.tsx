import { useEffect, useState } from 'react';
import type { SteamAccountInfo, SettingsPatch } from '../../ipc.js';
import { api, errorMessage } from '../api.js';
import { Switch } from '../Switch.js';
import type { SectionProps } from './types.js';

export function SteamSection({ settings, update }: SectionProps) {
  const { dir, user, allowRunning } = settings.steam;
  const [draft, setDraft] = useState(dir);
  const [accounts, setAccounts] = useState<SteamAccountInfo[]>([]);
  const [error, setError] = useState('');

  useEffect(() => setDraft(dir), [dir]);

  useEffect(() => {
    let live = true;
    api()
      .steamAccounts()
      .then((list) => live && setAccounts(list))
      .catch((e: unknown) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);

  const save = async (patch: SettingsPatch): Promise<boolean> => {
    setError('');
    try {
      await update(patch);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  };

  const commit = async () => {
    if (draft === dir) return;
    if (!(await save({ steam: { dir: draft } }))) setDraft(dir);
  };

  const known = accounts.some((account) => account.accountId === user);

  return (
    <section className="panel settings-section" aria-label="Steam">
      <h2>Steam</h2>
      <p className="help">Which Steam installation and account the shortcuts are written to.</p>
      <div className="field">
        <label htmlFor="settings-steam-dir">Steam folder</label>
        <div className="row">
          <input
            id="settings-steam-dir"
            className="input"
            type="text"
            aria-label="Steam folder"
            placeholder="Detected automatically"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commit();
            }}
          />
          {dir !== '' && (
            <button
              type="button"
              className="button"
              onClick={() => {
                setDraft('');
                void save({ steam: { dir: '' } });
              }}
            >
              Use auto-detect
            </button>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="settings-steam-user">Account</label>
        <select id="settings-steam-user" className="input" aria-label="Steam account" value={user} onChange={(event) => void save({ steam: { user: event.target.value } })}>
          <option value="">Most recent user</option>
          {accounts.map((account) => (
            <option key={account.accountId} value={account.accountId}>
              {`${account.name || 'Account ' + account.accountId} (${account.accountId})`}
            </option>
          ))}
          {user !== '' && !known && <option value={user}>{`Account ${user} (not found)`}</option>}
        </select>
      </div>
      <Switch checked={allowRunning} onChange={(next) => void save({ steam: { allowRunning: next } })}>
        Allow changes while Steam is running
      </Switch>
      {allowRunning && (
        <p className="callout warn" role="status">
          Steam rewrites its files when it closes, which can undo changes made while it runs.
        </p>
      )}
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
