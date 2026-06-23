import { Context, Hono } from "hono";
import { IconStar, ChevDown, ChevUp, IconCal } from "../components/icons";
import { raw } from "hono/html";
import { COUNTDOWN_JS, Layout } from "../components/Layout";
import { StatusBadge } from "../components/cards";
import { DossierRow } from "../components/dossier";
import { SubscribeForm } from "../components/forms";
import { ShowBlurb } from "../components/editorial";
import { ShowConvertBand, loadShowConvertCtx } from "../components/show-convert";
import { FreshBadge } from "../components/freshness";
import { SeasonTabs, ShowTabs } from "../components/nav";
import { ShareBar } from "../components/share";
import { buildDossier } from "../lib/dossier";
import { epCode, epHref, heroBg, largeStill, longDate, posterSrc, stripHtml, fmtRuntime } from "../lib/format";
import { providersFor, visitorRegion } from "../lib/providers";
import { similarShows } from "../lib/queries";
import { titleStat, titleRaterCount } from "../lib/ratings";
import { resolveShow, buildTmdbShow } from "../lib/tmdb-show";
import { servePng } from "../lib/render";
import { breadcrumbLd, canonical, eventLd, faqLd, origin } from "../lib/seo";
import { freshEpoch } from "../lib/freshness";
import { archivoFontCss, buildSignalSvg, posterDataUri } from "../lib/signal";
import { buildOgCard, buildRatingsOgCard, type OgCardData, type RatingsEp } from "../lib/social";
import { tmdbBackdrop } from "../lib/tmdb";
import { Bindings, EpisodeRow, EventRow, ShowRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------- essential episodes

interface EssentialPick {
  ep: EpisodeRow;
  why: string;
}

/**
 * Skip-guide algorithm: structural picks (pilot, series finale when ended,
 * each season's peak) plus top-rated fillers, capped at n, in watch order.
 */
function essentialPicks(eps: EpisodeRow[], n: number, ended: boolean): EssentialPick[] {
  const chrono = [...eps].sort(
    (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.number ?? 0) - (b.number ?? 0),
  );
  if (chrono.length === 0) return [];
  const picked = new Map<number, EssentialPick>();
  const add = (ep: EpisodeRow | undefined, why: string) => {
    if (ep && !picked.has(ep.id)) picked.set(ep.id, { ep, why });
  };

  add(chrono[0], "Pilot");
  if (ended) add(chrono[chrono.length - 1], "Series finale");

  const bySeason = new Map<number, EpisodeRow[]>();
  for (const e of chrono) {
    const s = e.season ?? 0;
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s)!.push(e);
  }
  for (const [s, seasonEps] of bySeason) {
    const peak = seasonEps.filter((e) => e.rating != null).sort((a, b) => b.rating! - a.rating!)[0];
    add(peak, `Season ${s} peak`);
  }
  for (const e of [...eps].filter((e) => e.rating != null).sort((a, b) => b.rating! - a.rating!)) {
    if (picked.size >= n) break;
    add(e, "Top rated");
  }
  // More seasons than slots: drop the lowest-rated season peaks, keep structure.
  while (picked.size > n) {
    const droppable = [...picked.values()]
      .filter((p) => p.why.endsWith("peak"))
      .sort((a, b) => (a.ep.rating ?? 0) - (b.ep.rating ?? 0))[0];
    if (!droppable) break;
    picked.delete(droppable.ep.id);
  }
  return [...picked.values()].sort(
    (a, b) =>
      (a.ep.season ?? 0) - (b.ep.season ?? 0) || (a.ep.number ?? 0) - (b.ep.number ?? 0),
  );
}

