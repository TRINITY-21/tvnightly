// The marketing studio's data layer: surface "post-worthy moments" from the
// site's own signals (trending, tonight's schedule, renewals/premieres, instant-
// classic episodes, new-on-streaming) and turn each into a ready-to-post package
// — a branded card (see buildPromoCard) + platform captions.
import type { AppContext } from "../types";
import { origin } from "./seo";
import { slugifyName } from "./format";
import { tmdbTrendingList } from "./tmdb";
import { liveTonight } from "./schedule-live";

const tmdbImg = (path: string | null | undefined, size = "w342") =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

const pad2 = (n: number | null) => String(n ?? 0).padStart(2, "0");

export type PromoTheme =
  | "trending"
  | "tonight"
  | "renewed"
  | "premiere"
  | "classic"
  | "streaming"
  | "top";

export interface PromoMoment {
  id: string; // stable-ish key for the UI
  theme: PromoTheme;
  kicker: string; // the amber badge on the card
  tag: string; // section label in the studio UI
  title: string;
  rating: number | null;
  note: string | null; // the hook line on the card
  meta: string | null; // genres · year
  kind: "tv" | "movie";
  tmdbId: number | null; // for the card backdrop
  posterUrl: string | null;
  path: string; // public path → the share link
}

const parseGenres = (json: string | null): string[] => {
  if (!json) return [];
  try {
    return JSON.parse(json) as string[];
  } catch {
    return [];
  }
};

// run a D1 query, returning its rows or [] if the table is empty / the call fails
async function safeAll<R>(p: Promise<{ results: R[] }>): Promise<R[]> {
  try {
    return (await p).results;
  } catch {
    return [];
  }
}

/** Gather every post-worthy moment we can, newest/hottest first, deduped by
 *  destination. Each source is best-effort — an empty or failing one just
 *  contributes nothing (the event tables fill in over time as the crons run). */
