import { Context, Hono } from "hono";
import { raw } from "hono/html";
import { COUNTDOWN_JS, Layout } from "../components/Layout";
import { StatusBadge } from "../components/cards";
import { DossierRow } from "../components/dossier";
import { SubscribeForm } from "../components/forms";
import { ChevDown, ChevUp, IconCal } from "../components/icons";
import { SeasonTabs, ShowTabs } from "../components/nav";
import { buildDossier } from "../lib/dossier";
import { epCode, epHref, largeStill, longDate, posterSrc, stripHtml } from "../lib/format";
import { visitorRegion } from "../lib/providers";
import { getShow, similarShows } from "../lib/queries";
import { breadcrumbLd, canonical, origin } from "../lib/seo";
import { archivoFontCss, buildSignalSvg, posterDataUri } from "../lib/signal";
import { tmdbBackdrop } from "../lib/tmdb";
import { Bindings, EpisodeRow, EventRow } from "../types";

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
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const { results: allEps } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();

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
                          alt=""
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
                          <span class="epreg-rt">{ep.runtime} min</span>
                        </>
                      ) : null}
                    </p>
                    <p class="epreg-line">
                      <a class="epreg-name" href={epHref(show.slug, ep)}>
                        {ep.name ?? epCode(ep)}
                      </a>
                      <span class="epreg-leader"></span>
                      {ep.rating != null ? <span class="rating">★ {ep.rating.toFixed(1)}</span> : null}
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
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return null;
  const { results: allEps } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();
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
  return { show, allEps, seasons, season, redirect, redirectTo };
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

