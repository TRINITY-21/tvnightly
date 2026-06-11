// Runtime TMDB lookups, edge-cached so the free tier never feels them.
// The mirror stays lean: these are presentation assets, not data.

export type TmdbMedia = {
  posters: string[]; // file_paths
  backdrops: string[];
  videos: { key: string; name: string; type: string; published: string | null }[]; // YouTube only
};

/** Posters, backdrops and YouTube videos for a show — one TMDB call via
 *  append_to_response, edge-cached for 7 days, fail-to-null. */
export async function tmdbMedia(key: string, tmdbId: number): Promise<TmdbMedia | null> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/media/${tmdbId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&append_to_response=images,videos&include_image_language=en,null`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as {
      images?: {
        posters?: { file_path: string; vote_count: number }[];
        backdrops?: { file_path: string; vote_count: number }[];
      };
      videos?: {
        results?: { key: string; name: string; site: string; type: string; official: boolean; published_at?: string }[];
      };
    };
    const byVotes = (arr?: { file_path: string; vote_count: number }[]) =>
      (arr ?? []).sort((a, b) => b.vote_count - a.vote_count).map((i) => i.file_path);
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
      posters: byVotes(data.images?.posters),
      backdrops: byVotes(data.images?.backdrops),
      videos,
    };
  } catch {
    return null;
  }
}

/** The show's real designed backdrop, edge-cached for 30 days.
 *  Returns both renditions: w1280 for 1x screens, the original (often 4K)
 *  for retina — a hero band of 1280 CSS px needs 2560 source px at DPR 2. */
export async function tmdbBackdrop(
  key: string,
  tmdbId: number,
): Promise<{ x1: string; x2: string } | null> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/backdrop/${tmdbId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}`, {
        headers: { accept: "application/json" },
      });
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=2592000");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { backdrop_path?: string | null };
    return data.backdrop_path
      ? {
          x1: `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`,
          x2: `https://image.tmdb.org/t/p/original${data.backdrop_path}`,
        }
      : null;
  } catch {
    return null;
  }
}
