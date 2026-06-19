// Runtime TMDB lookups, edge-cached so the free tier never feels them.
// The mirror stays lean: these are presentation assets, not data.

type RawBundle = {
  backdrop_path?: string | null;
  poster_path?: string | null;
  original_title?: string;
  original_language?: string;
  production_companies?: { id: number; name: string }[];
  created_by?: { id: number; name: string }[];
  images?: {
    posters?: { file_path: string; iso_639_1: string | null; vote_count: number }[];
    backdrops?: { file_path: string; iso_639_1: string | null; vote_count: number }[];
  };
  videos?: {
    results?: {
      key: string;
      name: string;
      site: string;
      type: string;
      official: boolean;
      published_at?: string;
    }[];
  };
  credits?: {
    cast?: {
      id: number;
      name: string;
      profile_path: string | null;
      character?: string | null;
      order?: number;
    }[];
    crew?: {
      id: number;
      name: string;
      profile_path: string | null;
      job?: string;
      department?: string;
    }[];
  };
};

/** One call serves every TMDB presentation need for a title (base record +
 *  images + videos via append_to_response), edge-cached for 7 days.
 *  Movies ride their IMDb tt-id — TMDB accepts it directly in the path. */
async function bundle(
  key: string,
  kind: "tv" | "movie",
  id: number | string,
): Promise<RawBundle | null> {
  // v2: credits joined the bundle — new key so stale credit-less entries age out
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/media/v2/${kind}/${id}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/${kind}/${id}?api_key=${key}&append_to_response=images,videos,credits&include_image_language=en,null`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    return (await res.json()) as RawBundle;
  } catch {
    return null;
  }
}

const showBundle = (key: string, tmdbId: number) => bundle(key, "tv", tmdbId);

const byVotes = <T extends { vote_count: number }>(arr?: T[]): T[] =>
  (arr ?? []).slice().sort((a, b) => b.vote_count - a.vote_count);

export type TmdbMedia = {
  posters: string[]; // file_paths
  backdrops: string[];
  videos: { key: string; name: string; type: string; published: string | null }[]; // YouTube only
};

const mapMedia = (data: RawBundle): TmdbMedia => {
  // trailers first, official before fan uploads, newest first within a tier
  const typeRank = (t: string) =>
    ["Trailer", "Teaser", "Clip", "Featurette", "Behind the Scenes", "Opening Credits"].indexOf(t);
  const videos = (data.videos?.results ?? [])
    .filter((v) => v.site === "YouTube")
    .sort(
      (a, b) =>
        Number(b.official) - Number(a.official) ||
        (typeRank(a.type) === -1 ? 99 : typeRank(a.type)) -
          (typeRank(b.type) === -1 ? 99 : typeRank(b.type)) ||
        (b.published_at ?? "").localeCompare(a.published_at ?? ""),
    )
    .map((v) => ({ key: v.key, name: v.name, type: v.type, published: v.published_at ?? null }));
  return {
    posters: byVotes(data.images?.posters).map((i) => i.file_path),
    backdrops: byVotes(data.images?.backdrops).map((i) => i.file_path),
    videos,
  };
};

/** Posters, backdrops and YouTube videos for the media pages, vote-ordered. */
export async function tmdbMedia(key: string, tmdbId: number): Promise<TmdbMedia | null> {
  const data = await showBundle(key, tmdbId);
  return data ? mapMedia(data) : null;
}

/** Movie media: same bundle, keyed on the IMDb id our mirror already holds. */
export async function tmdbMovieMedia(key: string, imdbId: string): Promise<TmdbMedia | null> {
  const data = await bundle(key, "movie", imdbId);
  return data ? mapMedia(data) : null;
}

/** Schema-only facts that live in the same edge-cached movie bundle but aren't
 *  persisted in our mirror: the original-language title, ISO 639-1 language,
 *  lead production company, and the best YouTube trailer. Used to enrich the
 *  Movie JSON-LD without a DB backfill or an extra TMDB round-trip (cache hit). */
export async function tmdbMovieFacts(
  key: string,
  imdbId: string,
): Promise<{
  originalTitle: string | null;
  language: string | null;
  studio: string | null;
  trailer: { name: string; key: string; published: string | null } | null;
} | null> {
  const data = await bundle(key, "movie", imdbId);
  if (!data) return null;
  const videos = mapMedia(data).videos;
  const trailer = videos.find((v) => v.type === "Trailer") ?? videos[0] ?? null;
  return {
    originalTitle: data.original_title ?? null,
    language: data.original_language ?? null,
    studio: data.production_companies?.[0]?.name ?? null,
    trailer,
  };
}

/** The hero backdrop. NOT TMDB's designated backdrop_path — that's often a
 *  soft frame grab. We take the community's top-voted backdrop, preferring
 *  textless art (iso null) so the still never carries a baked-in title
 *  under our own h1; backdrop_path is only the last resort.
 *  Returns both renditions: w1280 for 1x screens, the original (often 4K)
 *  for retina — a 1280-CSS-px band needs 2560 source px at DPR 2. */
const pickBackdrop = (data: RawBundle): { x1: string; x2: string } | null => {
  const ranked = byVotes(data.images?.backdrops);
  const pick =
    ranked.find((i) => i.iso_639_1 === null)?.file_path ??
    ranked[0]?.file_path ??
    data.backdrop_path;
  return pick
    ? {
        x1: `https://image.tmdb.org/t/p/w1280${pick}`,
        x2: `https://image.tmdb.org/t/p/original${pick}`,
      }
    : null;
};

