// Runtime TMDB lookups, edge-cached so the free tier never feels them.
// The mirror stays lean: these are presentation assets, not data.

type RawBundle = {
  backdrop_path?: string | null;
  poster_path?: string | null;
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

export async function tmdbBackdrop(
  key: string,
  tmdbId: number,
): Promise<{ x1: string; x2: string } | null> {
  const data = await showBundle(key, tmdbId);
  return data ? pickBackdrop(data) : null;
}

export type TmdbCastEntry = {
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
      name: p.name,
      profile_path: p.profile_path,
      character: p.character ?? null,
    }));
}

/** Movie hero backdrop, same selection rules, keyed on the IMDb id. */
export async function tmdbMovieBackdrop(
  key: string,
  imdbId: string,
): Promise<{ x1: string; x2: string } | null> {
  const data = await bundle(key, "movie", imdbId);
  return data ? pickBackdrop(data) : null;
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
