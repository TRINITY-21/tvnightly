// Hybrid catalog: when a title isn't in the D1 mirror, render it live from TMDB.
// The mirror is our warm/engaged subset; this makes every TMDB title findable
// and viewable (and indexable) without seeding.
import type { Context } from "hono";
import { Bindings, HonoEnv } from "../types";
import { tmdbSearch, tmdbTitle, tmdbWatchProviders } from "./tmdb";
import { slugifyName } from "./format";
import { origin } from "./seo";
import { visitorRegion } from "./providers";
import { aggregateRatingLd, titleStat } from "./ratings";
import { tmdbRef } from "./materialize";
import { byngeHandoffHrefAsync } from "./bynge";
import { TmdbTitlePage } from "../components/TmdbDetail";

/** Live-TMDB detail fallback for a `/show/:slug` or `/movie/:slug` D1 miss.
 *  Resolves the tmdb id from the `?t=` hint (a search click) or, for a clean /
 *  shared URL, by matching the slug against a TMDB search. */
export async function tmdbFallback(
  c: Context<HonoEnv>,
  kind: "tv" | "movie",
  slug: string,
) {
  const key = c.env.TMDB_API_KEY;
  if (!key) return c.notFound();

  const hint = Number(c.req.query("t"));
  let tmdbId = Number.isFinite(hint) && hint > 0 ? hint : null;
  if (!tmdbId) {
    const hits = (await tmdbSearch(key, slug.replace(/-/g, " "))).filter((h) => h.kind === kind);
    tmdbId = (hits.find((h) => slugifyName(h.name) === slug) ?? hits[0])?.tmdbId ?? null;
  }
  if (!tmdbId) return c.notFound();

  const t = await tmdbTitle(key, kind, tmdbId);
  if (!t) return c.notFound();

  const region = visitorRegion(c);
  const ref = tmdbRef(tmdbId);
  const [providers, stat, ratingLd, byngeWatchHref] = await Promise.all([
    tmdbWatchProviders(key, kind, tmdbId, region),
    titleStat(c.env.DB, kind, ref),
    aggregateRatingLd(c.env.DB, kind, ref),
    byngeHandoffHrefAsync(kind, { imdbId: t.imdbId }, { title: t.name, poster: t.poster?.x1 ?? null }),
  ]);
  const path = kind === "tv" ? "show" : "movie";
  const canonical = `${origin(c)}/${path}/${slugifyName(t.name)}`;
  // not in the mirror yet → let it be re-checked sooner than a normal page
  c.header("Cache-Control", "public, max-age=600");
  return c.html(
    <TmdbTitlePage
      c={c}
      t={t}
      providers={providers}
      region={region}
      stat={stat}
      ratingLd={ratingLd}
      canonical={canonical}
      byngeWatchHref={byngeWatchHref}
    />,
  );
}
