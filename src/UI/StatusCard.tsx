import type { StatusInfo } from '../ipc.js';

export function StatusCard({ status }: { status: StatusInfo }) {
  return (
    <section className="card" aria-label="Steam status">
      <h2>Steam</h2>
      {status.error ? (
        <p className="error">{status.error}</p>
      ) : (
        <dl>
          <dt>Installation</dt>
          <dd>{status.steamRoot}</dd>
          <dt>Account</dt>
          <dd>{status.accountId}</dd>
        </dl>
      )}
      <p>
        <span className={status.steamRunning ? 'badge warn' : 'badge ok'}>
          {status.steamRunning ? 'Steam is running: close it before syncing' : 'Steam is closed'}
        </span>{' '}
        <span className="muted">{status.platform}</span>
      </p>
    </section>
  );
}
