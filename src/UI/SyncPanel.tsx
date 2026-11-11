import { useState } from 'react';
import type { IntegrationInfo, SyncReport, SyncRequest } from '../ipc.js';
import { api, errorMessage } from './api.js';

type Options = Omit<SyncRequest, 'only'>;

const CHECKBOXES: { key: keyof Options; label: string }[] = [
  { key: 'dryRun', label: 'Dry run (preview only, change nothing)' },
  { key: 'prune', label: 'Remove shortcuts for games that are gone' },
  { key: 'includeMaybe', label: 'Include weak guesses (Unity/Unreal installs)' },
  { key: 'artwork', label: 'Download artwork from SteamGridDB' },
];

const COUNTS = ['added', 'updated', 'removed', 'unchanged', 'skipped'] as const;

export function SyncPanel({ integrations, disabled, onChanged }: { integrations: IntegrationInfo[]; disabled: boolean; onChanged: () => void }) {
  const [options, setOptions] = useState<Options>({ dryRun: true, prune: false, includeMaybe: false, artwork: true });
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport>();
  const [failure, setFailure] = useState<string>();

  async function run(): Promise<void> {
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await api().sync(options);
      setReport(result);
      if (!options.dryRun && !result.error) onChanged();
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-label="Sync">
      <h2>Sync</h2>
      <p className="muted">Scans: {integrations.length === 0 ? 'nothing on this platform' : integrations.map((i) => i.label).join(', ')}</p>
      {CHECKBOXES.map(({ key, label }) => (
        <label key={key} className="check">
          <input type="checkbox" checked={options[key]} onChange={(event) => setOptions({ ...options, [key]: event.target.checked })} />
          {label}
        </label>
      ))}
      <button type="button" disabled={disabled || busy} onClick={() => void run()}>
        {busy ? 'Working…' : options.dryRun ? 'Preview sync' : 'Sync now'}
      </button>
      {failure && <p className="error">{failure}</p>}
      {report?.error && <p className="error">{report.error}</p>}
      {report && (
        <>
          <p>{COUNTS.map((name) => `${report[name].length} ${name}`).join(' · ')}</p>
          <pre className="log">{report.log.join('\n')}</pre>
        </>
      )}
    </section>
  );
}
