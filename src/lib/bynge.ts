// Bynge.app watch handoff — TMDB id for movies, IMDb tt-id for shows (Bynge's
// catalog keys). tvnightly routes through /play/* for a branded transition screen.

const BYNGE_ORIGIN = "https://bynge.app";

export type ByngeIds = { tmdbId?: number | null; imdbId?: string | null };

const normImdb = (id: string | null | undefined): string | null => {
  const raw = (id ?? "").trim();
  if (!raw) return null;
  const withTt = raw.startsWith("tt") ? raw : `tt${raw}`;
  return /^tt\d+$/i.test(withTt) ? withTt : null;
};

/** Direct Bynge player URL (skip our handoff). */
export function byngeDirectUrl(kind: "tv" | "movie", ids: ByngeIds): string | null {
  const imdb = normImdb(ids.imdbId);
  const tmdb = ids.tmdbId && ids.tmdbId > 0 ? ids.tmdbId : null;

  if (kind === "movie") {
    if (tmdb) return `${BYNGE_ORIGIN}/movie/${tmdb}/watch`;
    if (imdb) return `${BYNGE_ORIGIN}/movie/${imdb}/watch`;
    return null;
  }
  if (imdb) return `${BYNGE_ORIGIN}/show/${imdb}/watch`;
  if (tmdb) return `${BYNGE_ORIGIN}/show/${tmdb}/watch`;
  return null;
}

/** tvnightly handoff path segment id (numeric TMDB or tt… IMDb). */
export function byngePlayId(kind: "tv" | "movie", ids: ByngeIds): string | null {
  const imdb = normImdb(ids.imdbId);
  const tmdb = ids.tmdbId && ids.tmdbId > 0 ? String(ids.tmdbId) : null;

  if (kind === "movie") return tmdb ?? imdb;
  return imdb ?? tmdb;
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

export function byngeTargetFromPlay(segment: "movie" | "show", id: string): string | null {
  if (!/^\d+$/.test(id) && !/^tt\d+$/i.test(id)) return null;
  const byngeSegment = segment === "movie" ? "movie" : "show";
  return `${BYNGE_ORIGIN}/${byngeSegment}/${id}/watch`;
}
