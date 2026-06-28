// Region-aware trailer playability via the YouTube Data API.
//
// A YouTube embed shows "Video unavailable — not available in your country" when
// a video is region-blocked or non-embeddable. TMDB's region tag, the "official"
// flag, and YouTube oEmbed all FAIL to detect this (a US-tagged official trailer
// can still be geo-blocked). The Data API does: videos.list returns
// status.embeddable + contentDetails.regionRestriction. Cloudflare gives us the
// viewer's country (cf-ipcountry), so we only ever surface a trailer that
// actually plays — otherwise the caller shows the show/movie backdrop.
//
// No GCP_API_KEY set -> degrade gracefully to "best available trailer".
import type { AppContext } from "../types";
import { tmdbTrailerKeys } from "./tmdb";

// The subset of YouTube video ids that are embeddable, public and playable in
// `country`. One videos.list call per 50 ids; edge-cached. API/quota errors are
// treated as "unknown" (not blocking) so a trailer never silently disappears.
export async function youtubePlayable(gcpKey: string, ids: string[], country: string): Promise<Set<string>> {
  const ok = new Set<string>();
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!gcpKey || !uniq.length) return ok;
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails` +
      `&id=${batch.join(",")}&key=${gcpKey}`;
    let data: { items?: any[] } | null = null;
    try {
      const r = await fetch(url, { cf: { cacheTtl: 21600, cacheEverything: true } } as RequestInit);
      if (!r.ok) continue; // quota / transient -> don't block (unknown = allow downstream)
      data = await r.json();
    } catch {
      continue;
    }
    for (const it of data?.items ?? []) {
      const s = it.status ?? {};
      if (s.embeddable === false) continue;
      if (s.privacyStatus && s.privacyStatus !== "public") continue;
      const rr = it.contentDetails?.regionRestriction ?? {};
      if (Array.isArray(rr.blocked) && rr.blocked.includes(country)) continue;
      if (Array.isArray(rr.allowed) && !rr.allowed.includes(country)) continue;
      ok.add(it.id);
    }
  }
  return ok;
}

// Viewer's country. Production: Cloudflare's per-request cf-ipcountry header.
// Dev (no cf-ipcountry): the worker runs on your Mac, so its own egress IP IS
// your location — resolve it once via Cloudflare's trace. A ?cc= query overrides
// either for testing. This is what makes region-blocking match what YOU see.
let DEV_CC: string | null = null;
async function resolveCountry(c: AppContext): Promise<string> {
  const q = c.req.query("cc");
  if (q) return q.toUpperCase();
  const cf = c.req.header("cf-ipcountry");
  if (cf && cf !== "XX" && cf !== "T1") return cf.toUpperCase();
  if (DEV_CC) return DEV_CC;
  try {
    const t = await (await fetch("https://www.cloudflare.com/cdn-cgi/trace")).text();
    DEV_CC = (t.match(/^loc=([A-Z]{2})/m)?.[1] ?? "US").toUpperCase();
  } catch {
    DEV_CC = "US";
  }
  return DEV_CC;
}

// Reorder candidates so server-confirmed-playable ones come FIRST, the rest
// after (original order preserved). The client player then walks the list and
// advances past any that still won't play, so even with no GCP key (dev) or a
// wrong country guess we land on a playable trailer — server ordering is just an
// optimization that avoids an error-flash on the first pick.
async function orderByPlayable<T extends { key: string }>(c: AppContext, cands: T[]): Promise<T[]> {
  if (cands.length <= 1) return cands;
  const gcp = c.env.GCP_API_KEY;
  if (!gcp) return cands; // no signal -> keep order, let the client fall through
  const ok = await youtubePlayable(gcp, cands.map((v) => v.key), await resolveCountry(c));
  if (!ok.size) return cands; // API quota/error -> don't reshuffle
  return [...cands.filter((v) => ok.has(v.key)), ...cands.filter((v) => !ok.has(v.key))];
}

/** ORDERED trailer candidates for a viewer: server-confirmed-playable first,
 *  then the rest (newest-first). The hero player walks this list, so a blocked
 *  trailer is skipped for the next one instead of dead-ending. main = [0]. */
export async function playableTrailerList(
  c: AppContext,
  kind: "tv" | "movie",
  id: number | string,
): Promise<{ key: string; name: string; type: string }[]> {
  const tmdbKey = c.env.TMDB_API_KEY;
  if (!tmdbKey) return [];
  return orderByPlayable(c, await tmdbTrailerKeys(tmdbKey, kind, id));
}

/** Same, from an already-fetched bundle video list — returns the ORIGINAL
 *  elements (callers keep extra fields), Trailer/Teaser only, playable-first. */
export async function playableVideoList<T extends { key: string; type?: string }>(
  c: AppContext,
  videos: T[],
): Promise<T[]> {
  const cands = videos.filter((v) => !v.type || v.type === "Trailer" || v.type === "Teaser");
  return orderByPlayable(c, cands);
}

/** The single best trailer that PLAYS for this viewer, or null (backdrop). The
 *  [0] of the ordered list — kept for callers that only embed one (e.g. the
 *  /api/trailer lazy-swap and poster play-discs). */
export async function playableTrailer(
  c: AppContext,
  kind: "tv" | "movie",
  id: number | string,
): Promise<{ key: string; name: string; type: string } | null> {
  return (await playableTrailerList(c, kind, id))[0] ?? null;
}

/** Single best trailer/teaser from a bundle video list, or null. */
export async function playableFromVideos<T extends { key: string; type?: string }>(
  c: AppContext,
  videos: T[],
): Promise<T | null> {
  return (await playableVideoList(c, videos))[0] ?? null;
}
