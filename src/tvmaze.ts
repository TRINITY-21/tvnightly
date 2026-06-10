// Thin TVmaze API client used by the cron sync Worker.
// TVmaze public API is keyless; rate limit is 20 calls / 10s / IP (HTTP 429 on excess).
const BASE = "https://api.tvmaze.com";

export interface TvmEpisode {
  id: number;
  season: number | null;
  number: number | null;
  name: string | null;
  airdate: string | null;
  airstamp: string | null;
  runtime: number | null;
  rating: { average: number | null } | null;
  image: { medium?: string; original?: string } | null;
  summary: string | null;
}

export interface TvmShow {
  id: number;
  name: string;
  status: string | null;
  premiered: string | null;
  ended: string | null;
  network: { name: string } | null;
  webChannel: { name: string } | null;
  rating: { average: number | null } | null;
  weight: number | null;
  image: { medium?: string; original?: string } | null;
  summary: string | null;
  externals: { imdb: string | null; thetvdb: number | null } | null;
  updated: number;
  _embedded?: { episodes?: TvmEpisode[] };
}

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TVmaze ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export const fetchShowWithEpisodes = (id: number) =>
  getJson<TvmShow>(`/shows/${id}?embed=episodes`);

/** Map of TVmaze show id -> last-updated epoch, for shows touched in the window. */
export const fetchUpdates = (since: "day" | "week" | "month" = "day") =>
  getJson<Record<string, number>>(`/updates/shows?since=${since}`);
