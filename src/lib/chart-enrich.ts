import type { MovieRow, ShowRow } from "../types";

const BIND_CHUNK = 90;

async function fetchShowsByTmdbIds(db: D1Database, ids: number[]): Promise<Map<number, ShowRow>> {
  const map = new Map<number, ShowRow>();
  for (let i = 0; i < ids.length; i += BIND_CHUNK) {
    const chunk = ids.slice(i, i + BIND_CHUNK);
    const { results } = await db
      .prepare(`SELECT * FROM shows WHERE tmdb_id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<ShowRow>();
    for (const row of results) {
      if (row.tmdb_id != null) map.set(row.tmdb_id, row);
    }
  }
  return map;
}

async function fetchMoviesByTmdbIds(db: D1Database, ids: number[]): Promise<Map<number, MovieRow>> {
  const map = new Map<number, MovieRow>();
  for (let i = 0; i < ids.length; i += BIND_CHUNK) {
    const chunk = ids.slice(i, i + BIND_CHUNK);
    const { results } = await db
      .prepare(`SELECT * FROM movies WHERE tmdb_id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<MovieRow>();
    for (const row of results) {
      if (row.tmdb_id != null) map.set(row.tmdb_id, row);
    }
  }
  return map;
}

/** Overlay D1 mirror fields onto a live TMDB row — keeps TMDB list order upstream. */
export function mergeShowWithD1(live: ShowRow, d1?: ShowRow): ShowRow {
  if (!d1) return live;
  return {
    ...d1,
    rating: d1.rating ?? live.rating,
    poster_url: d1.poster_url ?? live.poster_url,
    image_url: d1.image_url ?? live.image_url,
    premiered: d1.premiered ?? live.premiered,
    summary: d1.summary ?? live.summary,
    genres: d1.genres ?? live.genres,
    weight: d1.weight ?? live.weight,
    slug: d1.slug || live.slug,
  };
}

export function mergeMovieWithD1(live: MovieRow, d1?: MovieRow): MovieRow {
  if (!d1) return live;
  return {
    ...d1,
    rating: d1.rating ?? live.rating,
    poster_url: d1.poster_url ?? live.poster_url,
    overview: d1.overview ?? live.overview,
    year: d1.year ?? live.year,
    genres: d1.genres ?? live.genres,
    popularity: d1.popularity ?? live.popularity,
    votes: d1.votes ?? live.votes,
    slug: d1.slug || live.slug,
  };
}

export async function enrichShowsFromD1(db: D1Database, rows: ShowRow[]): Promise<ShowRow[]> {
  const ids = [...new Set(rows.map((r) => r.tmdb_id).filter((id): id is number => id != null))];
  if (!ids.length) return rows;
  const byTmdb = await fetchShowsByTmdbIds(db, ids);
  return rows.map((row) => (row.tmdb_id ? mergeShowWithD1(row, byTmdb.get(row.tmdb_id)) : row));
}

export async function enrichMoviesFromD1(db: D1Database, rows: MovieRow[]): Promise<MovieRow[]> {
  const ids = [...new Set(rows.map((r) => r.tmdb_id).filter((id): id is number => id != null))];
  if (!ids.length) return rows;
  const byTmdb = await fetchMoviesByTmdbIds(db, ids);
  return rows.map((row) => (row.tmdb_id ? mergeMovieWithD1(row, byTmdb.get(row.tmdb_id)) : row));
}