// The show's full text-less backdrop gallery, vote-ordered, so episode heroes can
// each wear a different frame instead of repeating the show's one lead backdrop.
const allBackdrops = (data: RawBundle): { x1: string; x2: string }[] => {
  const ranked = byVotes(data.images?.backdrops);
  const textless = ranked.filter((i) => i.iso_639_1 === null);
  const paths = (textless.length ? textless : ranked).map((i) => i.file_path);
  const finals = paths.length ? paths : data.backdrop_path ? [data.backdrop_path] : [];
  return finals.map((p) => ({
    x1: `https://image.tmdb.org/t/p/w1280${p}`,
    x2: `https://image.tmdb.org/t/p/original${p}`,
  }));
};
/** Every hi-res text-less backdrop a show has (same cached bundle as
 *  tmdbBackdrop), so callers can vary the frame per episode. */
export async function tmdbBackdrops(
  key: string,
  tmdbId: number,
): Promise<{ x1: string; x2: string }[]> {
  const data = await showBundle(key, tmdbId);
  return data ? allBackdrops(data) : [];
}

export async function tmdbBackdrop(
  key: string,
  tmdbId: number,
): Promise<{ x1: string; x2: string } | null> {
  const data = await showBundle(key, tmdbId);
  return data ? pickBackdrop(data) : null;
}

export type TmdbCastEntry = {
  /** TMDB person id — person pages address TMDB-only people at 10M + this */
  id: number;
  name: string;
  profile_path: string | null;
  character: string | null;
};

/** The movie's billed cast, in billing order — same cached bundle. */
export async function tmdbMovieCast(
  key: string,
  imdbId: string,
  limit = 24,
): Promise<TmdbCastEntry[]> {
  const data = await bundle(key, "movie", imdbId);
  return (data?.credits?.cast ?? [])
    .slice()
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      name: p.name,
      profile_path: p.profile_path,
      character: p.character ?? null,
    }));
}

export type TmdbCrewEntry = {
  /** TMDB person id — crew backfill stores them as 10M + this */
  id: number;
  name: string;
  profile_path: string | null;
  /** merged job line, e.g. "Director · Screenplay" */
  jobs: string;
};

// the credits a fan recognizes, in masthead order
const CREW_RANK = [
  "Director",
  "Screenplay",
  "Writer",
  "Story",
  "Executive Producer",
  "Producer",
  "Original Music Composer",
  "Director of Photography",
  "Editor",
];

/** A movie's key crew from the same cached bundle, one entry per person
 *  with their jobs merged — Nolan reads "Director · Screenplay", not twice. */
