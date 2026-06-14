// The recommendation engine for /recommend.
//
// Turns a session's rating trail (love/like/meh/awful on a few titles) into ONE
// confident primary pick plus runner-up contenders. Design goals from the
// redesign spec:
//   - a real NEGATIVE signal: an Awful demotes its genres/era even amid loves
//     (we demote, we don't hard-exclude, so one bad horror film ≠ "no horror");
//   - ONE blended score over a small candidate pool (genre + collaborative +
//     era + streaming-service), so results are never two sections that can both
//     return empty;
//   - a diversity pass so you don't get six near-identical shows;
//   - always a primary (graceful cold-start), never an empty page.
//
// Almost all of this is in-memory after a handful of indexed reads.
import { ShowRow, MovieRow } from "../types";
import { RatedEntry, VERDICT_WEIGHT, getRatedTitle, titleKey } from "./ratings";
import { similarShows, similarMovies, PICKER_MIN_WEIGHT } from "./queries";

// The legible "why" behind a pick — every field points back at something the
// user actually rated, so the result is checkable rather than magic. This is
// what the results page renders as the "Why this matches" ledger.
export interface WhySignal {
  anchor: string | null; // the title they loved most that this pick descends from
  genres: { name: string; n: number }[]; // matched genres + how many of their picks had each
  era: string | null; // e.g. "2010s" — only set when the era actually matched
  prov: string | null; // a streaming service they like, when it matches
  cf: number; // co-raters who share their taste (0 = none / pre-community)
}

// A render-ready pick, normalized across shows and movies.
export interface Pick {
  kind: "tv" | "movie";
  ref: string;
  slug: string;
  name: string;
  year: string | null;
  rating: number | null;
  poster: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  genres: string[];
  reason: string;
  score: number;
  why?: WhySignal; // attached at the end of buildRecommendation
}

// A card in the enrich deck / landing rail — just enough to render a poster.
export interface DeckCard {
  kind: "tv" | "movie";
  ref: string;
  name: string;
  year: string | null;
  poster: string | null;
  genres: string[];
}

export interface Recommendation {
  primary: Pick | null;
  contenders: Pick[];
  confidence: string;
  anchorName: string | null;
  matchPct: number; // a "feel" match strength for the hero ring
  tasteRead: string[]; // genres + era we inferred — the "we see you" panel
}

