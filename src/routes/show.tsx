import { Hono } from "hono";
import { raw } from "hono/html";
import { Bindings, EpisodeRow, ShowRow } from "../types";
import { visitorRegion, REGIONS, PROVIDER_LOGOS, providerBrand } from "../lib/providers";
import { stripHtml, epCode, epHref, hiRes, retinaSet, posterSrc, heroBg, longDate, slugifyName, personHref, comparePathFor, largeStill } from "../lib/format";
import { origin, canonical, breadcrumbLd } from "../lib/seo";
import { getShow, similarShows } from "../lib/queries";
import { titleStat } from "../lib/ratings";
import { tmdbBackdrop, tmdbMedia } from "../lib/tmdb";
import { buildDossier } from "../lib/dossier";
import { DossierRow } from "../components/dossier";
import { VsCard } from "../components/compare";
import { IconPlay } from "../components/icons";
import { hubForGenres } from "../lib/verticals";
import { Layout } from "../components/Layout";
import { ShowTabs, SeasonTabs } from "../components/nav";
import { StatusBadge, ExploreCard, ClampSummary } from "../components/cards";
import { ProviderLine } from "../components/providers";
import { RateInline, SubscribeForm } from "../components/forms";

const app = new Hono<{ Bindings: Bindings }>();

// The hero poster: the same canonical art every other surface uses
// (backfilled TMDB one-sheet, TVmaze fallback) — never a second variant.
const HeroPoster = (show: ShowRow) => {
  const p = posterSrc(show);
  return p ? (
    <img class="poster" src={p.src} srcset={p.srcset} alt={show.name} />
  ) : (
    <div class="poster card-fallback">{show.name}</div>
  );
};