export async function tmdbMovieCrew(
  key: string,
  imdbId: string,
  limit = 12,
): Promise<TmdbCrewEntry[]> {
  const data = await bundle(key, "movie", imdbId);
  const merged = new Map<
    number,
    { name: string; profile_path: string | null; jobs: string[]; rank: number }
  >();
  for (const p of data?.credits?.crew ?? []) {
    const rank = CREW_RANK.indexOf(p.job ?? "");
    if (rank === -1) continue;
    const cur = merged.get(p.id);
    if (cur) {
      if (!cur.jobs.includes(p.job!)) cur.jobs.push(p.job!);
      cur.rank = Math.min(cur.rank, rank);
      cur.profile_path = cur.profile_path ?? p.profile_path;
    } else {
      merged.set(p.id, { name: p.name, profile_path: p.profile_path, jobs: [p.job!], rank });
    }
  }
  return [...merged.entries()]
    .sort(([, a], [, b]) => a.rank - b.rank || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(([id, p]) => ({ id, name: p.name, profile_path: p.profile_path, jobs: p.jobs.join(" · ") }));
}

/** A series' creator(s) — the TV headline credit, read straight off the same
 *  cached show bundle as the backdrop (it rides the base /tv record). */
export async function tmdbShowCreators(
  key: string,
  tmdbId: number,
): Promise<{ id: number; name: string }[]> {
  const data = await bundle(key, "tv", tmdbId);
  return (data?.created_by ?? []).map((p) => ({ id: p.id, name: p.name })).slice(0, 3);
}

/** Movie hero backdrop, same selection rules, keyed on the IMDb id. */
export async function tmdbMovieBackdrop(
  key: string,
  imdbId: string,
): Promise<{ x1: string; x2: string } | null> {
  const data = await bundle(key, "movie", imdbId);
  return data ? pickBackdrop(data) : null;
}

/** Upcoming snapshot titles often lack an IMDb bridge — TMDB numeric id works. */
export async function tmdbUpcomingBackdrop(
  key: string,
  tmdbId: number,
): Promise<{ x1: string; x2: string } | null> {
  const data = await bundle(key, "movie", tmdbId);
  return data ? pickBackdrop(data) : null;
}

/** This week's worldwide trending titles as rank-ordered TMDB ids (two
 *  pages, 40 titles), edge-cached for 6 hours. The homepage matches them
 *  against the mirror — we only surface titles we can take the reader to. */
export async function tmdbTrending(key: string, kind: "tv" | "movie"): Promise<number[]> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/trending/v1/${kind}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const pages = await Promise.all(
        [1, 2].map((p) =>
          fetch(
            `https://api.themoviedb.org/3/trending/${kind}/week?api_key=${key}&page=${p}`,
            { headers: { accept: "application/json" } },
          ).then((r) => (r.ok ? (r.json() as Promise<{ results?: { id: number }[] }>) : null)),
        ),
      );
      const ids = pages.flatMap((j) => (j?.results ?? []).map((t) => t.id));
      if (!ids.length) return [];
      res = new Response(JSON.stringify(ids), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=21600",
        },
      });
      await cache.put(cacheKey, res.clone());
    }
    return (await res.json()) as number[];
  } catch {
    return [];
  }
}

/** The hero poster: the community's top-voted one-sheet, preferring the
 *  English version (a poster's title typography is the point), then
 *  textless, then TMDB's designated poster_path. Same cached bundle. */
export async function tmdbPoster(
  key: string,
  tmdbId: number,
): Promise<{ x1: string; x2: string } | null> {
  const data = await showBundle(key, tmdbId);
  if (!data) return null;
  const ranked = byVotes(data.images?.posters);
  const pick =
    ranked.find((i) => i.iso_639_1 === "en")?.file_path ??
    ranked[0]?.file_path ??
    data.poster_path;
  return pick
    ? {
        x1: `https://image.tmdb.org/t/p/w342${pick}`,
        x2: `https://image.tmdb.org/t/p/w780${pick}`,
      }
    : null;
}

// ---------------------------------------------------------------- hybrid catalog
// Live TMDB so any title is findable + viewable even when it isn't in the D1
// mirror. The mirror is just our warm/engaged subset; TMDB is the real catalog.

export type TmdbSearchHit = {
  tmdbId: number;
  kind: "tv" | "movie";
  name: string;
  year: string | null;
  posterPath: string | null;
  rating: number | null;
  overview: string | null;
  popularity: number;
  genreIds?: number[];
};