const parseGenres = (json: string | null): string[] => {
  if (!json) return [];
  try {
    const g = JSON.parse(json);
    return Array.isArray(g) ? g.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const showYear = (s: ShowRow): number | null => (s.premiered ? Number(s.premiered.slice(0, 4)) || null : null);

const providersOf = (row: ShowRow | MovieRow): Set<string> => {
  const out = new Set<string>();
  const add = (json: string | null) => {
    if (!json) return;
    try {
      const v = JSON.parse(json);
      if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && out.add(x));
      else if (v && typeof v === "object")
        Object.values(v).forEach((arr) => Array.isArray(arr) && arr.forEach((x) => typeof x === "string" && out.add(x)));
    } catch {
      /* ignore malformed seed */
    }
  };
  if ("providers" in row) add(row.providers);
  add(row.providers_intl);
  return out;
};

const showPick = (s: ShowRow, reason: string, score: number): Pick => ({
  kind: "tv",
  ref: String(s.id),
  slug: s.slug,
  name: s.name,
  year: s.premiered ? s.premiered.slice(0, 4) : null,
  rating: s.rating,
  poster: s.poster_url ?? s.image_url,
  tmdbId: s.tmdb_id,
  imdbId: s.imdb_id,
  genres: parseGenres(s.genres),
  reason,
  score,
});

const moviePick = (m: MovieRow, reason: string, score: number): Pick => ({
  kind: "movie",
  ref: m.imdb_id,
  slug: m.slug,
  name: m.title,
  year: m.year ? String(m.year) : null,
  rating: m.rating,
  poster: m.poster_url,
  tmdbId: m.tmdb_id,
  imdbId: m.imdb_id,
  genres: parseGenres(m.genres),
  reason,
  score,
});

type Scored = {
  pick: Pick;
  weight: number; // recognizability for tiebreak
  cf: number; // co-raters
  genreScore: number;
  eraHit: boolean;
  provHit: boolean;
  prov: string | null;
};

/**
 * The blended recommendation for a session's rating trail.
 * `hash` is the visitor's IP hash, so we never re-recommend what they rated.
 */
export async function buildRecommendation(
  db: D1Database,
  hash: string,
  rated: RatedEntry[],
): Promise<Recommendation> {
  // 1. Resolve full rows for the trail.
  const resolved = await Promise.all(
    rated.map(async (e) => {
      const t = await getRatedTitle(db, e.kind, e.ref);
      return t ? { e, show: t.show, movie: t.movie, name: t.name } : null;
    }),
  );
  const trail = resolved.filter((x): x is NonNullable<typeof x> => x !== null);

  // 2. Signed genre taste vector + era center + provider affinity (positives).
  const taste = new Map<string, number>();
  const genrePickCount = new Map<string, number>(); // how many liked picks carry each genre (for the "why")
  let eraSum = 0;
  let eraN = 0;
  const likedProviders = new Set<string>();
  let anchor: { name: string; w: number } | null = null;
  for (const t of trail) {
    const w = VERDICT_WEIGHT[t.e.verdict];
    const row = (t.show ?? t.movie)!;
    const genres = parseGenres(row.genres);
    for (const g of genres) taste.set(g, (taste.get(g) ?? 0) + w);
    if (w > 0) {
      for (const g of new Set(genres)) genrePickCount.set(g, (genrePickCount.get(g) ?? 0) + 1);
      const yr = t.show ? showYear(t.show) : (t.movie?.year ?? null);
      if (yr) {
        eraSum += yr * w;
        eraN += w;
      }
      for (const p of providersOf(row)) likedProviders.add(p);
      if (!anchor || w > anchor.w) anchor = { name: t.name, w };
    }
  }
  const eraCenter = eraN > 0 ? eraSum / eraN : null;
  const eraLabel = eraCenter ? `${Math.floor(eraCenter / 10) * 10}s` : null;
  const positives = trail.filter((t) => VERDICT_WEIGHT[t.e.verdict] > 0);
  const excluded = new Set(rated.map((e) => titleKey(e.kind, e.ref)));

  // Never re-surface what this visitor rated before (hashed IP).
  const { results: prior } = await db
    .prepare("SELECT kind, ref FROM rate_log WHERE ip_hash = ? LIMIT 200")
    .bind(hash)
    .all<{ kind: string; ref: string }>();
  for (const r of prior) excluded.add(titleKey(r.kind, r.ref));

  // 3. Candidate pool: genre-similar to each positive + collaborative filtering.
  const showPool = new Map<number, ShowRow>();
  const moviePool = new Map<string, MovieRow>();
  for (const t of positives) {
    if (t.show) for (const s of await similarShows(db, t.show, 8)) showPool.set(s.id, s);
    if (t.movie) for (const m of await similarMovies(db, t.movie, 8)) moviePool.set(m.imdb_id, m);
  }

  const coRaters = new Map<string, number>();
  if (positives.length) {
    const pairCond = positives.map(() => "(r1.kind = ? AND r1.ref = ?)").join(" OR ");
    const { results: cfRows } = await db
      .prepare(
        `SELECT r2.kind AS kind, r2.ref AS ref, COUNT(DISTINCT r2.ip_hash) AS n
         FROM rate_log r1 JOIN rate_log r2 ON r2.ip_hash = r1.ip_hash
         WHERE r1.verdict IN ('love','like') AND (${pairCond})
           AND r2.verdict IN ('love','like') AND r2.ip_hash != ?
           AND NOT (r2.kind = r1.kind AND r2.ref = r1.ref)
         GROUP BY r2.kind, r2.ref ORDER BY n DESC LIMIT 24`,
      )
      .bind(...positives.flatMap((t) => [t.e.kind, t.e.ref]), hash)
      .all<{ kind: string; ref: string; n: number }>();
    const newShowIds: number[] = [];
    const newMovieIds: string[] = [];
    for (const r of cfRows) {
      if (r.n < 2 || excluded.has(titleKey(r.kind, r.ref))) continue;
      coRaters.set(titleKey(r.kind, r.ref), r.n);
      if (r.kind === "tv" && !showPool.has(Number(r.ref))) newShowIds.push(Number(r.ref));
      if (r.kind === "movie" && !moviePool.has(r.ref)) newMovieIds.push(r.ref);
    }
    if (newShowIds.length) {
      const ph = newShowIds.slice(0, 12).map(() => "?").join(",");
      for (const s of (await db.prepare(`SELECT * FROM shows WHERE id IN (${ph})`).bind(...newShowIds.slice(0, 12)).all<ShowRow>()).results)
        showPool.set(s.id, s);
    }
    if (newMovieIds.length) {
      const ph = newMovieIds.slice(0, 12).map(() => "?").join(",");
      for (const m of (await db.prepare(`SELECT * FROM movies WHERE imdb_id IN (${ph})`).bind(...newMovieIds.slice(0, 12)).all<MovieRow>()).results)
        moviePool.set(m.imdb_id, m);
    }
  }

  // 4. Score every candidate with one blended formula.
  const scoreRow = (kind: "tv" | "movie", ref: string, genres: string[], year: number | null, provs: Set<string>): Omit<Scored, "pick" | "weight"> => {
    let genreScore = 0;
    for (const g of genres.slice(0, 3)) genreScore += taste.get(g) ?? 0;
    const cf = coRaters.get(titleKey(kind, ref)) ?? 0;
    const eraHit = eraCenter != null && year != null && Math.abs(year - eraCenter) <= 8;
    let prov: string | null = null;
    for (const p of provs) if (likedProviders.has(p)) { prov = p; break; }
    return { genreScore, cf: Math.min(cf, 5), eraHit, provHit: prov != null, prov };
  };

  const scored: Scored[] = [];
  for (const s of showPool.values()) {
    if (excluded.has(titleKey("tv", String(s.id)))) continue;
    const genres = parseGenres(s.genres);
    const parts = scoreRow("tv", String(s.id), genres, showYear(s), providersOf(s));
    const score = parts.genreScore + parts.cf + (parts.eraHit ? 0.5 : 0) + (parts.provHit ? 0.5 : 0);
    scored.push({ pick: showPick(s, "", score), weight: s.weight, ...parts });
  }
  for (const m of moviePool.values()) {
    if (excluded.has(titleKey("movie", m.imdb_id))) continue;
    const genres = parseGenres(m.genres);
    const parts = scoreRow("movie", m.imdb_id, genres, m.year, providersOf(m));
    const score = parts.genreScore + parts.cf + (parts.eraHit ? 0.5 : 0) + (parts.provHit ? 0.5 : 0);
    scored.push({ pick: moviePick(m, "", score), weight: (m.rating ?? 0) * 12, ...parts });
  }

  scored.sort((a, b) => b.pick.score - a.pick.score || b.cf - a.cf || b.weight - a.weight);

  // 5. Diversity pass: at most 2 per lead genre (backfilled if it starves).
  const anchorName = anchor?.name ?? null;
  const reasonFor = (s: Scored, isPrimary: boolean): string => {
    if (s.cf >= 3) return "Loved by people who share your taste";
    if (s.cf >= 2) return "Fans of your picks rate it highly";
    const g = s.pick.genres.find((x) => (taste.get(x) ?? 0) >= 1);
    if (isPrimary && anchorName) return `In the vein of ${anchorName}`;
    if (g && s.provHit && s.prov) return `${g} on ${s.prov} — your lane`;
    if (g) return anchorName ? `${g} like ${anchorName}` : `A standout in ${g.toLowerCase()}`;
    if (s.eraHit) return "Right from your sweet-spot era";
    if (s.provHit && s.prov) return `Streaming on ${s.prov}`;
    return anchorName ? `Shares the DNA of ${anchorName}` : "A close match for your taste";
  };
  // The structured, checkable "why" — only signals that actually fired.
  const whyFor = (s: Scored): WhySignal => ({
    anchor: anchorName,
    genres: s.pick.genres
      .filter((g) => (taste.get(g) ?? 0) >= 1)
      .slice(0, 2)
      .map((g) => ({ name: g, n: genrePickCount.get(g) ?? 1 })),
    era: s.eraHit ? eraLabel : null,
    prov: s.provHit ? s.prov : null,
    cf: s.cf,
  });

  const ordered: Scored[] = [];
  const overflow: Scored[] = [];
  const genreCount = new Map<string, number>();
  for (const s of scored) {
    const lead = s.pick.genres[0] ?? "_";
    if ((genreCount.get(lead) ?? 0) >= 2) {
      overflow.push(s);
      continue;
    }
    genreCount.set(lead, (genreCount.get(lead) ?? 0) + 1);
    ordered.push(s);
    if (ordered.length >= 7) break;
  }
  for (const s of overflow) {
    if (ordered.length >= 7) break;
    ordered.push(s);
  }

  let top = ordered.slice(0, 7);

  // 6. Cold start / starved pool: confident fallback so a page is never empty.
  if (top.length === 0) {
    const wantGenre = [...taste.entries()].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1])[0]?.[0];
    const likeClause = wantGenre ? "AND genres LIKE ?" : "";
    const fbShows = (
      await db
        .prepare(
          `SELECT * FROM shows WHERE weight >= ? AND rating >= 7.8 AND poster_url IS NOT NULL ${likeClause}
           ORDER BY rating DESC, weight DESC LIMIT 7`,
        )
        .bind(...(wantGenre ? [85, `%"${wantGenre}"%`] : [85]))
        .all<ShowRow>()
    ).results.filter((s) => !excluded.has(titleKey("tv", String(s.id))));
    top = fbShows.map((s) => ({ pick: showPick(s, wantGenre ? `A top ${wantGenre.toLowerCase()} pick` : "Among the best-reviewed", s.rating ?? 0), weight: s.weight, cf: 0, genreScore: 0, eraHit: false, provHit: false, prov: null }));
  }

  const withReasons = top.map((s, i) => ({ ...s.pick, reason: s.pick.reason || reasonFor(s, i === 0), why: whyFor(s) }));
  const primary = withReasons[0] ?? null;
  const contenders = withReasons.slice(1, 7);

  const topScore = top[0]?.pick.score ?? 0;
  const confidence = !primary
    ? ""
    : top[0]?.cf >= 3
      ? "High confidence"
      : positives.length >= 2 || topScore >= 3
        ? "Strong match"
        : "Worth a shot";
  // a soft "feel" number for the hero ring — not a precise claim, but it tracks
  // the real score and the depth of the read.
  const matchPct = primary ? Math.max(74, Math.min(97, Math.round(74 + topScore * 3.2 + Math.min(positives.length, 4)))) : 0;

  // the "we read your taste" panel: top positive genres + the era you live in.
  const tasteRead: string[] = [...taste.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([g]) => g);
  if (eraCenter) tasteRead.push(`${Math.floor(eraCenter / 10) * 10}s`);

  return { primary, contenders, confidence, anchorName, matchPct, tasteRead };
}

