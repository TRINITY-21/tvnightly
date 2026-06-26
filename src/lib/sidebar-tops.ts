import { posterSrc } from "./format";
import { tmdbTopRated } from "./tmdb";
import { toMovieRow, toShowRow } from "./tmdb-rows";
import type { MovieRow, ShowRow } from "../types";

export type SideRankItem = {
  name: string;
  href: string;
  poster: string | null;
  rating: number | null;
  kind: "TV" | "Movie";
};

const showItem = (s: ShowRow): SideRankItem => {
  const p = posterSrc(s);
  return {
    name: s.name,
    href: `/show/${s.slug}`,
    poster: p?.src ?? s.poster_url ?? s.image_url,
    rating: s.rating,
    kind: "TV",
  };
};

const movieItem = (m: MovieRow): SideRankItem => ({
  name: m.title,
  href: `/movie/${m.slug}`,
  poster: m.poster_url,
  rating: m.rating,
  kind: "Movie",
});

/** Top-rated series for the right rail — same blend as /top/tv, capped for the sidebar. */
export async function sidebarTopSeries(
  db: D1Database,
  apiKey: string | undefined,
  limit = 6,
): Promise<SideRankItem[]> {
  const d1 = (
    await db
      .prepare(
        `SELECT * FROM shows WHERE rating IS NOT NULL AND weight >= 75
         ORDER BY rating DESC, weight DESC LIMIT ?`,
      )
      .bind(limit)
      .all<ShowRow>()
  ).results;

  let rows = d1;
  if (apiKey) {
    const seen = new Set(d1.map((s) => s.tmdb_id).filter(Boolean));
    const live = (await tmdbTopRated(apiKey, "tv"))
      .map(toShowRow)
      .filter((s) => !seen.has(s.tmdb_id));
    rows = [...d1, ...live]
      .filter((s) => s.rating != null)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, limit);
  }
  return rows.map(showItem);
}

/** Top-rated films for the right rail — same blend as /movies/best. */
export async function sidebarTopMovies(
  db: D1Database,
  apiKey: string | undefined,
  limit = 6,
): Promise<SideRankItem[]> {
  const d1 = (
    await db
      .prepare(
        `SELECT * FROM movies WHERE rating IS NOT NULL AND votes >= 1000
         ORDER BY rating DESC, votes DESC LIMIT ?`,
      )
      .bind(limit)
      .all<MovieRow>()
  ).results;

  let rows = d1;
  if (apiKey) {
    const seen = new Set(d1.map((m) => m.tmdb_id).filter(Boolean));
    const live = (await tmdbTopRated(apiKey, "movie"))
      .map(toMovieRow)
      .filter((m) => !seen.has(m.tmdb_id));
    rows = [...d1, ...live]
      .filter((m) => m.rating != null)
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, limit);
  }
  return rows.map(movieItem);
}

export async function fetchSidebarTops(
  db: D1Database,
  apiKey: string | undefined,
  limit = 6,
): Promise<{ series: SideRankItem[]; movies: SideRankItem[] }> {
  const [series, movies] = await Promise.all([
    sidebarTopSeries(db, apiKey, limit),
    sidebarTopMovies(db, apiKey, limit),
  ]);
  return { series, movies };
}