app.get("/show/:slug", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const { results: episodes } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();

  const seasons = new Map<number, EpisodeRow[]>();
  for (const e of episodes) {
    const s = e.season ?? 0;
    if (!seasons.has(s)) seasons.set(s, []);
    seasons.get(s)!.push(e);
  }
  const netName = show.network ?? show.web_channel;
  const region = visitorRegion(c);
  // one bound COUNT instead of the full network GROUP-BY scan per pageview
  const [similar, stat, netCount] = await Promise.all([
    similarShows(c.env.DB, show),
    titleStat(c.env.DB, "tv", String(show.id)),
    netName
      ? c.env.DB.prepare(
          "SELECT COUNT(*) AS c FROM shows WHERE (network = ? OR web_channel = ?) AND weight >= 60",
        )
          .bind(netName, netName)
          .first<{ c: number }>()
      : Promise.resolve(null),
  ]);
  const netEntry =
    netName && (netCount?.c ?? 0) >= 3 ? { name: netName, slug: slugifyName(netName) } : undefined;

  const site = origin(c);
  const ld: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "TVSeries",
      name: show.name,
      url: `${site}/show/${show.slug}`,
      ...(show.poster_url || show.image_url
        ? { image: show.poster_url ?? show.image_url }
        : {}),
      ...(show.premiered ? { startDate: show.premiered } : {}),
      ...(show.ended ? { endDate: show.ended } : {}),
      ...(seasons.size ? { numberOfSeasons: Math.max(...seasons.keys()) } : {}),
    },
  ];

  // The hero frame: the show's real designed backdrop from TMDB (edge-cached),
  // falling back to the poster for the few shows without a TMDB bridge.
  const backdrop =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id)
      : null;
  const posterBg = hiRes(show.image_url);
  const heroFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : posterBg
      ? heroBg(posterBg)
      : null;

  // the rivals' backdrops for the head-to-head split cards (edge-cached)
  const rivalBackdrops = c.env.TMDB_API_KEY
    ? await Promise.all(
        similar
          .slice(0, 3)
          .map((s) =>
            s.tmdb_id ? tmdbBackdrop(c.env.TMDB_API_KEY!, s.tmdb_id) : Promise.resolve(null),
          ),
      )
    : [];

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={`${show.name} — episodes, ratings & renewal status | TV Nightly`}
      description={stripHtml(show.summary).slice(0, 155)}
      canonical={canonical(c)}
      ld={ld}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
    >
      <article class="show-hub">
        <header class="detail-hero frame-hero">
          {heroFrame ? (
            <div class="hero-backdrop" style={heroFrame}></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side">
              {HeroPoster(show)}
              <RateInline kind="tv" refId={String(show.id)} stat={stat} />
            </div>
            <div class="detail-info">
              <h1>{show.name}</h1>
              <p class="meta-strip">
                {/* the year range carries the status: closed = ended, –present = airing */}
                <span>
                  <a href="/top/tv" title="The top TV shows, ranked">TV</a>
                </span>
                {show.premiered ? (
                  <>
                    <span class="sep">·</span>
                    <span>
                      {show.premiered.slice(0, 4)}
                      {show.ended
                        ? `–${show.ended.slice(0, 4)}`
                        : show.status === "Running"
                          ? "–present"
                          : ""}
                    </span>
                  </>
                ) : null}
                {episodes.length ? (
                  <>
                    <span class="sep">·</span>
                    <span>
                      <a
                        href={`/show/${show.slug}/best-episodes`}
                        title={`The best episodes of ${show.name}`}
                      >
                        {seasons.size} season{seasons.size === 1 ? "" : "s"}, {episodes.length}{" "}
                        episode{episodes.length === 1 ? "" : "s"}
                      </a>
                    </span>
                  </>
                ) : null}
                {netName ? (
                  <>
                    <span class="sep">·</span>
                    <span>
                      <a href={`/network/${slugifyName(netName)}`}>{netName}</a>
                    </span>
                  </>
                ) : null}
                {(() => {
                  const g: string[] = show.genres ? JSON.parse(show.genres) : [];
                  return g.length ? (
                    <>
                      <span class="sep">·</span>
                      <span>
                        {g.slice(0, 3).map((x, i) => (
                          <>
                            {i > 0 ? ", " : ""}
                            <a href={`/genre/${slugifyName(x)}/shows`}>{x}</a>
                          </>
                        ))}
                      </span>
                    </>
                  ) : null;
                })()}
                {show.runtime ? (
                  <>
                    <span class="sep">·</span>
                    <span>{show.runtime} min</span>
                  </>
                ) : null}
                {show.rating != null ? (
                  <>
                    <span class="sep">·</span>
                    <span class="rating">★ {show.rating.toFixed(1)}</span>
                  </>
                ) : null}
              </p>
              <ProviderLine
                row={show}
                region={region}
                fallbackHref={`/show/${show.slug}/release-date`}
                pickerType="tv"
                allHref={`/show/${show.slug}/where-to-watch`}
              />
              
              {show.summary ? (
                stripHtml(show.summary).length > 280 ? (
                  <ClampSummary id="synopsis-clamp">{raw(show.summary)}</ClampSummary>
                ) : (
                  <div class="summary">{raw(show.summary)}</div>
                )
              ) : null}
              {show.blurb ? (
                <aside class="blurb">
                  <span class="blurb-label">The TV Nightly take</span>
                  <p>{show.blurb}</p>
                </aside>
              ) : null}
            </div>
          </div>
        </header>
        <ShowTabs slug={show.slug} current="overview" />
        {(() => {
          const nextEp = episodes.find((e) => e.airstamp && new Date(e.airstamp) > new Date());
          return nextEp ? (
            <p class="answer">
              <span class="live-dot"></span>Next episode: <strong>{epCode(nextEp)}</strong>
              {nextEp.name ? ` — ${nextEp.name}` : ""} · {nextEp.airdate}{" "}
              <a href={`/show/${show.slug}/next-episode`} class="chev-after">countdown</a>
            </p>
          ) : null;
        })()}
        {(() => {
          const top3 = episodes
            .filter((e) => e.rating != null)
            .sort((a, b) => b.rating! - a.rating!)
            .slice(0, 3);
          return top3.length ? (
            <section>
              <h2>
                Highest-rated episodes{" "}
                <a class="more" href={`/show/${show.slug}/best-episodes`}>
                  all ranked
                </a>
              </h2>
              <ol class="top3">
                {top3.map((e, i) => {
                  const pitch = stripHtml(e.summary);
                  return (
                    <li>
                      <span class="top3-num">{String(i + 1).padStart(2, "0")}</span>
                      {e.image_url ? (
                        <img class="top3-still" src={e.image_url} alt="" loading="lazy" />
                      ) : null}
                      <span class="top3-main">
                        <span class="top3-name">
                          <a href={epHref(show.slug, e)}>{e.name}</a>{" "}
                          <span class="muted">{epCode(e)}</span>
                        </span>
                        {pitch ? <span class="top3-sub">{pitch}</span> : null}
                      </span>
                      <span class="rank-score">
                        <span class="rating">★ {e.rating!.toFixed(1)}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null;
        })()}
        {(() => {
          const cast: { n: string; c: string | null; img: string | null }[] = show.cast_json
            ? JSON.parse(show.cast_json)
            : [];
          return cast.length ? (
            <section id="cast">
              <h2>
                Cast
                {cast.length > 8 ? (
                  <a class="more" href={`/show/${show.slug}/cast`}>
                    full cast & details
                  </a>
                ) : null}
              </h2>
              <div class="cast-row">
                {cast.slice(0, 8).map((p) => {
                  const href = personHref(p);
                  const inner = (
                    <>
                      {p.img ? (
                        <img src={p.img} alt={p.n} loading="lazy" />
                      ) : (
                        <div class="cast-fallback">{p.n}</div>
                      )}
                      <span class="cast-name">{p.n}</span>
                      {p.c ? <span class="cast-char muted">{p.c}</span> : null}
                    </>
                  );
                  return href ? (
                    <a class="cast-card" href={href}>
                      {inner}
                    </a>
                  ) : (
                    <div class="cast-card">{inner}</div>
                  );
                })}
              </div>
            </section>
          ) : null;
        })()}
        {seasons.size ? (
          <section>
            <h2>Episodes by season</h2>
            <div class="lineup-board">
              {(() => {
                const latest = Math.max(...seasons.keys());
                const seasonAvg = (eps: EpisodeRow[]) => {
                  const rated = eps.filter((e) => e.rating != null);
                  return rated.length
                    ? rated.reduce((s, e) => s + e.rating!, 0) / rated.length
                    : null;
                };
                // "Best season" only when the comparison is honest: two or
                // more seasons with 5+ rated episodes each.
                const contenders = [...seasons.entries()]
                  .map(([n, eps]) => ({
                    n,
                    rated: eps.filter((e) => e.rating != null).length,
                    avg: seasonAvg(eps),
                  }))
                  .filter((s) => s.rated >= 5 && s.avg != null);
                const bestSeason =
                  contenders.length >= 2
                    ? contenders.reduce((a, b) => (b.avg! > a.avg! ? b : a)).n
                    : null;
                // Season shape at a glance: one bar per rated episode in
                // airing order on a ground line, the season's peak in gold.
                const seasonSpark = (rated: EpisodeRow[], bestId: number) => {
                  const W = 4;
                  const G = 2;
                  const H = 16;
                  const w = rated.length * (W + G) - G;
                  const bars = rated
                    .map((e, i) => {
                      const h = Math.max(2, Math.min(H, Math.round(((e.rating! - 4) / 6) * H)));
                      const fill = e.id === bestId ? "var(--warn)" : "rgba(163, 158, 151, 0.35)";
                      return `<rect x="${i * (W + G)}" y="${H - h}" width="${W}" height="${h}" rx="1" fill="${fill}"/>`;
                    })
                    .join("");
                  const base = `<rect x="0" y="${H - 1}" width="${w}" height="1" fill="rgba(163, 158, 151, 0.25)"/>`;
                  return raw(
                    `<svg class="fold-spark" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img"><title>Episode ratings across the season — the gold bar is its best episode</title>${base}${bars}</svg>`,
                  );
                };
                const epRate = (e: EpisodeRow) =>
                  e.rating != null ? (
                    <span class="ep-rate rating">
                      <span class="star">★</span> {e.rating.toFixed(1)}
                    </span>
                  ) : (
                    <span class="ep-rate muted">—</span>
                  );
                const twoToneCode = (e: EpisodeRow) => {
                  const code = epCode(e);
                  return (
                    <span class="ep-code">
                      <span class="s">{code.slice(0, 3)}</span>
                      {code.slice(3)}
                    </span>
                  );
                };
                return [...seasons.entries()].map(([season, eps]) => {
                  const rated = eps.filter((e) => e.rating != null);
                  const avg = seasonAvg(eps);
                  const yrs = eps
                    .map((e) => e.airdate?.slice(0, 4))
                    .filter((y): y is string => !!y);
                  const aired = yrs.length
                    ? yrs[0] === yrs[yrs.length - 1]
                      ? yrs[0]
                      : `${yrs[0]}–${yrs[yrs.length - 1].slice(2)}`
                    : null;
                  const best =
                    rated.length >= 3
                      ? rated.reduce((a, b) => (b.rating! > a.rating! ? b : a))
                      : null;
                  return (
                    <details class="season-fold" open={season === latest}>
                      <summary>
                        <span class="fold-slate">
                          {season === 0 ? (
                            <span class="fold-eyebrow">Specials</span>
                          ) : (
                            <>
                              <span class="fold-eyebrow">Season</span>
                              <span class="fold-num">{String(season).padStart(2, "0")}</span>
                            </>
                          )}
                        </span>
                        {season === bestSeason ? <span class="ep-best">Best season</span> : null}
                        {best ? seasonSpark(rated, best.id) : null}
                        <span class="fold-meta">
                          <span class="m">
                            <span class="m-val">{eps.length}</span>
                            <span class="m-label">Episodes</span>
                          </span>
                          {aired ? (
                            <span class="m m-aired">
                              <span class="m-val">{aired}</span>
                              <span class="m-label">Aired</span>
                            </span>
                          ) : null}
                          <span class="m">
                            <span class="m-val rating">
                              {avg != null ? (
                                <>
                                  <span class="star">★</span> {avg.toFixed(1)}
                                </>
                              ) : (
                                "—"
                              )}
                            </span>
                            <span class="m-label">Season avg</span>
                          </span>
                        </span>
                      </summary>
                      <div class="fold-body">
                        <ol class="ep-list">
                          {eps.map((e) => {
                            const isBest = best != null && e.id === best.id;
                            const pitch = stripHtml(e.summary).slice(0, 140);
                            return (
                              <li class="ep-row">
                                {twoToneCode(e)}
                                <span class="still-wrap">
                                  {e.image_url ? (
                                    <img
                                      src={e.image_url}
                                      width="84"
                                      height="47"
                                      alt=""
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <span class="still-empty" aria-hidden="true"></span>
                                  )}
                                  {isBest ? <span class="still-chyron">Season's best</span> : null}
                                </span>
                                <span class="ep-lead-main">
                                  <span class="ep-lead-line">
                                    <a
                                      class="ep-name"
                                      href={epHref(show.slug, e)}
                                      title={e.name ?? undefined}
                                    >
                                      {e.name ?? epCode(e)}
                                    </a>
                                    <span class="ep-leader"></span>
                                    <span class="ep-date muted">
                                      {e.airdate ? longDate(e.airdate) : ""}
                                    </span>
                                    {epRate(e)}
                                  </span>
                                  {pitch ? <span class="ep-lead-sub">{pitch}</span> : null}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                        <p class="fold-foot">
                          <a class="chev-after" href={`/show/${show.slug}/season/${season}`}>
                            Season {season} ranked & reviewed
                          </a>
                        </p>
                      </div>
                    </details>
                  );
                });
              })()}
            </div>
          </section>
        ) : null}
        {similar.length ? (
          <section id="similar">
            <h2>
              Shows like {show.name}{" "}
              <a class="more" href={`/show/${show.slug}/similar`}>
                all similar shows
              </a>
            </h2>
            {/* the method line is literally what the SQL does — same honesty
                move as the tab rail: say only what we can back */}
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
                  compare={{
                    href: comparePathFor(show.slug, s.slug),
                    label: `Compare ${s.name} with ${show.name}`,
                  }}
                />
              ))}
            </ol>
          </section>
        ) : null}
        {similar.length ? (
          <section id="head-to-head">
            <h2>
              Head-to-head{" "}
              <a class="more" href={`/compare?a=${show.slug}`}>
                pick any opponent
              </a>
            </h2>
            <p class="dossier-method">
              Stack {show.name}'s full episode-rating history against a rival, on one chart.
            </p>
            <div class="vs-grid">
              {similar.slice(0, 3).map((s, i) => {
                const small = (u: string) => u.replace("/w1280/", "/w780/");
                return (
                  <VsCard
                    href={comparePathFor(show.slug, s.slug)}
                    a={{
                      name: show.name,
                      poster: posterSrc(show)?.src ?? null,
                      backdrop: backdrop ? small(backdrop.x1) : null,
                    }}
                    b={{
                      name: s.name,
                      poster: posterSrc(s)?.src ?? null,
                      backdrop: rivalBackdrops[i] ? small(rivalBackdrops[i]!.x1) : null,
                    }}
                    cta="Full episode chart"
                  />
                );
              })}
            </div>
          </section>
        ) : null}
        {(() => {
          const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
          const hub = hubForGenres(genres, null);
          return (
            <section>
              <h2>
                Keep exploring{" "}
                <a class="more" href="/top/tv">
                  top shows
                </a>
              </h2>
              <div class="explore-grid">
                <ExploreCard
                  icon="Shortcut"
                  title="The essential episodes"
                  desc="Short on time? The pilot-to-finale shortcut, only the episodes that matter."
                  href={`/show/${show.slug}/essential`}
                />
                <ExploreCard
                  icon="Matchup"
                  title="Compare with another show"
                  desc="Two shows' episode ratings on one chart — settle it."
                  href={`/compare?a=${show.slug}`}
                />
                {netEntry ? (
                  <ExploreCard
                    icon="Network"
                    title={`Best ${netEntry.name} shows`}
                    desc="More from the same network, ranked by rating."
                    href={`/network/${netEntry.slug}`}
                  />
                ) : null}
                {genres.slice(0, 2).map((g) => (
                  <ExploreCard
                    icon="Genre"
                    title={`Best ${g.toLowerCase()} shows & films`}
                    desc={`The top of the ${g.toLowerCase()} pile, across both mediums.`}
                    href={`/genre/${slugifyName(g)}`}
                  />
                ))}
                {hub ? (
                  <ExploreCard
                    icon="Hub"
                    title={`The ${hub.name.toLowerCase()} hub`}
                    desc="The whole fandom on one bookmarkable page — rankings, premieres, what's new."
                    href={`/${hub.slug}`}
                  />
                ) : null}
              </div>
            </section>
          );
        })()}
      </article>
    </Layout>,
  );
});

// ----------------------------------------------------- ICS calendar feed

app.get("/show/:slug/calendar.ics", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const { results: eps } = await c.env.DB.prepare(
    `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now', '-7 days')
     ORDER BY airstamp LIMIT 100`,
  )
    .bind(show.id)
    .all<EpisodeRow>();

  const icsEsc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/[;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const stamp = dt(new Date().toISOString());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TV Nightly//tvnightly.com//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEsc(show.name)} — TV Nightly`,
  ];
  for (const e of eps) {
    if (!e.airstamp) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:ep-${e.id}@tvnightly.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dt(e.airstamp)}`,
      `DURATION:PT${e.runtime ?? 60}M`,
      `SUMMARY:${icsEsc(`${show.name} ${epCode(e)}${e.name ? ` — ${e.name}` : ""}`)}`,
      `URL:${origin(c)}/show/${show.slug}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  c.header("Content-Type", "text/calendar; charset=utf-8");
  c.header("Cache-Control", "public, max-age=21600");
  return c.body(lines.join("\r\n") + "\r\n");
});

// ---------------------------------------------------------- season pages

// "Where to watch X" is one of TV's biggest query patterns; we answer it
// region by region from the mirror the provider patrol keeps fresh.
app.get("/show/:slug/where-to-watch", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const base = `/show/${show.slug}/where-to-watch`;
  const reqRegion = (c.req.query("region") ?? "").trim().toUpperCase();
  if (reqRegion && !REGIONS.includes(reqRegion)) return c.redirect(base, 301);
  const region = reqRegion || visitorRegion(c);

  const intl: Record<string, string[]> = show.providers_intl
    ? JSON.parse(show.providers_intl)
    : {};
  const names = intl[region] ?? [];
  const elsewhere = REGIONS.filter((r) => r !== region && intl[r]?.length);

  const backdrop =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id)
      : null;
  const posterBg = hiRes(show.image_url);
  const heroFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : posterBg
      ? heroBg(posterBg)
      : null;

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Where to watch ${show.name} — streaming options | TV Nightly`}
      description={
        names.length
          ? `${show.name} is streaming on ${names.slice(0, 4).join(", ")} in ${region}. Every service and region, checked around the clock.`
          : `Where ${show.name} is streaming, region by region — checked around the clock.`
      }
      canonical={`${site}${base}`}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Where to watch", base)]}
    >
      <article class="show-hub">
        <header class="detail-hero frame-hero">
          {heroFrame ? (
            <div class="hero-backdrop" style={heroFrame}></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side">
              {HeroPoster(show)}
            </div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> Streaming guide
              </p>
              <h1>Where to watch {show.name}</h1>
              <p class="summary">{stripHtml(show.summary).slice(0, 180)}</p>
              {/* explicit submit, no onchange (WCAG 3.2.2); works without JS */}
              <form method="get" action={base} class="sub-form watch-region">
                <label for="wr-region" class="muted" style="flex-basis:auto;font-weight:400">
                  Showing options for
                </label>
                <select
                  id="wr-region"
                  name="region"
                  style="background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:0.35rem 0.5rem"
                >
                  {REGIONS.map((r) => (
                    <option value={r} selected={r === region}>
                      {r}
                    </option>
                  ))}
                </select>
                <button type="submit">Go</button>
              </form>
            </div>
          </div>
        </header>
        <ShowTabs slug={show.slug} current="watch" />
        <section>
          <h2>Streaming in {region}</h2>
          {names.length ? (
            <ul class="watch-list">
              {names.map((n) => (
                <li class="watch-row">
                  {PROVIDER_LOGOS[n] ? (
                    <img
                      class="watch-logo"
                      src={PROVIDER_LOGOS[n]}
                      alt=""
                      width="44"
                      height="44"
                      loading="lazy"
                    />
                  ) : (
                    <span class="watch-logo watch-logo-fallback" aria-hidden="true">
                      {n.slice(0, 1)}
                    </span>
                  )}
                  <span class="watch-name">{n}</span>
                  <a
                    class="chev-after watch-more"
                    href={`/network/${slugifyName(providerBrand(n))}/shows`}
                  >
                    More on {providerBrand(n)}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p class="muted">
              {show.name} isn't on a streaming service in {region} right now
              {elsewhere.length ? " — but it is elsewhere:" : "."}
            </p>
          )}
          {elsewhere.length ? (
            <p class="muted watch-elsewhere">
              Also streaming in:{" "}
              {elsewhere.map((r, i) => (
                <>
                  {i > 0 ? " · " : ""}
                  <a href={`${base}?region=${r}`}>{r}</a>
                </>
              ))}
            </p>
          ) : null}
          <p class="muted watch-src">
            Streaming data via JustWatch/TMDB, re-checked around the clock by our provider patrol.
          </p>
        </section>
        <section>
          <h2>Keep going</h2>
          <nav class="pill-nav">
            <a class="chev-after" href={`/show/${show.slug}`}>
              {show.name} overview
            </a>
            <a class="chev-after" href={`/show/${show.slug}/best-episodes`}>
              Best episodes
            </a>
            <a class="chev-after" href={`/whats-new`}>
              What's new on streaming
            </a>
          </nav>
        </section>
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
      </article>
    </Layout>,
  );
});

// "Shows like X" is its own query pattern — the full dossier gets a page.
app.get("/show/:slug/similar", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const similar = await similarShows(c.env.DB, show, 18);
  if (!similar.length) return c.redirect(`/show/${show.slug}`, 302);
  const region = visitorRegion(c);
  const base = `/show/${show.slug}/similar`;

  const backdrop =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id)
      : null;
  const posterBg = hiRes(show.image_url);
  const heroFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : posterBg
      ? heroBg(posterBg)
      : null;

  const site = origin(c);
  const ld = [
    breadcrumbLd(site, show, "Similar shows", base),
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Shows like ${show.name}`,
      itemListElement: similar.map((s, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${site}/show/${s.slug}`,
        name: s.name,
      })),
    },
  ];
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Shows like ${show.name} — ${similar.length} similar shows ranked | TV Nightly`}
      description={`The ${similar.length} closest matches to ${show.name}: ${similar
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")} and more, ranked by match strength with ratings and where to stream.`}
      canonical={`${site}${base}`}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={ld}
    >
      <article class="show-hub">
        <header class="detail-hero frame-hero">
          {heroFrame ? <div class="hero-backdrop" style={heroFrame}></div> : null}
          <div class="detail-head">
            <div class="detail-side">
              {HeroPoster(show)}
            </div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> More like this
              </p>
              <h1>Shows like {show.name}</h1>
              <p class="summary">
                The {similar.length} closest matches on shared genres, ranked by match strength
                and popularity — each with its evidence: shared cast, networks, and where it's
                streaming in your region.
              </p>
            </div>
          </div>
        </header>
        <ShowTabs slug={show.slug} current="similar" />
        <section>
          <h2>The closest matches</h2>
          <ol class="dossier-board">
            {similar.map((s, i) => (
              <DossierRow
                i={i}
                href={`/show/${s.slug}`}
                name={s.name}
                d={buildDossier(show, s, region)}
                rating={s.rating}
                poster={posterSrc(s)}
                compare={{
                  href: comparePathFor(show.slug, s.slug),
                  label: `Compare ${s.name} with ${show.name}`,
                }}
              />
            ))}
          </ol>
        </section>
        <section>
          <h2>Keep going</h2>
          <nav class="pill-nav">
            <a class="chev-after" href={`/show/${show.slug}`}>
              {show.name} overview
            </a>
            <a class="chev-after" href={`/show/${show.slug}/where-to-watch`}>
              Where to watch
            </a>
            <a class="chev-after" href="/what-to-watch">
              What should I watch tonight?
            </a>
          </nav>
        </section>
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
      </article>
    </Layout>,
  );
});

// Media: the show's designed artwork and its YouTube trailers/clips,
// straight from TMDB (one edge-cached call) — no mirror tables touched.
app.get("/show/:slug/media", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const media =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbMedia(c.env.TMDB_API_KEY, show.tmdb_id)
      : null;
  const base = `/show/${show.slug}/media`;
  const site = origin(c);

  const trailer = media?.videos.find((v) => v.type === "Trailer") ?? media?.videos[0] ?? null;
  const clips = (media?.videos ?? []).filter((v) => v !== trailer).slice(0, 9);
  const backdrops = (media?.backdrops ?? []).slice(0, 12);
  const posters = (media?.posters ?? []).slice(0, 12);
  const hasAny = Boolean(trailer || clips.length || backdrops.length || posters.length);

  const backdrop =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id)
      : null;
  const posterBg = hiRes(show.image_url);
  const heroFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : posterBg
      ? heroBg(posterBg)
      : null;

  const ld: unknown[] = [breadcrumbLd(site, show, "Media", base)];
  if (trailer) {
    ld.push({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: trailer.name,
      thumbnailUrl: `https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${trailer.key}`,
      ...(trailer.published ? { uploadDate: trailer.published } : {}),
    });
  }

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name} — trailer, posters & artwork | TV Nightly`}
      description={`Every trailer, clip, poster and backdrop for ${show.name} in one place.`}
      canonical={`${site}${base}`}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={ld}
      scripts={["/js/media-lightbox.js"]}
    >
      <article class="show-hub">
        <header class="detail-hero frame-hero">
          {heroFrame ? <div class="hero-backdrop" style={heroFrame}></div> : null}
          <div class="detail-head">
            <div class="detail-side">
              {HeroPoster(show)}
            </div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> Media
              </p>
              <h1>{show.name} — trailers & artwork</h1>
              <p class="summary">
                {hasAny
                  ? `The official trailers, clips, posters and backdrops for ${show.name}.`
                  : `No media available for ${show.name} yet.`}
              </p>
            </div>
          </div>
        </header>
        <ShowTabs slug={show.slug} current="media" />
        {trailer ? (
          <section>
            <h2>Trailer</h2>
            <div class="media-player">
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${trailer.key}`}
                title={trailer.name}
                loading="lazy"
                allowfullscreen
                allow="encrypted-media; picture-in-picture"
              ></iframe>
            </div>
          </section>
        ) : null}
        {clips.length ? (
          <section>
            <h2>More videos</h2>
            <div class="media-videos">
              {clips.map((v) => (
                <a
                  class="media-video"
                  href={`https://www.youtube.com/watch?v=${v.key}`}
                  target="_blank"
                  rel="noopener"
                >
                  <span class="media-thumb">
                    <img
                      src={`https://img.youtube.com/vi/${v.key}/hqdefault.jpg`}
                      alt=""
                      width="480"
                      height="360"
                      loading="lazy"
                      decoding="async"
                    />
                    <IconPlay size={34} />
                  </span>
                  <span class="media-video-kind">{v.type}</span>
                  <span class="media-video-name">{v.name}</span>
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {backdrops.length ? (
          <section>
            <h2>Backdrops</h2>
            <div class="media-backdrops" data-gallery-title={show.name} data-gallery-kind="Backdrop">
              {backdrops.map((p, i) => (
                <a
                  class="media-art"
                  href={`https://image.tmdb.org/t/p/original${p}`}
                  target="_blank"
                  rel="noopener"
                  data-gallery="backdrops"
                  data-view={`https://image.tmdb.org/t/p/w1280${p}`}
                  data-alt={`${show.name} backdrop ${i + 1} of ${backdrops.length}`}
                >
                  <img
                    src={`https://image.tmdb.org/t/p/w780${p}`}
                    srcset={`https://image.tmdb.org/t/p/w780${p} 1x, https://image.tmdb.org/t/p/w1280${p} 2x`}
                    alt=""
                    width="780"
                    height="439"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {posters.length ? (
          <section>
            <h2>Posters</h2>
            <div class="media-posters" data-gallery-title={show.name} data-gallery-kind="Poster">
              {posters.map((p, i) => (
                <a
                  class="media-art"
                  href={`https://image.tmdb.org/t/p/original${p}`}
                  target="_blank"
                  rel="noopener"
                  data-gallery="posters"
                  data-view={`https://image.tmdb.org/t/p/w780${p}`}
                  data-alt={`${show.name} poster ${i + 1} of ${posters.length}`}
                >
                  <img
                    src={`https://image.tmdb.org/t/p/w342${p}`}
                    srcset={`https://image.tmdb.org/t/p/w342${p} 1x, https://image.tmdb.org/t/p/w780${p} 2x`}
                    alt=""
                    width="342"
                    height="513"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <h2>Keep going</h2>
          <nav class="pill-nav">
            <a class="chev-after" href={`/show/${show.slug}`}>
              {show.name} overview
            </a>
            <a class="chev-after" href={`/show/${show.slug}/similar`}>
              Shows like {show.name}
            </a>
            <a class="chev-after" href={`/show/${show.slug}/where-to-watch`}>
              Where to watch
            </a>
          </nav>
        </section>
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
      </article>
    </Layout>,
  );
});

app.get("/show/:slug/season/:n{[0-9]+}", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const n = Number(c.req.param("n"));
  const [{ results: eps }, maxRow, similar] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM episodes WHERE show_id = ? AND season = ? ORDER BY number")
      .bind(show.id, n)
      .all<EpisodeRow>(),
    c.env.DB.prepare("SELECT MAX(season) AS m FROM episodes WHERE show_id = ?")
      .bind(show.id)
      .first<{ m: number | null }>(),
    similarShows(c.env.DB, show),
  ]);
  if (eps.length === 0) return c.notFound();
  const region = visitorRegion(c);

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name} Season ${n} — episode list, ratings & air dates | TV Nightly`}
      description={`All ${eps.length} episodes of ${show.name} Season ${n}, with air dates and viewer ratings.`}
      canonical={canonical(c)}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, `Season ${n}`, path)]}
    >
      <h1 class="epreg-h1">
        <a href={`/show/${show.slug}`}>{show.name}</a> — Season {n}
      </h1>
      <SeasonTabs slug={show.slug} season={n} current="overview" latest={n === maxRow?.m} />
      <p class="epreg-method">
        All {eps.length} episodes in airing order, with first-run dates and viewer ratings.
      </p>
      {(() => {
        const anyStill = eps.some((e) => e.image_url);
        return (
          <ol class={anyStill ? "epreg" : "epreg epreg--textonly"}>
            {eps.map((e, i) => (
              <li>
                {/* the numeral IS the episode number here, so the chyron
                    skips the code — one encoding per fact */}
                <span class="epreg-num">{String(e.number ?? i + 1).padStart(2, "0")}</span>
                {anyStill ? (
                  <a class="epreg-still-link" href={epHref(show.slug, e)} tabindex={-1} aria-hidden="true">
                    {e.image_url ? (
                      <img
                        class="epreg-still"
                        src={e.image_url}
                        srcset={`${e.image_url} 1x, ${largeStill(e.image_url)} 2x`}
                        width="168"
                        height="95"
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
                  {e.airdate || e.runtime ? (
                    <p class="epreg-meta">
                      {e.airdate ? <span>{longDate(e.airdate)}</span> : null}
                      {e.airdate && e.runtime ? <span class="sep"> · </span> : null}
                      {e.runtime ? <span class="epreg-rt">{e.runtime} min</span> : null}
                    </p>
                  ) : null}
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
        );
      })()}
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

export default app;
