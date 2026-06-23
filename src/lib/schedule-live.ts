// "On tonight", live from TVmaze's own schedule API — the same source their
// Countdown uses — instead of our D1 mirror, which is a stale snapshot and skews
// to daily soaps. TVmaze is free + keyless and the show ids ARE our D1 ids, so we
// upgrade matched titles to their canonical slug/poster and let the rest resolve
// through the detail fallback. Edge-cached an hour so traffic never hits TVmaze.
import { Bindings, TonightRow } from "../types";
import { slugifyName } from "./format";

// real programming only — TVmaze types we treat as the catalogue (no news, talk,
// reality, game, variety, sport). Documentary stays for prestige nature/true docs.
const SCRIPTED_TYPES = new Set(["Scripted", "Animation", "Documentary"]);

// English titles always qualify. A non-English title must be BOTH popular and
// acclaimed to make the cut — TVmaze popularity weight alone doesn't separate
// prestige (Squid Game) from high-traffic donghua (Swallowed Star is weight ~96
// but only ~7.3), so we also require a strong rating. This keeps the genuine
// foreign hits and drops the obscure long-tail the global web schedule is full of.
const FOREIGN_WEIGHT_MIN = 90;
const FOREIGN_RATING_MIN = 7.5;
const isEnglish = (s: { language?: string | null }) =>
  (s.language ?? "").toLowerCase() === "english";
const foreignQualifies = (s: { weight?: number; rating?: { average: number | null } | null }) =>
  (s.weight ?? 0) >= FOREIGN_WEIGHT_MIN && (s.rating?.average ?? 0) >= FOREIGN_RATING_MIN;

// Premium-rail tuning. We fill up to TONIGHT_TARGET cards; a live airing is hidden
// only when it's *rated* below QUALITY_MIN (unrated new premieres get the benefit
// of the doubt). Soaps are scripted but off-brand and TVmaze doesn't always tag
// them, so a small name guard backstops the daily-strip filter.
const TONIGHT_TARGET = 12;
const QUALITY_MIN = 6;
const SOAP_NAMES = new Set([
  "hollyoaks",
  "eastenders",
  "coronation street",
  "emmerdale",
  "neighbours",
  "home and away",
  "general hospital",
  "days of our lives",
  "the young and the restless",
  "the bold and the beautiful",
]);
const isJunk = (s: { name: string; rating?: { average: number | null } | null }) =>
  SOAP_NAMES.has(s.name.toLowerCase()) ||
  (s.rating?.average != null && s.rating.average < QUALITY_MIN);

type TvmazeShow = {
  id: number;
  name: string;
  type: string;
  status: string | null;
  language?: string | null;
  weight?: number;
  rating?: { average: number | null } | null;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
  image?: { medium?: string; original?: string } | null;
  schedule?: { days?: string[]; time?: string } | null;
};
type TvmazeEntry = {
  id: number;
  season: number | null;
  number: number | null;
  name: string | null;
  airdate: string | null;
  airstamp: string | null;
  runtime: number | null;
  _embedded?: { show?: TvmazeShow };
};

async function fetchSchedule(url: string, tag: string): Promise<TvmazeEntry[]> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/${tag}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(url, { headers: { accept: "application/json" } });
      if (!live.ok) return [];
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=3600");
      await cache.put(cacheKey, res.clone());
    }
    return (await res.json()) as TvmazeEntry[];
  } catch {
    return [];
  }
}

/** Tonight's scripted streaming/web schedule, in air-time order, mapped into our
 *  TonightRow card shape (D1-canonical slug + poster where the title is mirrored,
 *  TVmaze metadata otherwise). `date` defaults to today (UTC).
 *
 *  `opts.backfill` tops a thin rail up from the curated D1 catalogue — ONLY for
 *  the homepage discovery rail. Those rows carry no airstamp/season/number, so
 *  consumers that render an episode code or air date (the /tonight + /calendar
 *  schedule pages, the promo "new episode tonight" cards) must NOT pass it. */