export async function getPromoMoments(c: AppContext): Promise<PromoMoment[]> {
  const key = c.env.TMDB_API_KEY;
  const db = c.env.DB;
  const out: PromoMoment[] = [];

  const settle = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch {
      return fallback;
    }
  };

  // 1. Trending this week (live TMDB) — always available
  if (key) {
    const [tv, movies] = await Promise.all([
      settle(tmdbTrendingList(key, "tv"), []),
      settle(tmdbTrendingList(key, "movie"), []),
    ]);
    for (const h of tv.slice(0, 5)) {
      out.push({
        id: `trend-tv-${h.tmdbId}`,
        theme: "trending",
        kicker: "Trending now",
        tag: "Trending",
        title: h.name,
        rating: h.rating,
        note: "Everyone's watching this week",
        meta: h.year,
        kind: "tv",
        tmdbId: h.tmdbId,
        posterUrl: tmdbImg(h.posterPath),
        path: `/show/${slugifyName(h.name)}`,
      });
    }
    for (const h of movies.slice(0, 4)) {
      out.push({
        id: `trend-mv-${h.tmdbId}`,
        theme: "trending",
        kicker: "Trending now",
        tag: "Trending",
        title: h.name,
        rating: h.rating,
        note: "The film everyone's talking about",
        meta: h.year,
        kind: "movie",
        tmdbId: h.tmdbId,
        posterUrl: tmdbImg(h.posterPath),
        path: `/movie/${slugifyName(h.name)}`,
      });
    }
  }

  // 2. On tonight (live TVmaze schedule) — enrich with D1's tmdb_id + poster so
  // the card gets a real backdrop and a reliable TMDB poster (the raw TVmaze
  // original sometimes fails to inline → an empty card)
  const tonight = (await settle(liveTonight(c), [])).slice(0, 3);
  const tslugs = tonight.map((r) => r.show_slug);
  const enrich = new Map<string, { tmdb_id: number | null; poster_url: string | null }>();
  if (tslugs.length) {
    const rows = await safeAll(
      db
        .prepare(
          `SELECT slug, tmdb_id, poster_url FROM shows WHERE slug IN (${tslugs.map(() => "?").join(",")})`,
        )
        .bind(...tslugs)
        .all<{ slug: string; tmdb_id: number | null; poster_url: string | null }>(),
    );
    for (const x of rows) enrich.set(x.slug, x);
  }
  for (const r of tonight) {
    const d = enrich.get(r.show_slug);
    out.push({
      id: `tonight-${r.show_slug}-${r.season}-${r.number}`,
      theme: "tonight",
      kicker: "On tonight",
      tag: "Tonight",
      title: r.show_name,
      rating: r.rating,
      note: `New episode tonight — S${pad2(r.season)}E${pad2(r.number)}`,
      meta: r.network,
      kind: "tv",
      tmdbId: d?.tmdb_id ?? null,
      posterUrl: d?.poster_url ?? r.show_poster ?? r.show_image,
      path: `/show/${r.show_slug}`,
    });
  }

  // 3. Renewals / premieres (show_events, last 14 days)
  const events = await safeAll(
    db
      .prepare(
        `SELECT e.type, e.season, e.new_value, s.slug, s.name, s.tmdb_id, s.poster_url, s.image_url, s.rating, s.genres
         FROM show_events e JOIN shows s ON s.id = e.show_id
         WHERE e.type IN ('season_announced','premiere_set','premiere_moved')
           AND e.detected_at > unixepoch() - 1209600
         ORDER BY e.detected_at DESC LIMIT 8`,
      )
      .all<{
        type: string;
        season: number | null;
        new_value: string | null;
        slug: string;
        name: string;
        tmdb_id: number | null;
        poster_url: string | null;
        image_url: string | null;
        rating: number | null;
        genres: string | null;
      }>(),
  );
  for (const e of events) {
    const renewed = e.type === "season_announced";
    out.push({
      id: `event-${e.slug}-${e.type}-${e.season ?? 0}`,
      theme: renewed ? "renewed" : "premiere",
      kicker: renewed ? "Renewed" : e.type === "premiere_moved" ? "New date" : "Premiere set",
      tag: "News",
      title: e.name,
      rating: e.rating,
      note: renewed
        ? `Season ${e.season ?? ""} is officially happening`.trim()
        : e.new_value
          ? `Premieres ${e.new_value}`
          : "A premiere date is set",
      meta: parseGenres(e.genres).slice(0, 2).join(" · ") || null,
      kind: "tv",
      tmdbId: e.tmdb_id,
      posterUrl: e.poster_url ?? e.image_url,
      path: `/show/${e.slug}/release-date`,
    });
  }

  // 4. Instant-classic episodes (episode_alerts, last 14 days)
  const classics = await safeAll(
    db
      .prepare(
        `SELECT ep.season, ep.number, ep.rating AS ep_rating, s.slug, s.name, s.tmdb_id, s.poster_url, s.image_url, s.genres
         FROM episode_alerts a JOIN episodes ep ON ep.id = a.episode_id JOIN shows s ON s.id = ep.show_id
         WHERE a.created_at > unixepoch() - 1209600
         ORDER BY a.created_at DESC LIMIT 6`,
      )
      .all<{
        season: number | null;
        number: number | null;
        ep_rating: number | null;
        slug: string;
        name: string;
        tmdb_id: number | null;
        poster_url: string | null;
        image_url: string | null;
        genres: string | null;
      }>(),
  );
  for (const e of classics) {
    out.push({
      id: `classic-${e.slug}-${e.season}-${e.number}`,
      theme: "classic",
      kicker: "Instant classic",
      tag: "Instant classics",
      title: e.name,
      rating: e.ep_rating,
      note: `S${pad2(e.season)}E${pad2(e.number)} just became must-watch`,
      meta: parseGenres(e.genres).slice(0, 2).join(" · ") || null,
      kind: "tv",
      tmdbId: e.tmdb_id,
      posterUrl: e.poster_url ?? e.image_url,
      path: `/show/${e.slug}/s${pad2(e.season)}e${pad2(e.number)}`,
    });
  }

  // 5. New on streaming (provider_events 'added', last 14 days, TV)
  const streaming = await safeAll(
    db
      .prepare(
        `SELECT pe.service, s.slug, s.name, s.tmdb_id, s.poster_url, s.image_url, s.rating, s.genres
         FROM provider_events pe JOIN shows s ON s.slug = pe.slug
         WHERE pe.kind='tv' AND pe.change='added' AND pe.detected_at > unixepoch() - 1209600
         GROUP BY s.id ORDER BY MAX(pe.detected_at) DESC LIMIT 5`,
      )
      .all<{
        service: string;
        slug: string;
        name: string;
        tmdb_id: number | null;
        poster_url: string | null;
        image_url: string | null;
        rating: number | null;
        genres: string | null;
      }>(),
  );
  for (const e of streaming) {
    out.push({
      id: `stream-${e.slug}`,
      theme: "streaming",
      kicker: "Now streaming",
      tag: "New on streaming",
      title: e.name,
      rating: e.rating,
      note: `Now streaming on ${e.service}`,
      meta: parseGenres(e.genres).slice(0, 2).join(" · ") || null,
      kind: "tv",
      tmdbId: e.tmdb_id,
      posterUrl: e.poster_url ?? e.image_url,
      path: `/show/${e.slug}/where-to-watch`,
    });
  }

  // dedupe by destination, keep first (sources are already priority-ordered)
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.path) ? false : (seen.add(m.path), true)));
}

