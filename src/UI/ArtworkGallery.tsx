import { useRef, type KeyboardEvent } from 'react';
import type { ArtworkChoice, ArtworkEntry, ArtworkKind, ArtworkOption } from '../ipc.js';
import './ArtworkGallery.css';

interface KindInfo {
  kind: ArtworkKind;
  label: string;
  size: string;
}

const KINDS: KindInfo[] = [
  { kind: 'hero', label: 'Hero', size: '1920 × 620' },
  { kind: 'poster', label: 'Poster', size: '600 × 900' },
  { kind: 'wide', label: 'Wide capsule', size: '920 × 430' },
  { kind: 'logo', label: 'Logo', size: '800 × 310' },
  { kind: 'icon', label: 'Icon', size: '256 × 256' },
];

interface Props {
  /** Undefined until the game's artwork has been read. */
  entry?: ArtworkEntry;
  /** Options are being fetched now (show placeholders for types whose list is not there yet). */
  loading: boolean;
  /** The type whose pick is being saved/downloaded right now (show a spinner on its selected option). */
  picking?: ArtworkKind;
  /** Called when the user chooses an option (`imageId`) or "none" (`null`). Not called for the option that is already selected. */
  onPick: (kind: ArtworkKind, imageId: number | null) => void;
}

export function ArtworkGallery({ entry, loading, picking, onPick }: Props) {
  return (
    <div className="gallery">
      {loading && <p className="gallery-sr" role="status">Fetching options…</p>}
      {KINDS.map((info) => (
        <Group key={info.kind} info={info} choice={entry?.choices[info.kind]} loading={loading} picking={picking === info.kind} onPick={onPick} />
      ))}
    </div>
  );
}

interface GroupProps {
  info: KindInfo;
  choice?: ArtworkChoice;
  loading: boolean;
  picking: boolean;
  onPick: Props['onPick'];
}

function Group({ info, choice, loading, picking, onPick }: GroupProps) {
  const { kind, label } = info;
  const options = choice?.options ?? [];
  const selected = choice?.selected;
  const selectedIndex = selected === null ? options.length : options.findIndex((o) => o.id === selected);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const hasOptions = options.length > 0;
  // Positions 0..n-1 are options, n is the "None" tile.
  const tabbable = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedOption = selectedIndex >= 0 && selectedIndex < options.length ? options[selectedIndex] : undefined;

  const pick = (index: number): void => {
    if (index === selectedIndex) return;
    const option = options[index];
    onPick(kind, option ? option.id : null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const count = options.length + 1;
    const next = (index + step + count) % count;
    pick(next);
    refs.current[next]?.focus();
  };

  const summary = selected === null ? 'None' : selectedOption ? `Option ${selectedIndex + 1} of ${options.length}` : '';

  let body;
  if (!choice) {
    body = loading ? (
      <div className="gallery-row">
        {[0, 1, 2].map((n) => (
          <div key={n} className={`skeleton gallery-skeleton art-frame-${kind}`} aria-hidden="true" />
        ))}
      </div>
    ) : (
      <p className="muted">Options load when the game page opens.</p>
    );
  } else if (!hasOptions) {
    body = <p className="muted">SteamGridDB has no {label.toLowerCase()} for this game.</p>;
  } else {
    body = (
      <>
        {kind === 'hero' && (
          <figure className="art-hero-preview">
            {selectedOption ? (
              selectedOption.fullUrl ?? selectedOption.thumbUrl ? (
                <img src={selectedOption.fullUrl ?? selectedOption.thumbUrl} alt="Hero preview" />
              ) : (
                <span className="muted">Not downloaded</span>
              )
            ) : selected === null ? (
              <span className="muted">No hero image will be added to Steam.</span>
            ) : (
              <span className="muted">Not downloaded</span>
            )}
          </figure>
        )}
        <div role="radiogroup" aria-label={`${label} image`} className={`gallery-row gallery-row-${kind}`}>
          {options.map((option, index) => (
            <button
              key={option.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={index === selectedIndex}
              tabIndex={index === tabbable ? 0 : -1}
              className={`gallery-tile gallery-tile-${kind}${index === selectedIndex ? ' selected' : ''}`}
              onClick={() => pick(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <OptionImage kind={kind} label={label} option={option} index={index} />
              <span className="gallery-caption">
                <span>{option.style}</span>
                {option.width > 0 && option.height > 0 && <span className="muted">{option.width} × {option.height}</span>}
                {option.nsfw && <span className="chip">Adult</span>}
              </span>
              {picking && index === selectedIndex && <span className="gallery-spinner" aria-hidden="true" />}
            </button>
          ))}
          <button
            ref={(el) => {
              refs.current[options.length] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected === null}
            aria-label={`No ${label.toLowerCase()} image`}
            tabIndex={options.length === tabbable ? 0 : -1}
            className={`gallery-tile gallery-tile-none gallery-tile-${kind}${selected === null ? ' selected' : ''}`}
            onClick={() => pick(options.length)}
            onKeyDown={(event) => onKeyDown(event, options.length)}
          >
            <span className="gallery-none">None</span>
            {picking && selected === null && <span className="gallery-spinner" aria-hidden="true" />}
          </button>
        </div>
      </>
    );
  }

  return (
    <section className="art-group" aria-label={label} aria-busy={picking ? 'true' : undefined}>
      <div className="gallery-head">
        <h3>{label}</h3>
        <span className="muted">{info.size}</span>
        {summary && <span className="muted gallery-summary">{summary}</span>}
      </div>
      {body}
    </section>
  );
}

function OptionImage({ kind, label, option, index }: { kind: ArtworkKind; label: string; option: ArtworkOption; index: number }) {
  const src = option.thumbUrl ?? option.fullUrl;
  return (
    <span className={`gallery-frame gallery-frame-${kind}`}>
      {src ? <img src={src} alt={`${label} option ${index + 1}, ${option.style}`} /> : <span className="muted">Loading…</span>}
    </span>
  );
}