export async function liveTonight(
  c: { env: Bindings },
  date = new Date().toISOString().slice(0, 10),
  opts: { backfill?: boolean } = {},
): Promise<TonightRow[]> {
  const items = await fetchSchedule(
    `https://api.tvmaze.com/schedule/web?date=${date}`,
    `tvmaze/web/${date}`,
  );
  const scripted = items.filter((e) => {
    const s = e._embedded?.show;
    if (!e.airstamp || !s || !SCRIPTED_TYPES.has(s.type)) return false;
    // daily strips — soaps, daily news/talk — air 4+ days a week; keep them out
    if ((s.schedule?.days?.length ?? 0) >= 4) return false;
    // English + popular-foreign: the global web schedule skews to obscure
    // non-English long-tail (donghua, daytime foreign drama) that has no traction
    // with our audience. Keep all English titles; admit a foreign title only when
    // it's both popular AND acclaimed (Squid Game / Money Heist tier).
    if (!isEnglish(s) && !foreignQualifies(s)) return false;
    // quality floor — drop soaps and titles already rated poorly
    if (isJunk(s)) return false;
    return true;
  });
  if (!scripted.length) return [];

  // a full-season drop yields many episodes for one show — collapse to a single
  // card at the title's earliest episode (the premiere, when it's premiere day)
  const earliest = new Map<number, TvmazeEntry>();
  for (const e of scripted) {
    const id = e._embedded!.show!.id;
    const cur = earliest.get(id);
    const before =
      !cur ||
      (e.season ?? 99) < (cur.season ?? 99) ||
      ((e.season ?? 99) === (cur.season ?? 99) && (e.number ?? 99) < (cur.number ?? 99));
    if (before) earliest.set(id, e);
  }
  const deduped = [...earliest.values()];

  // upgrade titles we mirror to their canonical slug + artwork (matched by id)
  const ids = [...new Set(deduped.map((e) => e._embedded!.show!.id))];
  const mirror = new Map<number, { slug: string; poster_url: string | null; image_url: string | null }>();
  const { results } = await c.env.DB.prepare(
    `SELECT id, slug, poster_url, image_url FROM shows WHERE id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<{ id: number; slug: string; poster_url: string | null; image_url: string | null }>();
  for (const r of results) mirror.set(r.id, r);

  // popularity order (TVmaze weight) so recognized titles lead and obscure
  // long-tail streaming (low-weight donghua/foreign) sinks
  const live = deduped
    .sort((a, b) => (b._embedded!.show!.weight ?? 0) - (a._embedded!.show!.weight ?? 0))
    .map((e) => {
      const show = e._embedded!.show!;
      const m = mirror.get(show.id);
      const tvmazeArt = show.image?.original ?? show.image?.medium ?? null;
      return {
        id: e.id,
        show_id: show.id,
        season: e.season,
        number: e.number,
        name: e.name,
        airdate: e.airdate ?? e.airstamp?.slice(0, 10) ?? null,
        airstamp: e.airstamp,
        runtime: e.runtime,
        rating: show.rating?.average ?? null,
        image_url: null,
        summary: null,
        show_name: show.name,
        show_slug: m?.slug ?? slugifyName(show.name),
        network: show.webChannel?.name ?? show.network?.name ?? null,
        show_poster: m?.poster_url ?? tvmazeArt,
        show_image: m?.image_url ?? tvmazeArt,
      } as unknown as TonightRow;
    });

  if (!opts.backfill || live.length >= TONIGHT_TARGET) return live;
  return [...live, ...(await tonightBackfill(c, live, TONIGHT_TARGET - live.length))];
}

/** When the live web schedule is thin or junky, top the "On tonight" rail up from
 *  the curated D1 catalogue — highly-rated, popular, currently-running scripted
 *  titles you can stream tonight. They carry no airstamp, so the card shows a
 *  "tonight" chip (not a fake time) and they sort after the genuine airings. */
async function tonightBackfill(
  c: { env: Bindings },
  live: TonightRow[],
  need: number,
): Promise<TonightRow[]> {
  if (need <= 0) return [];
  const haveSlugs = new Set(live.map((r) => r.show_slug));
  const { results } = await c.env.DB.prepare(
    `SELECT id, slug, name, rating, poster_url, image_url, web_channel, network
       FROM shows
      WHERE type IN ('Scripted', 'Animation', 'Documentary')
        AND poster_url IS NOT NULL
        AND rating IS NOT NULL AND rating >= 7.5
        AND status = 'Running'
      ORDER BY weight DESC, rating DESC
      LIMIT ?`,
  )
    .bind(need + 8) // headroom to drop any already on the live rail
    .all<{
      id: number;
      slug: string;
      name: string;
      rating: number | null;
      poster_url: string | null;
      image_url: string | null;
      web_channel: string | null;
      network: string | null;
    }>();
  return results
    .filter((s) => !haveSlugs.has(s.slug))
    .slice(0, need)
    .map(
      (s) =>
        ({
          id: 0,
          show_id: s.id,
          season: null,
          number: null,
          name: null,
          airdate: null,
          airstamp: null,
          runtime: null,
          rating: s.rating,
          image_url: null,
          summary: null,
          show_name: s.name,
          show_slug: s.slug,
          network: s.web_channel ?? s.network ?? null,
          show_poster: s.poster_url ?? s.image_url,
          show_image: s.image_url ?? s.poster_url,
        }) as unknown as TonightRow,
    );
}
