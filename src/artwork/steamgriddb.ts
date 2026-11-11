export type ArtworkKind = 'poster' | 'hero' | 'logo' | 'icon' | 'wide';

/** The slice of the fetch API we rely on, so tests (and other runtimes) can substitute it. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<FetchResponse>;

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

  /** Finds the SteamGridDB game ID best matching a title, if any. */
  async searchGame(title: string): Promise<number | undefined> {
    const games = await this.get<{ id: number }[]>(`/search/autocomplete/${encodeURIComponent(title)}`);
    return games[0]?.id;
  }

  /** Returns the URL of the top-rated image of a given kind for a game, if any. */
  async findArtworkUrl(gameId: number, kind: ArtworkKind): Promise<string | undefined> {
    const { path, query } = ENDPOINTS[kind];
    const images = await this.get<{ url: string }[]>(`/${path}/game/${gameId}?${query}`);
    return images[0]?.url;
  }
}
