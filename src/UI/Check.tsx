/** A checkbox that can also show "some selected" (a dash), used for groups and select-all. */
export function Check({ checked, indeterminate = false, label, onChange }: { checked: boolean; indeterminate?: boolean; label?: string; onChange: (next: boolean) => void }) {
  return (
    <input
      ref={(input) => {
        if (input) input.indeterminate = indeterminate;
      }}
      type="checkbox"
      className="check"
      checked={checked}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
