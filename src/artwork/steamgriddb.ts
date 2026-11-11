import { normalizeTitle } from '../dedupe.js';
import type { ArtworkKind } from './kinds.js';

export type { ArtworkKind };

/** The slice of the fetch API we rely on, so tests (and other runtimes) can substitute it. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

/** "II" and "2" are the same game; "I", "V" and "X" are left alone because they are often part of a name (Mega Man X). */
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9' };

/** A title reduced to what identifies the game: case, punctuation, symbols and Roman numerals II to IX ignored. */
export function titleKey(title: string): string {
  return normalizeTitle(title.replace(/\b(?:ii|iii|iv|vi|vii|viii|ix)\b/gi, (numeral) => ROMAN[numeral.toLowerCase()] as string));
}

const BASE_URL = 'https://www.steamgriddb.com/api/v2';

interface Endpoint {
  path: string;
  query: string;
}

const ENDPOINTS: Record<ArtworkKind, Endpoint> = {
  poster: { path: 'grids', query: 'dimensions=600x900&types=static' },
  wide: { path: 'grids', query: 'dimensions=920x430,460x215&types=static' },
  hero: { path: 'heroes', query: 'types=static' },
  logo: { path: 'logos', query: 'types=static' },
  icon: { path: 'icons', query: 'types=static' },
};

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export class SteamGridDbClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike,
  ) {}

  private async get<T>(pathAndQuery: string): Promise<T> {
    const response = await this.fetchFn(`${BASE_URL}${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok) throw new Error(`SteamGridDB request failed with HTTP ${response.status}`);
    const body = (await response.json()) as ApiResponse<T>;
    if (!body.success) throw new Error('SteamGridDB request was not successful');
    return body.data;
  }

  /**
   * Finds the SteamGridDB game with exactly this title (ignoring case, punctuation, symbols such as ™ and Roman numerals).
   * Its search is fuzzy and always returns something, so a near miss would show another game's artwork;
   * no exact match means no artwork.
   */
  async searchGame(title: string): Promise<number | undefined> {
    const games = await this.get<{ id: number; name: string }[]>(`/search/autocomplete/${encodeURIComponent(title)}`);
    const wanted = titleKey(title);
    return games.find((game) => titleKey(game.name) === wanted)?.id;
  }

  /** Returns the URL of the top-rated image of a given kind for a game, if any. */
  async findArtworkUrl(gameId: number, kind: ArtworkKind): Promise<string | undefined> {
    const { path, query } = ENDPOINTS[kind];
    const images = await this.get<{ url: string }[]>(`/${path}/game/${gameId}?${query}`);
    return images[0]?.url;
  }
}
