import type { ReactNode } from 'react';

/** A labelled on/off switch. */
export function Switch({ checked, onChange, children, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}
