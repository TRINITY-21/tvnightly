import { Hono } from "hono";
import { raw } from "hono/html";
import { Bindings, EpisodeRow } from "../types";
import { visitorRegion } from "../lib/providers";
import { stripHtml, epCode, slugifyName, personHref, comparePathFor } from "../lib/format";
import { origin, canonical, breadcrumbLd } from "../lib/seo";
import { getShow, similarShows } from "../lib/queries";
import { titleStat } from "../lib/ratings";
import { hubForGenres } from "../lib/verticals";
import { Layout } from "../components/Layout";
import { ShowTabs } from "../components/nav";
import { StatusBadge, ShowCard, ExploreCard, ClampSummary } from "../components/cards";
import { ProviderLine } from "../components/providers";
import { RateInline } from "../components/forms";

const app = new Hono<{ Bindings: Bindings }>();

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
      ...(show.image_url ? { image: show.image_url } : {}),
      ...(show.premiered ? { startDate: show.premiered } : {}),
      ...(show.ended ? { endDate: show.ended } : {}),
      ...(seasons.size ? { numberOfSeasons: Math.max(...seasons.keys()) } : {}),
    },
  ];

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={`${show.name} — episodes, ratings & renewal status | TV Nightly`}
      description={stripHtml(show.summary).slice(0, 155)}
      canonical={canonical(c)}
      ld={ld}
      ogImage={show.image_url ?? undefined}
    >
      <article class="show-hub">
        <header class="detail-hero">
          {show.image_url ? (
            <div class="hero-backdrop" style={`background-image:url('${show.image_url}')`}></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side">
              {show.image_url ? (
                <img class="poster" src={show.image_url} alt={show.name} />
              ) : (
                <div class="poster card-fallback">{show.name}</div>
              )}
              <RateInline kind="tv" refId={String(show.id)} stat={stat} />
            </div>
            <div class="detail-info">
              <h1>{show.name}</h1>
              <p class="meta-strip">
                {/* the year range carries the status: closed = ended, –present = airing */}
                <span>TV</span>
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
                      {seasons.size} season{seasons.size === 1 ? "" : "s"}, {episodes.length}{" "}
                      episode{episodes.length === 1 ? "" : "s"}
                    </span>
                  </>
                ) : null}
                {show.network || show.web_channel ? (
                  <>
                    <span class="sep">·</span>
                    <span>{show.network ?? show.web_channel}</span>
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
                            <a href={`/genre/${slugifyName(x)}`}>{x}</a>
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
                region={visitorRegion(c)}
                fallbackHref={`/show/${show.slug}/release-date`}
                pickerType="tv"
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
                          {e.name} <span class="muted">{epCode(e)}</span>
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
            {(() => {
              const latest = Math.max(...seasons.keys());
              return [...seasons.entries()].map(([season, eps]) => {
                const rated = eps.filter((e) => e.rating != null);
                const avg = rated.length
                  ? rated.reduce((s, e) => s + e.rating!, 0) / rated.length
                  : null;
                const year = eps.find((e) => e.airdate)?.airdate?.slice(0, 4);
                return (
                  <details class="season-fold" open={season === latest}>
                    <summary>
                      <span class="fold-title">Season {season}</span>
                      <span class="fold-stats muted">
                        {eps.length} episode{eps.length === 1 ? "" : "s"}
                        {year ? ` · ${year}` : ""}
                        {avg != null ? ` · avg ★ ${avg.toFixed(1)}` : ""}
                      </span>
                    </summary>
                    <ol class="ep-list">
                      {eps.map((e) => (
                        <li>
                          <span class="muted">{epCode(e)}</span> {e.name}
                          {e.rating != null ? (
                            <span class="rating"> ★ {e.rating.toFixed(1)}</span>
                          ) : null}
                          {e.airdate ? <span class="muted"> · {e.airdate}</span> : null}
                        </li>
                      ))}
                    </ol>
                    <p>
                      <a class="chev-after" href={`/show/${show.slug}/season/${season}`}>
                        Season {season} ranked & reviewed
                      </a>
                    </p>
                  </details>
                );
              });
            })()}
          </section>
        ) : null}
        {similar.length ? (
          <section>
            <h2>Shows like {show.name}</h2>
            <div class="grid">
              {similar.map((s) => (
                <div class="card-stack">
                  <ShowCard show={s} />
                  <a class="vote-btn compare-btn" href={comparePathFor(show.slug, s.slug)}>
                    COMPARE
                  </a>
                </div>
              ))}
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
                  icon="VS"
                  title={`Compare ${show.name}`}
                  desc="Stack its full episode-rating history against any other show, on one chart."
                  href={`/compare?a=${show.slug}`}
                />
                <ExploreCard
                  icon="EPS"
                  title="The essential episodes"
                  desc="Short on time? The pilot-to-finale shortcut, only the episodes that matter."
                  href={`/show/${show.slug}/essential`}
                />
                {netEntry ? (
                  <ExploreCard
                    icon="NET"
                    title={`Best ${netEntry.name} shows`}
                    desc="More from the same network, ranked by rating."
                    href={`/network/${netEntry.slug}`}
                  />
                ) : null}
                {genres.slice(0, 2).map((g) => (
                  <ExploreCard
                    icon="GEN"
                    title={`Best ${g.toLowerCase()} shows & films`}
                    desc={`The top of the ${g.toLowerCase()} pile, across both mediums.`}
                    href={`/genre/${slugifyName(g)}`}
                  />
                ))}
                {hub ? (
                  <ExploreCard
                    icon="HUB"
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

app.get("/show/:slug/season/:n{[0-9]+}", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const n = Number(c.req.param("n"));
  const { results: eps } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? AND season = ? ORDER BY number",
  )
    .bind(show.id, n)
    .all<EpisodeRow>();
  if (eps.length === 0) return c.notFound();

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name} Season ${n} — episode list, ratings & air dates | TV Nightly`}
      description={`All ${eps.length} episodes of ${show.name} Season ${n}, with air dates and viewer ratings.`}
      canonical={canonical(c)}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, `Season ${n}`, path)]}
    >
      <h1>
        <a href={`/show/${show.slug}`}>{show.name}</a> — Season {n}
      </h1>
      <ShowTabs slug={show.slug} />
      <ol class="ep-list">
        {eps.map((e) => (
          <li>
            <span class="muted">{epCode(e)}</span> <strong>{e.name}</strong>
            {e.rating != null ? <span class="rating"> ★ {e.rating.toFixed(1)}</span> : null}
            {e.airdate ? <span class="muted"> · {e.airdate}</span> : null}
            {e.summary ? <p class="muted">{stripHtml(e.summary)}</p> : null}
          </li>
        ))}
      </ol>
    </Layout>,
  );
});

export default app;