app.get("/show/:slug/essential", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const { show, episodes: allEps } = r;

  // Optional per-season scope: the skip guide for one season.
  const path = `/show/${show.slug}/essential`;
  const seasonsAll = [
    ...new Set(allEps.map((e) => e.season).filter((s): s is number => s != null)),
  ];
  const rawSeason = (c.req.query("season") ?? "").trim();
  let season: number | null = null;
  if (rawSeason !== "") {
    const sn = Number(rawSeason);
    if (!Number.isInteger(sn) || !seasonsAll.includes(sn)) return c.redirect(path, 301);
    season = sn;
  }
  const eps = season != null ? allEps.filter((e) => e.season === season) : allEps;

  const lengthParam = Number(c.req.query("length") ?? 15);
  const n = season != null ? 8 : [10, 15, 25].includes(lengthParam) ? lengthParam : 15;
  const ratedCount = eps.filter((e) => e.rating != null).length;
  // A season is "complete" for finale purposes once a later season exists.
  const closed =
    show.status === "Ended" || (season != null && season < Math.max(...seasonsAll));
  let picks = ratedCount >= (season != null ? 6 : 10) ? essentialPicks(eps, n, closed) : [];
  if (season != null) {
    picks = picks.map((p) => ({
      ...p,
      why:
        p.why === "Pilot"
          ? season === 1
            ? "Pilot"
            : "Season premiere"
          : p.why === "Series finale"
            ? "Season finale"
            : p.why.endsWith("peak")
              ? "Season peak"
              : p.why,
    }));
  }
  const seasonLabel = season != null ? ` Season ${season}` : "";
  const anyStill = picks.some((p) => p.ep.image_url);
  const similar = await similarShows(c.env.DB, show);
  const region = visitorRegion(c);

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`The ${picks.length || "essential"} episodes of ${show.name}${seasonLabel} you must watch | TV Nightly`}
      description={
        season != null
          ? `Short on time? The essential ${show.name} Season ${season} watch list — the premiere, the peak, the finale, skip the rest.`
          : `Short on time? The essential ${show.name} watch list: pilot, every season's peak, and the all-time greats — skip the rest.`
      }
      canonical={
        season != null
          ? `${site}${path}?season=${season}`
          : n === 15
            ? `${site}${path}`
            : `${site}${path}?length=${n}`
      }
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      preloadImage={
        picks[0]?.ep.image_url
          ? { x1: picks[0].ep.image_url, x2: largeStill(picks[0].ep.image_url) }
          : undefined
      }
      ld={[breadcrumbLd(site, show, `Essential${seasonLabel} episodes`, path)]}
    >
      <article>
        <h1 class="epreg-h1">
          The <span class="epreg-kind">essential</span> episodes of{" "}
          <a href={`/show/${show.slug}`}>{show.name}</a>
          {seasonLabel}
        </h1>
        {season != null ? (
          <SeasonTabs slug={show.slug} season={season} current="essential" latest={season === Math.max(...seasonsAll)} />
        ) : (
          <ShowTabs slug={show.slug} current="essential" />
        )}
        {picks.length === 0 ? (
          <p class="muted">
            Not enough rated episodes yet to build a reliable essential list — check back soon.
          </p>
        ) : (
          <>
            {season == null ? (
              <nav class="epreg-rail" aria-label="Watch list length">
                <span class="epreg-rail-label">Length</span>
                {[10, 15, 25].map((len) => (
                  <a
                    class="epreg-all"
                    href={len === 15 ? path : `${path}?length=${len}`}
                    aria-current={n === len ? "page" : undefined}
                  >
                    {len} episodes
                  </a>
                ))}
              </nav>
            ) : null}
            <p class="epreg-method">
              Watch these {picks.length} in order and you've got {show.name}
              {seasonLabel} — each pick states its reason.
            </p>
            <ol class={anyStill ? "epreg" : "epreg epreg--textonly"}>
              {picks.map(({ ep, why }, i) => (
                <li>
                  <span class="epreg-num">{String(i + 1).padStart(2, "0")}</span>
                  {anyStill ? (
                    <a class="epreg-still-link" href={epHref(show.slug, ep)} tabindex={-1} aria-hidden="true">
                      {ep.image_url ? (
                        <img
                          class="epreg-still"
                          src={ep.image_url}
                          srcset={`${ep.image_url} 1x, ${largeStill(ep.image_url)} 2x`}
                          width="168"
                          height="95"
                          alt={`${show.name} ${epCode(ep)}`}
                          loading={i === 0 ? "eager" : "lazy"}
                          fetchpriority={i === 0 ? "high" : undefined}
                          decoding="async"
                        />
                      ) : (
                        <span class="epreg-still--empty">{epCode(ep)}</span>
                      )}
                    </a>
                  ) : null}
                  <span class="epreg-main">
                    <p class="epreg-meta">
                      <span class="epreg-code">{epCode(ep)}</span>
                      <span class="sep"> · </span>
                      <span class="epreg-code">{why}</span>
                      {ep.airdate ? (
                        <>
                          <span class="sep"> · </span>
                          {longDate(ep.airdate)}
                        </>
                      ) : null}
                      {ep.runtime ? (
                        <>
                          <span class="sep"> · </span>
                          <span class="epreg-rt">{fmtRuntime(ep.runtime)}</span>
                        </>
                      ) : null}
                    </p>
                    <p class="epreg-line">
                      <a class="epreg-name" href={epHref(show.slug, ep)}>
                        {ep.name ?? epCode(ep)}
                      </a>
                      <span class="epreg-leader"></span>
                      {ep.rating != null ? <span class="rating"><IconStar class="rating-star" />{ep.rating.toFixed(1)}</span> : null}
                    </p>
                    {ep.summary ? <p class="epreg-sum">{stripHtml(ep.summary)}</p> : null}
                  </span>
                </li>
              ))}
            </ol>
            <nav class="epreg-links" aria-label={`More ${show.name} rankings`}>
              <a href={`/show/${show.slug}/best-episodes${season != null ? `?season=${season}` : ""}`}>
                Best episodes
              </a>
              <a href={`/show/${show.slug}/worst-episodes${season != null ? `?season=${season}` : ""}`}>
                Worst episodes
              </a>
              <a href={`/show/${show.slug}/ratings${season != null ? `?season=${season}` : ""}`}>
                Ratings graph
              </a>
            </nav>
          </>
        )}
        {similar.length ? (
          <section>
            <h2>Shows like {show.name}</h2>
            <p class="dossier-method">
              The closest matches on shared genres, ranked by match strength and popularity.
            </p>
            <ol class="dossier-board">
              {similar.map((s, i) => (
                <DossierRow
                  i={i}
                  href={`/show/${s.slug}/essential`}
                  name={`The essential episodes of ${s.name}`}
                  d={buildDossier(show, s, region)}
                  rating={s.rating}
                  poster={posterSrc(s)}
                />
              ))}
            </ol>
          </section>
        ) : null}
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
      </article>
    </Layout>,
  );
});

// ------------------------------------------------- episode ratings graph
// "Signal": the run as a phosphor trace — built in lib/signal.ts, one
// builder for the page chart and every saved frame.

/** Loads a show + scoped episodes with the shared ?season validation. */
async function ratingsScope(c: Context<{ Bindings: Bindings }, "/show/:slug">, redirectTo: string) {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return null;
  const { show } = r;
  let allEps = r.episodes;
  // A mirrored show whose episodes were never rating-synced (TVmaze episode
  // ratings are sparse, or the episodes predate a sync) has nothing to plot, so
  // the graph comes up blank. Pull the episodes live from TMDB — which carries
  // per-episode ratings — so every show with a tmdb bridge gets a graph.
  if (!r.isTmdb && show.tmdb_id && c.env.TMDB_API_KEY && !allEps.some((e) => e.rating != null)) {
    const live = await buildTmdbShow(c, show.tmdb_id);
    if (live?.episodes.some((e) => e.rating != null)) allEps = live.episodes;
  }
  // null seasons ride the specials bucket (0), matching the grid builder;
  // specials sort last, like the grid's SP column
  const raw0 = [...new Set(allEps.map((e) => e.season ?? 0))].sort((a, b) => a - b);
  const seasons = [...raw0.filter((s) => s !== 0), ...(raw0.includes(0) ? [0] : [])];
  const rawSeason = (c.req.query("season") ?? "").trim();
  let season: number | null = null;
  let redirect = false;
  if (rawSeason !== "") {
    const n = Number(rawSeason);
    if (!Number.isInteger(n) || !seasons.includes(n)) redirect = true;
    else season = n;
  }
  return { show, allEps, seasons, season, redirect, redirectTo, ratingRef: r.ratingRef };
}

/** Season scope filter — specials (0) include null-season rows. */
const inSeason = (e: EpisodeRow, season: number) => (e.season ?? 0) === season;

app.get("/show/:slug/ratings.svg", async (c) => {
  const scope = await ratingsScope(c, "");
  if (!scope) return c.notFound();
  if (scope.redirect) return c.redirect(`/show/${scope.show.slug}/ratings.svg`, 301);
  const eps =
    scope.season != null ? scope.allEps.filter((e) => inSeason(e, scope.season!)) : scope.allEps;
  const bd =
    scope.show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, scope.show.tmdb_id)
      : null;
  const [fontCss, poster, backdrop] = await Promise.all([
    archivoFontCss(c.env.ASSETS),
    posterDataUri(posterSrc(scope.show)?.src ?? null),
    posterDataUri(bd?.x1 ?? null),
  ]);
  const sig = buildSignalSvg(eps, scope.show, {
    frame: "card",
    season: scope.season,
    slug: scope.show.slug,
    fontCss: fontCss ?? undefined,
    poster,
    backdrop,
  });
  if (!sig) return c.notFound();
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "public, max-age=3600");
  return c.body(sig.svg);
});

// "Streaming on X" for the OG card. Region-invariant (the card is one shared
// edge-cached image) — prefer the US provider, fall back to the network.
function ogStreamNote(show: ShowRow): string | null {
  const { names } = providersFor(show, "US");
  if (names.length) return `Streaming on ${names[0].trim()}`;
  if (show.network) return `On ${show.network}`;
  if (show.web_channel) return `On ${show.web_channel}`;
  return null;
}

