// Runtime TMDB lookups, edge-cached so the free tier never feels them.
// The mirror stays lean: these are presentation assets, not data.

type RawBundle = {
  backdrop_path?: string | null;
  poster_path?: string | null;
  original_title?: string;
  original_language?: string;
  production_companies?: { id: number; name: string }[];
  created_by?: { id: number; name: string }[];
  tagline?: string | null;
  images?: {
    posters?: { file_path: string; iso_639_1: string | null; vote_count: number }[];
    backdrops?: { file_path: string; iso_639_1: string | null; vote_count: number }[];
    logos?: { file_path: string; iso_639_1: string | null; vote_count: number }[];
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

/** The single best YouTube trailer for a title — TV by tmdb id, movie by tmdb
 *  id or IMDb tt-id (TMDB accepts either in the path). Rides the same 7-day
 *  edge-cached bundle as the media pages, so the homepage card play buttons
 *  (lazy, on click) and the Latest Trailers rail cost nothing on a cache hit.
 *  Prefers an official Trailer, then a Teaser, then any clip. */
export async function tmdbTrailer(
  key: string,
  kind: "tv" | "movie",
  id: number | string,
): Promise<{ key: string; name: string } | null> {
  const data = await bundle(key, kind, id);
  if (!data) return null;
  const videos = mapMedia(data).videos;
  const v =
    videos.find((x) => x.type === "Trailer") ??
    videos.find((x) => x.type === "Teaser") ??
    videos[0] ??
    null;
  return v ? { key: v.key, name: v.name } : null;
}

/** A title's YouTube trailer/teaser candidates in preference order (official
 *  Trailer first) — so a caller can fall through to one that actually plays for
 *  the viewer when the top pick is region-blocked. */
export async function tmdbTrailerKeys(
  key: string,
  kind: "tv" | "movie",
  id: number | string,
): Promise<{ key: string; name: string; type: string }[]> {
  const data = await bundle(key, kind, id);
  if (!data) return [];
  return mapMedia(data)
    .videos.filter((v) => v.type === "Trailer" || v.type === "Teaser")
    .map((v) => ({ key: v.key, name: v.name, type: v.type }));
}

/** Best YouTube trailer for a movie bundle id — same pick as tmdbTrailer, with a
 *  media-page fallback when the cached bundle is video-less. */
export async function movieSpotlightTrailer(
  key: string,
  bundleId: string | number,
): Promise<{ key: string; name: string } | null> {
  if (!bundleId) return null;
  const picked = await tmdbTrailer(key, "movie", bundleId);
  if (picked) return picked;
  const media = await tmdbMovieMedia(key, String(bundleId));
  const v =
    media?.videos.find((x) => x.type === "Trailer") ??
    media?.videos.find((x) => x.type === "Teaser") ??
    media?.videos[0] ??
    null;
  return v ? { key: v.key, name: v.name } : null;
}

/** The hero backdrop. NOT TMDB's designated backdrop_path — that's often a
 *  soft frame grab. We take the community's top-voted backdrop, preferring
 *  textless art (iso null) so the still never carries a baked-in title
 *  under our own h1; backdrop_path is only the last resort.
 *  Returns two BOUNDED renditions: w780 for 1x screens, w1280 for retina. We
 *  deliberately avoid TMDB's `original` (often a 2–6 MB 4K frame) here — this is
 *  the hero LCP image, and on a phone (high-DPR, the common case) the original
 *  was multi-megabytes for a band no wider than ~1200 device px. w1280 is the
 *  largest fixed TMDB backdrop size and is plenty for any hero band. */
const pickBackdrop = (data: RawBundle): { x1: string; x2: string } | null => {
  const ranked = byVotes(data.images?.backdrops);
  const pick =
    ranked.find((i) => i.iso_639_1 === null)?.file_path ??
    ranked[0]?.file_path ??
    data.backdrop_path;
  return pick
    ? {
        x1: `https://image.tmdb.org/t/p/w780${pick}`,
        x2: `https://image.tmdb.org/t/p/w1280${pick}`,
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
    x1: `https://image.tmdb.org/t/p/w780${p}`,
    x2: `https://image.tmdb.org/t/p/w1280${p}`,
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

// The show's transparent title logo (PNG) for overlaying on art — prefer the
// English logo, then a language-neutral one, then whatever's top-voted. w500
// keeps the alpha channel and is sharp enough for a 540px column.
const pickLogo = (data: RawBundle): string | null => {
  const ranked = byVotes(data.images?.logos);
  const pick =
    ranked.find((i) => i.iso_639_1 === "en")?.file_path ??
    ranked.find((i) => i.iso_639_1 === null)?.file_path ??
    ranked[0]?.file_path;
  return pick ? `https://image.tmdb.org/t/p/w500${pick}` : null;
};

export async function tmdbLogo(key: string, tmdbId: number): Promise<string | null> {
  const data = await showBundle(key, tmdbId);
  return data ? pickLogo(data) : null;
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

/** Key crew for a series — directors and writers from the same cached bundle. */
export async function tmdbShowCrew(
  key: string,
  tmdbId: number,
  limit = 12,
): Promise<TmdbCrewEntry[]> {
  const data = await bundle(key, "tv", tmdbId);
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

/** One-line tagline from the cached TMDB bundle. */
export async function tmdbTagline(
  key: string,
  kind: "tv" | "movie",
  id: number | string,
): Promise<string | null> {
  const data = await bundle(key, kind, id);
  const t = data?.tagline?.trim();
  return t || null;
}

/** Movie hero backdrop, same selection rules, keyed on the IMDb id. */
export async function tmdbMovieBackdrop(
  key: string,
  imdbId: string,
): Promise<{ x1: string; x2: string } | null> {
  const data = await bundle(key, "movie", imdbId);
  return data ? pickBackdrop(data) : null;
}

/** IMDb bridge for a TMDB film — used when a live chart row only has tmdb_id. */
export async function tmdbMovieExternalIds(
  key: string,
  tmdbId: number,
): Promise<{ imdb_id: string | null } | null> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/movie-ext/v1/${tmdbId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${key}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { imdb_id?: string | null };
    return { imdb_id: data.imdb_id ?? null };
  } catch {
    return null;
  }
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

export type TmdbTaggedStill = {
  filePath: string;
  mediaType: "tv" | "movie";
  mediaId: number;
  mediaTitle: string;
  voteCount: number;
  imageType: string;
};

/** Profile headshots from TMDB's person images collection. */
export type TmdbPersonProfile = {
  filePath: string;
  voteCount: number;
};

export async function tmdbPersonProfileImages(
  key: string,
  personId: number,
): Promise<TmdbPersonProfile[]> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/person-images/v1/${personId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/person/${personId}/images?api_key=${key}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as {
      profiles?: { file_path?: string; vote_count?: number }[];
    };
    return (data.profiles ?? [])
      .map((row) => {
        const filePath = row.file_path;
        if (!filePath) return null;
        return {
          filePath,
          voteCount: Number(row.vote_count) || 0,
        } satisfies TmdbPersonProfile;
      })
      .filter((x): x is TmdbPersonProfile => x != null)
      .sort((a, b) => b.voteCount - a.voteCount);
  } catch {
    return [];
  }
}

/** Stills where TMDB has tagged this person in-frame — the IMDb highlights row. */
export async function tmdbPersonTaggedStills(
  key: string,
  personId: number,
): Promise<TmdbTaggedStill[]> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/person-tagged/v2/${personId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/person/${personId}/tagged_images?api_key=${key}&page=1`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    return (data.results ?? [])
      .map((row) => {
        const media = row.media as Record<string, unknown> | undefined;
        const filePath = row.file_path as string | undefined;
        if (!filePath || !media) return null;

        const rowType = row.media_type as string | undefined;
        const nestedType = media.media_type as string | undefined;
        let mediaType: "tv" | "movie" | null = null;
        let mediaId: number | undefined;

        // Episode stills tag the parent series — row.media_type is "episode".
        if (rowType === "episode" || nestedType === "tv_episode") {
          mediaType = "tv";
          mediaId = (media.show_id as number) ?? (media.id as number);
        } else {
          const raw =
            rowType === "tv" || rowType === "movie"
              ? rowType
              : nestedType === "tv" || nestedType === "movie"
                ? nestedType
                : media.name && !media.title
                  ? "tv"
                  : media.title
                    ? "movie"
                    : null;
          if (raw === "tv" || raw === "movie") {
            mediaType = raw;
            mediaId = media.id as number;
          }
        }

        if (!mediaType || !mediaId) return null;
        const mediaTitle = String(
          mediaType === "tv" ? media.name ?? media.title : media.title ?? media.name ?? "",
        ).trim();
        if (!mediaTitle) return null;
        return {
          filePath,
          mediaType,
          mediaId,
          mediaTitle,
          voteCount: Number(row.vote_count) || 0,
          imageType: (row.image_type as string) ?? "still",
        } satisfies TmdbTaggedStill;
      })
      .filter((x): x is TmdbTaggedStill => x != null)
      .filter((x) => x.imageType === "still")
      .sort((a, b) => b.voteCount - a.voteCount);
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

/** Canonical genre labels for TMDB genre ids — matches TVmaze-style names in D1. */
const TMDB_TV_GENRE_LABELS: Record<number, string> = {
  10759: "Action",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Science-Fiction",
  10766: "Soap",
  10767: "Talk",
  10768: "War",
  37: "Western",
};
const TMDB_MOVIE_GENRE_LABELS: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science-Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

export function tmdbGenreLabelsFromIds(kind: "tv" | "movie", ids: number[]): string[] {
  const map = kind === "tv" ? TMDB_TV_GENRE_LABELS : TMDB_MOVIE_GENRE_LABELS;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const label = map[id];
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

export type TmdbDiscoverSort = "rated" | "popular" | "new";

export function tmdbDiscoverSortBy(kind: "tv" | "movie", sort: TmdbDiscoverSort): string {
  if (sort === "new") {
    return kind === "tv" ? "first_air_date.desc" : "primary_release_date.desc";
  }
  if (sort === "popular") return "popularity.desc";
  return "vote_average.desc";
}

export type TmdbChartDiscoverOpts = {
  kind: "tv" | "movie";
  sort?: TmdbDiscoverSort;
  genreId?: number | null;
  year?: number | null;
  decade?: { start: number; end: number } | null;
  pages?: number;
};

const TMDB_CHART_PAGES_MAX = 25;
// When a quality-thresholded discover pass yields fewer than this, top it up with
// a lenient (low-vote-floor) pass so niche genre × year × network combos still
// fill out a chart. The quality titles already fetched stay ranked first.
const TMDB_FILL_TARGET = 40;
const TMDB_FILL_PAGES = 10;

/** Fetch `pages` of a /discover query in parallel and flatten (deduped by caller). */
async function discoverPages(
  key: string,
  kind: "tv" | "movie",
  pages: number,
  extra: string,
): Promise<TmdbSearchHit[]> {
  const batches = await Promise.all(
    Array.from({ length: pages }, (_, i) => tmdbList(key, `/discover/${kind}`, kind, i + 1, extra)),
  );
  return batches.flat();
}

/** Dedupe hits by tmdbId, preserving first-seen order. */
function dedupeHits(hits: TmdbSearchHit[]): TmdbSearchHit[] {
  const seen = new Set<number>();
  return hits.filter((h) => !seen.has(h.tmdbId) && seen.add(h.tmdbId));
}

/**
 * Two-pass /discover: a quality pass (real vote floor + optional rating floor)
 * ranked first, then — only when that comes up short — a lenient pass on the same
 * filters with a low vote floor to fill the tail. Guarantees breadth on sparse
 * combos without letting one-vote titles outrank the real catalogue.
 */
async function discoverWithFill(
  key: string,
  kind: "tv" | "movie",
  pages: number,
  base: string, // sort + genre/year/decade/provider filters, no vote/rating gate
  qualityVotes: number,
  ratingFloor: number | null,
  lenientVotes: number,
): Promise<TmdbSearchHit[]> {
  const ratingGate = ratingFloor != null ? `&vote_average.gte=${ratingFloor}` : "";
  const primary = dedupeHits(
    await discoverPages(key, kind, pages, `${base}&vote_count.gte=${qualityVotes}${ratingGate}`),
  );
  if (primary.length >= TMDB_FILL_TARGET) return primary;
  const fill = await discoverPages(
    key,
    kind,
    Math.min(pages, TMDB_FILL_PAGES),
    `${base}&vote_count.gte=${lenientVotes}`,
  );
  return dedupeHits([...primary, ...fill]);
}

/** Live /discover for chart lists — TMDB is the source of truth for catalog breadth. */
export async function tmdbDiscoverChart(
  key: string,
  opts: TmdbChartDiscoverOpts,
): Promise<TmdbSearchHit[]> {
  const { kind, sort = "rated", genreId, year, decade } = opts;
  const pages = Math.max(1, Math.min(opts.pages ?? TMDB_CHART_PAGES_MAX, TMDB_CHART_PAGES_MAX));
  const sortBy = tmdbDiscoverSortBy(kind, sort);
  let base = `&sort_by=${sortBy}`;
  if (genreId) base += `&with_genres=${genreId}`;
  if (year != null) {
    base += kind === "tv" ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`;
  }
  if (decade) {
    base +=
      kind === "tv"
        ? `&first_air_date.gte=${decade.start}-01-01&first_air_date.lte=${decade.end}-12-31`
        : `&primary_release_date.gte=${decade.start}-01-01&primary_release_date.lte=${decade.end}-12-31`;
  }
  return discoverWithFill(key, kind, pages, base, kind === "tv" ? 30 : 200, 5, kind === "tv" ? 3 : 15);
}

/** Live /discover for a genre (popularity-ranked, rated only). */
export async function tmdbDiscoverGenre(
  key: string,
  kind: "tv" | "movie",
  genreId: number,
  pages = 2,
  year?: number | null,
): Promise<TmdbSearchHit[]> {
  return tmdbDiscoverChart(key, { kind, genreId, year, pages, sort: "popular" });
}

/** Live /discover for a streaming provider in a region (popularity-ranked). */
export async function tmdbDiscoverProvider(
  key: string,
  kind: "tv" | "movie",
  providerId: number,
  region: string,
  pages = 2,
  opts?: {
    genreId?: number | null;
    year?: number | null;
    sort?: TmdbDiscoverSort;
  },
): Promise<TmdbSearchHit[]> {
  const sort = opts?.sort ?? "popular";
  const sortBy = tmdbDiscoverSortBy(kind, sort);
  let base = `&with_watch_providers=${providerId}&watch_region=${region}&sort_by=${sortBy}`;
  if (opts?.genreId) base += `&with_genres=${opts.genreId}`;
  if (opts?.year != null) {
    base += kind === "tv" ? `&first_air_date_year=${opts.year}` : `&primary_release_year=${opts.year}`;
  }
  const n = Math.max(1, Math.min(pages, TMDB_CHART_PAGES_MAX));
  // Provider catalogues are region-scoped and thin out fast on genre/year filters;
  // no rating floor here (a provider's catalogue is the signal), just vote floors.
  return discoverWithFill(key, kind, n, base, kind === "tv" ? 30 : 100, null, kind === "tv" ? 3 : 10);
}

/** Live /discover by TMDB network (with_networks) — a broadcast/cable channel's
 *  own catalogue. TV only (TMDB has no movie networks); same adaptive fill as the
 *  provider charts, so a channel that isn't a streaming watch-provider (HBO, The
 *  CW, BBC One…) still returns a full chart. */
export async function tmdbDiscoverNetwork(
  key: string,
  networkId: number,
  pages = 2,
  opts?: { genreId?: number | null; year?: number | null; sort?: TmdbDiscoverSort },
): Promise<TmdbSearchHit[]> {
  const sort = opts?.sort ?? "popular";
  const sortBy = tmdbDiscoverSortBy("tv", sort);
  let base = `&with_networks=${networkId}&sort_by=${sortBy}`;
  if (opts?.genreId) base += `&with_genres=${opts.genreId}`;
  if (opts?.year != null) base += `&first_air_date_year=${opts.year}`;
  const n = Math.max(1, Math.min(pages, TMDB_CHART_PAGES_MAX));
  return discoverWithFill(key, "tv", n, base, 30, null, 3);
}

/** A TMDB show's networks (id + name) — a light detail fetch, edge-cached a week.
 *  Used to resolve a network name to its TMDB id when it isn't in the curated map
 *  (so any channel with a sample show can drive a with_networks chart). */
export async function tmdbShowNetworks(
  key: string,
  tmdbId: number,
): Promise<{ id: number; name: string }[]> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/tv-networks/${tmdbId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}`, {
        headers: { accept: "application/json" },
      });
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { networks?: { id: number; name: string }[] };
    return data.networks ?? [];
  } catch {
    return [];
  }
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
/** Trending (tv|movie) with full title data — the trending rails. `window`
 *  defaults to "week"; the homepage uses "day" for faster day-to-day movement. */
export async function tmdbTrendingList(
  key: string,
  kind: "tv" | "movie",
  window: "day" | "week" = "week",
): Promise<TmdbSearchHit[]> {
  return tmdbList(key, `/trending/${kind}/${window}`, kind);
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