const HASH_BASE = ["TVNightly", "WhatToWatch"];
const camel = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, "");

/** Platform-flavored captions for a moment: a hook + the link + hashtags. The
 *  founder copies one and posts it. */
export function promoCaptions(
  m: PromoMoment,
  base: string,
): { x: string; instagram: string; tiktok: string } {
  const link = `${base}${m.path}`;
  const titleTag = camel(m.title).slice(0, 28);
  const themeTag: Record<PromoTheme, string> = {
    trending: "Trending",
    tonight: "OnTonight",
    renewed: "Renewed",
    premiere: "Premiere",
    classic: "MustWatch",
    streaming: "NowStreaming",
    top: "TopTV",
  };
  const tags = [...HASH_BASE, themeTag[m.theme], titleTag, m.kind === "movie" ? "Movies" : "TVShow"]
    .filter(Boolean)
    .map((t) => `#${t}`);
  const emoji: Record<PromoTheme, string> = {
    trending: "🔥",
    tonight: "📺",
    renewed: "🎉",
    premiere: "🗓️",
    classic: "⭐",
    streaming: "🍿",
    top: "🏆",
  };
  const e = emoji[m.theme];
  const rating = m.rating != null ? ` (★ ${m.rating.toFixed(1)})` : "";
  const hook = m.note ?? m.kicker;

  // X / Twitter — punchy, link inline, fewer tags
  const x = `${e} ${m.title}${rating} — ${hook}.\n\n${link}\n\n${tags.slice(0, 3).join(" ")}`;
  // Instagram — caption-style, "link in bio", full tag block
  const instagram = `${e} ${m.kicker.toUpperCase()}: ${m.title}${rating}\n\n${hook}. Full episode ratings, renewals & where to stream at TV Nightly — link in bio.\n\n${tags.join(" ")} #StreamingTV #BingeWatch`;
  // TikTok — hook-first, short
  const tiktok = `${m.title}${rating} ${e}\n${hook} 👀\n${link}\n\n${tags.join(" ")} #fyp #TVTok`;
  return { x, instagram, tiktok };
}

/** Generic platform captions for any studio card (composer + graphs). Same voice
 *  as promoCaptions: a hook + link + hashtags, flavored per platform. The caller
 *  supplies the subject (emoji, title, hook, optional IG sub-line, link, tags). */
export function buildCaptions(o: {
  emoji: string;
  title: string;
  hook: string;
  sub?: string;
  link: string;
  tags: string[];
}): { x: string; instagram: string; tiktok: string } {
  const tg = [...HASH_BASE, ...o.tags]
    .map((t) => camel(t).slice(0, 28))
    .filter(Boolean)
    .map((t) => `#${t}`);
  const dot = /[.?!]$/.test(o.hook) ? "" : "."; // don't double-punctuate a "?" hook
  // X / Twitter — punchy, link inline, fewer tags
  const x = `${o.emoji} ${o.title} — ${o.hook}${dot}\n\n${o.link}\n\n${tg.slice(0, 3).join(" ")}`;
  // Instagram — caption-style, "link in bio", full tag block
  const instagram =
    `${o.emoji} ${o.title}\n\n${o.hook}${dot}${o.sub ? " " + o.sub : ""}\n\n` +
    `More at TV Nightly — link in bio.\n\n${tg.join(" ")} #StreamingTV #BingeWatch`;
  // TikTok — hook-first, short
  const tiktok = `${o.title} ${o.emoji}\n${o.hook} 👀\n${o.link}\n\n${tg.join(" ")} #fyp #TVTok`;
  return { x, instagram, tiktok };
}

export const promoBase = (c: AppContext) => origin(c);
