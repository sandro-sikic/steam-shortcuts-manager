import { useState } from 'react';
import type { DuplicateInfo, GameInfo, GamesReport, ShortcutInfo } from '../ipc.js';
import { Check } from './Check.js';
import { coverHue, initials } from './cover.js';
import { SearchIcon } from './icons.js';

type Hue = React.CSSProperties;

/** What will happen to a game on the next Apply, given its checkbox and whether it is in Steam. */
function stateOf(game: GameInfo): { label: string; tone: string } | undefined {
  if (game.excluded) return game.inSteam ? { label: 'Will remove', tone: 'remove' } : undefined;
  return game.inSteam ? { label: 'In Steam', tone: 'in' } : { label: 'Will add', tone: 'add' };
}

function Cover({ title }: { title: string }) {
  return (
    <div className="cover" aria-hidden="true">
      {initials(title)}
    </div>
  );
}

function GameCard({ game, onToggle }: { game: GameInfo; onToggle: (keys: string[], include: boolean) => void }) {
  const state = stateOf(game);
  return (
    <li className={game.excluded ? 'game off' : 'game'} style={{ '--hue': coverHue(game.title) } as Hue}>
      <label className="game-label">
        <Check checked={!game.excluded} onChange={(include) => onToggle([game.key], include)} />
        <Cover title={game.title} />
        {state && <span className={`origin ${state.tone}`}>{state.label}</span>}
        <span className="game-info">
          <span className="game-title">{game.title}</span>
          {game.weak && <span className="chip">Guess</span>}
        </span>
      </label>
    </li>
  );
}

function ShortcutCard({ shortcut, label }: { shortcut: ShortcutInfo; label: { text: string; tone: string; hint: string } }) {
  return (
    <li className="game fixed" style={{ '--hue': coverHue(shortcut.title) } as Hue}>
      <Cover title={shortcut.title} />
      <span className={`origin ${label.tone}`} title={label.hint}>
        {label.text}
      </span>
      <span className="game-info">
        <span className="game-title">{shortcut.title}</span>
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

function Duplicates({ duplicates }: { duplicates: DuplicateInfo[] }) {
  return (
    <details className="dupes">
      <summary>
        {duplicates.length} duplicate{duplicates.length === 1 ? '' : 's'} skipped
      </summary>
      <ul>
        {duplicates.map((duplicate) => (
          <li key={`${duplicate.store}:${duplicate.title}`}>
            {duplicate.title} <span className="muted">[{duplicate.store}] is the same as {duplicate.of}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Tri-state for a set of games: all on, none, or some. */
function selection(games: GameInfo[]): { checked: boolean; indeterminate: boolean } {
  const on = games.filter((game) => !game.excluded).length;
  return { checked: games.length > 0 && on === games.length, indeterminate: on > 0 && on < games.length };
}

export function Library({
  report,
  shortcuts,
  loading,
  onToggle,
}: {
  report: GamesReport;
  shortcuts: ShortcutInfo[];
  loading: boolean;
  onToggle: (keys: string[], include: boolean) => void;
}) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const matches = (title: string): boolean => title.toLowerCase().includes(needle);

  const visible = report.games.filter((game) => matches(game.title));
  const groups = [...new Set(visible.map((game) => game.store))].sort((a, b) => a.localeCompare(b));
  const found = new Set(report.games.map((game) => game.appId));
  const yours = shortcuts.filter((shortcut) => !shortcut.managed && matches(shortcut.title));
  const gone = shortcuts.filter((shortcut) => shortcut.managed && !found.has(shortcut.appId) && matches(shortcut.title));

  const everything = selection(visible);
  const selected = report.games.filter((game) => !game.excluded).length;
  const setAll = (games: GameInfo[], include: boolean): void => onToggle(games.map((game) => game.key), include);

  let body;
  if (loading) body = <Skeletons />;
  else if (report.games.length === 0 && shortcuts.length === 0) {
    body = (
      <div className="empty">
        <h3>No games found</h3>
        <p>None of the supported launchers has an installed game on this computer yet.</p>
      </div>
    );
  } else if (visible.length + yours.length + gone.length === 0) {
    body = (
      <div className="empty">
        <h3>No matches</h3>
        <p>Nothing in your library matches “{query.trim()}”.</p>
      </div>
    );
  } else {
    body = (
      <>
        {groups.map((store) => {
          const games = visible.filter((game) => game.store === store).sort((a, b) => a.title.localeCompare(b.title));
          const { checked, indeterminate } = selection(games);
          return (
            <section key={store} className="group" aria-label={store}>
              <div className="group-head">
                <Check checked={checked} indeterminate={indeterminate} label={`Select all ${store}`} onChange={(include) => setAll(games, include)} />
                <h3>{store}</h3>
                <span className="count">{games.filter((game) => !game.excluded).length}/{games.length}</span>
              </div>
              <ul className="grid">
                {games.map((game) => (
                  <GameCard key={game.key} game={game} onToggle={onToggle} />
                ))}
              </ul>
            </section>
          );
        })}
        {yours.length > 0 && (
          <section className="group" aria-label="Your shortcuts">
            <div className="group-head">
              <h3>Your shortcuts</h3>
              <span className="muted">Added by you, never changed here</span>
            </div>
            <ul className="grid">
              {yours.map((shortcut) => (
                <ShortcutCard key={shortcut.appId} shortcut={shortcut} label={{ text: 'Yours', tone: 'yours', hint: 'Added by you' }} />
              ))}
            </ul>
          </section>
        )}
        {gone.length > 0 && (
          <section className="group" aria-label="No longer found">
            <div className="group-head">
              <h3>No longer found</h3>
              <span className="muted">Added by us, but the game is gone. Remove with “Remove shortcuts for games that are gone”.</span>
            </div>
            <ul className="grid">
              {gone.map((shortcut) => (
                <ShortcutCard key={shortcut.appId} shortcut={shortcut} label={{ text: 'Not found', tone: 'gone', hint: 'Created by Steam Manager' }} />
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  return (
    <section className="library" aria-label="Library">
      <div className="section-head">
        <h2>
          Library <span className="count">{loading ? '' : report.games.length}</span>
        </h2>
        <label className="search">
          <SearchIcon />
          <input type="search" placeholder="Search games" aria-label="Search games" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      {!loading && visible.length > 0 && (
        <div className="toolbar">
          <label className="select-all">
            <Check checked={everything.checked} indeterminate={everything.indeterminate} label="Select all games" onChange={(include) => setAll(visible, include)} />
            Select all
          </label>
          <span className="muted">
            {selected} of {report.games.length} selected for Steam
          </span>
        </div>
      )}
      {body}
      {!loading && report.duplicates.length > 0 && <Duplicates duplicates={report.duplicates} />}
    </section>
  );
}
