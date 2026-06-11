// Runtime TMDB lookups, edge-cached so the free tier never feels them.
// The mirror stays lean: these are presentation assets, not data.

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
