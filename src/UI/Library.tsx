import { useState } from 'react';
import type { ShortcutInfo } from '../ipc.js';
import { coverHue, initials } from './cover.js';
import { SearchIcon } from './icons.js';

function GameCard({ shortcut }: { shortcut: ShortcutInfo }) {
  return (
    <li className="game" style={{ '--hue': coverHue(shortcut.title) } as React.CSSProperties}>
      <div className="cover" aria-hidden="true">
        {initials(shortcut.title)}
      </div>
      <div className="game-info">
        <span className="game-title">{shortcut.title}</span>
        <span className="game-meta">
          {shortcut.tags.map((tag) => (
            <span key={tag} className="chip">
              {tag}
            </span>
          ))}
        </span>
      </div>
      <span className={shortcut.managed ? 'origin synced' : 'origin manual'} title={shortcut.managed ? 'Created by Steam Manager' : 'Added by you'}>
        {shortcut.managed ? 'Synced' : 'Yours'}
      </span>
    </li>
  );
}

function Skeletons() {
  return (
    <ul className="grid" aria-busy="true" aria-label="Loading library">
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <li key={n} className="game skeleton" />
      ))}
    </ul>
  );
}

export function Library({ shortcuts, loading }: { shortcuts: ShortcutInfo[]; loading: boolean }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = shortcuts.filter((shortcut) => shortcut.title.toLowerCase().includes(needle));

  let body;
  if (loading) body = <Skeletons />;
  else if (shortcuts.length === 0) {
    body = (
      <div className="empty">
        <h3>No games yet</h3>
        <p>Run a sync to add the games installed on this computer to Steam.</p>
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className="empty">
        <h3>No matches</h3>
        <p>Nothing in your library matches “{query.trim()}”.</p>
      </div>
    );
  } else {
    body = (
      <ul className="grid">
        {shown.map((shortcut) => (
          <GameCard key={shortcut.appId} shortcut={shortcut} />
        ))}
      </ul>
    );
  }

  return (
    <section className="library" aria-label="Library">
      <div className="section-head">
        <h2>
          Library <span className="count">{loading ? '' : shortcuts.length}</span>
        </h2>
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search games" aria-label="Search games" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {body}
    </section>
  );
}
