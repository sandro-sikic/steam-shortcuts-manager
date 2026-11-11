import { useEffect, useState } from 'react';
import { api, errorMessage } from '../api.js';
import type { GameInfo, Lists } from '../../ipc.js';

function ListEditor({ title, help, entries, onSave }: { title: string; help: string; entries: string[]; onSave: (next: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');

  const add = async () => {
    const entry = draft.trim();
    if (!entry || entries.some((existing) => existing.toLowerCase() === entry.toLowerCase())) return;
    if (await onSave([...entries, entry])) setDraft('');
  };

  return (
    <div className="field">
      <h3>{title}</h3>
      <p className="help">{help}</p>
      <div className="row">
        {entries.map((entry) => (
          <span key={entry} className="chip">
            {entry}
            <button type="button" aria-label={`Remove ${entry}`} onClick={() => void onSave(entries.filter((e) => e !== entry))}>
              x
            </button>
          </span>
        ))}
      </div>
      <div className="row">
        <input
          className="input"
          type="text"
          aria-label={`Add to ${title}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add();
          }}
        />
        <button type="button" className="button" onClick={() => void add()}>
          Add
        </button>
      </div>
    </div>
  );
}

export function LibrarySection({ games, onChanged }: { games: GameInfo[]; onChanged: () => void }) {
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api()
      .lists()
      .then(setLists, (e: unknown) => setError(errorMessage(e)));
  }, []);

  /** Saves part of the lists; true when it worked. */
  const save = async (patch: Partial<Lists>, changed = false): Promise<boolean> => {
    setError(null);
    try {
      setLists(await api().setLists(patch));
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
    if (changed) onChanged();
    return true;
  };

  return (
    <section className="panel settings-section" aria-label="Library">
      <h2>Library</h2>
      <p className="help">Choose which games are kept out of Steam and which apps count as games.</p>
      {error && (
        <p className="status error" role="alert">
          {error}
        </p>
      )}
      {!lists ? (
        !error && <p className="help">Loading...</p>
      ) : (
        <>
          <div className="field">
            <h3>Switched off</h3>
            {lists.exclude.length === 0 ? (
              <p className="help">No games are switched off.</p>
            ) : (
              <>
                <ul>
                  {lists.exclude.map((key) => {
                    const game = games.find((g) => g.key === key);
                    return (
                      <li key={key} className="row">
                        <span>
                          {game ? game.title : key}
                          {game && <span className="muted"> {game.store}</span>}
                        </span>
                        <button type="button" className="button" onClick={() => void save({ exclude: lists.exclude.filter((k) => k !== key) }, true)}>
                          Turn on
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="row">
                  <button type="button" className="button" onClick={() => void save({ exclude: [] }, true)}>
                    Turn all back on
                  </button>
                </div>
              </>
            )}
          </div>
          <ListEditor title="Always treat as games" help="Installed apps, by name or id, that are always counted as games." entries={lists.allow} onSave={(allow) => save({ allow })} />
          <ListEditor title="Never treat as games" help="Installed apps, by name or id, that are never counted as games." entries={lists.deny} onSave={(deny) => save({ deny })} />
        </>
      )}
    </section>
  );
}