/** A ShowRow → landscape OG card payload: genres · year range, rating, stream. */
function ogShowData(show: ShowRow, posterUri: string | null, backdropUri: string | null): OgCardData {
  const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const yr = show.premiered
    ? show.premiered.slice(0, 4) +
      (show.ended ? `–${show.ended.slice(0, 4)}` : show.status === "Running" ? "–present" : "")
    : "";
  const meta = [genres.slice(0, 3).join(" · "), yr].filter(Boolean).join(" · ");
  return {
    kicker: "TV Series",
    title: show.name,
    meta: meta || null,
    rating: show.rating,
    note: ogStreamNote(show),
    posterUri,
    backdropUri,
  };
}

// 1200×630 branded card for link unfurls — see src/lib/render.ts / social.ts.
app.get("/show/:slug/og.png", async (c) => {
  const slug = c.req.param("slug");
  return servePng(c, `show/${slug}`, async () => {
    const r = await resolveShow(c, slug);
    if (!r) return null;
    const show = r.show;
    const bd =
      show.tmdb_id && c.env.TMDB_API_KEY ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id) : null;
    const [posterUri, backdropUri] = await Promise.all([
      posterDataUri(posterSrc(show)?.src ?? null),
      posterDataUri(bd?.x1 ?? null),
    ]);
    return buildOgCard(ogShowData(show, posterUri, backdropUri));
  });
});

// 1200×630 ratings-graph card — the episode heatmap is the hero (see social.ts).
app.get("/show/:slug/ratings/og.png", async (c) => {
  const slug = c.req.param("slug");
  return servePng(c, `ratings/${slug}`, async () => {
    const r = await resolveShow(c, slug);
    if (!r) return null;
    const show = r.show;
    let episodes = r.episodes;
    // same blank-graph guard as the page: fall back to live TMDB episode ratings
    if (!r.isTmdb && show.tmdb_id && c.env.TMDB_API_KEY && !episodes.some((e) => e.rating != null)) {
      const live = await buildTmdbShow(c, show.tmdb_id);
      if (live?.episodes.some((e) => e.rating != null)) episodes = live.episodes;
    }
    const eps: RatingsEp[] = episodes.map((e) => ({
      season: e.season,
      number: e.number,
      rating: e.rating,
    }));
    if (!eps.length) return null;
    const bd =
      show.tmdb_id && c.env.TMDB_API_KEY ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id) : null;
    const backdropUri = await posterDataUri(bd?.x1 ?? posterSrc(show)?.src ?? null);
    return buildRatingsOgCard({ name: show.name, kicker: "Episode ratings", episodes: eps, backdropUri });
  });
});

