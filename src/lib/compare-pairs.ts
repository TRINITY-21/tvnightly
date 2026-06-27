// Featured versus-card pairs for the TV and movie compare doorways.
import type { VsSide } from "../components/compare";
import type { MovieRow, ShowRow } from "../types";
import { hiRes } from "./format";
import { similarMovies, similarShows } from "./queries";
import { tmdbBackdrop, tmdbMovieBackdrop } from "./tmdb";

const MATCHUP_PAIRS = 24;
export const MOVIE_MORE_PER_ANCHOR = 12;
export const MOVIE_SIM_POOL = 20;

export async function showSides(
  key: string | undefined,
  shows: ShowRow[],
): Promise<Map<string, VsSide>> {
  const bds = await Promise.all(
    shows.map((s) => (key && s.tmdb_id ? tmdbBackdrop(key, s.tmdb_id) : Promise.resolve(null))),
  );
  const small = (u: string) => u.replace("/w1280/", "/w780/");
  return new Map(
    shows.map((s, i): [string, VsSide] => [
      s.slug,
      {
        name: s.name,
        poster: s.poster_url ?? hiRes(s.image_url),
        backdrop: bds[i] ? small(bds[i]!.x1) : hiRes(s.image_url),
      },
    ]),
  );
}

export async function movieSides(
  key: string | undefined,
  movies: MovieRow[],
): Promise<Map<string, VsSide>> {
  const bds = key
    ? await Promise.all(movies.map((m) => tmdbMovieBackdrop(key, m.imdb_id)))
    : movies.map(() => null);
  const small = (u: string) => u.replace("/w1280/", "/w780/");
  return new Map(
    movies.map((m, i): [string, VsSide] => [
      m.slug,
      {
        name: m.title,
        poster: m.poster_url,
        backdrop: bds[i] ? small(bds[i]!.x1) : null,
      },
    ]),
  );
}

export async function tvMatchPairs(
  db: D1Database,
  anchor: ShowRow | null,
): Promise<[ShowRow, ShowRow][]> {
  if (anchor) {
    const sims = await similarShows(db, anchor, MATCHUP_PAIRS);
    return sims.slice(0, MATCHUP_PAIRS).map((s) => [anchor, s]);
  }
  const { results: tops } = await db
    .prepare("SELECT * FROM shows ORDER BY weight DESC LIMIT ?")
    .bind(MATCHUP_PAIRS + 1)
    .all<ShowRow>();
  return tops.slice(0, MATCHUP_PAIRS).map((s, i) => [s, tops[(i + 1) % tops.length]]);
}

export async function movieMatchPairs(
  db: D1Database,
  anchor: MovieRow | null,
): Promise<[MovieRow, MovieRow][]> {
  if (anchor) {
    const sims = await similarMovies(db, anchor, MATCHUP_PAIRS);
    return sims.slice(0, MATCHUP_PAIRS).map((m) => [anchor, m]);
  }
  const { results: tops } = await db
    .prepare("SELECT * FROM movies WHERE rating IS NOT NULL ORDER BY popularity DESC LIMIT ?")
    .bind(MATCHUP_PAIRS + 1)
    .all<MovieRow>();
  return tops.slice(0, MATCHUP_PAIRS).map((m, i) => [m, tops[(i + 1) % tops.length]]);
}

export function involvedShows(pairs: [ShowRow, ShowRow][]): Map<string, ShowRow> {
  const involved = new Map<string, ShowRow>();
  for (const [a, b] of pairs) {
    involved.set(a.slug, a);
    involved.set(b.slug, b);
  }
  return involved;
}

export function involvedMovies(pairs: [MovieRow, MovieRow][]): Map<string, MovieRow> {
  const involved = new Map<string, MovieRow>();
  for (const [a, b] of pairs) {
    involved.set(a.slug, a);
    involved.set(b.slug, b);
  }
  return involved;
}
