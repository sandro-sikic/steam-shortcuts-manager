import type { ShortcutInfo } from '../ipc.js';

export function ShortcutList({ shortcuts }: { shortcuts: ShortcutInfo[] }) {
  return (
    <section className="card" aria-label="Shortcuts">
      <h2>Non-Steam shortcuts ({shortcuts.length})</h2>
      {shortcuts.length === 0 ? (
        <p className="muted">No shortcuts yet.</p>
      ) : (
        <ul className="list">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.appId}>
              <span className="title">{shortcut.title}</span>
              {shortcut.tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
              {shortcut.managed && <span className="badge ok">managed</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