// A rating from a handful of votes is noise — and it swings between cached
// snapshots, so the same brand-new title reads 9.4 in the trending rail and 10.0
// in the hero. Only surface an average once it has enough votes to be stable.
export const MIN_RATING_VOTES = 50;
export const liveRating = (avg: unknown, count: unknown): number | null =>
  typeof avg === "number" && avg > 0 && Number(count) >= MIN_RATING_VOTES ? avg : null;

/** Live TMDB multi-search (tv + movie), popularity-ordered, edge-cached 1h. */
export async function tmdbSearch(key: string, query: string): Promise<TmdbSearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const cacheKey = new Request(
    `https://edge-cache.tvnightly.com/search/v1/${encodeURIComponent(q.toLowerCase())}`,
  );
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/search/multi?api_key=${key}&include_adult=false&query=${encodeURIComponent(q)}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=3600");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    return (data.results ?? [])
      .filter(
        (r) =>
          (r.media_type === "tv" || r.media_type === "movie") && (r.poster_path || r.backdrop_path),
      )
      .map((r) => ({
        tmdbId: r.id as number,
        kind: r.media_type as "tv" | "movie",
        name: (r.media_type === "tv" ? r.name : r.title) as string,
        year: String((r.first_air_date || r.release_date || "") as string).slice(0, 4) || null,
        posterPath: (r.poster_path as string) ?? null,
        rating:
          liveRating(r.vote_average, r.vote_count),
        overview: (r.overview as string) || null,
        popularity: Number(r.popularity) || 0,
      }))
      .filter((r) => r.name)
      .sort((a, b) => b.popularity - a.popularity);
  } catch {
    return [];
  }
}

export type TmdbPersonHit = { tmdbId: number; name: string; profilePath: string | null };
/** Live TMDB people search, popularity-ordered, edge-cached 1h — so a person the
 *  TVmaze-seeded mirror doesn't have is still findable from the search box. */
export async function tmdbSearchPeople(key: string, query: string): Promise<TmdbPersonHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const cacheKey = new Request(
    `https://edge-cache.tvnightly.com/psearch/v2/${encodeURIComponent(q.toLowerCase())}`,
  );
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/search/person?api_key=${key}&query=${encodeURIComponent(q)}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=3600");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    return (data.results ?? [])
      .filter((p) => p.name && p.profile_path)
      .slice(0, 6)
      .map((p) => ({
        tmdbId: p.id as number,
        name: p.name as string,
        profilePath: (p.profile_path as string) ?? null,
      }));
  } catch {
    return [];
  }
}

export type TmdbTitle = {
  tmdbId: number;
  kind: "tv" | "movie";
  name: string;
  year: string | null;
  genres: string[];
  overview: string | null;
  rating: number | null;
  status: string | null;
  seasons: number | null;
  runtime: number | null;
  imdbId: string | null;
  poster: { x1: string; x2: string } | null;
  backdrop: { x1: string; x2: string } | null;
  cast: { id: number; name: string; character: string | null; profilePath: string | null }[];
  trailerKey: string | null;
};

/** A renderable title straight from TMDB — same edge-cached bundle the media
 *  pages already use, normalized for a detail page. */
export async function tmdbTitle(
  key: string,
  kind: "tv" | "movie",
  tmdbId: number,
): Promise<TmdbTitle | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await bundle(key, kind, tmdbId)) as any;
  if (!data || !data.id) return null;
  const name = kind === "tv" ? data.name : data.title;
  if (!name) return null;
  const dateStr = (kind === "tv" ? data.first_air_date : data.release_date) ?? "";
  const ranked = byVotes(data.images?.posters) as {
    file_path: string;
    iso_639_1: string | null;
    vote_count: number;
  }[];
  const posterPick =
    ranked.find((i) => i.iso_639_1 === "en")?.file_path ?? ranked[0]?.file_path ?? data.poster_path;
  const vids = data.videos?.results ?? [];
  const trailer =
    vids.find((v: { site: string; type: string }) => v.site === "YouTube" && v.type === "Trailer") ??
    vids.find((v: { site: string }) => v.site === "YouTube");
  return {
    tmdbId,
    kind,
    name,
    year: String(dateStr).slice(0, 4) || null,
    genres: (data.genres ?? []).map((g: { name: string }) => g.name).filter(Boolean),
    overview: data.overview || null,
    rating:
      liveRating(data.vote_average, data.vote_count),
    status: data.status ?? null,
    seasons: kind === "tv" ? (data.number_of_seasons ?? null) : null,
    runtime: kind === "movie" ? (data.runtime ?? null) : (data.episode_run_time?.[0] ?? null),
    imdbId: data.external_ids?.imdb_id ?? data.imdb_id ?? null,
    poster: posterPick
      ? {
          x1: `https://image.tmdb.org/t/p/w342${posterPick}`,
          x2: `https://image.tmdb.org/t/p/w500${posterPick}`,
        }
      : null,
    backdrop: pickBackdrop(data),
    cast: (data.credits?.cast ?? [])
      .slice(0, 18)
      .map((p: { id: number; name: string; character?: string; profile_path?: string | null }) => ({
        id: p.id,
        name: p.name,
        character: p.character ?? null,
        profilePath: p.profile_path ?? null,
      })),
    trailerKey: trailer?.key ?? null,
  };
}

