// =============================================================================
// Shorts generator — the engine behind /admin/shorts.
//
// One search → MANY "Top 10" angle ideas → a ranked 10 → per-platform captions
// → a single render_short.sh that drives the LOCAL countdown video pipeline
// (tools/countdown/make_countdown_depth.sh). Cloudflare Workers can't run
// ffmpeg/DepthFlow, so this lib only ASSEMBLES the spec; the .sh runs on the Mac.
//
// All ranking reuses the existing live TMDB helpers in ./tmdb + ./tmdb-show —
// no new API integrations.
// =============================================================================
import type { Context } from "hono";
import type { AppContext, HonoEnv } from "../types";
import { slugifyName } from "./format";
import { buildCaptions, type CaptionSet } from "./promo";
import { origin } from "./seo";
import {
  tmdbDiscoverChart,
  tmdbDiscoverNetwork,
  tmdbRecommendations,
  tmdbSearch,
  tmdbSearchPeople,
  tmdbShowNetworks,
  tmdbTopRated,
  tmdbTrendingList,
  tmdbUpcomingMovies,
  type TmdbSearchHit,
} from "./tmdb";
import { buildTmdbShow, tmdbPersonData } from "./tmdb-show";

const BRAND_ACCENT = "0x39d98a";
const IMG = (path: string | null, size: string): string | null =>
  !path ? null : /^https?:/.test(path) ? path : `https://image.tmdb.org/t/p/${size}${path}`;

// User-friendly genres → TMDB ids (movie + tv). Drives both search detection and
// the genre angles. Only the ids that exist per-medium are set.
export const GENRES: { name: string; slug: string; movie?: number; tv?: number }[] = [
  { name: "Action", slug: "action", movie: 28, tv: 10759 },
  { name: "Adventure", slug: "adventure", movie: 12, tv: 10759 },
  { name: "Animation", slug: "animation", movie: 16, tv: 16 },
  { name: "Comedy", slug: "comedy", movie: 35, tv: 35 },
  { name: "Crime", slug: "crime", movie: 80, tv: 80 },
  { name: "Documentary", slug: "documentary", movie: 99, tv: 99 },
  { name: "Drama", slug: "drama", movie: 18, tv: 18 },
  { name: "Family", slug: "family", movie: 10751, tv: 10751 },
  { name: "Fantasy", slug: "fantasy", movie: 14, tv: 10765 },
  { name: "History", slug: "history", movie: 36 },
  { name: "Horror", slug: "horror", movie: 27 },
  { name: "Mystery", slug: "mystery", movie: 9648, tv: 9648 },
  { name: "Reality", slug: "reality", tv: 10764 },
  { name: "Romance", slug: "romance", movie: 10749 },
  { name: "Sci-Fi", slug: "sci-fi", movie: 878, tv: 10765 },
  { name: "Thriller", slug: "thriller", movie: 53 },
  { name: "War", slug: "war", movie: 10752, tv: 10768 },
  { name: "Western", slug: "western", movie: 37, tv: 37 },
];
export const findGenre = (q: string) => {
  const s = q.trim().toLowerCase();
  return GENRES.find((g) => g.slug === s || g.name.toLowerCase() === s || s.includes(g.name.toLowerCase()));
};

// ---------------------------------------------------------------------------
// Types (mirrored as JSDoc in public/js/shorts.js)
// ---------------------------------------------------------------------------
export type ShortKind = "tv" | "movie";
export type SubjectKind = ShortKind | "person" | "genre" | "year";

export interface SearchSubject {
  kind: SubjectKind;
  label: string;
  sublabel: string | null;
  tmdbId: number | null;
  posterUrl: string | null;
  year: number | null;
  genreId: number | null;
  genreSlug: string | null;
  genreIds: number[];
}

export type AngleType =
  | "person-films" | "person-roles" | "person-overall"
  | "title-episodes" | "similar-to"
  | "genre-alltime" | "genre-year" | "year-best"
  | "alltime-best" | "trending-week" | "network-best" | "upcoming-movies";

// Names the exact helper + args the ranker will invoke. Whitelisted server-side.
export interface AngleQuery {
  fn: AngleType;
  kind: ShortKind;
  tmdbId?: number;
  genreId?: number;
  year?: number;
}

