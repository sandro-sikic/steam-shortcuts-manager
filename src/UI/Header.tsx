import type { StatusInfo } from '../ipc.js';
import { AlertIcon, CheckIcon, Logo, RefreshIcon } from './icons.js';

function StatusPill({ status, loading }: { status?: StatusInfo; loading: boolean }) {
  if (loading) return <span className="pill skeleton" role="status" aria-label="Checking Steam" />;
  if (!status) return <span className="pill danger"><AlertIcon />Not connected</span>;
  if (status.error) return <span className="pill danger"><AlertIcon />Steam not found</span>;
  if (status.steamRunning) return <span className="pill warn"><AlertIcon />Steam is running</span>;
  return <span className="pill ok"><CheckIcon />Steam is closed</span>;
}

export function Header({ status, loading, onRefresh }: { status?: StatusInfo; loading: boolean; onRefresh: () => void }) {
  return (
    <header className="top">
      <div className="brand">
        <Logo />
        <h1>Steam Manager</h1>
      </div>
      <div className="top-actions">
        <StatusPill status={status} loading={loading} />
        <button type="button" className="icon-button" aria-label="Refresh" title="Refresh" onClick={onRefresh}>
          <RefreshIcon />
        </button>
      </div>
    </header>
  );
}