app.get("/show/:slug/ratings", async (c) => {
  const scope = await ratingsScope(c, "");
  if (!scope) return c.notFound();
  const { show, allEps, seasons, season, ratingRef } = scope;
  const base = `/show/${show.slug}/ratings`;
  if (scope.redirect) return c.redirect(base, 301);
  const eps = season != null ? allEps.filter((e) => inSeason(e, season)) : allEps;
  const [stat, raterCount, similarTop] = await Promise.all([
    titleStat(c.env.DB, "tv", ratingRef),
    titleRaterCount(c.env.DB, "tv", ratingRef),
    similarShows(c.env.DB, show, 3),
  ]);
  // the page chart wears the same band as the saved card — what you see is
  // what you download (inline SVG may reference URLs directly)
  const pageBd =
    show.tmdb_id && c.env.TMDB_API_KEY ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id) : null;
  const sig = buildSignalSvg(eps, show, {
    frame: "page",
    season,
    slug: show.slug,
    poster: posterSrc(show)?.src ?? null,
    backdrop: pageBd?.x1 ?? null,
  });
  const similar = await similarShows(c.env.DB, show);
  const region = visitorRegion(c);
  const seasonLabel = season != null ? (season === 0 ? " Specials" : ` Season ${season}`) : "";
  const q = season != null ? `?season=${season}` : "";

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name}${seasonLabel} episode ratings graph — every episode charted | TV Nightly`}
      description={
        season != null
          ? `Every rated episode of ${show.name} Season ${season} on one chart: the peaks, the dips, the finale.`
          : `Every rated ${show.name} episode on one chart: see the peaks, the dips, and how each season compares.`
      }
      canonical={season != null ? `${site}${base}?season=${season}` : `${site}${base}`}
      ogImage={`${site}${base}/og.png`}
      ogImageLarge
      ld={[breadcrumbLd(site, show, `${seasonLabel || "Episode"} ratings graph`.trim(), path)]}
      scripts={["/js/signal.js", "/js/share.js"]}
    >
      <h1>
        <a href={`/show/${show.slug}`}>{show.name}</a>
        {seasonLabel}: episode ratings graph
      </h1>
      <ShowConvertBand
        show={show}
        ratingRef={ratingRef}
        stat={stat}
        raterCount={raterCount}
        episodes={allEps}
        similar={similarTop}
        seasonQuery={q}
        hideRatingsLink
      />
      {season != null ? (
        <SeasonTabs slug={show.slug} season={season} current="ratings" latest={season === Math.max(...seasons)} />
      ) : (
        <ShowTabs slug={show.slug} current="ratings" />
      )}
      {seasons.length > 1 || sig ? (
        <div class="sig-bar">
          {seasons.length > 1 ? (
            <nav class="epreg-rail" aria-label="Filter by season">
              <span class="epreg-rail-label">Filter</span>
              <a class="epreg-all" href={base} aria-current={season == null ? "page" : undefined}>
                All
              </a>
              {seasons.map((s) => (
                <a
                  class="epreg-seg"
                  href={`${base}?season=${s}`}
                  aria-current={season === s ? "page" : undefined}
                >
                  {s === 0 ? "SP" : `S${s}`}
                </a>
              ))}
            </nav>
          ) : null}
          {sig ? (
            // saving needs JS to rasterize — the control appears with it
            <div class="sig-save" hidden>
              <button>Save image</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {sig ? (
        <>
          <figure
            class="sig"
            tabindex={0}
            role="application"
            aria-roledescription="interactive chart"
            aria-label={sig.summary}
          >
            <div class="sig-screen">{raw(sig.svg)}</div>
            <figcaption class="sr-only">{sig.summary}</figcaption>
            <div class="sr-only" aria-live="polite" id="sig-live"></div>
          </figure>
          <div class="sig-strip" data-slug={show.slug} data-season={season ?? ""} hidden>
            <div class="sig-read" id="sig-read"></div>
          </div>
          {raw(`<script type="application/json" id="sig-data">${sig.island}</script>`)}
          {/* ranking links + Share on one row (Share pushed right); the .sig-save
              button above still handles the portrait image export. */}
          <div class="epreg-foot">
            <nav class="epreg-links" aria-label={`More ${show.name} rankings`}>
              <a href={`/show/${show.slug}/best-episodes${q}`}>Best episodes</a>
              <a href={`/show/${show.slug}/worst-episodes${q}`}>Worst episodes</a>
              <a href={`/show/${show.slug}/essential${q}`}>Essential episodes</a>
            </nav>
            <ShareBar url={`${site}${base}`} title={`${show.name} — every episode rated & charted`} />
          </div>
          {similar.length ? (
            <section>
              <h2>Shows like {show.name}</h2>
              <p class="dossier-method">
                The closest matches on shared genres, ranked by match strength and popularity —
                each opens its own ratings grid.
              </p>
              <ol class="dossier-board">
                {similar.map((s, i) => (
                  <DossierRow
                    i={i}
                    href={`/show/${s.slug}/ratings`}
                    name={`The episode ratings of ${s.name}`}
                    d={buildDossier(show, s, region)}
                    rating={s.rating}
                    poster={posterSrc(s)}
                  />
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : (
        <p class="muted">
          No rated episodes yet for {show.name}
          {seasonLabel}.{" "}
          {season != null ? <a href={base}>View all seasons</a> : null}
        </p>
      )}
    </Layout>,
  );
});

// ------------------------------------------------- best / worst episodes

const rankedPage =
  (order: "DESC" | "ASC") => async (c: Context<{ Bindings: Bindings }, "/show/:slug">) => {
    const resolved = await resolveShow(c, c.req.param("slug"));
    if (!resolved) return c.notFound();
    const show = resolved.show;
    const kind = order === "DESC" ? "best" : "worst";
    const base = `/show/${show.slug}/${kind}-episodes`;

    // One grouped pass: validates the ?season filter and sizes the run
    // spectrum (one cell per episode slot).
    const maxBySeason = new Map<number, number>();
    for (const e of resolved.episodes) {
      if (e.season == null) continue;
      maxBySeason.set(e.season, Math.max(maxBySeason.get(e.season) ?? 0, e.number ?? 0));
    }
    const seasonRows = [...maxBySeason.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([s, maxn]) => ({ s, maxn }));
    const seasons = seasonRows.map((r) => r.s);
    const rawSeason = (c.req.query("season") ?? "").trim();
    let season: number | null = null;
    if (rawSeason) {
      const n = Number(rawSeason);
      if (!seasons.includes(n)) return c.redirect(base, 301);
      season = n;
    }

    let eps: (EpisodeRow & { up: number | null; down: number | null })[];
    if (resolved.isTmdb) {
      const dir = order === "DESC" ? -1 : 1;
      eps = resolved.episodes
        .filter((e) => e.rating != null && (season == null || e.season === season))
        .map((e) => ({ ...e, up: null, down: null }))
        .sort(
          (a, b) =>
            dir * ((a.rating ?? 0) - (b.rating ?? 0)) ||
            (a.season ?? 0) - (b.season ?? 0) ||
            (a.number ?? 0) - (b.number ?? 0),
        )
        .slice(0, 25);
    } else {
      const res = await c.env.DB.prepare(
        `SELECT e.*, v.up, v.down FROM episodes e
         LEFT JOIN episode_votes v ON v.episode_id = e.id
         WHERE e.show_id = ? AND e.rating IS NOT NULL${season != null ? " AND e.season = ?" : ""}
         ORDER BY e.rating ${order}, e.season, e.number LIMIT 25`,
      )
        .bind(...(season != null ? [show.id, season] : [show.id]))
        .all<EpisodeRow & { up: number | null; down: number | null }>();
      eps = res.results;
    }

    // the run spectrum: one cell per episode slot, the listed 25 lit —
    // top-list membership is printed nowhere else on the page
    const totalCells = seasonRows.reduce((n, r) => n + (r.maxn ?? 0), 0);
    const spectrum = seasons.length >= 2 && seasons.length <= 12 && totalCells <= 120;
    const lit = new Set(eps.map((e) => `${e.season}:${e.number}`));

    const anyStill = eps.some((e) => e.image_url);
    const plates = eps.length >= 10 ? 3 : eps.length >= 4 ? 1 : 0;
    const q = season != null ? `?season=${season}` : "";

    const similar = await similarShows(c.env.DB, show);
    const convert = await loadShowConvertCtx(c.env.DB, show, resolved.ratingRef, similar);
    const region = visitorRegion(c);
    const site = origin(c);
    const path = new URL(c.req.url).pathname;
    const seasonLabel = season != null ? ` Season ${season}` : "";
    const ld: unknown[] = [
      breadcrumbLd(site, show, `${kind} episodes`, path),
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `The ${kind} episodes of ${show.name}`,
        itemListElement: eps.map((e, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `${e.name ?? epCode(e)} (${epCode(e)})`,
        })),
      },
    ];

    const method = [
      season != null
        ? `Season ${season} only — ranked by viewer rating, ${kind === "best" ? "highs" : "lows"} first.`
        : `Ranked by viewer rating, ${kind === "best" ? "highs" : "lows"} first.`,
      spectrum ? "Lit marks on the season rail place this list across the run." : null,
      "Vote on a placement to back it or contest it.",
      eps.length < 10 ? "Fewer than 10 rated episodes — treat this ranking as provisional." : null,
    ]
      .filter(Boolean)
      .join(" ");

    c.header("Cache-Control", "public, max-age=3600");
    return c.html(
      <Layout
        title={`The ${eps.length} ${kind} episodes of ${show.name}${seasonLabel}, ranked | TV Nightly`}
        description={`${show.name}${seasonLabel}'s ${kind} episodes ranked by viewer rating, from ${
          eps[0] ? `"${eps[0].name}"` : "the top"
        } down.`}
        canonical={season != null ? `${site}${base}?season=${season}` : `${site}${base}`}
        // a show (or filtered season) with no rated episodes yet is an empty
        // ranking — keep it reachable but out of the index until it has content
        noindex={eps.length === 0}
        ogImage={show.poster_url ?? show.image_url ?? undefined}
        scripts={["/js/votes.js"]}
        preloadImage={
          eps[0]?.image_url
            ? { x1: eps[0].image_url, x2: largeStill(eps[0].image_url) }
            : undefined
        }
        ld={ld}
      >
        <article data-show-id={String(show.id)}>
          <h1 class="epreg-h1">
            The <span class="epreg-kind">{kind}</span> episodes of{" "}
            <a href={`/show/${show.slug}`}>{show.name}</a>
            {seasonLabel}
          </h1>
          {kind === "best" && show.blurb ? <ShowBlurb text={show.blurb} /> : null}
          <ShowConvertBand
            show={show}
            ratingRef={resolved.ratingRef}
            stat={convert.stat}
            raterCount={convert.raterCount}
            episodes={resolved.episodes}
            similar={convert.similar}
            seasonQuery={q}
            hideRatingsLink={false}
          />
          {season != null ? (
            <SeasonTabs slug={show.slug} season={season} current={kind === "best" ? "best" : "worst"} latest={season === Math.max(...seasons)} />
          ) : (
            <ShowTabs slug={show.slug} current={kind === "best" ? "best" : "worst"} />
          )}
          {seasons.length > 1 && seasons.length <= 30 ? (
            <nav class="epreg-rail" aria-label="Filter by season">
              <span class="epreg-rail-label">Filter</span>
              <a class="epreg-all" href={base} aria-current={season == null ? "page" : undefined}>
                All
              </a>
              {seasons.map((s) => (
                <a
                  class="epreg-seg"
                  href={`${base}?season=${s}`}
                  aria-current={season === s ? "page" : undefined}
                >
                  <span class="epreg-seg-label">S{s}</span>
                  {spectrum ? (
                    <span class="epreg-cells">
                      {Array.from({ length: seasonRows.find((r) => r.s === s)?.maxn ?? 0 }, (_, i) => (
                        <i class={lit.has(`${s}:${i + 1}`) ? "epreg-cell is-lit" : "epreg-cell"}></i>
                      ))}
                    </span>
                  ) : null}
                </a>
              ))}
            </nav>
          ) : null}
          <p class="epreg-method">{method}</p>
          <ol class={anyStill ? "epreg" : "epreg epreg--textonly"}>
            {eps.map((e, i) => (
              <li class={i < plates ? "epreg-plate" : undefined}>
                <span class="epreg-num">{String(i + 1).padStart(2, "0")}</span>
                {anyStill ? (
                  <a class="epreg-still-link" href={epHref(show.slug, e)} tabindex={-1} aria-hidden="true">
                    {e.image_url ? (
                      <img
                        class="epreg-still"
                        src={e.image_url}
                        srcset={`${e.image_url} 1x, ${largeStill(e.image_url)} 2x`}
                        width={i < plates ? "256" : "168"}
                        height={i < plates ? "144" : "95"}
                        alt={`${show.name} ${epCode(e)}`}
                        loading={i === 0 ? "eager" : "lazy"}
                        fetchpriority={i === 0 ? "high" : undefined}
                        decoding="async"
                      />
                    ) : (
                      <span class="epreg-still--empty">{epCode(e)}</span>
                    )}
                  </a>
                ) : null}
                <span class="epreg-main">
                  <p class="epreg-meta">
                    <span class="epreg-code">{epCode(e)}</span>
                    {e.airdate ? (
                      <>
                        <span class="sep"> · </span>
                        {longDate(e.airdate)}
                      </>
                    ) : null}
                    {e.runtime ? (
                      <>
                        <span class="sep"> · </span>
                        <span class="epreg-rt">{fmtRuntime(e.runtime)}</span>
                      </>
                    ) : null}
                  </p>
                  <p class="epreg-line">
                    <a class="epreg-name" href={epHref(show.slug, e)}>
                      {e.name ?? epCode(e)}
                    </a>
                    <span class="epreg-leader"></span>
                    <span class="rating"><IconStar class="rating-star" />{e.rating!.toFixed(1)}</span>
                  </p>
                  {e.summary ? <p class="epreg-sum">{stripHtml(e.summary)}</p> : null}
                  <div class="epreg-verdict">
                    <span class="vote" data-ep-id={String(e.id)}>
                      <button class="vote-btn" data-dir="up" aria-label="Agree with this ranking">
                        <ChevUp /> <span class="vote-count">{e.up ?? 0}</span>
                      </button>
                      <button class="vote-btn" data-dir="down" aria-label="Disagree with this ranking">
                        <ChevDown /> <span class="vote-count">{e.down ?? 0}</span>
                      </button>
                    </span>
                  </div>
                </span>
              </li>
            ))}
          </ol>
          <nav class="epreg-links" aria-label={`More ${show.name} rankings`}>
            {kind === "best" ? (
              <a href={`/show/${show.slug}/essential${q}`}>Essential watch list</a>
            ) : (
              <a href={`/show/${show.slug}/best-episodes${q}`}>Best episodes</a>
            )}
            {kind === "best" ? (
              <a href={`/show/${show.slug}/worst-episodes${q}`}>Worst episodes</a>
            ) : (
              <a href={`/show/${show.slug}/essential${q}`}>Essential watch list</a>
            )}
            <a href={`/show/${show.slug}/ratings${q}`}>Ratings graph</a>
            <a href="/best-episodes">All-time top 100</a>
          </nav>
          {similar.length ? (
            <section>
              <h2>Shows like {show.name}</h2>
              <p class="dossier-method">
                The closest matches on shared genres, ranked by match strength and popularity.
              </p>
              <ol class="dossier-board">
                {similar.map((s, i) => (
                  <DossierRow
                    i={i}
                    href={`/show/${s.slug}/${kind}-episodes`}
                    name={`The ${kind} episodes of ${s.name}`}
                    d={buildDossier(show, s, region)}
                    rating={s.rating}
                    poster={posterSrc(s)}
                  />
                ))}
              </ol>
            </section>
          ) : null}
          <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
        </article>
      </Layout>,
    );
  };

app.get("/show/:slug/best-episodes", rankedPage("DESC"));
app.get("/show/:slug/worst-episodes", rankedPage("ASC"));

// ---------------------------------------------------------- next episode

// ---- the schedule slates: shared pieces for next-episode + release-date ----

/** Four-block live countdown in the stat-band voice; COUNTDOWN_JS drives it. */
const CountBand = ({ ts }: { ts: string }) => (
  <div class="count-band" data-ts={ts}>
    {(["Days", "Hours", "Minutes", "Seconds"] as const).map((u) => (
      <div class="count">
        <span class="count-num" data-u={u[0].toLowerCase()}>
          —
        </span>
        <span class="count-label">{u}</span>
      </div>
    ))}
  </div>
);

type SeasonFirst = { s: number; first: string };

const seasonPremieres = async (db: D1Database, showId: number): Promise<SeasonFirst[]> => {
  const { results } = await db
    .prepare(
      `SELECT season AS s, MIN(airdate) AS first FROM episodes
       WHERE show_id = ? AND season IS NOT NULL AND airdate IS NOT NULL
       GROUP BY season ORDER BY season DESC`,
    )
    .bind(showId)
    .all<SeasonFirst>();
  return results;
};

/** "9 of 13 seasons premiered in September" — only when the pattern is real
 *  (3+ seasons sharing the mode month, and it covers half the run). */
function premierePattern(firsts: SeasonFirst[]): { month: string; n: number; total: number } | null {
  const months = firsts.map((f) => Number(f.first.slice(5, 7))).filter((m) => m >= 1 && m <= 12);
  if (months.length < 3) return null;
  const counts = new Map<number, number>();
  for (const m of months) counts.set(m, (counts.get(m) ?? 0) + 1);
  const [mode, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n < 3 || n * 2 < months.length) return null;
  const month = new Date(Date.UTC(2000, mode - 1, 1)).toLocaleString("en-US", { month: "long" });
  return { month, n, total: months.length };
}

app.get("/show/:slug/next-episode", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const show = r.show;
  let next: EpisodeRow | null;
  let recent: EpisodeRow[];
  if (r.isTmdb) {
    const now = Date.now();
    const dated = r.episodes.filter((e) => e.airstamp);
    next =
      dated
        .filter((e) => new Date(e.airstamp as string).getTime() > now)
        .sort(
          (a, b) =>
            new Date(a.airstamp as string).getTime() - new Date(b.airstamp as string).getTime(),
        )[0] ?? null;
    recent = dated
      .filter((e) => new Date(e.airstamp as string).getTime() <= now)
      .sort(
        (a, b) =>
          new Date(b.airstamp as string).getTime() - new Date(a.airstamp as string).getTime(),
      )
      .slice(0, 3);
  } else {
    const [nextRes, recentRes] = await Promise.all([
      c.env.DB.prepare(
        `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now')
         ORDER BY airstamp LIMIT 1`,
      )
        .bind(show.id)
        .first<EpisodeRow>(),
      c.env.DB.prepare(
        `SELECT * FROM episodes WHERE show_id = ? AND airstamp <= datetime('now')
         ORDER BY airstamp DESC LIMIT 3`,
      )
        .bind(show.id)
        .all<EpisodeRow>(),
    ]);
    next = nextRes;
    recent = recentRes.results;
  }
  const similar = await similarShows(c.env.DB, show);
  const convert = await loadShowConvertCtx(c.env.DB, show, r.ratingRef, similar);
  const lastAired = recent[0] ?? null;
  const region = visitorRegion(c);

  // the slate leads with the episode we can show: the scheduled one, or —
  // while the schedule is empty — the last one that aired. The card wears the
  // episode's own frame (still, then the show's backdrop) as a mini hero; a
  // poster is never shown as art — it only feeds the ambient-light fallback.
  const slateEp = next ?? lastAired;
  const pitch = slateEp ? stripHtml(slateEp.summary).trim() : "";
  let media: { x1: string; x2?: string; ambient?: boolean } | null = slateEp?.image_url
    ? { x1: slateEp.image_url, x2: largeStill(slateEp.image_url) }
    : null;
  if (!media && show.tmdb_id && c.env.TMDB_API_KEY) {
    const bd = await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id);
    if (bd) media = { x1: bd.x1, x2: bd.x2 };
  }
  if (!media) {
    const p = posterSrc(show);
    if (p) media = { x1: p.src, ambient: true };
  }

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  const pageUrl = `${site}${path}`;
  const nextEvent =
    next?.airstamp
      ? eventLd({
          site,
          name: `${show.name} ${epCode(next)}${next.name ? `: ${next.name}` : ""}`,
          startDate: new Date(next.airstamp).toISOString(),
          url: pageUrl,
          description: `${show.name} ${epCode(next)} airs ${next.airdate ? longDate(next.airdate) : "soon"}${
            show.network ? ` on ${show.network}` : ""
          }.`,
        })
      : null;
  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={`When is the next episode of ${show.name}? | TV Nightly`}
      description={
        next
          ? `${show.name} ${epCode(next)} "${next.name ?? ""}" airs ${next.airdate ?? "soon"}.`
          : `${show.name} has no scheduled next episode. Status: ${show.status ?? "unknown"}.`
      }
      canonical={canonical(c)}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={[
        breadcrumbLd(site, show, "Next episode", path),
        ...(nextEvent ? [nextEvent] : []),
        // only when there's a real next episode, so the answer matches the
        // visible "Airs <date> on <network>" slate (Google's FAQ visibility rule)
        ...(next
          ? [
              faqLd([
                {
                  q: `When is the next episode of ${show.name}?`,
                  a: `${show.name} ${epCode(next)}${next.name ? ` "${next.name}"` : ""} airs ${
                    next.airdate ? longDate(next.airdate) : "soon"
                  }${show.network ? ` on ${show.network}` : ""}.`,
                },
              ]),
            ]
          : []),
      ]}
    >
      <h1>
        Next episode of <a href={`/show/${show.slug}`}>{show.name}</a>
      </h1>
      <ShowConvertBand
        show={show}
        ratingRef={r.ratingRef}
        stat={convert.stat}
        raterCount={convert.raterCount}
        episodes={r.episodes}
        similar={convert.similar}
      />
      <ShowTabs slug={show.slug} current="next" />
      <section class={media ? `slate slate-hero${media.ambient ? " slate-ambient" : ""}` : "slate"}>
        {media ? (
          <div class="slate-frame" style={heroBg(media.x1, media.x2)} aria-hidden="true"></div>
        ) : null}
        <div class="slate-body">
          {next ? (
            <>
              <p class="slate-chyron">
                Up next · <strong>{epCode(next)}</strong>
                {show.network ? ` · ${show.network}` : ""}
              </p>
              <p class="slate-title">{next.name ?? epCode(next)}</p>
              <div class="slate-facts">
                <p class="slate-fact">
                  <span class="fact-k">Airs</span>
                  <strong>{next.airdate ? longDate(next.airdate) : "soon"}</strong>
                  {show.network ? ` on ${show.network}` : ""}
                </p>
                {pitch ? <p class="slate-fact slate-pitch">{pitch}</p> : null}
              </div>
              {next.airstamp ? <CountBand ts={next.airstamp} /> : null}
              {raw(COUNTDOWN_JS)}
            </>
          ) : (
            <>
              <p class="slate-chyron">
                Last aired{lastAired ? <> · <strong>{epCode(lastAired)}</strong></> : null}
                {lastAired?.airdate ? ` · ${longDate(lastAired.airdate)}` : ""}
              </p>
              <p class="slate-title">{lastAired?.name ?? "No episode scheduled"}</p>
              <div class="slate-facts">
                <p class="slate-fact">
                  <StatusBadge status={show.status} />
                  {show.status === "Ended" ? (
                    <>{show.name} ended with this episode — no new season is coming.</>
                  ) : show.status === "To Be Determined" ? (
                    <>No next episode is scheduled — awaiting renewal news. We track the schedule hourly.</>
                  ) : (
                    <>No next episode is scheduled yet — the network hasn't dated the next one. We check hourly.</>
                  )}
                </p>
                {pitch ? <p class="slate-fact slate-pitch">{pitch}</p> : null}
              </div>
            </>
          )}
        </div>
      </section>
      <p>
        <a href={`/show/${show.slug}/calendar.ics`}><IconCal /> Add {show.name} to your calendar</a>
      </p>
      <SubscribeForm showId={show.id} label={`Email me when ${show.name} gets schedule news:`} />
      {recent.length ? (
        <section>
          <h2>Catch up</h2>
          <p class="epreg-method">
            The last {recent.length === 1 ? "episode" : `${recent.length} episodes`} to air,
            newest first{next ? ` — be caught up before ${epCode(next)} lands` : ""}.
          </p>
          <ol class={recent.some((e) => e.image_url) ? "epreg" : "epreg epreg--textonly"}>
            {recent.map((e) => (
              <li>
                <span class="epreg-num">{String(e.number ?? 0).padStart(2, "0")}</span>
                {recent.some((x) => x.image_url) ? (
                  <a class="epreg-still-link" href={epHref(show.slug, e)} tabindex={-1} aria-hidden="true">
                    {e.image_url ? (
                      <img
                        class="epreg-still"
                        src={e.image_url}
                        srcset={`${e.image_url} 1x, ${largeStill(e.image_url)} 2x`}
                        width="168"
                        height="95"
                        alt={`${show.name} ${epCode(e)}`}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span class="epreg-still--empty">{epCode(e)}</span>
                    )}
                  </a>
                ) : null}
                <span class="epreg-main">
                  <p class="epreg-meta">
                    <span class="epreg-code">{epCode(e)}</span>
                    {e.airdate ? (
                      <>
                        <span class="sep"> · </span>
                        {longDate(e.airdate)}
                      </>
                    ) : null}
                  </p>
                  <p class="epreg-line">
                    <a class="epreg-name" href={epHref(show.slug, e)}>
                      {e.name ?? epCode(e)}
                    </a>
                    <span class="epreg-leader"></span>
                    {e.rating != null ? <span class="rating"><IconStar class="rating-star" />{e.rating.toFixed(1)}</span> : null}
                  </p>
                  {e.summary ? <p class="epreg-sum">{stripHtml(e.summary)}</p> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {similar.length ? (
        <section>
          <h2>Shows like {show.name}</h2>
          <p class="dossier-method">
            The closest matches on shared genres, ranked by match strength and popularity.
          </p>
          <ol class="dossier-board">
            {similar.map((s, i) => (
              <DossierRow
                i={i}
                href={`/show/${s.slug}`}
                name={s.name}
                d={buildDossier(show, s, region)}
                rating={s.rating}
                poster={posterSrc(s)}
              />
            ))}
          </ol>
        </section>
      ) : null}
    </Layout>,
  );
});

// ---------------------------------------------------------- release date

app.get("/show/:slug/release-date", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const show = r.show;
  const db = c.env.DB;
  const convert = await loadShowConvertCtx(db, show, r.ratingRef);

  let next: EpisodeRow | null;
  let lastAired: EpisodeRow | null;
  let history: Omit<EventRow, "name" | "slug">[];
  let firsts: SeasonFirst[];
  let latestEventAt: number | null = null;
  if (r.isTmdb) {
    const now = Date.now();
    const dated = r.episodes.filter((e) => e.airstamp);
    next =
      dated
        .filter((e) => new Date(e.airstamp as string).getTime() > now)
        .sort(
          (a, b) =>
            new Date(a.airstamp as string).getTime() - new Date(b.airstamp as string).getTime(),
        )[0] ?? null;
    lastAired =
      dated
        .filter((e) => new Date(e.airstamp as string).getTime() <= now)
        .sort(
          (a, b) =>
            new Date(b.airstamp as string).getTime() - new Date(a.airstamp as string).getTime(),
        )[0] ?? null;
    history = [];
    const firstBySeason = new Map<number, string>();
    for (const e of r.episodes) {
      if (e.season == null || !e.airdate) continue;
      const cur = firstBySeason.get(e.season);
      if (!cur || e.airdate < cur) firstBySeason.set(e.season, e.airdate);
    }
    firsts = [...firstBySeason.entries()]
      .map(([s, first]) => ({ s, first }))
      .sort((a, b) => b.s - a.s);
  } else {
    next = await db
      .prepare(
        `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now')
         ORDER BY airstamp LIMIT 1`,
      )
      .bind(show.id)
      .first<EpisodeRow>();
    lastAired = await db
      .prepare(
        `SELECT * FROM episodes WHERE show_id = ? AND airstamp <= datetime('now')
         ORDER BY airstamp DESC LIMIT 1`,
      )
      .bind(show.id)
      .first<EpisodeRow>();
    const histRes = await db
      .prepare(
        `SELECT type, season, old_value, new_value, detected_at FROM show_events
         WHERE show_id = ? ORDER BY detected_at DESC LIMIT 10`,
      )
      .bind(show.id)
      .all<Omit<EventRow, "name" | "slug">>();
    history = histRes.results;
    firsts = await seasonPremieres(db, show.id);
    latestEventAt =
      (await db
        .prepare("SELECT MAX(detected_at) AS latest FROM show_events WHERE show_id = ?")
        .bind(show.id)
        .first<{ latest: number | null }>())?.latest ?? null;
  }
  const pattern = premierePattern(firsts);

  // the date over the show's own frame: the dated episode's still when one
  // exists, else the show's backdrop; a poster only ever feeds ambient light
  let media: { x1: string; x2?: string; ambient?: boolean } | null = next?.image_url
    ? { x1: next.image_url, x2: largeStill(next.image_url) }
    : null;
  if (!media && show.tmdb_id && c.env.TMDB_API_KEY) {
    const bd = await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id);
    if (bd) media = { x1: bd.x1, x2: bd.x2 };
  }
  if (!media) {
    const p = posterSrc(show);
    if (p) media = { x1: p.src, ambient: true };
  }

  const maxAired = lastAired?.season ?? 0;
  // People search for the NEXT season ("X season 3 release date") — name it,
  // announced or not.
  const targetSeason =
    next && (next.season ?? 0) > maxAired
      ? (next.season ?? null)
      : show.status !== "Ended"
        ? maxAired + 1
        : null;
  let answer: string;
  let showCountdown = false;
  // the slate: chyron qualifies, the title is THE answer (a date when we
  // have one, the honest pattern when we don't), the facts row by row
  let chyron: string;
  let slateTitle: string;
  let statusLine: string;
  if (next && (next.season ?? 0) > maxAired) {
    answer = `Season ${next.season} of ${show.name} premieres on ${next.airdate ? longDate(next.airdate) : "a date TBA"}.`;
    chyron = `Season ${next.season} premiere${show.network ? ` · ${show.network}` : ""}`;
    slateTitle = next.airdate ? longDate(next.airdate) : `Season ${next.season}`;
    statusLine = `${show.name} returns for Season ${next.season}${show.network ? ` on ${show.network}` : ""}.`;
    showCountdown = true;
  } else if (next) {
    answer = `Season ${next.season} of ${show.name} is currently airing — the next episode (${epCode(
      next,
    )}) airs ${next.airdate ? longDate(next.airdate) : "soon"}.`;
    chyron = `Season ${next.season} · now airing · next: ${epCode(next)}`;
    slateTitle = next.airdate ? longDate(next.airdate) : "Now airing";
    statusLine = `${epCode(next)}${next.name ? ` "${next.name}"` : ""} airs next — Season ${next.season} is still airing.`;
    showCountdown = true;
  } else if (show.status === "Ended") {
    answer = `${show.name} has ended${show.ended ? ` (final episode: ${longDate(show.ended)})` : ""} — no new season is coming.`;
    chyron = "Series ended";
    slateTitle = show.ended ? longDate(show.ended) : "Ended";
    statusLine = `${show.name} ended${lastAired?.name ? ` with ${lastAired.name} (${epCode(lastAired)})` : ""} — no new season is coming.`;
  } else if (show.status === "To Be Determined") {
    answer = `${show.name} has not yet been renewed for Season ${maxAired + 1}. Its status is officially "To Be Determined."`;
    chyron = `Season ${maxAired + 1} · awaiting renewal`;
    slateTitle = "Not renewed yet";
    statusLine = `${show.name} hasn't been renewed for Season ${maxAired + 1} yet.`;
  } else if (show.status === "In Development") {
    answer = `${show.name} is in development — no premiere date has been announced yet.`;
    chyron = "In development";
    slateTitle = "Date not announced";
    statusLine = `${show.name} is in development — no premiere date has been announced.`;
  } else {
    answer = `${show.name} is ${show.status ?? "of unknown status"}, but no next air date has been announced yet.`;
    chyron = `Season ${maxAired + 1} · not scheduled yet`;
    slateTitle = pattern ? `Historically ${pattern.month}` : "Date not announced";
    statusLine = `${show.name} is ${show.status?.toLowerCase() ?? "of unknown status"} — the next air date hasn't been announced.`;
  }

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  const pageUrl = `${site}${path}`;
  const freshAt = freshEpoch(show.updated_at, latestEventAt);
  const premiereEvent =
    showCountdown && next?.airstamp
      ? eventLd({
          site,
          name:
            next && (next.season ?? 0) > maxAired
              ? `${show.name} Season ${next.season} premiere`
              : `${show.name} ${epCode(next)}`,
          startDate: new Date(next.airstamp).toISOString(),
          url: pageUrl,
          description: statusLine,
        })
      : null;
  // status-aware title: match the query people actually type for each state
  // ("is X renewed", "is X coming back", "X season N release date")
  const generalTitle =
    show.status === "To Be Determined"
      ? `Is ${show.name} renewed for Season ${maxAired + 1}? Status & news`
      : show.status === "Ended"
        ? `Is ${show.name} coming back? ${show.name} status`
        : next && (next.season ?? 0) > maxAired
          ? `${show.name} Season ${next.season} release date & news`
          : `${show.name} release date & renewal status`;
  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={
        targetSeason
          ? `${show.name} Season ${targetSeason} release date${
              next && (next.season ?? 0) === targetSeason && next.airdate
                ? `: ${next.airdate}`
                : " — not announced yet"
            } | TV Nightly`
          : `${generalTitle} | TV Nightly`
      }
      description={answer.slice(0, 155)}
      canonical={canonical(c)}
      ogImage={`${site}/show/${show.slug}/og.png`}
      ogImageLarge
      ld={[
        breadcrumbLd(site, show, "Release date", path),
        ...(premiereEvent ? [premiereEvent] : []),
        faqLd([
          {
            q: targetSeason
              ? `When is ${show.name} Season ${targetSeason}?`
              : `Is ${show.name} renewed, and when does it return?`,
            a: statusLine,
          },
        ]),
      ]}
    >
      <h1>
        {targetSeason ? (
          <>
            When is <a href={`/show/${show.slug}`}>{show.name}</a> Season {targetSeason}?
          </>
        ) : (
          <>
            <a href={`/show/${show.slug}`}>{show.name}</a>: release date & renewal status
          </>
        )}{" "}
        <FreshBadge epoch={freshAt} />
      </h1>
      <ShowConvertBand
        show={show}
        ratingRef={r.ratingRef}
        stat={convert.stat}
        raterCount={convert.raterCount}
        episodes={r.episodes}
        similar={convert.similar}
      />
      <ShowTabs slug={show.slug} current="release" />
      <section class={media ? `slate slate-hero${media.ambient ? " slate-ambient" : ""}` : "slate"}>
        {media ? (
          <div class="slate-frame" style={heroBg(media.x1, media.x2)} aria-hidden="true"></div>
        ) : null}
        <div class="slate-body">
          <p class="slate-chyron">{chyron}</p>
          <p class="slate-title">{slateTitle}</p>
          <div class="slate-facts">
            <p class="slate-fact">
              <StatusBadge status={show.status} /> {statusLine}
            </p>
            {!next && show.status !== "Ended" && pattern ? (
              <p class="slate-fact">
                <span class="fact-k">History</span>
                {pattern.n} of {pattern.total} seasons premiered in {pattern.month}.
              </p>
            ) : null}
            {lastAired && show.status !== "Ended" ? (
              <p class="slate-fact">
                <span class="fact-k">Last aired</span>
                {lastAired.name ?? epCode(lastAired)} ({epCode(lastAired)})
                {lastAired.airdate ? ` · ${longDate(lastAired.airdate)}` : ""}
              </p>
            ) : null}
          </div>
          {showCountdown && next?.airstamp ? (
            <>
              <CountBand ts={next.airstamp} />
              {raw(COUNTDOWN_JS)}
            </>
          ) : null}
        </div>
      </section>
      <p>
        <a href={`/show/${show.slug}/calendar.ics`}><IconCal /> Add {show.name} to your calendar</a>{" "}
      </p>
      <SubscribeForm
        showId={show.id}
        label={`Email me when ${show.name} renewal or premiere news lands:`}
      />
      {firsts.length > 1 ? (
        <section>
          <h2>Season premiere dates</h2>
          <ol class="premiere-ledger">
            {firsts.map((f) => (
              <li>
                <a href={`/show/${show.slug}/season/${f.s}`}>Season {f.s}</a>
                <span class="pl-leader" aria-hidden="true"></span>
                <span class="pl-date">{longDate(f.first)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {history.length ? (
        <section>
          <h2>News history</h2>
          <ul class="ep-list">
            {history.map((h) => (
              <li>
                <span class="muted">
                  {new Date(h.detected_at * 1000).toISOString().slice(0, 10)}
                </span>{" "}
                {h.type === "season_announced" ? (
                  <>
                    Renewed — <strong>Season {h.season} confirmed</strong>
                  </>
                ) : h.type === "premiere_set" ? (
                  <>
                    Season {h.season} premiere date set: <strong>{h.new_value}</strong>
                  </>
                ) : h.type === "premiere_moved" ? (
                  <>
                    Premiere moved <span class="muted">{h.old_value}</span>{" "}
                    <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
                    <strong>{h.new_value}</strong>
                  </>
                ) : (
                  <>
                    {h.old_value ?? "?"}{" "}
                    <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
                    <strong>{h.new_value ?? "?"}</strong>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Layout>,
  );
});

export default app;
