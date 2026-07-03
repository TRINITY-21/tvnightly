// Bynge.app watch handoff — TVmaze numeric id for shows, IMDb tt-id for movies.
// Bynge's show URLs use the TVmaze catalog key (e.g. /show/91917/watch), not
// TMDB or the tt… IMDb slug. tvnightly routes through /play/* for a branded
// transition screen before the player opens.

const BYNGE_ORIGIN = "https://bynge.app";

export type ByngeIds = {
  /** TV shows — Bynge's catalog key (same as shows.id / TVmaze id in our mirror). */
  tvmazeId?: number | null;
  /** Movies — IMDb tt… id. */
  imdbId?: string | null;
};

const normImdb = (id: string | null | undefined): string | null => {
  const raw = (id ?? "").trim();
  if (!raw) return null;
  const withTt = raw.startsWith("tt") ? raw : `tt${raw}`;
  return /^tt\d+$/i.test(withTt) ? withTt : null;
};

/** Resolve a TVmaze show id when we only have IMDb (live-TMDB pages). */
export async function resolveTvmazeShowId(opts: {
  tvmazeId?: number | null;
  imdbId?: string | null;
}): Promise<number | null> {
  if (opts.tvmazeId && opts.tvmazeId > 0) return opts.tvmazeId;
  const imdb = normImdb(opts.imdbId);
  if (!imdb) return null;

  const cacheKey = new Request(`https://edge-cache.tvnightly.com/tvmaze-lookup/v1/${imdb}`);
  const cache = caches.default;
  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const id = Number(await hit.text());
      return id > 0 ? id : null;
    }
  } catch {
    /* miss */
  }

  let tvmazeId: number | null = null;
  try {
    const res = await fetch(`https://api.tvmaze.com/lookup/shows?imdb=${imdb}`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { id?: number };
      tvmazeId = typeof data?.id === "number" && data.id > 0 ? data.id : null;
    }
  } catch {
    tvmazeId = null;
  }

  try {
    await cache.put(
      cacheKey,
      new Response(String(tvmazeId ?? 0), {
        headers: { "Cache-Control": "public, max-age=604800" },
      }),
    );
  } catch {
    /* best-effort */
  }
  return tvmazeId;
}

/** Direct Bynge player URL (skip our handoff). */
export function byngeDirectUrl(kind: "tv" | "movie", ids: ByngeIds): string | null {
  if (kind === "tv") {
    const tvmaze = ids.tvmazeId && ids.tvmazeId > 0 ? ids.tvmazeId : null;
    return tvmaze ? `${BYNGE_ORIGIN}/show/${tvmaze}/watch` : null;
  }
  const imdb = normImdb(ids.imdbId);
  return imdb ? `${BYNGE_ORIGIN}/movie/${imdb}/watch` : null;
}

/** tvnightly handoff path segment id (numeric TVmaze for TV, tt… IMDb for movies). */
export function byngePlayId(kind: "tv" | "movie", ids: ByngeIds): string | null {
  if (kind === "tv") {
    return ids.tvmazeId && ids.tvmazeId > 0 ? String(ids.tvmazeId) : null;
  }
  return normImdb(ids.imdbId);
}

export function byngeHandoffHref(
  kind: "tv" | "movie",
  ids: ByngeIds,
  meta?: { title?: string; poster?: string | null },
): string | null {
  const id = byngePlayId(kind, ids);
  if (!id) return null;
  const segment = kind === "movie" ? "movie" : "show";
  const q = new URLSearchParams();
  if (meta?.title) q.set("t", meta.title);
  if (meta?.poster) q.set("p", meta.poster);
  const qs = q.toString();
  return qs ? `/play/${segment}/${id}?${qs}` : `/play/${segment}/${id}`;
}

/** IMDb tt-id for a TMDB catalog row — used when only tmdbId is known (Shorts). */
export async function tmdbImdbId(
  apiKey: string,
  kind: "tv" | "movie",
  tmdbId: number,
): Promise<string | null> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/tmdb-imdb/v1/${kind}/${tmdbId}`);
  const cache = caches.default;
  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const raw = (await hit.text()).trim();
      return raw && raw !== "0" ? raw : null;
    }
  } catch {
    /* miss */
  }

  let imdb: string | null = null;
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/${kind}/${tmdbId}?api_key=${apiKey}`,
      { headers: { accept: "application/json" } },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        imdb_id?: string;
        external_ids?: { imdb_id?: string };
      };
      imdb = normImdb(data.imdb_id ?? data.external_ids?.imdb_id ?? null);
    }
  } catch {
    imdb = null;
  }

  try {
    await cache.put(
      cacheKey,
      new Response(imdb ?? "0", { headers: { "Cache-Control": "public, max-age=604800" } }),
    );
  } catch {
    /* best-effort */
  }
  return imdb;
}

export async function byngeHandoffHrefAsync(
  kind: "tv" | "movie",
  ids: ByngeIds,
  meta?: { title?: string; poster?: string | null },
): Promise<string | null> {
  if (kind === "tv" && !ids.tvmazeId) {
    const tvmazeId = await resolveTvmazeShowId(ids);
    if (!tvmazeId) return null;
    return byngeHandoffHref(kind, { ...ids, tvmazeId }, meta);
  }
  return byngeHandoffHref(kind, ids, meta);
}

export function byngeTargetFromPlay(segment: "movie" | "show", id: string): string | null {
  if (segment === "show") {
    if (!/^\d+$/.test(id)) return null;
    return `${BYNGE_ORIGIN}/show/${id}/watch`;
  }
  if (!/^tt\d+$/i.test(id)) return null;
  return `${BYNGE_ORIGIN}/movie/${id}/watch`;
}
