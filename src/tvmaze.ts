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
  genres: string[] | null;
  averageRuntime: number | null;
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
  _embedded?: { episodes?: TvmEpisode[]; cast?: TvmCastCredit[] };
}

export interface TvmCastCredit {
  person: {
    id: number;
    name: string;
    image: { medium?: string } | null;
    birthday?: string | null;
    deathday?: string | null;
    country?: { name: string } | null;
  } | null;
  character: { name: string | null } | null;
  voice?: boolean;
}

/** Top-billed cast, deduped (actors repeat per character credit), max 10. */
export function topCast(show: TvmShow): TvmCastCredit[] {
  const credits = show._embedded?.cast ?? [];
  const seen = new Set<number>();
  const out: TvmCastCredit[] = [];
  for (const cr of credits) {
    const id = cr.person?.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(cr);
    if (out.length >= 10) break;
  }
  return out;
}

/** Compact JSON stored in shows.cast_json:
 *  {id, n: name, c: character, img: headshot, b: birthday, d: deathday,
 *   cn: country, v: voice-role} — only meaningful fields, omitted when null. */
export function castJson(show: TvmShow): string | null {
  const cast = topCast(show).map((cr) => ({
    id: cr.person!.id,
    n: cr.person!.name,
    c: cr.character?.name ?? null,
    img: cr.person?.image?.medium ?? null,
    ...(cr.person?.birthday ? { b: cr.person.birthday } : {}),
    ...(cr.person?.deathday ? { d: cr.person.deathday } : {}),
    ...(cr.person?.country?.name ? { cn: cr.person.country.name } : {}),
    ...(cr.voice ? { v: true } : {}),
  }));
  return cast.length ? JSON.stringify(cast) : null;
}

async function getJson<T>(path: string): Promise<T | null> {
  const res = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TVmaze ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export const fetchShowWithEpisodes = (id: number) =>
  getJson<TvmShow>(`/shows/${id}?embed[]=episodes&embed[]=cast`);

/** Map of TVmaze show id -> last-updated epoch, for shows touched in the window. */
export const fetchUpdates = (since: "day" | "week" | "month" = "day") =>
  getJson<Record<string, number>>(`/updates/shows?since=${since}`);
