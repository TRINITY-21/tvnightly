// Vertical trailer Shorts feed — trending/popular titles with YouTube trailers.
// Raw TMDB trailer lists are edge-cached; playable ordering is per-viewer.
import type { AppContext } from "../types";
import { byngeHandoffHrefAsync, tmdbImdbId } from "./bynge";
import { slugifyName } from "./format";
import {
  tmdbGenreLabelsFromIds,
  tmdbPopular,
  tmdbTrailerKeys,
  tmdbTrendingList,
  type TmdbSearchHit,
} from "./tmdb";
import { playableVideoList } from "./youtube";

export const SHORTS_FEED_LIMIT = 24;

export type TrailerShort = {
  id: string;
  kind: "tv" | "movie";
  title: string;
  year: number | null;
  rating: number | null;
  overview: string;
  poster: string | null;
  genreLabel: string;
  trailerKeys: string[];
  trailerName: string;
  detailHref: string;
  watchHref: string | null;
};

const FEED_CACHE_KEY = "https://edge-cache.tvnightly.com/trailer-shorts-feed-v1";
const FEED_CACHE_TTL = 3600;

type RawShort = {
  hit: TmdbSearchHit;
  trailers: { key: string; name: string; type: string }[];
};

const weaveHits = (...lists: TmdbSearchHit[][]): TmdbSearchHit[] => {
  const seen = new Set<string>();
  const tv: TmdbSearchHit[] = [];
  const mv: TmdbSearchHit[] = [];
  for (const list of lists) {
    for (const h of list) {
      const k = `${h.kind}:${h.tmdbId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      (h.kind === "tv" ? tv : mv).push(h);
    }
  }
  const out: TmdbSearchHit[] = [];
  for (let i = 0; i < Math.max(tv.length, mv.length); i++) {
    if (tv[i]) out.push(tv[i]);
    if (mv[i]) out.push(mv[i]);
  }
  return out;
};

async function loadRawShorts(key: string): Promise<RawShort[]> {
  const cache = caches.default;
  const cacheKey = new Request(FEED_CACHE_KEY);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return (await hit.json()) as RawShort[];
  } catch {
    /* cache miss */
  }

  const [trendTv, trendMv, popTv, popMv] = await Promise.all([
    tmdbTrendingList(key, "tv", "day"),
    tmdbTrendingList(key, "movie", "day"),
    tmdbPopular(key, "tv"),
    tmdbPopular(key, "movie"),
  ]);
  const hits = weaveHits(trendTv, trendMv, popTv, popMv).slice(0, SHORTS_FEED_LIMIT * 2);

  const raw = (
    await Promise.all(
      hits.map(async (hit) => {
        const trailers = (await tmdbTrailerKeys(key, hit.kind, hit.tmdbId)).filter(
          (t) => t.type === "Trailer" || t.type === "Teaser",
        );
        return trailers.length ? { hit, trailers } : null;
      }),
    )
  ).filter((x): x is RawShort => x !== null);

  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(raw), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${FEED_CACHE_TTL}`,
        },
      }),
    );
  } catch {
    /* best-effort */
  }
  return raw;
}

/** Build the viewer-specific Shorts feed (playable trailers first). */
export async function fetchTrailerShortsFeed(c: AppContext): Promise<TrailerShort[]> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return [];

  const raw = await loadRawShorts(key);
  const items: TrailerShort[] = [];

  for (const { hit, trailers } of raw) {
    if (items.length >= SHORTS_FEED_LIMIT) break;
    const ordered = await playableVideoList(c, trailers);
    const keys = ordered.map((t) => t.key).filter((k) => /^[\w-]{11}$/.test(k));
    if (!keys.length) continue;

    const slug = slugifyName(hit.name);
    const detailHref = hit.kind === "movie" ? `/movie/${slug}` : `/show/${slug}`;
    const labels = tmdbGenreLabelsFromIds(hit.kind, hit.genreIds ?? []);
    const genreLabel = labels[0] ?? (hit.kind === "movie" ? "Movie" : "TV");
    const yearNum = hit.year ? Number(hit.year) : null;
    const poster = hit.posterPath ? `https://image.tmdb.org/t/p/w342${hit.posterPath}` : null;
    const imdbId = await tmdbImdbId(key, hit.kind, hit.tmdbId);
    const watchHref = await byngeHandoffHrefAsync(
      hit.kind,
      { imdbId },
      { title: hit.name, poster },
    );

    items.push({
      id: `${hit.kind}-${hit.tmdbId}`,
      kind: hit.kind,
      title: hit.name,
      year: yearNum && !Number.isNaN(yearNum) ? yearNum : null,
      rating: hit.rating,
      overview: (hit.overview ?? "").trim().slice(0, 200),
      poster,
      genreLabel,
      trailerKeys: keys,
      trailerName: ordered[0].name,
      detailHref,
      watchHref,
    });
  }

  return items;
}
