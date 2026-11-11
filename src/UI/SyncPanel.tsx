import { useState } from 'react';
import type { IntegrationInfo, Settings, SyncReport } from '../ipc.js';
import { api, errorMessage } from './api.js';
import { SyncIcon } from './icons.js';
import { Segmented } from './Segmented.js';
import { Switch } from './Switch.js';

const SWITCHES = [
  { key: 'prune', label: 'Remove shortcuts for games that are gone' },
  { key: 'artwork', label: 'Download artwork from SteamGridDB' },
] as const;

const COUNTS = [
  { key: 'added', label: 'Added' },
  { key: 'updated', label: 'Updated' },
  { key: 'removed', label: 'Removed' },
  { key: 'unchanged', label: 'Unchanged' },
  { key: 'skipped', label: 'Skipped' },
] as const;

type Mode = 'preview' | 'apply';
type Toggles = Record<(typeof SWITCHES)[number]['key'], boolean>;

export function SyncPanel({
  integrations,
  defaults,
  disabled,
  includeMaybe,
  onIncludeMaybe,
  pending,
  onChanged,
}: {
  integrations: IntegrationInfo[];
  /** The starting choices, from settings. */
  defaults: Settings['sync'];
  disabled: boolean;
  includeMaybe: boolean;
  onIncludeMaybe: (next: boolean) => void;
  pending: { add: number; remove: number };
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>(defaults.mode);
  const [toggles, setToggles] = useState<Toggles>({ prune: defaults.prune, artwork: defaults.artwork });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ report: SyncReport; dryRun: boolean }>();
  const [failure, setFailure] = useState<string>();

  async function run(): Promise<void> {
    const dryRun = mode === 'preview';
    setBusy(true);
    setFailure(undefined);
    try {
      const report = await api().sync({ dryRun, includeMaybe, ...toggles });
      setResult({ report, dryRun });
      if (!dryRun && !report.error) onChanged();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel sync" aria-label="Sync">
      <h2>Sync</h2>
      <p className="sub">Finds the games installed on this computer and adds them to Steam.</p>

      <div className="launchers" aria-label="Launchers scanned">
        {integrations.filter((integration) => integration.enabled).length === 0 ? (
          <span className="muted">No launchers on this platform</span>
        ) : (
          integrations
            .filter((integration) => integration.enabled)
            .map((integration) => (
            <span key={integration.id} className="chip launcher">
              {integration.label}
            </span>
          ))
        )}
      </div>

      <Segmented
        label="Mode"
        value={mode}
        options={[
          { value: 'preview', label: 'Preview' },
          { value: 'apply', label: 'Apply' },
        ]}
        onChange={setMode}
      />
      <p className="hint">{mode === 'preview' ? 'Shows what would change. Nothing is written.' : 'Writes to Steam. Close Steam first.'}</p>

      <div className="switches">
        {SWITCHES.map(({ key, label }) => (
          <Switch key={key} checked={toggles[key]} onChange={(next) => setToggles({ ...toggles, [key]: next })}>
            {label}
          </Switch>
        ))}
        <Switch checked={includeMaybe} onChange={onIncludeMaybe}>
          List weak guesses (Unity/Unreal installs)
        </Switch>
      </div>

      <p className="pending">
        {pending.add === 0 && pending.remove === 0
          ? 'Steam already matches your selection.'
          : `${pending.add} to add · ${pending.remove} to remove`}
      </p>

      <button type="button" className={mode === 'apply' ? 'cta apply' : 'cta'} disabled={disabled || busy} onClick={() => void run()}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <SyncIcon />}
        {busy ? 'Working…' : mode === 'preview' ? 'Preview changes' : 'Apply to Steam'}
      </button>

      {failure && <p className="callout danger" role="alert">{failure}</p>}
      {result?.report.error && <p className="callout danger" role="alert">{result.report.error}</p>}
      {result && (
        <div className="result">
          <div className="stats">
            {COUNTS.map(({ key, label }) => {
              const count = result.report[key].length;
              return (
                <div key={key} className={count > 0 ? `stat ${key}` : 'stat'} aria-label={`${count} ${key}`}>
                  <b>{count}</b>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
          {result.dryRun && <p className="note">Preview only. Nothing was changed.</p>}
          {result.report.log.length > 0 && <pre className="log" aria-label="Log">{result.report.log.join('\n')}</pre>}
        </div>
      )}
    </section>
  );
}
