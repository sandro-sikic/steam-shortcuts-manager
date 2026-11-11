/** The kinds of artwork Steam shows for a game. Pure data, so the UI can use it too. */
export type ArtworkKind = 'poster' | 'hero' | 'logo' | 'icon' | 'wide';

/** In the order they are downloaded. */
export const ARTWORK_KINDS: readonly ArtworkKind[] = ['poster', 'wide', 'hero', 'logo', 'icon'];

/** File-name suffix Steam expects in `userdata/<id>/config/grid` for each kind: `<appId><suffix>.<ext>`. */
export const ARTWORK_SUFFIXES: Record<ArtworkKind, string> = {
  poster: 'p',
  wide: '',
  hero: '_hero',
  logo: '_logo',
  icon: '_icon',
};