/**
 * The enrich deck: 2–4 more titles to rate, chosen by INFORMATION GAIN — each
 * minimizes genre overlap with what's already rated (tie-broken by
 * recognizability), so each extra tap actually sharpens the taste vector
 * instead of confirming what we know.
 */
export async function enrichDeck(db: D1Database, rated: RatedEntry[], n = 4): Promise<DeckCard[]> {
  const ratedGenres = new Set<string>();
  const resolved = await Promise.all(rated.map((e) => getRatedTitle(db, e.kind, e.ref)));
  for (const t of resolved) {
    const row = t?.show ?? t?.movie;
    if (row) parseGenres(row.genres).forEach((g) => ratedGenres.add(g));
  }
  const excluded = new Set(rated.map((e) => titleKey(e.kind, e.ref)));

  const [{ results: shows }, { results: movies }] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, premiered, genres, COALESCE(poster_url, image_url) AS poster
         FROM shows WHERE weight >= 88 AND rating >= 7.5 AND poster_url IS NOT NULL
         ORDER BY weight DESC LIMIT 40`,
      )
      .all<{ id: number; name: string; premiered: string | null; genres: string | null; poster: string | null }>(),
    db
      .prepare(
        `SELECT imdb_id, title, year, genres, poster_url AS poster
         FROM movies WHERE rating >= 7.7 AND poster_url IS NOT NULL AND votes >= 1000
         ORDER BY popularity DESC LIMIT 40`,
      )
      .all<{ imdb_id: string; title: string; year: number | null; genres: string | null; poster: string | null }>(),
  ]);

  const pool: (DeckCard & { overlap: number })[] = [];
  for (const s of shows) {
    if (excluded.has(titleKey("tv", String(s.id)))) continue;
    const genres = parseGenres(s.genres);
    pool.push({
      kind: "tv",
      ref: String(s.id),
      name: s.name,
      year: s.premiered ? s.premiered.slice(0, 4) : null,
      poster: s.poster,
      genres,
      overlap: genres.filter((g) => ratedGenres.has(g)).length,
    });
  }
  for (const m of movies) {
    if (excluded.has(titleKey("movie", m.imdb_id))) continue;
    const genres = parseGenres(m.genres);
    pool.push({
      kind: "movie",
      ref: m.imdb_id,
      name: m.title,
      year: m.year ? String(m.year) : null,
      poster: m.poster,
      genres,
      overlap: genres.filter((g) => ratedGenres.has(g)).length,
    });
  }

  // least overlap first (most new information), then most recognizable.
  pool.sort((a, b) => a.overlap - b.overlap || (b.kind === a.kind ? 0 : a.kind === "tv" ? -1 : 1));
  const deck: DeckCard[] = [];
  const used = new Set<string>();
  for (const c of pool) {
    const lead = c.genres[0] ?? "_";
    if (used.has(lead)) continue; // one per lead genre keeps the deck diverse
    used.add(lead);
    deck.push({ kind: c.kind, ref: c.ref, name: c.name, year: c.year, poster: c.poster, genres: c.genres });
    if (deck.length >= n) break;
  }
  return deck;
}

/** A diverse, recognizable poster set for the landing's zero-typing tap row. */
export async function landingPicks(db: D1Database, n = 12): Promise<DeckCard[]> {
  const [{ results: shows }, { results: movies }] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, premiered, genres, COALESCE(poster_url, image_url) AS poster
         FROM shows WHERE weight >= 90 AND poster_url IS NOT NULL ORDER BY weight DESC LIMIT 30`,
      )
      .all<{ id: number; name: string; premiered: string | null; genres: string | null; poster: string | null }>(),
    db
      .prepare(
        `SELECT imdb_id, title, year, genres, poster_url AS poster
         FROM movies WHERE rating >= 7.8 AND poster_url IS NOT NULL ORDER BY popularity DESC LIMIT 20`,
      )
      .all<{ imdb_id: string; title: string; year: number | null; genres: string | null; poster: string | null }>(),
  ]);
  const all: DeckCard[] = [
    ...shows.map((s) => ({ kind: "tv" as const, ref: String(s.id), name: s.name, year: s.premiered ? s.premiered.slice(0, 4) : null, poster: s.poster, genres: parseGenres(s.genres) })),
    ...movies.map((m) => ({ kind: "movie" as const, ref: m.imdb_id, name: m.title, year: m.year ? String(m.year) : null, poster: m.poster, genres: parseGenres(m.genres) })),
  ];
  // spread across lead genres so the rail isn't ten dramas
  const out: DeckCard[] = [];
  const seen = new Map<string, number>();
  for (const c of all) {
    const lead = c.genres[0] ?? "_";
    if ((seen.get(lead) ?? 0) >= 2) continue;
    seen.set(lead, (seen.get(lead) ?? 0) + 1);
    out.push(c);
    if (out.length >= n) break;
  }
  return out.length ? out : all.slice(0, n);
}
