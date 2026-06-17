// Anonymous title verdicts (rate -> recommend): the only user data we keep.
import { ShowRow, MovieRow } from "../types";

// -------------------------------------------------- rate -> recommend flow
// "Tell us the last thing you watched and how it landed; we pick your next
// one." Only the anonymous verdict is saved (title_ratings/rate_log) — no
// accounts, no client-side storage of user data.

// Verdict code -> title_ratings column. "Good" reuses the liked column; the
// new "awful" is a real negative the recommender can act on.
export const VERDICTS: Record<string, "loved" | "liked" | "meh" | "awful"> = {
  love: "loved",
  like: "liked",
  meh: "meh",
  awful: "awful",
};

// Signed taste weights: a single Awful pulls hard against its genres/era, a
// Loved pushes hard for them. Meh is a soft negative (saw it, shrugged).
export const VERDICT_WEIGHT: Record<RatedEntry["verdict"], number> = {
  love: 2,
  like: 1,
  meh: -0.5,
  awful: -2,
};

// Four-step scale shown in the rating control, in display order (worst→best).
export const VERDICT_SCALE: { code: RatedEntry["verdict"]; label: string }[] = [
  { code: "awful", label: "Awful" },
  { code: "meh", label: "Meh" },
  { code: "like", label: "Good" },
  { code: "love", label: "Loved" },
];

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
  verdict: "love" | "like" | "meh" | "awful";
}

export function parseRated(s: string | undefined): RatedEntry[] {
  if (!s) return [];
  const out: RatedEntry[] = [];
  for (const part of s.split(",").slice(0, 10)) {
    const m = /^(tv|movie):(\d+|tt\d+):(love|like|meh|awful)$/.exec(part);
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
  return out.slice(0, 6);
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

// Below this many on-site verdicts the average is too noisy (and too gameable)
// to expose as a star snippet; the agreement line still renders via titleStat.
const MIN_RATERS_FOR_SCHEMA = 5;

/** First-party AggregateRating JSON-LD built from on-site verdicts — or null
 *  below the rater threshold. These are OUR ratings, collected on this very
 *  page (the verdict line stays visible in the body), which is exactly what
 *  Google's review-snippet policy requires — unlike third-party TMDB votes,
 *  which we deliberately never publish as structured data. The 4-point scale
 *  (awful/meh/good/loved) maps onto 1–5 and is averaged by rater count. */
export async function aggregateRatingLd(
  db: D1Database,
  kind: "tv" | "movie",
  ref: string,
): Promise<Record<string, unknown> | null> {
  const c = await db
    .prepare("SELECT loved, liked, meh, awful FROM title_ratings WHERE kind = ? AND ref = ?")
    .bind(kind, ref)
    .first<{ loved: number; liked: number; meh: number; awful: number }>();
  if (!c) return null;
  const count = c.loved + c.liked + c.meh + c.awful;
  if (count < MIN_RATERS_FOR_SCHEMA) return null;
  // loved=5 · good=4 · meh=2 · awful=1
  const avg = (5 * c.loved + 4 * c.liked + 2 * c.meh + c.awful) / count;
  return {
    "@type": "AggregateRating",
    ratingValue: Math.round(avg * 10) / 10,
    bestRating: 5,
    worstRating: 1,
    ratingCount: count,
  };
}
