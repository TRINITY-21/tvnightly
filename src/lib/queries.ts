// Shared D1 queries kept sargable: row reads are billed.
import { ShowRow, MovieRow } from "../types";
import { slugifyName } from "../lib/format";

// Pool floor: TVmaze weight >= 75 keeps picks recognizable (and the indexed
// range scan keeps D1 rows-read low even on a full 80K-show mirror).
export const PICKER_MIN_WEIGHT = 75;

export const getShow = (db: D1Database, slug: string) =>
  db.prepare("SELECT * FROM shows WHERE slug = ?").bind(slug).first<ShowRow>();

/**
 * Popular shows ranked by genre overlap (2+ shared genres when possible) —
 * internal links to their money pages, full rows for card rendering.
 */
export async function similarShows(db: D1Database, show: ShowRow): Promise<ShowRow[]> {
  const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const gs = genres.slice(0, 3);
  if (gs.length === 0) return [];
  const overlapExpr = gs.map(() => "(CASE WHEN genres LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, (${overlapExpr}) AS ov
         FROM shows WHERE id != ? AND weight >= ?
       ) WHERE ov >= ? ORDER BY ov DESC, weight DESC LIMIT 6`,
    )
    .bind(...gs.map((g) => `%"${g}"%`), show.id, PICKER_MIN_WEIGHT, Math.min(2, gs.length))
    .all<ShowRow>();
  return results;
}

/** Movie counterpart: genre-overlap similarity over the curated movies table. */
export async function similarMovies(db: D1Database, movie: MovieRow): Promise<MovieRow[]> {
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const gs = genres.slice(0, 3);
  if (gs.length === 0) return [];
  const overlapExpr = gs.map(() => "(CASE WHEN genres LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, (${overlapExpr}) AS ov FROM movies WHERE imdb_id != ?
       ) WHERE ov >= ? ORDER BY ov DESC, rating DESC, popularity DESC LIMIT 6`,
    )
    .bind(...gs.map((g) => `%"${g}"%`), movie.imdb_id, Math.min(2, gs.length))
    .all<MovieRow>();
  return results;
}

export async function networkDirectory(db: D1Database): Promise<{ name: string; slug: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT n, COUNT(*) AS c FROM (
         SELECT COALESCE(network, web_channel) AS n FROM shows WHERE weight >= 60
       ) WHERE n IS NOT NULL GROUP BY n HAVING c >= 3 ORDER BY c DESC LIMIT 30`,
    )
    .all<{ n: string; c: number }>();
  return results.map((r) => ({ name: r.n, slug: slugifyName(r.n), count: r.c }));
}

export async function genreDirectory(db: D1Database): Promise<{ tv: string[]; movie: string[] }> {
  const [tv, movie] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT value AS g FROM shows, json_each(shows.genres) WHERE shows.weight >= 60 ORDER BY 1`,
      )
      .all<{ g: string }>(),
    db.prepare("SELECT DISTINCT value AS g FROM movies, json_each(movies.genres) ORDER BY 1").all<{ g: string }>(),
  ]);
  return { tv: tv.results.map((r) => r.g), movie: movie.results.map((r) => r.g) };
}