export interface ShortAngle {
  angleId: string;
  type: AngleType;
  title: string; // 'Top 10 Matt Damon Movies'
  query: string; // 'matt-damon-movies' (campaign + filenames)
  intro: { line1: string; line2: string; line3: string };
  ctaReason: string;
  tmdbQuery: AngleQuery;
}

export interface ShortEntry {
  rank: number;
  tmdbId: number;
  kind: ShortKind;
  title: string; // display 'Inception (2010)'
  rawTitle: string; // 'Inception'
  year: number | null;
  posterUrl: string | null; // w342 thumb (curate grid)
  posterHiUrl: string | null; // original/ (export)
  rating: number | null;
  subLabel: string | null; // 'as Jason Bourne' / 'S5E14'
  accentHex: string;
}

export interface ShortProject {
  subject: SearchSubject;
  angle: ShortAngle;
  entries: ShortEntry[];
  accentHex: string;
  intro: { line1: string; line2: string; line3: string };
  ctaReason: string;
  ctaUrl: string;
  ctaComment: string;
  musicUrl: string | null;
  ramp: number;
  grade: 0 | 1;
  depth: 0 | 1;
}

export interface ExportBundle {
  filename: string;
  script: string;
  cardsTsv: string;
  captions: CaptionSet;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const upper = (s: string) => s.toUpperCase();
const titleYear = (name: string, year: number | string | null) =>
  year ? `${name} (${year})` : name;

const hitToEntry = (h: TmdbSearchHit, rank: number, sub: string | null = null): ShortEntry => ({
  rank,
  tmdbId: h.tmdbId,
  kind: h.kind,
  title: titleYear(h.name, h.year),
  rawTitle: h.name,
  year: h.year ? Number(String(h.year).slice(0, 4)) || null : null,
  posterUrl: IMG(h.posterPath, "w342"),
  posterHiUrl: IMG(h.posterPath, "original"),
  rating: h.rating ?? null,
  subLabel: sub,
  accentHex: BRAND_ACCENT,
});

// rating desc (rated first), popularity tiebreak; only entries with a poster.
const rankHits = (hits: TmdbSearchHit[], take = 10, subOf?: (h: TmdbSearchHit) => string | null) =>
  hits
    .filter((h) => h.posterPath)
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, take)
    .map((h, i) => hitToEntry(h, i + 1, subOf ? subOf(h) : null));

const angleId = (q: AngleQuery) => `${q.fn}-${q.kind}-${q.tmdbId ?? ""}-${q.genreId ?? ""}-${q.year ?? ""}`;

