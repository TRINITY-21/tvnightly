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
export async function similarShows(
  db: D1Database,
  show: ShowRow,
  limit = 6,
): Promise<ShowRow[]> {
  const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const gs = genres.slice(0, 3);
  if (gs.length === 0) return [];
  const overlapExpr = gs.map(() => "(CASE WHEN genres LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, (${overlapExpr}) AS ov
         FROM shows WHERE id != ? AND weight >= ?
       ) WHERE ov >= ? ORDER BY ov DESC, weight DESC LIMIT ?`,
    )
    .bind(...gs.map((g) => `%"${g}"%`), show.id, PICKER_MIN_WEIGHT, Math.min(2, gs.length), limit)
    .all<ShowRow>();
  return results;
}

/**
 * "Shows like the nominees" — given a slate of shows (e.g. an awards category
 * set), find the slate's dominant genres and return highly-rated same-genre
 * series that are NOT already in the slate. One query, billed once.
 */
export async function showsLikeSlate(
  db: D1Database,
  slate: ShowRow[],
  limit = 8,
): Promise<ShowRow[]> {
  const counts = new Map<string, number>();
  for (const s of slate) {
    const gs: string[] = s.genres ? JSON.parse(s.genres) : [];
    for (const g of gs) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);
  if (top.length === 0) return [];
  const ids = slate.map((s) => s.id);
  const overlapExpr = top.map(() => "(CASE WHEN genres LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const notIn = ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(",")})` : "";
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, (${overlapExpr}) AS ov
         FROM shows WHERE weight >= ? AND rating IS NOT NULL${notIn}
       ) WHERE ov >= ? ORDER BY ov DESC, rating DESC, weight DESC LIMIT ?`,
    )
    .bind(...top.map((g) => `%"${g}"%`), PICKER_MIN_WEIGHT, ...ids, Math.min(2, top.length), limit)
    .all<ShowRow>();
  return results;
}

/** Movie counterpart: genre-overlap similarity over the curated movies table. */
export async function similarMovies(
  db: D1Database,
  movie: MovieRow,
  limit = 6,
): Promise<MovieRow[]> {
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const gs = genres.slice(0, 3);
  if (gs.length === 0) return [];
  const overlapExpr = gs.map(() => "(CASE WHEN genres LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, (${overlapExpr}) AS ov FROM movies WHERE imdb_id != ?
       ) WHERE ov >= ? ORDER BY ov DESC, rating DESC, popularity DESC LIMIT ?`,
    )
    .bind(...gs.map((g) => `%"${g}"%`), movie.imdb_id, Math.min(2, gs.length), limit)
    .all<MovieRow>();
  return results;
}

/**
 * Which displayed crew have a person page. Matched two ways: by the crew
 * backfill's offset id (10M + TMDB id), then by name for people who entered
 * via the cast pipeline. Returns TMDB person id → people.id.
 */
export async function crewLinkMap(
  db: D1Database,
  crew: { id: number; name: string }[],
): Promise<Map<number, number>> {
  if (!crew.length) return new Map();
  const offsets = crew.map((p) => 10_000_000 + p.id);
  const names = crew.map((p) => p.name.toLowerCase());
  const marks = (n: number) => Array(n).fill("?").join(",");
  // Split the OR into a UNION: `id IN (...)` uses the people PK and
  // `lower(name) IN (...)` uses idx_people_name_lower — an `id IN OR lower(name) IN`
  // is non-sargable and scanned all ~34k people on every show/movie/person page.
  // UNION returns the same row set (the consumer keys by id + lower(name)).
  const { results } = await db
    .prepare(
      `SELECT id, name FROM people WHERE id IN (${marks(offsets.length)})
       UNION
       SELECT id, name FROM people WHERE lower(name) IN (${marks(names.length)})`,
    )
    .bind(...offsets, ...names)
    .all<{ id: number; name: string }>();
  const byId = new Set(results.map((r) => r.id));
  const byName = new Map(results.map((r) => [r.name.toLowerCase(), r.id]));
  const map = new Map<number, number>();
  for (const p of crew) {
    const off = 10_000_000 + p.id;
    const hit = byId.has(off) ? off : byName.get(p.name.toLowerCase());
    if (hit != null) map.set(p.id, hit);
  }
  return map;
}

export async function networkDirectory(db: D1Database): Promise<{ name: string; slug: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT n, COUNT(*) AS c FROM (
         SELECT COALESCE(network, web_channel) AS n FROM shows WHERE weight >= 60
       ) WHERE n IS NOT NULL GROUP BY n HAVING c >= 3 ORDER BY c DESC`,
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

/** Distinct season counts per show — for chart grid meta bars. */
export async function showSeasonCounts(
  db: D1Database,
  showIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  const ids = showIds.filter((id) => id != null && Number.isFinite(id));
  if (!ids.length) return map;
  const chunk = 80;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { results } = await db
      .prepare(
        `SELECT show_id, COUNT(DISTINCT season) AS n FROM episodes
         WHERE show_id IN (${slice.map(() => "?").join(",")}) AND season IS NOT NULL AND season > 0
         GROUP BY show_id`,
      )
      .bind(...slice)
      .all<{ show_id: number; n: number }>();
    for (const r of results) map.set(r.show_id, r.n);
  }
  return map;
}