app.get("/show/:slug/ratings", async (c) => {
  const scope = await ratingsScope(c, "");
  if (!scope) return c.notFound();
  const { show, allEps, seasons, season } = scope;
  const base = `/show/${show.slug}/ratings`;
  if (scope.redirect) return c.redirect(base, 301);
  const eps = season != null ? allEps.filter((e) => inSeason(e, season)) : allEps;
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
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, `${seasonLabel || "Episode"} ratings graph`.trim(), path)]}
      scripts={["/js/signal.js"]}
    >
      <h1>
        <a href={`/show/${show.slug}`}>{show.name}</a>
        {seasonLabel}: episode ratings graph
      </h1>
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
          <nav class="epreg-links" aria-label={`More ${show.name} rankings`}>
            <a href={`/show/${show.slug}/best-episodes${q}`}>Best episodes</a>
            <a href={`/show/${show.slug}/worst-episodes${q}`}>Worst episodes</a>
            <a href={`/show/${show.slug}/essential${q}`}>Essential episodes</a>
          </nav>
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
    const show = await getShow(c.env.DB, c.req.param("slug"));
    if (!show) return c.notFound();
    const kind = order === "DESC" ? "best" : "worst";
    const base = `/show/${show.slug}/${kind}-episodes`;

    // One grouped pass: validates the ?season filter and sizes the run
    // spectrum (one cell per episode slot).
    const { results: seasonRows } = await c.env.DB.prepare(
      `SELECT season AS s, MAX(number) AS maxn
       FROM episodes WHERE show_id = ? AND season IS NOT NULL
       GROUP BY season ORDER BY season`,
    )
      .bind(show.id)
      .all<{ s: number; maxn: number | null }>();
    const seasons = seasonRows.map((r) => r.s);
    const rawSeason = (c.req.query("season") ?? "").trim();
    let season: number | null = null;
    if (rawSeason) {
      const n = Number(rawSeason);
      if (!seasons.includes(n)) return c.redirect(base, 301);
      season = n;
    }

    const { results: eps } = await c.env.DB.prepare(
      `SELECT e.*, v.up, v.down FROM episodes e
       LEFT JOIN episode_votes v ON v.episode_id = e.id
       WHERE e.show_id = ? AND e.rating IS NOT NULL${season != null ? " AND e.season = ?" : ""}
       ORDER BY e.rating ${order}, e.season, e.number LIMIT 25`,
    )
      .bind(...(season != null ? [show.id, season] : [show.id]))
      .all<EpisodeRow & { up: number | null; down: number | null }>();

    // the run spectrum: one cell per episode slot, the listed 25 lit —
    // top-list membership is printed nowhere else on the page
    const totalCells = seasonRows.reduce((n, r) => n + (r.maxn ?? 0), 0);
    const spectrum = seasons.length >= 2 && seasons.length <= 12 && totalCells <= 120;
    const lit = new Set(eps.map((e) => `${e.season}:${e.number}`));

    const anyStill = eps.some((e) => e.image_url);
    const plates = eps.length >= 10 ? 3 : eps.length >= 4 ? 1 : 0;
    const q = season != null ? `?season=${season}` : "";

    const similar = await similarShows(c.env.DB, show);
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
                        alt=""
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
                        <span class="epreg-rt">{e.runtime} min</span>
                      </>
                    ) : null}
                  </p>
                  <p class="epreg-line">
                    <a class="epreg-name" href={epHref(show.slug, e)}>
                      {e.name ?? epCode(e)}
                    </a>
                    <span class="epreg-leader"></span>
                    <span class="rating">★ {e.rating!.toFixed(1)}</span>
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
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const [next, recentRes, similar] = await Promise.all([
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
    similarShows(c.env.DB, show),
  ]);
  const recent = recentRes.results;
  const lastAired = recent[0] ?? null;
  const region = visitorRegion(c);

  // the slate leads with the episode we can show: the scheduled one, or —
  // while the schedule is empty — the last one that aired. No episode still
  // yet (premieres rarely have one) -> the show's backdrop, then its poster.
  const slateEp = next ?? lastAired;
  const pitch = slateEp ? stripHtml(slateEp.summary).trim() : "";
  let media: { src: string; srcset?: string; poster?: boolean } | null = slateEp?.image_url
    ? { src: slateEp.image_url, srcset: `${slateEp.image_url} 1x, ${largeStill(slateEp.image_url)} 2x` }
    : null;
  if (!media && show.tmdb_id && c.env.TMDB_API_KEY) {
    const bd = await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id);
    if (bd) media = { src: bd.x1, srcset: `${bd.x1} 1x, ${bd.x2} 2x` };
  }
  if (!media) {
    const p = posterSrc(show);
    if (p) media = { ...p, poster: true };
  }

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
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
      ld={[breadcrumbLd(site, show, "Next episode", path)]}
    >
      <h1>
        Next episode of <a href={`/show/${show.slug}`}>{show.name}</a>
      </h1>
      <ShowTabs slug={show.slug} current="next" />
      <section class={`slate${media ? ` has-media${media.poster ? " is-poster" : ""}` : ""}`}>
        {media ? (
          <div class="slate-media">
            <img
              src={media.src}
              srcset={media.srcset}
              alt={slateEp?.name ?? show.name}
              width={media.poster ? 190 : 384}
              height={media.poster ? 285 : 216}
            />
          </div>
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
                        alt=""
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
                    {e.rating != null ? <span class="rating">★ {e.rating.toFixed(1)}</span> : null}
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
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const db = c.env.DB;

  const next = await db
    .prepare(
      `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now')
       ORDER BY airstamp LIMIT 1`,
    )
    .bind(show.id)
    .first<EpisodeRow>();
  const lastAired = await db
    .prepare(
      `SELECT * FROM episodes WHERE show_id = ? AND airstamp <= datetime('now')
       ORDER BY airstamp DESC LIMIT 1`,
    )
    .bind(show.id)
    .first<EpisodeRow>();
  const { results: history } = await db
    .prepare(
      `SELECT type, season, old_value, new_value, detected_at FROM show_events
       WHERE show_id = ? ORDER BY detected_at DESC LIMIT 10`,
    )
    .bind(show.id)
    .all<Omit<EventRow, "name" | "slug">>();

  const firsts = await seasonPremieres(db, show.id);
  const pattern = premierePattern(firsts);

  // the one-sheet next to the date reads like a premiere announcement;
  // backdrop only if the mirror has no poster yet
  let media: { src: string; srcset?: string; poster?: boolean } | null = posterSrc(show)
    ? { ...posterSrc(show)!, poster: true }
    : null;
  if (!media && show.tmdb_id && c.env.TMDB_API_KEY) {
    const bd = await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id);
    if (bd) media = { src: bd.x1, srcset: `${bd.x1} 1x, ${bd.x2} 2x` };
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
          : `${show.name} release date & renewal status | TV Nightly`
      }
      description={answer.slice(0, 155)}
      canonical={canonical(c)}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Release date", path)]}
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
        )}
      </h1>
      <ShowTabs slug={show.slug} current="release" />
      <section class={`slate${media ? ` has-media${media.poster ? " is-poster" : ""}` : ""}`}>
        {media ? (
          <div class="slate-media">
            <img
              src={media.src}
              srcset={media.srcset}
              alt={`${show.name} poster`}
              width={media.poster ? 150 : 384}
              height={media.poster ? 225 : 216}
            />
          </div>
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