// ---------------------------------------------------------------------------
// resolveSubjects — free text → the things you can build a Top 10 around
// ---------------------------------------------------------------------------
export async function resolveSubjects(c: Context<HonoEnv>, q: string): Promise<SearchSubject[]> {
  const key = c.env.TMDB_API_KEY ?? "";
  const out: SearchSubject[] = [];

  // a bare year → "Top 10 of <year>"
  const ym = q.trim().match(/^(19[5-9]\d|20[0-4]\d)$/);
  if (ym) {
    out.push({ kind: "year", label: ym[1], sublabel: "Year", tmdbId: null, posterUrl: null, year: Number(ym[1]), genreId: null, genreSlug: null, genreIds: [] });
  }
  // a genre word → "Top 10 <genre>"
  const g = findGenre(q);
  if (g) {
    out.push({ kind: "genre", label: g.name, sublabel: "Genre", tmdbId: g.tv ?? g.movie ?? null, posterUrl: null, year: null, genreId: g.tv ?? g.movie ?? null, genreSlug: g.slug, genreIds: [] });
  }

  const [titles, people] = await Promise.all([tmdbSearch(key, q), tmdbSearchPeople(key, q)]);
  for (const h of titles.slice(0, 8)) {
    out.push({
      kind: h.kind, label: h.name,
      sublabel: `${h.kind === "tv" ? "TV Series" : "Movie"}${h.year ? ` · ${String(h.year).slice(0, 4)}` : ""}`,
      tmdbId: h.tmdbId, posterUrl: IMG(h.posterPath, "w185"),
      year: h.year ? Number(String(h.year).slice(0, 4)) || null : null,
      genreId: null, genreSlug: null, genreIds: h.genreIds ?? [],
    });
  }
  for (const p of people.slice(0, 4)) {
    out.push({ kind: "person", label: p.name, sublabel: "Person", tmdbId: p.tmdbId, posterUrl: IMG(p.profilePath, "w185"), year: null, genreId: null, genreSlug: null, genreIds: [] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// buildAngles — one subject → a menu of finished video concepts
// ---------------------------------------------------------------------------
const A = (
  type: AngleType,
  title: string,
  q: AngleQuery,
  intro: { line1: string; line2: string; line3?: string },
  ctaReason = "FULL RANKINGS + WHERE TO STREAM",
): ShortAngle => ({
  angleId: angleId(q),
  type,
  title,
  query: slugify(title.replace(/^top 10 /i, "")),
  intro: { line1: upper(intro.line1), line2: upper(intro.line2), line3: upper(intro.line3 ?? "HOW MANY HAVE YOU SEEN?") },
  ctaReason,
  tmdbQuery: q,
});

export function buildAngles(s: SearchSubject): ShortAngle[] {
  const out: ShortAngle[] = [];
  const N = s.label;
  const NU = upper(N);

  if (s.kind === "person" && s.tmdbId) {
    out.push(A("person-films", `Top 10 ${N} Movies`, { fn: "person-films", kind: "movie", tmdbId: s.tmdbId },
      { line1: `TOP 10 ${N}`, line2: "MOVIES" }));
    out.push(A("person-roles", `Top 10 ${N} TV Roles`, { fn: "person-roles", kind: "tv", tmdbId: s.tmdbId },
      { line1: `TOP 10 ${N}`, line2: "TV ROLES" }));
    out.push(A("person-overall", `${N}'s 10 Best Performances`, { fn: "person-overall", kind: "movie", tmdbId: s.tmdbId },
      { line1: NU, line2: "EVERY ROLE RANKED" }));
    return out;
  }

  if (s.kind === "genre" && s.genreId != null) {
    const g = GENRES.find((x) => x.slug === s.genreSlug);
    if (g?.tv) out.push(A("genre-alltime", `Top 10 ${N} Series`, { fn: "genre-alltime", kind: "tv", genreId: g.tv },
      { line1: `TOP 10 ${N}`, line2: "SERIES" }));
    if (g?.movie) out.push(A("genre-alltime", `Top 10 ${N} Movies`, { fn: "genre-alltime", kind: "movie", genreId: g.movie },
      { line1: `TOP 10 ${N}`, line2: "MOVIES" }));
    return out;
  }

  if (s.kind === "year" && s.year) {
    out.push(A("year-best", `Top 10 Series of ${s.year}`, { fn: "year-best", kind: "tv", year: s.year },
      { line1: "BEST SERIES", line2: `OF ${s.year}` }));
    out.push(A("year-best", `Top 10 Movies of ${s.year}`, { fn: "year-best", kind: "movie", year: s.year },
      { line1: "BEST MOVIES", line2: `OF ${s.year}` }));
    return out;
  }

  // a TITLE (movie or tv)
  const k = s.kind as ShortKind;
  const id = s.tmdbId!;
  const noun = k === "tv" ? "Series" : "Movies";
  if (k === "tv") {
    out.push(A("title-episodes", `Top 10 Episodes of ${N}`, { fn: "title-episodes", kind: "tv", tmdbId: id },
      { line1: "TOP 10 EPISODES", line2: `OF ${NU}` }));
  }
  out.push(A("similar-to", `Top 10 ${noun} Like ${N}`, { fn: "similar-to", kind: k, tmdbId: id },
    { line1: `IF YOU LIKED ${NU}`, line2: "WATCH THESE NEXT" }, "MORE LIKE THIS + WHERE TO STREAM"));
  // genre angles from the title's own genres (max 2)
  for (const gid of (s.genreIds ?? []).slice(0, 2)) {
    const g = GENRES.find((x) => x.movie === gid || x.tv === gid);
    if (!g) continue;
    out.push(A("genre-alltime", `Top 10 ${g.name} ${noun}`, { fn: "genre-alltime", kind: k, genreId: gid },
      { line1: `TOP 10 ${upper(g.name)}`, line2: upper(noun) }));
    if (s.year) out.push(A("genre-year", `Top 10 ${g.name} ${noun} of ${s.year}`, { fn: "genre-year", kind: k, genreId: gid, year: s.year },
      { line1: `TOP 10 ${upper(g.name)}`, line2: `OF ${s.year}` }));
  }
  if (s.year) out.push(A("year-best", `Top 10 ${noun} of ${s.year}`, { fn: "year-best", kind: k, year: s.year },
    { line1: `BEST ${upper(noun)}`, line2: `OF ${s.year}` }));
  out.push(A("alltime-best", `Top 10 ${noun} of All Time`, { fn: "alltime-best", kind: k },
    { line1: `TOP 10 ${upper(noun)}`, line2: "OF ALL TIME" }));
  out.push(A("trending-week", `Top 10 Trending ${noun} This Week`, { fn: "trending-week", kind: k },
    { line1: "TRENDING NOW", line2: `TOP 10 ${upper(noun)}` }));
  if (k === "tv") out.push(A("network-best", `Top 10 Series on This Network`, { fn: "network-best", kind: "tv", tmdbId: id },
    { line1: "TOP 10 ON", line2: "THIS NETWORK" }));
  if (k === "movie") out.push(A("upcoming-movies", `Top 10 Most Anticipated Movies`, { fn: "upcoming-movies", kind: "movie" },
    { line1: "MOST ANTICIPATED", line2: "MOVIES COMING SOON" }));
  return out;
}

// ---------------------------------------------------------------------------
// runAngleQuery — fetch + rank the 10 for a chosen angle (whitelisted dispatch)
// ---------------------------------------------------------------------------
export async function runAngleQuery(c: Context<HonoEnv>, q: AngleQuery): Promise<ShortEntry[]> {
  const key = c.env.TMDB_API_KEY ?? "";
  switch (q.fn) {
    case "similar-to":
      return rankHits(await tmdbRecommendations(key, q.kind, q.tmdbId!));
    case "alltime-best":
      return rankHits(await tmdbTopRated(key, q.kind));
    case "trending-week":
      return rankHits(await tmdbTrendingList(key, q.kind));
    case "genre-alltime":
      return rankHits(await tmdbDiscoverChart(key, { kind: q.kind, sort: "rated", genreId: q.genreId }));
    case "genre-year":
      return rankHits(await tmdbDiscoverChart(key, { kind: q.kind, sort: "rated", genreId: q.genreId, year: q.year }));
    case "year-best":
      return rankHits(await tmdbDiscoverChart(key, { kind: q.kind, sort: "rated", year: q.year }));
    case "upcoming-movies": {
      const up = await tmdbUpcomingMovies(key);
      return up
        .filter((u) => u.posterPath)
        .slice(0, 10)
        .map((u, i) => hitToEntry({ tmdbId: u.tmdbId, kind: "movie", name: u.title, year: u.releaseDate ? u.releaseDate.slice(0, 4) : null, posterPath: u.posterPath, rating: null, overview: null, popularity: u.popularity } as TmdbSearchHit, i + 1));
    }
    case "network-best": {
      const nets = await tmdbShowNetworks(key, q.tmdbId!);
      if (!nets.length) return [];
      return rankHits(await tmdbDiscoverNetwork(key, nets[0].id, 2, { sort: "rated" }));
    }
    case "title-episodes": {
      const data = await buildTmdbShow(c, q.tmdbId!);
      if (!data) return [];
      const showPoster = data.show.poster_url || data.show.image_url;
      return data.episodes
        .filter((e) => e.rating != null)
        .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
        .slice(0, 10)
        .map((e, i) => ({
          rank: i + 1,
          tmdbId: q.tmdbId!,
          kind: "tv" as ShortKind,
          title: e.name || `Episode ${e.number}`,
          rawTitle: e.name || `Episode ${e.number}`,
          year: null,
          posterUrl: e.image_url || showPoster,
          posterHiUrl: e.image_url || showPoster,
          rating: e.rating,
          subLabel: `S${e.season ?? "?"}E${e.number ?? "?"}`,
          accentHex: BRAND_ACCENT,
        }));
    }
    case "person-films":
    case "person-roles":
    case "person-overall": {
      const p = await tmdbPersonData(c, q.tmdbId!);
      if (!p) return [];
      const films: ShortEntry[] = p.films
        .filter((f) => f.poster_url && f.tmdb_id)
        .map((f) => ({
          rank: 0, tmdbId: f.tmdb_id!, kind: "movie" as ShortKind,
          title: titleYear(f.title, f.year), rawTitle: f.title, year: f.year,
          posterUrl: f.poster_url, posterHiUrl: f.poster_url, rating: f.rating ?? null,
          subLabel: f.character ? `as ${f.character}` : null, accentHex: BRAND_ACCENT,
        }));
      const roles: ShortEntry[] = p.roles
        .filter((r) => (r.poster_url || r.image_url) && r.tmdb_id)
        .map((r) => ({
          rank: 0, tmdbId: r.tmdb_id!, kind: "tv" as ShortKind,
          title: titleYear(r.name, r.premiered ? r.premiered.slice(0, 4) : null), rawTitle: r.name,
          year: r.premiered ? Number(r.premiered.slice(0, 4)) || null : null,
          posterUrl: r.poster_url || r.image_url, posterHiUrl: r.poster_url || r.image_url, rating: r.rating ?? null,
          subLabel: r.character ? `as ${r.character}` : null, accentHex: BRAND_ACCENT,
        }));
      const pool = q.fn === "person-roles" ? roles : q.fn === "person-films" ? films : [...films, ...roles];
      return pool
        .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
        .slice(0, 10)
        .map((e, i) => ({ ...e, rank: i + 1 }));
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Captions — delegate to the shared buildCaptions (7 platforms + tags + UTM)
// ---------------------------------------------------------------------------
/** Map a chosen angle to the on-site page that best matches its promise, so the
 *  caption link lands on the exact ranked page instead of a generic hub — e.g.
 *  "Top 10 Episodes of Severance" → /show/severance/best-episodes, not /top/tv.
 *  Returns null for angles without a clean 1:1 page (genre / year / network /
 *  person / all-time): the caller keeps its sensible Top-TV / Movies default.
 *  Uses the site's canonical slugifier (same as promo.ts link-outs) so the
 *  /show/<slug>/… path resolves. */
export function shortsLandingPath(o: {
  angleType: AngleType;
  kind: ShortKind;
  subjectLabel: string | null | undefined;
}): string | null {
  const slug = o.subjectLabel ? slugifyName(o.subjectLabel) : "";
  if (!slug) return null;
  switch (o.angleType) {
    case "title-episodes": // "Top 10 Episodes of X" → that show's ranked episodes
      return `/show/${slug}/best-episodes`;
    case "similar-to": // "Top 10 … Like X" → that title's similar page
      return `/${o.kind === "movie" ? "movie" : "show"}/${slug}/similar`;
    default:
      return null;
  }
}

export function shorts10Captions(p: {
  c: AppContext;
  title: string;
  query: string;
  kind: ShortKind;
  ctaUrl: string;
  landingPath?: string | null;
}): CaptionSet {
  const base = origin(p.c);
  // Prefer the angle's real matching page (landingPath) so the caption link lands
  // on the exact ranked page the video promised. p.ctaUrl is only the brand line
  // shown IN the video ("tvnightly.com"), so when there's no precise page we strip
  // it to a path and fall back to the Top TV / Movies hub.
  const fallbackPath =
    (p.ctaUrl || "")
      .trim()
      .replace(/^https?:\/\//i, "") // protocol
      .replace(/^[^/]*\.[^/]*?(?=\/|$)/, "") // a leading host token ("x.y")
      .replace(/^\/+/, "") || // leading slashes
    (p.kind === "movie" ? "movies" : "top/tv");
  const landingPath = (p.landingPath || "").replace(/^\/+/, "") || fallbackPath;
  const link = `${base}/${landingPath}`;
  return buildCaptions({
    emoji: "🏆",
    title: `Top 10 ${p.title}`,
    hook: "Ranked from 10 to 1 — which have you actually seen?",
    sub: "Did I get #1 wrong? Settle it in the comments 👇",
    link,
    tags: ["Top10", p.query.replace(/-/g, ""), "Ranked", p.kind === "movie" ? "Movies" : "TVShows"],
    campaign: `top10-${p.query}`,
  });
}

// ---------------------------------------------------------------------------
// Export — one self-contained render_short.sh + a captions pack
// ---------------------------------------------------------------------------
const sh = (s: string | null | undefined) => String(s ?? "").replace(/'/g, "'\\''");
const tsvSafe = (s: string | null | undefined) => String(s ?? "").replace(/[\t\n\r]+/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Per-category theming — each category gets its own accent colour + mood-matched
// music so a "Best Romance" short doesn't look or sound like a "Best Horror" one.
// Accents are vivid mid-tones (the dark CTA text stays legible on them). Music is
// a local mood track the founder curates once — see tools/countdown/music/SOURCES.md.
// ---------------------------------------------------------------------------
export type ShortMood = "epic" | "dark" | "romance" | "upbeat" | "scifi";

const GENRE_THEME: Record<string, { accent: string; mood: ShortMood }> = {
  action: { accent: "0xff5a3c", mood: "epic" },
  adventure: { accent: "0xf2a413", mood: "epic" },
  animation: { accent: "0x3cc8ff", mood: "upbeat" },
  comedy: { accent: "0xffd23c", mood: "upbeat" },
  crime: { accent: "0xe0503a", mood: "dark" },
  documentary: { accent: "0x4db8a4", mood: "epic" },
  drama: { accent: "0xb98cff", mood: "romance" },
  family: { accent: "0x6ad06a", mood: "upbeat" },
  fantasy: { accent: "0x9b7bff", mood: "epic" },
  history: { accent: "0xc9a24b", mood: "epic" },
  horror: { accent: "0xff2e2e", mood: "dark" },
  mystery: { accent: "0x7c6cff", mood: "dark" },
  reality: { accent: "0xff6ec7", mood: "upbeat" },
  romance: { accent: "0xff5c8a", mood: "romance" },
  "sci-fi": { accent: "0x2ee6d6", mood: "scifi" },
  thriller: { accent: "0xff7a1a", mood: "dark" },
  war: { accent: "0x8a8f57", mood: "epic" },
  western: { accent: "0xd98a3a", mood: "epic" },
};

// Fallback theme by angle type when there's no genre to key off.
const ANGLE_THEME: Partial<Record<AngleType, { accent: string; mood: ShortMood }>> = {
  "trending-week": { accent: "0xff5c8a", mood: "upbeat" },
  "alltime-best": { accent: "0xf2c14e", mood: "epic" },
  "year-best": { accent: "0x4db8a4", mood: "epic" },
  "genre-year": { accent: "0x4db8a4", mood: "epic" },
  "upcoming-movies": { accent: "0x2ee6d6", mood: "scifi" },
};

const MOOD_FILE: Record<ShortMood, string> = {
  epic: "epic.mp3",
  dark: "dark.mp3",
  romance: "romance.mp3",
  upbeat: "upbeat.mp3",
  scifi: "scifi.mp3",
};

const DEFAULT_THEME: { accent: string; mood: ShortMood } = { accent: BRAND_ACCENT, mood: "epic" };

const genreThemeById = (id: number | undefined): { accent: string; mood: ShortMood } | null => {
  if (id == null) return null;
  const g = GENRES.find((x) => x.movie === id || x.tv === id);
  return g ? GENRE_THEME[g.slug] ?? null : null;
};

/** The category's accent + music mood, from (in priority) the angle's genre, then
 *  the subject's own genres, then an angle-type fallback, then the brand default. */
export function resolveShortTheme(p: ShortProject): { accentHex: string; mood: ShortMood; musicFile: string } {
  const fromSubject = (p.subject.genreIds ?? []).map(genreThemeById).find((t): t is { accent: string; mood: ShortMood } => Boolean(t));
  const t = genreThemeById(p.angle.tmdbQuery.genreId) ?? fromSubject ?? ANGLE_THEME[p.angle.type] ?? DEFAULT_THEME;
  return { accentHex: t.accent, mood: t.mood, musicFile: MOOD_FILE[t.mood] };
}

export function shorts10Spec(c: AppContext, p: ShortProject): ExportBundle {
  const entries = [...p.entries].slice(0, 10);
  // countdown order: rank 10 (worst) → rank 1 (best) reveals last
  const ordered = entries.slice().sort((a, b) => b.rank - a.rank);
  // Category theming: use the per-category accent unless the user set a custom one
  // (left at the brand default → auto-theme). Music resolves to the mood track.
  const theme = resolveShortTheme(p);
  const userAccent = (p.accentHex || "").trim().toLowerCase();
  const accentHex = !userAccent || userAccent === BRAND_ACCENT ? theme.accentHex : p.accentHex;
  const cardsRows = ordered.map((e) => `${e.rank}\t${tsvSafe(e.title)}\t${accentHex}\t`);
  const cardsTsv = `# rank\\ttitle\\taccent\\tposter(blank — fetched by rank below)\n${cardsRows.join("\n")}\n`;

  const fetches = ordered
    .map((e) => {
      const url = e.posterHiUrl || e.posterUrl;
      return url ? `curl -fsSL -o "posters/${e.rank}.jpg" '${sh(url)}' && echo "  ✓ #${e.rank} ${tsvSafe(e.rawTitle)}"` : `echo "  ! #${e.rank} no poster — drop posters/${e.rank}.jpg manually"`;
    })
    .join("\n");

  const dir = "/Users/ghost/Documents/tvnightly/tools/countdown";
  // Music: an explicit URL wins; otherwise use the category's local mood track
  // (music/<mood>.mp3 — curated once per tools/countdown/music/SOURCES.md); fall
  // back to any music.mp3 already sitting in the dir.
  const music = p.musicUrl
    ? `curl -fsSL -o music.mp3 '${sh(p.musicUrl)}' && echo "  ✓ music.mp3 (custom)"`
    : `if [ -f 'music/${theme.musicFile}' ]; then cp 'music/${theme.musicFile}' music.mp3 && echo "  ✓ ${theme.mood} track (music/${theme.musicFile})"; elif [ -f music.mp3 ]; then echo "  • using existing music.mp3"; else echo "⚠️  No music/${theme.musicFile} — add a ${theme.mood} track (see tools/countdown/music/SOURCES.md) or drop a music.mp3 here."; exit 1; fi`;

  const cfg = [
    `export INTRO_LINE1='${sh(p.intro.line1)}'`,
    `export INTRO_LINE2='${sh(p.intro.line2)}'`,
    `export INTRO_LINE3='${sh(p.intro.line3)}'`,
    `export CTA_REASON='${sh(p.ctaReason)}'`,
    `export CTA_URL='${sh(p.ctaUrl)}'`,
    `export CTA_COMMENT='${sh(p.ctaComment)}'`,
    `export ACCENT='${sh(accentHex)}'`,
    `export RAMP=${p.ramp}`,
    `export GRADE=${p.grade}`,
    `export DEPTH=${p.depth}`,
  ].join("\n");

  const script = `#!/usr/bin/env bash
# render_short — generated by TV Nightly /admin/shorts. Renders a beat-synced
# 9:16 countdown Short via the local pipeline (ffmpeg + DepthFlow). Run on your Mac.
set -euo pipefail
cd '${dir}'
mkdir -p posters out work

echo "→ writing cards.tsv"
cat > cards.tsv <<'TSV'
${cardsRows.join("\n")}
TSV

echo "→ fetching ${ordered.length} hi-res posters"
${fetches}

echo "→ music"
${music}

echo "→ config + render"
${cfg}
bash make_countdown_depth.sh
echo "✓ done → out/countdown_depth.mp4"
`;

  return {
    filename: `render_short--${p.angle.query}.sh`,
    script,
    cardsTsv,
    captions: shorts10Captions({
      c,
      title: titleForCaptions(p),
      query: p.angle.query,
      kind: p.angle.tmdbQuery.kind,
      ctaUrl: p.ctaUrl,
      landingPath: shortsLandingPath({
        angleType: p.angle.type,
        kind: p.angle.tmdbQuery.kind,
        subjectLabel: p.subject?.label,
      }),
    }),
  };
}

const titleForCaptions = (p: ShortProject) => p.angle.title.replace(/^top 10 /i, "");
