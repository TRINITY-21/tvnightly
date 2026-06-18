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

type TvmazeShow = {
  id: number;
  name: string;
  type: string;
  status: string | null;
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
 *  TVmaze metadata otherwise). `date` defaults to today (UTC). */
export async function liveTonight(
  c: { env: Bindings },
  date = new Date().toISOString().slice(0, 10),
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
  return deduped
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
}
