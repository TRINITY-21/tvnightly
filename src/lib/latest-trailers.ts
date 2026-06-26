import { tmdbPopular, tmdbTrailer, tmdbTrendingList } from "./tmdb";

export type TrailerItem = { title: string; kind: string; key: string; name: string };

type Seed = { kind: "tv" | "movie"; id: number; title: string; label: string };

const weaveSeeds = (tv: Seed[], movies: Seed[]): Seed[] => {
  const woven: Seed[] = [];
  for (let i = 0; i < Math.max(tv.length, movies.length); i++) {
    if (tv[i]) woven.push(tv[i]);
    if (movies[i]) woven.push(movies[i]);
  }
  return woven.slice(0, 8);
};

const tvSeeds = (rows: { tmdb_id: number | null; name: string }[]): Seed[] =>
  rows
    .filter((s): s is { tmdb_id: number; name: string } => s.tmdb_id != null)
    .slice(0, 6)
    .map((s) => ({ kind: "tv", id: s.tmdb_id, title: s.name, label: "TV" }));

const movieSeeds = (rows: { tmdb_id: number | null; title: string }[]): Seed[] =>
  rows
    .filter((m): m is { tmdb_id: number; title: string } => m.tmdb_id != null)
    .slice(0, 6)
    .map((m) => ({ kind: "movie", id: m.tmdb_id, title: m.title, label: "Movie" }));

/** Build trailer seeds from trending/popular rails (homepage passes its own rails). */
export const trailerSeedsFromRails = (
  trendTv: { tmdb_id: number | null; name: string }[],
  trendMovies: { tmdb_id: number | null; title: string }[],
  fallbackTv: { tmdb_id: number | null; name: string }[],
  fallbackMovies: { tmdb_id: number | null; title: string }[],
): Seed[] =>
  weaveSeeds(
    tvSeeds(trendTv.length ? trendTv : fallbackTv),
    movieSeeds(trendMovies.length ? trendMovies : fallbackMovies),
  );

/** Resolve YouTube trailer keys for woven TV + film seeds (edge-cached per title). */
export async function latestTrailers(
  apiKey: string | undefined,
  seeds?: Seed[],
): Promise<TrailerItem[]> {
  if (!apiKey) return [];

  let woven = seeds?.length ? seeds.slice(0, 8) : null;
  if (!woven?.length) {
    const [trendTv, trendMv, popTv, popMv] = await Promise.all([
      tmdbTrendingList(apiKey, "tv"),
      tmdbTrendingList(apiKey, "movie"),
      tmdbPopular(apiKey, "tv"),
      tmdbPopular(apiKey, "movie"),
    ]);
    const tv = (trendTv.length ? trendTv : popTv)
      .slice(0, 6)
      .map((h) => ({ tmdb_id: h.tmdbId, name: h.name }));
    const mv = (trendMv.length ? trendMv : popMv)
      .slice(0, 6)
      .map((h) => ({ tmdb_id: h.tmdbId, title: h.name }));
    woven = weaveSeeds(tvSeeds(tv), movieSeeds(mv));
  }

  return (
    await Promise.all(
      woven.map(async (s) => {
        const t = await tmdbTrailer(apiKey, s.kind, s.id);
        return t ? { title: s.title, kind: s.label, key: t.key, name: t.name } : null;
      }),
    )
  )
    .filter((x): x is TrailerItem => x !== null)
    .slice(0, 6);
}
