/** The kinds of artwork Steam shows for a game. Pure data, so the UI can use it too. */
export type ArtworkKind = 'poster' | 'hero' | 'logo' | 'icon' | 'wide';

/** In the order they are downloaded. */
export const ARTWORK_KINDS: readonly ArtworkKind[] = ['poster', 'wide', 'hero', 'logo', 'icon'];