/** TMDB popular (tv|movie) — the homepage "Popular" rails, edge-cached 6h. */
export async function tmdbPopular(key: string, kind: "tv" | "movie"): Promise<TmdbSearchHit[]> {
  return tmdbList(key, `/${kind}/popular`, kind);
}

/** TMDB's all-time top-rated chart (built-in min-vote threshold), pages 1-2. */
export async function tmdbTopRated(key: string, kind: "tv" | "movie"): Promise<TmdbSearchHit[]> {
  const [a, b] = await Promise.all([
    tmdbList(key, `/${kind}/top_rated`, kind),
    tmdbList(key, `/${kind}/top_rated`, kind, 2),
  ]);
  const seen = new Set<number>();
  return [...a, ...b].filter((h) => !seen.has(h.tmdbId) && seen.add(h.tmdbId));
}

// TMDB genre ids — fixed lists. We map our genre names (TVmaze-ish) to them so a
// /genre page can pull the live catalog via /discover, not just the D1 mirror.
const TMDB_TV_GENRES: Record<string, number> = {
  action: 10759, adventure: 10759, animation: 16, comedy: 35, crime: 80,
  documentary: 99, drama: 18, family: 10751, kids: 10762, mystery: 9648,
  news: 10763, reality: 10764, "science-fiction": 10765, "sci-fi": 10765,
  fantasy: 10765, soap: 10766, talk: 10767, "war-politics": 10768,
  war: 10768, western: 37, thriller: 80, horror: 9648,
};
const TMDB_MOVIE_GENRES: Record<string, number> = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
  documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36,
  horror: 27, music: 10402, mystery: 9648, romance: 10749,
  "science-fiction": 878, "sci-fi": 878, "tv-movie": 10770, thriller: 53,
  war: 10752, western: 37,
};
export const tmdbGenreId = (kind: "tv" | "movie", slug: string): number | null =>
  (kind === "tv" ? TMDB_TV_GENRES : TMDB_MOVIE_GENRES)[slug] ?? null;

/** Live /discover for a genre (popularity-ranked, rated only). */
export async function tmdbDiscoverGenre(
  key: string,
  kind: "tv" | "movie",
  genreId: number,
): Promise<TmdbSearchHit[]> {
  const path = `/discover/${kind}`;
  const extra = `&with_genres=${genreId}&sort_by=popularity.desc&vote_count.gte=${kind === "tv" ? 50 : 200}&vote_average.gte=6`;
  const [a, b] = await Promise.all([
    tmdbList(key, path, kind, 1, extra),
    tmdbList(key, path, kind, 2, extra),
  ]);
  const seen = new Set<number>();
  return [...a, ...b].filter((h) => !seen.has(h.tmdbId) && seen.add(h.tmdbId));
}

/** Live /discover for a streaming provider in a region (popularity-ranked). */
export async function tmdbDiscoverProvider(
  key: string,
  kind: "tv" | "movie",
  providerId: number,
  region: string,
): Promise<TmdbSearchHit[]> {
  const extra = `&with_watch_providers=${providerId}&watch_region=${region}&sort_by=popularity.desc&vote_count.gte=${kind === "tv" ? 30 : 100}`;
  const [a, b] = await Promise.all([
    tmdbList(key, `/discover/${kind}`, kind, 1, extra),
    tmdbList(key, `/discover/${kind}`, kind, 2, extra),
  ]);
  const seen = new Set<number>();
  return [...a, ...b].filter((h) => !seen.has(h.tmdbId) && seen.add(h.tmdbId));
}

