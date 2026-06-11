// Anonymous title verdicts (rate -> recommend): the only user data we keep.
import { ShowRow, MovieRow } from "../types";

// -------------------------------------------------- rate -> recommend flow
// "Tell us the last thing you watched and how it landed; we pick your next
// one." Only the anonymous verdict is saved (title_ratings/rate_log) — no
// accounts, no client-side storage of user data.

export const VERDICTS: Record<string, "loved" | "liked" | "meh"> = {
  love: "loved",
  like: "liked",
  meh: "meh",
};

export async function getRatedTitle(
  db: D1Database,
  kind: string,
  ref: string,
): Promise<{ show?: ShowRow; movie?: MovieRow; name: string; image: string | null } | null> {
  if (kind === "tv" && /^\d+$/.test(ref)) {
    const show = await db.prepare("SELECT * FROM shows WHERE id = ?").bind(Number(ref)).first<ShowRow>();
    return show ? { show, name: show.name, image: show.image_url } : null;
  }
  if (kind === "movie" && /^tt\d+$/.test(ref)) {
    const movie = await db.prepare("SELECT * FROM movies WHERE imdb_id = ?").bind(ref).first<MovieRow>();
    return movie ? { movie, name: movie.year ? `${movie.title} (${movie.year})` : movie.title, image: movie.poster_url } : null;
  }
  return null;
}

// The rating trail of a session lives in the URL (?rated=tv:169:love,...) —
// shareable, account-free, and never stored client-side.
export interface RatedEntry {
  kind: "tv" | "movie";
  ref: string;
  verdict: "love" | "like" | "meh";
}

export function parseRated(s: string | undefined): RatedEntry[] {
  if (!s) return [];
  const out: RatedEntry[] = [];
  for (const part of s.split(",").slice(0, 8)) {
    const m = /^(tv|movie):(\d+|tt\d+):(love|like|meh)$/.exec(part);
    if (!m) continue;
    if (m[1] === "tv" && !/^\d+$/.test(m[2])) continue;
    if (m[1] === "movie" && !/^tt\d+$/.test(m[2])) continue;
    if (!out.some((e) => e.kind === m[1] && e.ref === m[2]))
      out.push({
        kind: m[1] as RatedEntry["kind"],
        ref: m[2],
        verdict: m[3] as RatedEntry["verdict"],
      });
  }
  return out.slice(0, 5);
}

export const fmtRated = (list: RatedEntry[]) => list.map((e) => `${e.kind}:${e.ref}:${e.verdict}`).join(",");
export const titleKey = (kind: string, ref: string) => `${kind}:${ref}`;

/** Community agreement line for a title, or null below the 2-rater threshold. */
export async function titleStat(db: D1Database, kind: string, ref: string): Promise<string | null> {
  const counts = await db
    .prepare("SELECT loved, liked, meh FROM title_ratings WHERE kind = ? AND ref = ?")
    .bind(kind, ref)
    .first<{ loved: number; liked: number; meh: number }>();
  if (!counts) return null;
  const total = counts.loved + counts.liked + counts.meh;
  if (total < 2) return null;
  const pct = Math.round(((counts.loved + counts.liked) / total) * 100);
  return `${pct}% of ${total} raters loved or liked this`;
}
