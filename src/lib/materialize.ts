// Materialize-on-write: snapshot a live-TMDB title into D1 the first time it's
// engaged (a verdict), so community/ranking lists can render it without a TMDB
// call per row. Ref convention for these titles: "t<tmdbId>".
import { tmdbTitle } from "./tmdb";
import { slugifyName } from "./format";

export const isTmdbRef = (ref: string) => /^t\d+$/.test(ref);
export const tmdbRef = (tmdbId: number) => `t${tmdbId}`;

/** Upsert a TMDB title's snapshot. Returns false if TMDB has no such title. */
export async function materializeTmdbTitle(
  db: D1Database,
  key: string,
  kind: "tv" | "movie",
  tmdbId: number,
): Promise<boolean> {
  const t = await tmdbTitle(key, kind, tmdbId);
  if (!t) return false;
  await db
    .prepare(
      `INSERT INTO title_snapshots (kind, ref, tmdb_id, name, year, poster_url, slug, rating, updated_at)
       VALUES (?,?,?,?,?,?,?,?,unixepoch())
       ON CONFLICT(kind, ref) DO UPDATE SET name=excluded.name, year=excluded.year,
         poster_url=excluded.poster_url, slug=excluded.slug, rating=excluded.rating,
         updated_at=excluded.updated_at`,
    )
    .bind(kind, tmdbRef(tmdbId), tmdbId, t.name, t.year, t.poster?.x1 ?? null, slugifyName(t.name), t.rating)
    .run();
  return true;
}