/** TMDB "recommendations" for a title — the live fallback for "Shows/Movies like
 *  X" when our D1 genre-overlap query comes up empty (live-only or genre-less). */
export async function tmdbRecommendations(
  key: string,
  kind: "tv" | "movie",
  tmdbId: number,
): Promise<TmdbSearchHit[]> {
  return tmdbList(key, `/${kind}/${tmdbId}/recommendations`, kind);
}
/** This week's trending (tv|movie) with full title data — the trending rails. */
export async function tmdbTrendingList(key: string, kind: "tv" | "movie"): Promise<TmdbSearchHit[]> {
  return tmdbList(key, `/trending/${kind}/week`, kind);
}

export type TmdbUpcoming = {
  tmdbId: number;
  title: string;
  releaseDate: string;
  posterPath: string | null;
  popularity: number;
};
/** Upcoming US theatrical releases (2 pages), carrying TMDB popularity so the
 *  premieres hub can lead with the anticipated titles. Edge-cached 6h. */
export async function tmdbUpcomingMovies(key: string): Promise<TmdbUpcoming[]> {
  const cacheKey = new Request("https://edge-cache.tvnightly.com/upcoming/v1/us");
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const out: TmdbUpcoming[] = [];
      for (let p = 1; p <= 2; p++) {
        const live = await fetch(
          `https://api.themoviedb.org/3/movie/upcoming?api_key=${key}&region=US&page=${p}`,
          { headers: { accept: "application/json" } },
        );
        if (!live.ok) break;
        const data = (await live.json()) as { results?: Record<string, unknown>[] };
        for (const m of data.results ?? []) {
          if (!m.release_date) continue;
          out.push({
            tmdbId: m.id as number,
            title: m.title as string,
            releaseDate: m.release_date as string,
            posterPath: (m.poster_path as string) ?? null,
            popularity: Number(m.popularity) || 0,
          });
        }
      }
      res = new Response(JSON.stringify(out), {
        headers: { "content-type": "application/json", "Cache-Control": "public, max-age=21600" },
      });
      await cache.put(cacheKey, res.clone());
    }
    return (await res.json()) as TmdbUpcoming[];
  } catch {
    return [];
  }
}
// shared fetch+normalize for the single-media-type list endpoints (no media_type
// field — the endpoint dictates the kind), edge-cached so traffic never hits TMDB.
async function tmdbList(
  key: string,
  path: string,
  kind: "tv" | "movie",
  page = 1,
  extra = "",
): Promise<TmdbSearchHit[]> {
  const cacheKey = new Request(
    `https://edge-cache.tvnightly.com/list/v2${path}/${page}${encodeURIComponent(extra)}`,
  );
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3${path}?api_key=${key}&page=${page}${extra}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=21600");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    return (data.results ?? [])
      .filter((r) => r.poster_path || r.backdrop_path)
      .map((r) => ({
        tmdbId: r.id as number,
        kind,
        name: (kind === "tv" ? r.name : r.title) as string,
        year: String((r.first_air_date || r.release_date || "") as string).slice(0, 4) || null,
        posterPath: (r.poster_path as string) ?? null,
        rating:
          liveRating(r.vote_average, r.vote_count),
        overview: (r.overview as string) || null,
        popularity: Number(r.popularity) || 0,
        genreIds: (r.genre_ids as number[]) ?? [],
      }))
      .filter((r) => r.name);
  } catch {
    return [];
  }
}

/** Live streaming availability (flatrate) for a region — edge-cached 24h. */
export async function tmdbWatchProviders(
  key: string,
  kind: "tv" | "movie",
  tmdbId: number,
  region: string,
): Promise<string[]> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/watch/v1/${kind}/${tmdbId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/${kind}/${tmdbId}/watch/providers?api_key=${key}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=86400");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as {
      results?: Record<string, { flatrate?: { provider_name: string }[] }>;
    };
    return (data.results?.[region]?.flatrate ?? []).map((p) => p.provider_name);
  } catch {
    return [];
  }
}
