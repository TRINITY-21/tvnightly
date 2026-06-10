import { Hono } from "hono";
import type { Context } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import { runSync, type SyncEnv } from "./sync";
import { sendEmails } from "./email";
import { signToken, verifyToken } from "./tokens";

type Bindings = SyncEnv;
type AppContext = Context<{ Bindings: Bindings }>;
const app = new Hono<{ Bindings: Bindings }>();

interface ShowRow {
  id: number;
  slug: string;
  name: string;
  status: string | null;
  premiered: string | null;
  ended: string | null;
  network: string | null;
  web_channel: string | null;
  rating: number | null;
  weight: number;
  image_url: string | null;
  summary: string | null;
  imdb_id: string | null;
  blurb: string | null;
  genres: string | null; // JSON string array, e.g. '["Drama","Crime"]'
  runtime: number | null;
}

interface EpisodeRow {
  id: number;
  show_id: number;
  season: number | null;
  number: number | null;
  name: string | null;
  airdate: string | null;
  airstamp: string | null;
  runtime: number | null;
  rating: number | null;
  image_url: string | null;
  summary: string | null;
}

type TonightRow = EpisodeRow & { show_name: string; show_slug: string; network: string | null };

interface MovieRow {
  imdb_id: string;
  slug: string;
  title: string;
  year: number | null;
  release_date: string | null;
  overview: string | null;
  genres: string | null; // JSON string array
  runtime: number | null;
  rating: number | null;
  votes: number | null;
  popularity: number | null;
  poster_url: string | null;
  providers: string | null; // JSON string array of US streaming services
}

const stripHtml = (s: string | null) => (s ?? "").replace(/<[^>]*>/g, "").trim();
const epCode = (e: EpisodeRow) =>
  `S${String(e.season ?? 0).padStart(2, "0")}E${String(e.number ?? 0).padStart(2, "0")}`;

const getShow = (db: D1Database, slug: string) =>
  db.prepare("SELECT * FROM shows WHERE slug = ?").bind(slug).first<ShowRow>();

/**
 * Popular shows ranked by genre overlap (2+ shared genres when possible) —
 * internal links to their money pages, full rows for card rendering.
 */
async function similarShows(db: D1Database, show: ShowRow): Promise<ShowRow[]> {
  const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const gs = genres.slice(0, 3);
  if (gs.length === 0) return [];
  const overlapExpr = gs.map(() => "(CASE WHEN genres LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, (${overlapExpr}) AS ov
         FROM shows WHERE id != ? AND weight >= ?
       ) WHERE ov >= ? ORDER BY ov DESC, weight DESC LIMIT 6`,
    )
    .bind(...gs.map((g) => `%"${g}"%`), show.id, PICKER_MIN_WEIGHT, Math.min(2, gs.length))
    .all<ShowRow>();
  return results;
}

/** Movie counterpart: genre-overlap similarity over the curated movies table. */
async function similarMovies(db: D1Database, movie: MovieRow): Promise<MovieRow[]> {
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const gs = genres.slice(0, 3);
  if (gs.length === 0) return [];
  const overlapExpr = gs.map(() => "(CASE WHEN genres LIKE ? THEN 1 ELSE 0 END)").join(" + ");
  const { results } = await db
    .prepare(
      `SELECT * FROM (
         SELECT *, (${overlapExpr}) AS ov FROM movies WHERE imdb_id != ?
       ) WHERE ov >= ? ORDER BY ov DESC, rating DESC, popularity DESC LIMIT 6`,
    )
    .bind(...gs.map((g) => `%"${g}"%`), movie.imdb_id, Math.min(2, gs.length))
    .all<MovieRow>();
  return results;
}

const origin = (c: AppContext) => c.env.SITE_ORIGIN ?? new URL(c.req.url).origin;
const canonical = (c: AppContext) => origin(c) + new URL(c.req.url).pathname;

// </script> can't appear inside a JSON-LD block; escape < to be safe.
const jsonLd = (data: unknown) =>
  raw(
    `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
  );

const COUNTDOWN_JS = `<script>(function(){var el=document.getElementById('countdown');if(!el||!el.dataset.ts)return;var t=new Date(el.dataset.ts).getTime();function tick(){var d=t-Date.now();if(d<=0){el.textContent='Airing now';return}var s=Math.floor(d/1000);el.textContent=Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m '+(s%60)+'s';setTimeout(tick,1000)}tick()})();</script>`;

const Layout: FC<
  PropsWithChildren<{
    title: string;
    description?: string;
    canonical?: string;
    ld?: unknown[];
    ogImage?: string;
    scripts?: string[];
    noindex?: boolean;
  }>
> = (props) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{props.title}</title>
      {props.description ? <meta name="description" content={props.description} /> : null}
      {props.canonical ? <link rel="canonical" href={props.canonical} /> : null}
      {props.noindex ? <meta name="robots" content="noindex" /> : null}
      <meta property="og:site_name" content="TV Nightly" />
      <meta property="og:type" content="website" />
      <meta property="og:title" content={props.title} />
      {props.description ? <meta property="og:description" content={props.description} /> : null}
      {props.canonical ? <meta property="og:url" content={props.canonical} /> : null}
      {props.ogImage ? <meta property="og:image" content={props.ogImage} /> : null}
      {/* Posters are portrait — the small summary card crops far better than large-image. */}
      <meta name="twitter:card" content="summary" />
      <link rel="stylesheet" href="/styles.css" />
      {(props.ld ?? []).map((d) => jsonLd(d))}
    </head>
    <body>
      <header class="site-header">
        <a class="logo" href="/">
          TV Nightly
        </a>
        <form action="/search" method="get" class="search">
          <input type="search" name="q" placeholder="Search shows…" required />
        </form>
        <nav>
          <a href="/recommend">Recommend me</a>
          <a href="/loved">Loved</a>
          <a href="/what-to-watch">What to watch</a>
          <a href="/movies">Movies</a>
          <a href="/tonight">Tonight</a>
          <a href="/calendar">Calendar</a>
          <a href="/renewals">Renewals</a>
        </nav>
      </header>
      <main>{props.children}</main>
      <footer class="site-footer">
        <div class="footer-sub">
          <p>
            <strong>Stay updated</strong> — today's TV, renewals and premieres in your inbox.
          </p>
          <form action="/subscribe" method="post" class="sub-form">
            <input type="hidden" name="kind" value="daily" />
            <input type="email" name="email" placeholder="Enter your email" required />
            <button type="submit">Subscribe</button>
          </form>
        </div>
        <p class="disclaimer">
          <strong>Disclaimer:</strong> TV Nightly is independent and is not affiliated with any TV
          shows, networks, or data sources. While we aim to provide reliable information, the data
          presented on this site is not guaranteed to be accurate, complete, or current.
        </p>
        <p>
          TV information from{" "}
          <a href="https://www.tvmaze.com" rel="noopener">
            TVmaze.com
          </a>{" "}
          (CC BY-SA).{" "}
          <a href="https://www.themoviedb.org" rel="noopener">
            <img
              class="tmdb-logo"
              src="https://files.readme.io/29c6fee-blue_short.svg"
              alt="TMDB"
              height="11"
            />
          </a>{" "}
          This product uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise
          approved by TMDB. Streaming availability data from{" "}
          <a href="https://www.justwatch.com" rel="noopener">
            JustWatch
          </a>{" "}
          via TMDB.
        </p>
        <p>
          <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a> · © 2026 TV
          Nightly. All rights reserved.
        </p>
      </footer>
      {["/js/typeahead.js", ...(props.scripts ?? [])].map((s) => (
        <script src={s} defer></script>
      ))}
    </body>
  </html>
);

const StatusBadge: FC<{ status: string | null }> = ({ status }) => {
  const cls = status === "Running" ? "ok" : status === "Ended" ? "ended" : "tbd";
  return <span class={`badge ${cls}`}>{status ?? "Unknown"}</span>;
};

const ShowCard: FC<{ show: ShowRow }> = ({ show }) => (
  <a class="card" href={`/show/${show.slug}`}>
    {show.image_url ? (
      <img src={show.image_url} alt={show.name} loading="lazy" />
    ) : (
      <div class="card-fallback">{show.name}</div>
    )}
    <div class="card-body">
      <span class="card-title">{show.name}</span>
      {show.rating != null ? <span class="rating">★ {show.rating.toFixed(1)}</span> : null}
    </div>
  </a>
);

const MovieCard: FC<{ movie: MovieRow }> = ({ movie }) => (
  <a class="card" href={`/movie/${movie.slug}`}>
    {movie.poster_url ? (
      <img src={movie.poster_url} alt={movie.title} loading="lazy" />
    ) : (
      <div class="card-fallback">{movie.title}</div>
    )}
    <div class="card-body">
      <span class="card-title">{movie.title}</span>
      {movie.rating != null ? <span class="rating">★ {movie.rating.toFixed(1)}</span> : null}
    </div>
  </a>
);

/** One-tap verdict buttons + community stat — every title page collects data. */
const RateInline: FC<{ kind: string; refId: string; stat: string | null }> = ({ kind, refId, stat }) => (
  <div class="rate-inline">
    <span class="muted">{stat ?? "Seen it?"}</span>
    {(
      [
        ["love", "😍"],
        ["like", "🙂"],
        ["meh", "😴"],
      ] as const
    ).map(([value, emoji]) => (
      <form method="post" action="/recommend" class="verdict-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="ref" value={refId} />
        <input type="hidden" name="verdict" value={value} />
        <button type="submit" class="vote-btn" aria-label={`Rate: ${value}`}>
          {emoji}
        </button>
      </form>
    ))}
  </div>
);

const SubscribeForm: FC<{ showId: number; label: string }> = ({ showId, label }) => (
  <form action="/subscribe" method="post" class="sub-form inline">
    <input type="hidden" name="kind" value="renewal" />
    <input type="hidden" name="show_id" value={String(showId)} />
    <label>{label}</label>
    <input type="email" name="email" placeholder="you@example.com" required />
    <button type="submit">Notify me</button>
  </form>
);

const breadcrumbLd = (site: string, show: ShowRow, page: string, path: string) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "TV Nightly", item: site },
    { "@type": "ListItem", position: 2, name: show.name, item: `${site}/show/${show.slug}` },
    { "@type": "ListItem", position: 3, name: page, item: `${site}${path}` },
  ],
});

// ---------------------------------------------------------------- home

app.get("/", async (c) => {
  const { results: top } = await c.env.DB.prepare(
    "SELECT * FROM shows ORDER BY weight DESC, rating DESC LIMIT 24",
  ).all<ShowRow>();
  const { results: tonight } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE date(e.airstamp) = date('now')
     ORDER BY e.airstamp LIMIT 12`,
  ).all<TonightRow>();
  const { results: premieres } = await c.env.DB.prepare(
    `SELECT e.airdate, e.season, s.name AS show_name, s.slug AS show_slug
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.number = 1 AND e.airstamp > datetime('now')
       AND e.airstamp < datetime('now', '+21 days')
     ORDER BY e.airstamp LIMIT 8`,
  ).all<{ airdate: string | null; season: number | null; show_name: string; show_slug: string }>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="TV Nightly — best episodes, release dates & what's on TV tonight"
      description="Track the best episodes of every TV show, season release dates, renewal status, and what's airing tonight."
      canonical={canonical(c)}
    >
      <section class="hero">
        <h2>Can't decide what to watch tonight?</h2>
        <p>
          <a class="verdict-btn" href="/what-to-watch">
            Spin the picker 🎲
          </a>{" "}
          <a class="verdict-btn" href="/recommend">
            Rate one thing → get your pick
          </a>
        </p>
      </section>
      {tonight.length ? (
        <section>
          <h2>
            On tonight{" "}
            <a class="more" href="/tonight">
              all of tonight →
            </a>
          </h2>
          <ul class="ep-list">
            {tonight.map((e) => (
              <li>
                <a href={`/show/${e.show_slug}`}>{e.show_name}</a> {epCode(e)}
                {e.name ? ` — ${e.name}` : ""}
                {e.network ? <span class="muted"> · {e.network}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {premieres.length ? (
        <section>
          <h2>
            Premiering soon{" "}
            <a class="more" href="/premieres">
              all upcoming →
            </a>
          </h2>
          <ul class="ep-list">
            {premieres.map((p) => (
              <li>
                <span class="muted">{p.airdate}</span>{" "}
                <a href={`/show/${p.show_slug}/release-date`}>{p.show_name}</a> Season {p.season}{" "}
                premiere
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2>
          Popular shows{" "}
          <a class="more" href="/best-episodes">
            all-time top episodes →
          </a>
        </h2>
        <div class="grid">
          {top.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      </section>
    </Layout>,
  );
});

// ------------------------------------------- all-time best episodes (global)

app.get("/best-episodes", async (c) => {
  // TVmaze exposes no episode vote counts, so raw averages include one-voter
  // 10.0s. Shrink each episode toward its show's overall rating (Bayesian-ish
  // prior) and cap each show at 3 entries to keep the list honest and varied.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT e.*, s.name AS show_name, s.slug AS show_slug,
              (e.rating + 2.0 * s.rating) / 3.0 AS score,
              ROW_NUMBER() OVER (PARTITION BY e.show_id ORDER BY e.rating DESC) AS rn
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.rating IS NOT NULL AND s.rating IS NOT NULL AND s.weight >= 75
     ) WHERE rn <= 3 ORDER BY score DESC, id LIMIT 100`,
  ).all<EpisodeRow & { show_name: string; show_slug: string }>();

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="The 100 highest-rated TV episodes of all time | TV Nightly"
      description={`The best single episodes of television ever made, ranked by viewer rating${
        results[0] ? `, starting with ${results[0].show_name}'s "${results[0].name}"` : ""
      }.`}
      canonical={canonical(c)}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "The highest-rated TV episodes of all time",
          itemListElement: results.slice(0, 25).map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${e.show_name}: ${e.name ?? epCode(e)} (${epCode(e)})`,
            url: `${origin(c)}/show/${e.show_slug}/best-episodes`,
          })),
        },
      ]}
    >
      <h1>The highest-rated TV episodes of all time</h1>
      <p class="muted">
        Ranked by viewer rating, weighted against each show's overall score so tiny-sample
        outliers don't game the list. Max three entries per show.
      </p>
      {results.length === 0 ? <p class="muted">Ratings are still loading — check back soon.</p> : null}
      <ol class="ranked">
        {results.map((e) => (
          <li>
            <strong>
              <a href={`/show/${e.show_slug}/best-episodes`}>{e.show_name}</a>: {e.name}
            </strong>{" "}
            <span class="muted">{epCode(e)}</span>
            <span class="rating"> ★ {e.rating!.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </Layout>,
  );
});

// ---------------------------------------------------------------- show hub

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
  const similar = await similarShows(c.env.DB, show);
  const stat = await titleStat(c.env.DB, "tv", String(show.id));

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
        <div class="show-head">
          {show.image_url ? (
            <img class="poster" src={show.image_url} alt={show.name} />
          ) : (
            <div class="poster card-fallback">{show.name}</div>
          )}
          <div>
            <h1>{show.name}</h1>
            <p>
              <StatusBadge status={show.status} />
              {show.premiered ? <span class="muted"> · {show.premiered.slice(0, 4)}</span> : null}
              {show.network || show.web_channel ? (
                <span class="muted"> · {show.network ?? show.web_channel}</span>
              ) : null}
              {show.rating != null ? (
                <span class="rating"> · ★ {show.rating.toFixed(1)}</span>
              ) : null}
            </p>
            <nav class="show-nav">
              <a href={`/show/${show.slug}/best-episodes`}>Best episodes</a>
              <a href={`/show/${show.slug}/essential`}>Essential</a>
              <a href={`/show/${show.slug}/ratings`}>Ratings graph</a>
              <a href={`/show/${show.slug}/next-episode`}>Next episode</a>
              <a href={`/show/${show.slug}/release-date`}>Release date</a>
              <a href={`/show/${show.slug}/calendar.ics`}>📅 Calendar</a>
            </nav>
            <RateInline kind="tv" refId={String(show.id)} stat={stat} />
            {show.blurb ? <p class="blurb">{show.blurb}</p> : null}
            {show.summary ? <div class="summary">{raw(show.summary)}</div> : null}
          </div>
        </div>
        {[...seasons.entries()].map(([season, eps]) => (
          <section>
            <h2>
              <a href={`/show/${show.slug}/season/${season}`}>Season {season}</a>
            </h2>
            <ol class="ep-list">
              {eps.map((e) => (
                <li>
                  <span class="muted">{epCode(e)}</span> {e.name}
                  {e.rating != null ? <span class="rating"> ★ {e.rating.toFixed(1)}</span> : null}
                  {e.airdate ? <span class="muted"> · {e.airdate}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        ))}
        {similar.length ? (
          <section>
            <h2>More like {show.name}</h2>
            <ul class="ep-list">
              {similar.map((s) => (
                <li>
                  <a href={`/show/${s.slug}/best-episodes`}>The best episodes of {s.name}</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
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
  const { results: eps } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();
  const lengthParam = Number(c.req.query("length") ?? 15);
  const n = [10, 15, 25].includes(lengthParam) ? lengthParam : 15;
  const ratedCount = eps.filter((e) => e.rating != null).length;
  const picks = ratedCount >= 10 ? essentialPicks(eps, n, show.status === "Ended") : [];

  const site = origin(c);
  const path = `/show/${show.slug}/essential`;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`The ${picks.length || "essential"} episodes of ${show.name} you must watch | TV Nightly`}
      description={`Short on time? The essential ${show.name} watch list: pilot, every season's peak, and the all-time greats — skip the rest.`}
      canonical={n === 15 ? `${site}${path}` : `${site}${path}?length=${n}`}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Essential episodes", path)]}
    >
      <article>
        <h1>
          The essential episodes of <a href={`/show/${show.slug}`}>{show.name}</a>
        </h1>
        {picks.length === 0 ? (
          <p class="muted">
            Not enough rated episodes yet to build a reliable essential list — check back soon.
          </p>
        ) : (
          <>
            <p class="muted">
              Watch these {picks.length} in order and you've got {show.name}. How much time do you
              have? <a href={`${path}?length=10`}>10 episodes</a> ·{" "}
              <a href={`${path}?length=15`}>15</a> · <a href={`${path}?length=25`}>25</a>
            </p>
            <ol class="ep-list">
              {picks.map(({ ep, why }) => (
                <li>
                  <span class="muted">{epCode(ep)}</span> <strong>{ep.name}</strong>{" "}
                  <span class="why-tag">{why}</span>
                  {ep.rating != null ? <span class="rating"> ★ {ep.rating.toFixed(1)}</span> : null}
                  {ep.summary ? <p class="muted">{stripHtml(ep.summary)}</p> : null}
                </li>
              ))}
            </ol>
            <p>
              Want the full picture? <a href={`/show/${show.slug}/best-episodes`}>Best episodes</a>{" "}
              · <a href={`/show/${show.slug}/ratings`}>Ratings graph</a>
            </p>
          </>
        )}
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
      </article>
    </Layout>,
  );
});

// ------------------------------------------------- episode ratings graph

function ratingsSvg(eps: EpisodeRow[]): string {
  const rated = eps.filter((e) => e.rating != null);
  if (rated.length === 0) return "";
  const PAD = 34;
  const STEP = 9;
  const W = Math.max(420, rated.length * STEP + PAD * 2);
  const H = 240;
  const yFor = (r: number) => {
    const clamped = Math.max(5, Math.min(10, r));
    return PAD + (10 - clamped) * ((H - PAD * 2) / 5);
  };
  const colorFor = (r: number) => {
    const t = Math.max(0, Math.min(1, (r - 6) / 3.5)); // 6 -> red, 9.5+ -> green
    return `hsl(${Math.round(t * 120)},70%,50%)`;
  };
  const parts: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Episode ratings by season">`,
  ];
  // season bands
  let x = PAD;
  let season = rated[0].season ?? 0;
  let bandStart = x;
  let bandIdx = 0;
  const flushBand = (endX: number) => {
    parts.push(
      `<rect x="${bandStart}" y="${PAD}" width="${endX - bandStart}" height="${H - PAD * 2}" fill="${bandIdx % 2 ? "#181b24" : "#11141d"}"/>`,
      `<text x="${(bandStart + endX) / 2}" y="${H - 10}" fill="#8b91a0" font-size="10" text-anchor="middle">S${season}</text>`,
    );
    bandIdx++;
  };
  for (const e of rated) {
    if ((e.season ?? 0) !== season) {
      flushBand(x);
      season = e.season ?? 0;
      bandStart = x;
    }
    x += STEP;
  }
  flushBand(x);
  // gridlines
  for (const r of [5, 6, 7, 8, 9, 10]) {
    parts.push(
      `<line x1="${PAD}" y1="${yFor(r)}" x2="${x}" y2="${yFor(r)}" stroke="#2a2f3d" stroke-width="0.5"/>`,
      `<text x="${PAD - 6}" y="${yFor(r) + 3}" fill="#8b91a0" font-size="10" text-anchor="end">${r}</text>`,
    );
  }
  // points
  let px = PAD;
  for (const e of rated) {
    const title = `${epCode(e)} ${e.name ?? ""} — ${e.rating!.toFixed(1)}`.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    parts.push(
      `<circle cx="${px + STEP / 2}" cy="${yFor(e.rating!)}" r="3" fill="${colorFor(e.rating!)}"><title>${title}</title></circle>`,
    );
    px += STEP;
  }
  parts.push("</svg>");
  return parts.join("");
}

app.get("/show/:slug/ratings", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const { results: eps } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();
  const svg = ratingsSvg(eps);
  const rated = eps.filter((e) => e.rating != null);

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name} episode ratings graph — every episode charted | TV Nightly`}
      description={`Every rated ${show.name} episode on one chart: see the peaks, the dips, and how each season compares.`}
      canonical={canonical(c)}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Ratings graph", path)]}
    >
      <h1>
        <a href={`/show/${show.slug}`}>{show.name}</a>: episode ratings graph
      </h1>
      {svg ? (
        <>
          <p class="muted">
            {rated.length} rated episodes, hover any dot for details. Higher and greener is better.
          </p>
          <div class="graph-wrap">{raw(svg)}</div>
          <p>
            <a href={`/show/${show.slug}/best-episodes`}>Best episodes</a> ·{" "}
            <a href={`/show/${show.slug}/worst-episodes`}>Worst episodes</a> ·{" "}
            <a href={`/show/${show.slug}/essential`}>Essential watch list</a>
          </p>
        </>
      ) : (
        <p class="muted">No rated episodes yet for {show.name}.</p>
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

    // Optional per-season filter, validated against the show's real seasons.
    const { results: seasonRows } = await c.env.DB.prepare(
      "SELECT DISTINCT season AS s FROM episodes WHERE show_id = ? AND season IS NOT NULL ORDER BY season",
    )
      .bind(show.id)
      .all<{ s: number }>();
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

    const similar = kind === "best" ? await similarShows(c.env.DB, show) : [];
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

    c.header("Cache-Control", "public, max-age=3600");
    return c.html(
      <Layout
        title={`The ${eps.length} ${kind} episodes of ${show.name}${seasonLabel}, ranked | TV Nightly`}
        description={`${show.name}${seasonLabel}'s ${kind} episodes ranked by viewer rating, from ${
          eps[0] ? `"${eps[0].name}"` : "the top"
        } down.`}
        canonical={season != null ? `${site}${base}?season=${season}` : `${site}${base}`}
        ogImage={show.image_url ?? undefined}
        scripts={["/js/votes.js"]}
        ld={ld}
      >
        <article data-show-id={String(show.id)}>
          <h1>
            The {kind} episodes of <a href={`/show/${show.slug}`}>{show.name}</a>
            {seasonLabel}
          </h1>
          {show.blurb && kind === "best" ? <p class="blurb">{show.blurb}</p> : null}
          {seasons.length > 1 && seasons.length <= 30 ? (
            <p class="muted">
              Filter: <a href={base}>{season == null ? <strong>All</strong> : "All"}</a>
              {seasons.map((s) => (
                <>
                  {" · "}
                  <a href={`${base}?season=${s}`}>
                    {season === s ? <strong>S{s}</strong> : `S${s}`}
                  </a>
                </>
              ))}
            </p>
          ) : null}
          {eps.length < 10 ? (
            <p class="muted">
              Not enough rated episodes yet for a reliable ranking — check back as ratings come in.
            </p>
          ) : null}
          <ol class="ranked">
            {eps.map((e) => (
              <li>
                <strong>{e.name}</strong> <span class="muted">{epCode(e)}</span>
                <span class="rating"> ★ {e.rating!.toFixed(1)}</span>
                <span class="vote" data-ep-id={String(e.id)}>
                  <button class="vote-btn" data-dir="up" aria-label="Agree with this ranking">
                    👍 <span class="vote-count">{e.up ?? 0}</span>
                  </button>
                  <button class="vote-btn" data-dir="down" aria-label="Disagree with this ranking">
                    👎 <span class="vote-count">{e.down ?? 0}</span>
                  </button>
                </span>
                {e.summary ? <p class="muted">{stripHtml(e.summary)}</p> : null}
              </li>
            ))}
          </ol>
          {kind === "best" ? (
            <p>
              Short on time? <a href={`/show/${show.slug}/essential`}>The essential watch list</a>{" "}
              · <a href={`/show/${show.slug}/ratings`}>Ratings graph</a> ·{" "}
              <a href="/best-episodes">All-time top 100</a>
            </p>
          ) : null}
          {similar.length ? (
            <section>
              <h2>More like {show.name}</h2>
              <ul class="ep-list">
                {similar.map((s) => (
                  <li>
                    <a href={`/show/${s.slug}/best-episodes`}>The best episodes of {s.name}</a>
                  </li>
                ))}
              </ul>
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

app.get("/show/:slug/next-episode", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const next = await c.env.DB.prepare(
    `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now')
     ORDER BY airstamp LIMIT 1`,
  )
    .bind(show.id)
    .first<EpisodeRow>();

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
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Next episode", path)]}
    >
      <h1>
        Next episode of <a href={`/show/${show.slug}`}>{show.name}</a>
      </h1>
      {next ? (
        <div class="answer">
          <p>
            <strong>{next.name ?? epCode(next)}</strong> <span class="muted">{epCode(next)}</span>{" "}
            airs <strong>{next.airdate}</strong>
            {show.network ? <span class="muted"> on {show.network}</span> : null}.
          </p>
          <p class="countdown" id="countdown" data-ts={next.airstamp ?? ""}></p>
          {raw(COUNTDOWN_JS)}
        </div>
      ) : (
        <div class="answer">
          <p>
            No next episode is scheduled. <StatusBadge status={show.status} />
            {show.status === "Ended" && show.ended ? (
              <span class="muted"> The show ended on {show.ended}.</span>
            ) : show.status === "To Be Determined" ? (
              <span class="muted"> Awaiting renewal news — check back soon.</span>
            ) : null}
          </p>
        </div>
      )}
      <p>
        <a href={`/show/${show.slug}/calendar.ics`}>📅 Add {show.name} to your calendar</a>
      </p>
      <SubscribeForm showId={show.id} label={`Email me when ${show.name} gets schedule news:`} />
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
  if (next && (next.season ?? 0) > maxAired) {
    answer = `Season ${next.season} of ${show.name} premieres on ${next.airdate}.`;
    showCountdown = true;
  } else if (next) {
    answer = `Season ${next.season} of ${show.name} is currently airing — the next episode (${epCode(
      next,
    )}) airs ${next.airdate}.`;
    showCountdown = true;
  } else if (show.status === "Ended") {
    answer = `${show.name} has ended${show.ended ? ` (final episode: ${show.ended})` : ""} — no new season is coming.`;
  } else if (show.status === "To Be Determined") {
    answer = `${show.name} has not yet been renewed for Season ${maxAired + 1}. Its status is officially "To Be Determined."`;
  } else if (show.status === "In Development") {
    answer = `${show.name} is in development — no premiere date has been announced yet.`;
  } else {
    answer = `${show.name} is ${show.status ?? "of unknown status"}, but no next air date has been announced yet.`;
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
      ogImage={show.image_url ?? undefined}
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
      <div class="answer">
        <p>
          <StatusBadge status={show.status} /> {answer}
        </p>
        {showCountdown ? (
          <>
            <p class="countdown" id="countdown" data-ts={next?.airstamp ?? ""}></p>
            {raw(COUNTDOWN_JS)}
          </>
        ) : null}
        {lastAired ? (
          <p class="muted">
            Last aired episode: {lastAired.name} ({epCode(lastAired)}) on {lastAired.airdate}.
          </p>
        ) : null}
      </div>
      <SubscribeForm
        showId={show.id}
        label={`Email me when ${show.name} renewal or premiere news lands:`}
      />
      <p>
        <a href={`/show/${show.slug}/calendar.ics`}>📅 Add {show.name} to your calendar</a>{" "}
        <span class="muted">— subscribe in Google/Apple Calendar and never miss an episode</span>
      </p>
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
                    Premiere moved <span class="muted">{h.old_value}</span> →{" "}
                    <strong>{h.new_value}</strong>
                  </>
                ) : (
                  <>
                    {h.old_value ?? "?"} → <strong>{h.new_value ?? "?"}</strong>
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

// ------------------------------------------------------- tonight / calendar

app.get("/tonight", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE date(e.airstamp) = date('now')
     ORDER BY e.airstamp`,
  ).all<TonightRow>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="What's on TV tonight | TV Nightly"
      description="Every episode airing on TV and streaming tonight, in air-time order."
      canonical={canonical(c)}
    >
      <h1>On TV tonight</h1>
      {results.length === 0 ? <p class="muted">Nothing in the schedule for today yet.</p> : null}
      <ul class="ep-list">
        {results.map((e) => (
          <li>
            <span class="muted">
              {e.airstamp ? new Date(e.airstamp).toISOString().slice(11, 16) : "--:--"}
            </span>{" "}
            <a href={`/show/${e.show_slug}`}>{e.show_name}</a> {epCode(e)}
            {e.name ? ` — ${e.name}` : ""}
            {e.network ? <span class="muted"> · {e.network}</span> : null}
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

app.get("/calendar", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.airstamp >= datetime('now', 'start of day')
       AND e.airstamp < datetime('now', '+7 days')
     ORDER BY e.airstamp`,
  ).all<TonightRow>();

  const byDay = new Map<string, TonightRow[]>();
  for (const e of results) {
    const day = e.airdate ?? (e.airstamp ?? "").slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }

  c.header("Cache-Control", "public, max-age=900");
  return c.html(
    <Layout
      title="TV schedule this week | TV Nightly"
      description="The 7-day TV calendar: every episode airing this week, by day."
      canonical={canonical(c)}
    >
      <h1>This week's TV calendar</h1>
      {byDay.size === 0 ? <p class="muted">No scheduled episodes in the next 7 days.</p> : null}
      {[...byDay.entries()].map(([day, eps]) => (
        <section>
          <h2>{day}</h2>
          <ul class="ep-list">
            {eps.map((e) => (
              <li>
                <a href={`/show/${e.show_slug}`}>{e.show_name}</a> {epCode(e)}
                {e.name ? ` — ${e.name}` : ""}
                {e.network ? <span class="muted"> · {e.network}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Layout>,
  );
});

// -------------------------------------------------- rate -> recommend flow
// "Tell us the last thing you watched and how it landed; we pick your next
// one." Only the anonymous verdict is saved (title_ratings/rate_log) — no
// accounts, no client-side storage of user data.

const VERDICTS: Record<string, "loved" | "liked" | "meh"> = {
  love: "loved",
  like: "liked",
  meh: "meh",
};

async function getRatedTitle(
  db: D1Database,
  kind: string,
  ref: string,
): Promise<{ show?: ShowRow; movie?: MovieRow; name: string; image: string | null } | null> {
  if (kind === "tv" && /^\d+$/.test(ref)) {
    const show = await db.prepare("SELECT * FROM shows WHERE id = ?").bind(Number(ref)).first<ShowRow>();
    return show ? { show, name: show.name, image: show.image_url } : null;
  }
  if (kind === "movie" && /^tt\d+$/.test(ref)) {
    const movie = await db.prepare("SELECT * FROM movies WHERE imdb_id = ?").bind(ref).first<MovieRow>();
    return movie ? { movie, name: movie.year ? `${movie.title} (${movie.year})` : movie.title, image: movie.poster_url } : null;
  }
  return null;
}

// The rating trail of a session lives in the URL (?rated=tv:169:love,...) —
// shareable, account-free, and never stored client-side.
interface RatedEntry {
  kind: "tv" | "movie";
  ref: string;
  verdict: "love" | "like" | "meh";
}

function parseRated(s: string | undefined): RatedEntry[] {
  if (!s) return [];
  const out: RatedEntry[] = [];
  for (const part of s.split(",").slice(0, 8)) {
    const m = /^(tv|movie):(\d+|tt\d+):(love|like|meh)$/.exec(part);
    if (!m) continue;
    if (m[1] === "tv" && !/^\d+$/.test(m[2])) continue;
    if (m[1] === "movie" && !/^tt\d+$/.test(m[2])) continue;
    if (!out.some((e) => e.kind === m[1] && e.ref === m[2]))
      out.push({
        kind: m[1] as RatedEntry["kind"],
        ref: m[2],
        verdict: m[3] as RatedEntry["verdict"],
      });
  }
  return out.slice(0, 5);
}

const fmtRated = (list: RatedEntry[]) => list.map((e) => `${e.kind}:${e.ref}:${e.verdict}`).join(",");
const titleKey = (kind: string, ref: string) => `${kind}:${ref}`;

/** Community agreement line for a title, or null below the 2-rater threshold. */
async function titleStat(db: D1Database, kind: string, ref: string): Promise<string | null> {
  const counts = await db
    .prepare("SELECT loved, liked, meh FROM title_ratings WHERE kind = ? AND ref = ?")
    .bind(kind, ref)
    .first<{ loved: number; liked: number; meh: number }>();
  if (!counts) return null;
  const total = counts.loved + counts.liked + counts.meh;
  if (total < 2) return null;
  const pct = Math.round(((counts.loved + counts.liked) / total) * 100);
  return `${pct}% of ${total} raters loved or liked this`;
}

app.get("/recommend", async (c) => {
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim();
  const kind = c.req.query("kind") ?? "";
  const ref = (c.req.query("ref") ?? "").trim();
  const v = c.req.query("v") ?? "";

  // Step 3: verdict saved (arrived via POST redirect) -> show the picks.
  if (kind && ref && VERDICTS[v]) {
    const title = await getRatedTitle(db, kind, ref);
    if (!title) return c.notFound();
    const rated = parseRated(c.req.query("rated"));
    if (!rated.some((e) => e.kind === kind && e.ref === ref)) {
      rated.push({ kind: kind as RatedEntry["kind"], ref, verdict: v as RatedEntry["verdict"] });
    }
    const positives = rated.filter((e) => e.verdict !== "meh");

    const counts = await db
      .prepare("SELECT loved, liked, meh FROM title_ratings WHERE kind = ? AND ref = ?")
      .bind(kind, ref)
      .first<{ loved: number; liked: number; meh: number }>();
    const total = (counts?.loved ?? 0) + (counts?.liked ?? 0) + (counts?.meh ?? 0);
    const positive = (counts?.loved ?? 0) + (counts?.liked ?? 0);
    const stat =
      total >= 2
        ? v === "meh"
          ? `${Math.round(((counts?.meh ?? 0) / total) * 100)}% of raters shrugged at it too.`
          : `${Math.round((positive / total) * 100)}% of raters loved or liked it too.`
        : "You're one of its first raters — thanks!";

    // Never recommend what this visitor already rated: the URL trail plus
    // everything their hashed IP rated before.
    const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
    const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
    const { results: priorRatings } = await db
      .prepare("SELECT kind, ref FROM rate_log WHERE ip_hash = ? LIMIT 200")
      .bind(hash)
      .all<{ kind: string; ref: string }>();
    const exclude = new Set<string>([
      ...rated.map((e) => titleKey(e.kind, e.ref)),
      ...priorRatings.map((r) => titleKey(r.kind, r.ref)),
    ]);

    // Collaborative filtering: what other raters who loved these also loved.
    let cfShows: ShowRow[] = [];
    let cfMovies: MovieRow[] = [];
    if (positives.length) {
      const pairCond = positives.map(() => "(r1.kind = ? AND r1.ref = ?)").join(" OR ");
      const { results: cfRows } = await db
        .prepare(
          `SELECT r2.kind AS kind, r2.ref AS ref, COUNT(DISTINCT r2.ip_hash) AS n
           FROM rate_log r1
           JOIN rate_log r2 ON r2.ip_hash = r1.ip_hash
           WHERE r1.verdict IN ('love','like') AND (${pairCond})
             AND r2.verdict IN ('love','like') AND r2.ip_hash != ?
             AND NOT (r2.kind = r1.kind AND r2.ref = r1.ref)
           GROUP BY r2.kind, r2.ref
           ORDER BY n DESC LIMIT 20`,
        )
        .bind(...positives.flatMap((e) => [e.kind, e.ref]), hash)
        .all<{ kind: string; ref: string; n: number }>();
      const strong = cfRows.filter((r) => r.n >= 2 && !exclude.has(titleKey(r.kind, r.ref)));
      const showIds = strong.filter((r) => r.kind === "tv").map((r) => Number(r.ref)).slice(0, 6);
      const movieIds = strong.filter((r) => r.kind === "movie").map((r) => r.ref).slice(0, 6);
      if (showIds.length) {
        const ph = showIds.map(() => "?").join(",");
        cfShows = (
          await db.prepare(`SELECT * FROM shows WHERE id IN (${ph})`).bind(...showIds).all<ShowRow>()
        ).results;
      }
      if (movieIds.length) {
        const ph = movieIds.map(() => "?").join(",");
        cfMovies = (
          await db.prepare(`SELECT * FROM movies WHERE imdb_id IN (${ph})`).bind(...movieIds).all<MovieRow>()
        ).results;
      }
    }
    const cfKeys = new Set([
      ...cfShows.map((s) => titleKey("tv", String(s.id))),
      ...cfMovies.map((m) => titleKey("movie", m.imdb_id)),
    ]);

    // Genre triangulation across everything loved/liked this session.
    let recShows: ShowRow[] = [];
    let recMovies: MovieRow[] = [];
    if (positives.length) {
      const showCount = new Map<number, { row: ShowRow; n: number }>();
      const movieCount = new Map<string, { row: MovieRow; n: number }>();
      for (const e of positives) {
        const t = e.kind === kind && e.ref === ref ? title : await getRatedTitle(db, e.kind, e.ref);
        if (!t) continue;
        if (t.show) {
          for (const s of await similarShows(db, t.show)) {
            const cur = showCount.get(s.id) ?? { row: s, n: 0 };
            cur.n++;
            showCount.set(s.id, cur);
          }
        }
        if (t.movie) {
          for (const m of await similarMovies(db, t.movie)) {
            const cur = movieCount.get(m.imdb_id) ?? { row: m, n: 0 };
            cur.n++;
            movieCount.set(m.imdb_id, cur);
          }
        }
      }
      recShows = [...showCount.values()]
        .filter((x) => !exclude.has(titleKey("tv", String(x.row.id))) && !cfKeys.has(titleKey("tv", String(x.row.id))))
        .sort((a, b) => b.n - a.n || b.row.weight - a.row.weight)
        .slice(0, 6)
        .map((x) => x.row);
      recMovies = [...movieCount.values()]
        .filter((x) => !exclude.has(titleKey("movie", x.row.imdb_id)) && !cfKeys.has(titleKey("movie", x.row.imdb_id)))
        .sort((a, b) => b.n - a.n || (b.row.rating ?? 0) - (a.row.rating ?? 0))
        .slice(0, 6)
        .map((x) => x.row);
    } else {
      // Everything so far was 'meh' — change direction: avoid ALL its genres.
      const genreJson = title.show?.genres ?? title.movie?.genres ?? null;
      const gs: string[] = (genreJson ? JSON.parse(genreJson) : []).slice(0, 3);
      const notLike = gs.map(() => "AND (genres IS NULL OR genres NOT LIKE ?)").join(" ");
      if (kind === "tv") {
        recShows = (
          await db
            .prepare(
              `SELECT * FROM shows WHERE id != ? AND weight >= ? AND rating >= 7.5 ${notLike}
               ORDER BY weight DESC LIMIT 6`,
            )
            .bind(title.show!.id, PICKER_MIN_WEIGHT, ...gs.map((g) => `%"${g}"%`))
            .all<ShowRow>()
        ).results.filter((s) => !exclude.has(titleKey("tv", String(s.id))));
      } else {
        recMovies = (
          await db
            .prepare(
              `SELECT * FROM movies WHERE imdb_id != ? AND rating >= 7.5 ${notLike}
               ORDER BY popularity DESC LIMIT 6`,
            )
            .bind(title.movie!.imdb_id, ...gs.map((g) => `%"${g}"%`))
            .all<MovieRow>()
        ).results.filter((m) => !exclude.has(titleKey("movie", m.imdb_id)));
      }
    }

    const ratedParam = encodeURIComponent(fmtRated(rated));
    const heading =
      positives.length > 1
        ? `Triangulating from your ${rated.length} ratings`
        : v === "meh"
          ? "Let's go a different direction"
          : `Because you ${v === "love" ? "loved" : "liked"} ${title.name}`;
    const recNames = [
      ...cfShows.map((s) => s.name),
      ...cfMovies.map((m) => m.title),
      ...recShows.map((s) => s.name),
      ...recMovies.map((m) => m.title),
    ];

    c.header("Cache-Control", "no-store");
    return c.html(
      <Layout
        title={`Your next watch, based on ${title.name} | TV Nightly`}
        description={
          recNames.length
            ? `Rated ${title.name}? TV Nightly says: ${recNames.slice(0, 3).join(", ")}…`
            : `Rate what you watched, get your next pick.`
        }
        canonical={`${origin(c)}/recommend`}
        ogImage={title.image ?? undefined}
      >
        <h1>{heading}</h1>
        <p class="muted">Verdict saved — {stat}</p>
        {cfShows.length || cfMovies.length ? (
          <section>
            <h2>Raters with your taste also loved</h2>
            <div class="grid">
              {cfShows.map((s) => (
                <ShowCard show={s} />
              ))}
              {cfMovies.map((m) => (
                <MovieCard movie={m} />
              ))}
            </div>
          </section>
        ) : null}
        {recShows.length || recMovies.length ? (
          <section>
            <h2>{positives.length > 1 ? "Matched to all your picks" : "More in this vein"}</h2>
            <div class="grid">
              {recShows.map((s) => (
                <ShowCard show={s} />
              ))}
              {recMovies.map((m) => (
                <MovieCard movie={m} />
              ))}
            </div>
          </section>
        ) : null}
        {!cfShows.length && !cfMovies.length && !recShows.length && !recMovies.length ? (
          <p class="muted">
            We need a bit more data for this one — try the <a href="/what-to-watch">picker</a>.
          </p>
        ) : null}
        <p>
          <a class="verdict-btn" href={`/recommend?rated=${ratedParam}`}>
            Rate one more — picks get sharper
          </a>
        </p>
        <div class="sub-form inline">
          <form method="post" action="/subscribe" class="sub-form">
            <input type="hidden" name="kind" value="daily" />
            <label>Want a fresh pick in your inbox? Join the daily email:</label>
            <input type="email" name="email" placeholder="you@example.com" required />
            <button type="submit">Sign me up</button>
          </form>
        </div>
      </Layout>,
    );
  }

  // Step 2: title chosen -> ask the verdict.
  if (kind && ref) {
    const title = await getRatedTitle(db, kind, ref);
    if (!title) return c.notFound();
    const ratedStr = fmtRated(parseRated(c.req.query("rated")));
    const Verdict = ({ value, label }: { value: string; label: string }) => (
      <form method="post" action="/recommend" class="verdict-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="ref" value={ref} />
        {ratedStr ? <input type="hidden" name="rated" value={ratedStr} /> : null}
        <input type="hidden" name="verdict" value={value} />
        <button type="submit" class="verdict-btn">
          {label}
        </button>
      </form>
    );
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(
      <Layout title={`How was ${title.name}? | TV Nightly`} canonical={`${origin(c)}/recommend`}>
        <div class="pick-card">
          {title.image ? (
            <img class="poster" src={title.image} alt={title.name} />
          ) : (
            <div class="poster card-fallback">{title.name}</div>
          )}
          <div>
            <h1>How was {title.name}?</h1>
            <div class="verdicts">
              <Verdict value="love" label="😍 Loved it" />
              <Verdict value="like" label="🙂 Liked it" />
              <Verdict value="meh" label="😴 Meh" />
            </div>
            <p class="muted">One tap. We save the verdict (nothing else) and pick your next watch.</p>
          </div>
        </div>
      </Layout>,
    );
  }

  // Step 1b: searching for the title.
  const ratedQS = (() => {
    const s = fmtRated(parseRated(c.req.query("rated")));
    return s ? `&rated=${encodeURIComponent(s)}` : "";
  })();
  if (q) {
    const [shows, movies] = await Promise.all([
      db
        .prepare("SELECT id, name, premiered FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 5")
        .bind(q)
        .all<{ id: number; name: string; premiered: string | null }>(),
      db
        .prepare("SELECT imdb_id, title, year FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 5")
        .bind(q)
        .all<{ imdb_id: string; title: string; year: number | null }>(),
    ]);
    c.header("Cache-Control", "public, max-age=300");
    return c.html(
      <Layout title={`Which one did you watch? | TV Nightly`} canonical={`${origin(c)}/recommend`}>
        <h1>Which one did you watch?</h1>
        {shows.results.length === 0 && movies.results.length === 0 ? (
          <p class="muted">
            Nothing matched "{q}" — <a href="/recommend">try another search</a>.
          </p>
        ) : null}
        <ul class="ep-list">
          {shows.results.map((s) => (
            <li>
              <a href={`/recommend?kind=tv&ref=${s.id}${ratedQS}`}>
                {s.name}
                {s.premiered ? ` (${s.premiered.slice(0, 4)})` : ""}
              </a>{" "}
              <span class="muted">· TV show</span>
            </li>
          ))}
          {movies.results.map((m) => (
            <li>
              <a href={`/recommend?kind=movie&ref=${m.imdb_id}${ratedQS}`}>
                {m.title}
                {m.year ? ` (${m.year})` : ""}
              </a>{" "}
              <span class="muted">· Movie</span>
            </li>
          ))}
        </ul>
      </Layout>,
    );
  }

  // Step 1: landing — search box + zero-typing quick picks.
  const [{ results: topShows }, { results: topMovies }] = await Promise.all([
    db.prepare("SELECT id, name FROM shows ORDER BY weight DESC, rating DESC LIMIT 8").all<{ id: number; name: string }>(),
    db.prepare("SELECT imdb_id, title FROM movies ORDER BY popularity DESC LIMIT 4").all<{ imdb_id: string; title: string }>(),
  ]);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="What should I watch next? Rate one thing, get your pick | TV Nightly"
      description="Tell us the last show or movie you watched and how it landed — we'll pick your next watch. No account needed."
      canonical={canonical(c)}
    >
      <h1>What should I watch next?</h1>
      <p>Tell us the last thing you finished, and how it landed. We'll take it from there.</p>
      <form method="get" action="/recommend" class="search">
        <input type="search" name="q" placeholder="The last show or movie you watched…" required />
        {ratedQS ? (
          <input type="hidden" name="rated" value={fmtRated(parseRated(c.req.query("rated")))} />
        ) : null}
        <button type="submit" class="verdict-btn">Find it</button>
      </form>
      <h2>Or tap one you've seen</h2>
      <p class="quick-picks">
        {topShows.map((s) => (
          <a class="chip" href={`/recommend?kind=tv&ref=${s.id}${ratedQS}`}>
            {s.name}
          </a>
        ))}
        {topMovies.map((m) => (
          <a class="chip" href={`/recommend?kind=movie&ref=${m.imdb_id}${ratedQS}`}>
            {m.title}
          </a>
        ))}
      </p>
      <p>
        <a href="/loved">See what the community loves →</a>
      </p>
    </Layout>,
  );
});

app.post("/recommend", async (c) => {
  const body = await c.req.parseBody();
  const kind = String(body.kind ?? "");
  const ref = String(body.ref ?? "").trim();
  const verdict = String(body.verdict ?? "");
  const prior = fmtRated(parseRated(typeof body.rated === "string" ? body.rated : undefined));
  const col = VERDICTS[verdict];
  if (!col || (kind !== "tv" && kind !== "movie")) return c.notFound();
  const title = await getRatedTitle(c.env.DB, kind, ref);
  if (!title) return c.notFound();

  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
  const dup = await c.env.DB.prepare(
    "SELECT 1 AS x FROM rate_log WHERE ip_hash = ? AND kind = ? AND ref = ?",
  )
    .bind(hash, kind, ref)
    .first();
  if (!dup) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO rate_log (ip_hash, kind, ref, created_at, verdict) VALUES (?,?,?,unixepoch(),?)",
      ).bind(hash, kind, ref, verdict),
      c.env.DB.prepare(
        `INSERT INTO title_ratings (kind, ref, loved, liked, meh) VALUES (?,?,?,?,?)
         ON CONFLICT(kind, ref) DO UPDATE SET
           loved = loved + excluded.loved, liked = liked + excluded.liked, meh = meh + excluded.meh`,
      ).bind(kind, ref, col === "loved" ? 1 : 0, col === "liked" ? 1 : 0, col === "meh" ? 1 : 0),
    ]);
  }
  return c.redirect(
    `/recommend?kind=${kind}&ref=${encodeURIComponent(ref)}&v=${verdict}${prior ? `&rated=${encodeURIComponent(prior)}` : ""}`,
    303,
  );
});

// ------------------------------------------------- community loved charts

app.get("/loved", async (c) => {
  const db = c.env.DB;
  const { results: rows } = await db
    .prepare(
      `SELECT * FROM (
         SELECT kind, ref, loved, liked, meh, (loved + liked + meh) AS total,
                (loved + 0.5 * liked) / CAST(loved + liked + meh AS REAL) AS score
         FROM title_ratings
       ) WHERE total >= 2 ORDER BY score DESC, total DESC LIMIT 40`,
    )
    .all<{ kind: string; ref: string; total: number; score: number }>();

  const showIds = rows.filter((r) => r.kind === "tv").map((r) => Number(r.ref));
  const movieIds = rows.filter((r) => r.kind === "movie").map((r) => r.ref);
  const shows = showIds.length
    ? (
        await db
          .prepare(`SELECT id, name, slug FROM shows WHERE id IN (${showIds.map(() => "?").join(",")})`)
          .bind(...showIds)
          .all<{ id: number; name: string; slug: string }>()
      ).results
    : [];
  const movies = movieIds.length
    ? (
        await db
          .prepare(
            `SELECT imdb_id, title, year, slug FROM movies WHERE imdb_id IN (${movieIds.map(() => "?").join(",")})`,
          )
          .bind(...movieIds)
          .all<{ imdb_id: string; title: string; year: number | null; slug: string }>()
      ).results
    : [];
  const showMap = new Map(shows.map((s) => [String(s.id), s]));
  const movieMap = new Map(movies.map((m) => [m.imdb_id, m]));

  c.header("Cache-Control", "public, max-age=900");
  return c.html(
    <Layout
      title="The most loved shows & movies on TV Nightly"
      description="Community charts built from real one-tap verdicts: what TV Nightly's raters love right now."
      canonical={canonical(c)}
    >
      <h1>Most loved by the TV Nightly community</h1>
      <p class="muted">
        Ranked by reader verdicts from <a href="/recommend">the recommender</a>. Early days — every
        rating moves this chart.
      </p>
      {rows.length === 0 ? (
        <p class="muted">
          No titles have enough ratings yet. <a href="/recommend">Be the first</a>.
        </p>
      ) : null}
      <ol class="ranked">
        {rows.map((r) => {
          const s = r.kind === "tv" ? showMap.get(r.ref) : undefined;
          const m = r.kind === "movie" ? movieMap.get(r.ref) : undefined;
          if (!s && !m) return null;
          const href = s ? `/show/${s.slug}` : `/movie/${m!.slug}`;
          const label = s ? s.name : `${m!.title}${m!.year ? ` (${m!.year})` : ""}`;
          return (
            <li>
              <strong>
                <a href={href}>{label}</a>
              </strong>{" "}
              <span class="muted">· {s ? "TV show" : "Movie"}</span>
              <span class="rating"> {Math.round(r.score * 100)}% positive</span>
              <span class="muted">
                {" "}
                · {r.total} rating{r.total === 1 ? "" : "s"}
              </span>
            </li>
          );
        })}
      </ol>
    </Layout>,
  );
});

// ---------------------------------------------------------------- movies

app.get("/movies", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM movies ORDER BY popularity DESC LIMIT 48",
  ).all<MovieRow>();
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Popular movies — ratings, runtimes & picks | TV Nightly"
      description="The most popular movies with ratings, runtimes and genres — plus ranked best-of lists and a what-to-watch picker."
      canonical={canonical(c)}
    >
      <h1>Popular movies</h1>
      <p>
        <a href="/movies/best">Best movies, ranked →</a> ·{" "}
        <a href="/what-to-watch?type=movie">Pick one for me 🎲</a>
      </p>
      {results.length === 0 ? (
        <p class="muted">No movies loaded yet — the catalog is on its way.</p>
      ) : null}
      <div class="grid">
        {results.map((m) => (
          <MovieCard movie={m} />
        ))}
      </div>
    </Layout>,
  );
});

app.get("/movies/best", async (c) => {
  // Validate genre against the real list FIRST: kills LIKE-metacharacter junk
  // pages and reflected-text spam; invalid values redirect to the bare page.
  const { results: genreRows } = await c.env.DB.prepare(
    "SELECT DISTINCT value AS g FROM movies, json_each(movies.genres) ORDER BY 1",
  ).all<{ g: string }>();
  const requested = (c.req.query("genre") ?? "").trim();
  if (requested && !genreRows.some((r) => r.g === requested)) {
    return c.redirect("/movies/best", 301);
  }
  const genre = requested;

  const conds = ["rating IS NOT NULL", "votes >= 1000"];
  const binds: (string | number)[] = [];
  if (genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${genre}"%`);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM movies WHERE ${conds.join(" AND ")} ORDER BY rating DESC, votes DESC LIMIT 50`,
  )
    .bind(...binds)
    .all<MovieRow>();

  const heading = genre ? `The best ${genre.toLowerCase()} movies, ranked` : "The best movies of all time, ranked";
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${heading} | TV Nightly`}
      description={`${heading} by viewer rating${results[0] ? `, from ${results[0].title} down` : ""}.`}
      canonical={
        genre
          ? `${origin(c)}/movies/best?genre=${encodeURIComponent(genre)}`
          : canonical(c)
      }
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: heading,
          itemListElement: results.slice(0, 25).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${m.title}${m.year ? ` (${m.year})` : ""}`,
            url: `${origin(c)}/movie/${m.slug}`,
          })),
        },
      ]}
    >
      <h1>{heading}</h1>
      <form method="get" action="/movies/best" class="picker-form">
        <label>
          Genre{" "}
          <select name="genre">
            <option value="">All genres</option>
            {genreRows.map((r) => (
              <option value={r.g} selected={r.g === genre}>
                {r.g}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Rank</button>
      </form>
      {results.length === 0 ? <p class="muted">No rated movies for that filter yet.</p> : null}
      <ol class="ranked">
        {results.map((m) => (
          <li>
            <strong>
              <a href={`/movie/${m.slug}`}>{m.title}</a>
            </strong>{" "}
            {m.year ? <span class="muted">({m.year})</span> : null}
            <span class="rating"> ★ {m.rating!.toFixed(1)}</span>
            {m.overview ? <p class="muted">{m.overview.slice(0, 180)}…</p> : null}
          </li>
        ))}
      </ol>
    </Layout>,
  );
});

app.get("/movie/:slug", async (c) => {
  const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<MovieRow>();
  if (!movie) return c.notFound();
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const stat = await titleStat(c.env.DB, "movie", movie.imdb_id);

  // No aggregateRating here: Google's review-snippet guidelines require ratings
  // collected on YOUR site; republishing TMDB votes as structured data risks a
  // manual action. The rating stays visible in the page body.
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: movie.title,
    url: `${origin(c)}/movie/${movie.slug}`,
    ...(movie.poster_url ? { image: movie.poster_url } : {}),
    ...(movie.release_date ? { datePublished: movie.release_date } : {}),
  };

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${movie.title}${movie.year ? ` (${movie.year})` : ""} — rating, runtime & info | TV Nightly`}
      description={(movie.overview ?? "").slice(0, 155)}
      canonical={canonical(c)}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={[ld]}
    >
      <article class="show-hub">
        <div class="show-head">
          {movie.poster_url ? (
            <img class="poster" src={movie.poster_url} alt={movie.title} />
          ) : (
            <div class="poster card-fallback">{movie.title}</div>
          )}
          <div>
            <h1>
              {movie.title} {movie.year ? <span class="muted">({movie.year})</span> : null}
            </h1>
            <p>
              {movie.rating != null ? <span class="rating">★ {movie.rating.toFixed(1)}</span> : null}
              {movie.votes ? <span class="muted"> ({movie.votes.toLocaleString()} votes)</span> : null}
              {movie.runtime ? <span class="muted"> · {movie.runtime} min</span> : null}
              {genres.length ? <span class="muted"> · {genres.join(", ")}</span> : null}
            </p>
            {movie.providers && JSON.parse(movie.providers).length ? (
              <p class="provs">
                <span class="muted">Streaming on</span>{" "}
                {(JSON.parse(movie.providers) as string[]).map((p) => (
                  <span class="prov">{p}</span>
                ))}
              </p>
            ) : null}
            {movie.overview ? <div class="summary">{movie.overview}</div> : null}
            <RateInline kind="movie" refId={movie.imdb_id} stat={stat} />
            <p>
              <a href={`https://www.imdb.com/title/${movie.imdb_id}/`} rel="noopener">
                IMDb ↗
              </a>{" "}
              · <a href="/what-to-watch?type=movie">Pick me another 🎲</a>
            </p>
          </div>
        </div>
      </article>
    </Layout>,
  );
});

// ----------------------------------------------------- what-to-watch picker

// Pool floor: TVmaze weight >= 75 keeps picks recognizable (and the indexed
// range scan keeps D1 rows-read low even on a full 80K-show mirror).
const PICKER_MIN_WEIGHT = 75;

app.get("/what-to-watch", async (c) => {
  const db = c.env.DB;
  const type = c.req.query("type") === "movie" ? "movie" : "tv";
  const rawGenre = (c.req.query("genre") ?? "").trim();
  const status = c.req.query("status") ?? "";
  const minRating = Number(c.req.query("min") ?? 0) || 0;
  const runtimeBand = c.req.query("runtime") ?? ""; // '' | 'short' | 'long'
  // Same form values, sensible minutes per medium.
  const RUNTIME_CAPS = { tv: { short: 35, long: 65 }, movie: { short: 100, long: 135 } };
  const maxRuntime =
    runtimeBand === "short" || runtimeBand === "long" ? RUNTIME_CAPS[type][runtimeBand] : 0;

  const { results: genreRows } =
    type === "movie"
      ? await db
          .prepare("SELECT DISTINCT value AS g FROM movies, json_each(movies.genres) ORDER BY 1")
          .all<{ g: string }>()
      : await db
          .prepare(
            `SELECT DISTINCT value AS g FROM shows, json_each(shows.genres)
             WHERE shows.weight >= ? ORDER BY 1`,
          )
          .bind(PICKER_MIN_WEIGHT)
          .all<{ g: string }>();
  // Only genres that actually exist pass through to the LIKE pattern.
  const genre = genreRows.some((r) => r.g === rawGenre) ? rawGenre : "";

  // Service filter (movies): dropdown derived from real provider data.
  let service = "";
  let serviceRows: { p: string }[] = [];
  if (type === "movie") {
    serviceRows = (
      await db
        .prepare(
          `SELECT value AS p, COUNT(*) AS n FROM movies, json_each(movies.providers)
           GROUP BY value ORDER BY n DESC LIMIT 12`,
        )
        .all<{ p: string }>()
    ).results;
    const reqService = (c.req.query("service") ?? "").trim();
    service = serviceRows.some((r) => r.p === reqService) ? reqService : "";
  }

  // Anti-repeat: spins exclude everything already seen this session (URL trail).
  const skip = (c.req.query("skip") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => (type === "movie" ? /^tt\d+$/.test(s) : /^\d+$/.test(s)))
    .slice(-20);

  const conds: string[] = ["rating IS NOT NULL"];
  const binds: (string | number)[] = [];
  if (type === "tv") {
    // Popularity floor keeps TV picks recognizable; the movies table is
    // curated-by-construction (seeded top-N), so it needs no floor.
    conds.push("weight >= ?");
    binds.push(PICKER_MIN_WEIGHT);
  }
  if (genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${genre}"%`);
  }
  if (service) {
    conds.push("providers LIKE ?");
    binds.push(`%"${service}"%`);
  }
  if (type === "tv" && status === "ended") conds.push("status = 'Ended'");
  if (type === "tv" && status === "running") conds.push("status = 'Running'");
  if (minRating) {
    conds.push("rating >= ?");
    binds.push(minRating);
  }
  if (maxRuntime) {
    conds.push("runtime <= ?");
    binds.push(maxRuntime);
  }
  if (skip.length) {
    const ph = skip.map(() => "?").join(",");
    conds.push(type === "movie" ? `imdb_id NOT IN (${ph})` : `id NOT IN (${ph})`);
    binds.push(...skip);
  }
  const where = conds.join(" AND ");

  // Typed per-medium branches: a movie row never has show fields and vice
  // versa, so derive everything the card needs inside each branch.
  interface PickView {
    name: string;
    href: string;
    image: string | null;
    genres: string[];
    providers: string[];
    rating: number | null;
    runtime: number | null;
    desc: string;
    status: string | null; // TV only
    slug: string;
    refId: string; // shows.id / movies.imdb_id — for skip trail + rating
  }
  let pick: PickView | null = null;
  if (type === "movie") {
    const m = await db
      .prepare(`SELECT * FROM movies WHERE ${where} ORDER BY RANDOM() LIMIT 1`)
      .bind(...binds)
      .first<MovieRow>();
    if (m) {
      pick = {
        name: m.year ? `${m.title} (${m.year})` : m.title,
        href: `/movie/${m.slug}`,
        image: m.poster_url,
        genres: m.genres ? JSON.parse(m.genres) : [],
        providers: m.providers ? JSON.parse(m.providers) : [],
        rating: m.rating,
        runtime: m.runtime,
        desc: (m.overview ?? "").slice(0, 220),
        status: null,
        slug: m.slug,
        refId: m.imdb_id,
      };
    }
  } else {
    const s = await db
      .prepare(`SELECT * FROM shows WHERE ${where} ORDER BY RANDOM() LIMIT 1`)
      .bind(...binds)
      .first<ShowRow>();
    if (s) {
      pick = {
        name: s.name,
        href: `/show/${s.slug}`,
        image: s.image_url,
        genres: s.genres ? JSON.parse(s.genres) : [],
        providers: [],
        rating: s.rating,
        runtime: s.runtime,
        desc: s.blurb ?? stripHtml(s.summary).slice(0, 220),
        status: s.status,
        slug: s.slug,
        refId: String(s.id),
      };
    }
  }
  const skipNext = pick ? [...skip, pick.refId].slice(-20).join(",") : skip.join(",");
  c.header("Cache-Control", "no-store");
  return c.html(
    <Layout
      title="What should I watch tonight? — TV show picker | TV Nightly"
      description="Can't decide what to watch? Spin the picker: a great TV show matching your genre, rating, and episode-length filters."
      canonical={origin(c) + "/what-to-watch"}
    >
      <h1>What should I watch tonight?</h1>
      <form method="get" action="/what-to-watch" class="picker-form">
        <label>
          What{" "}
          <select name="type">
            <option value="tv" selected={type === "tv"}>
              TV show
            </option>
            <option value="movie" selected={type === "movie"}>
              Movie
            </option>
          </select>
        </label>
        <label>
          Genre{" "}
          <select name="genre">
            <option value="">Any</option>
            {genreRows.map((r) => (
              <option value={r.g} selected={r.g === genre}>
                {r.g}
              </option>
            ))}
          </select>
        </label>
        {type === "movie" && serviceRows.length ? (
          <label>
            Streaming on{" "}
            <select name="service">
              <option value="">Any service</option>
              {serviceRows.map((r) => (
                <option value={r.p} selected={r.p === service}>
                  {r.p}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {type === "tv" ? (
          <label>
            Status{" "}
            <select name="status">
              <option value="" selected={status === ""}>
                Any
              </option>
              <option value="ended" selected={status === "ended"}>
                Finished (bingeable)
              </option>
              <option value="running" selected={status === "running"}>
                Still running
              </option>
            </select>
          </label>
        ) : null}
        <label>
          Rating{" "}
          <select name="min">
            <option value="" selected={!minRating}>
              Any
            </option>
            <option value="7" selected={minRating === 7}>
              7+ good
            </option>
            <option value="8" selected={minRating === 8}>
              8+ great
            </option>
          </select>
        </label>
        <label>
          {type === "movie" ? "Length" : "Episode length"}{" "}
          <select name="runtime">
            <option value="" selected={!runtimeBand}>
              Any
            </option>
            <option value="short" selected={runtimeBand === "short"}>
              ≤ {RUNTIME_CAPS[type].short} min
            </option>
            <option value="long" selected={runtimeBand === "long"}>
              ≤ {RUNTIME_CAPS[type].long} min
            </option>
          </select>
        </label>
        {skipNext ? <input type="hidden" name="skip" value={skipNext} /> : null}
        <button type="submit">Spin 🎲</button>
      </form>

      {pick ? (
        <div class="pick-card">
          {pick.image ? (
            <img class="poster" src={pick.image} alt={pick.name} />
          ) : (
            <div class="poster card-fallback">{pick.name}</div>
          )}
          <div>
            <h2>
              <a href={pick.href}>{pick.name}</a>
            </h2>
            <p>
              {type === "tv" ? <StatusBadge status={pick.status} /> : null}
              {pick.rating != null ? <span class="rating"> · ★ {pick.rating.toFixed(1)}</span> : null}
              {pick.runtime ? (
                <span class="muted">
                  {" "}
                  · {type === "movie" ? `${pick.runtime} min` : `~${pick.runtime} min/ep`}
                </span>
              ) : null}
              {pick.genres.length ? <span class="muted"> · {pick.genres.join(", ")}</span> : null}
            </p>
            {pick.providers.length ? (
              <p class="provs">
                <span class="muted">Streaming on</span>{" "}
                {pick.providers.map((p) => (
                  <span class="prov">{p}</span>
                ))}
              </p>
            ) : null}
            <p>{pick.desc}</p>
            <RateInline kind={type} refId={pick.refId} stat={null} />
            <p>
              {type === "movie" ? (
                <a href="/movies/best">Best movies, ranked</a>
              ) : (
                <>
                  <a href={`/show/${pick.slug}/best-episodes`}>Best episodes</a> ·{" "}
                  <a href={`/show/${pick.slug}/next-episode`}>Next episode</a>
                </>
              )}
            </p>
          </div>
        </div>
      ) : (
        <p class="muted">Nothing matches those filters — try loosening one.</p>
      )}
    </Layout>,
  );
});

// ------------------------------------------------------------- renewals

interface EventRow {
  type: string;
  season: number | null;
  old_value: string | null;
  new_value: string | null;
  detected_at: number;
  name: string;
  slug: string;
}

const eventLine = (ev: EventRow) => {
  const date = new Date(ev.detected_at * 1000).toISOString().slice(0, 10);
  switch (ev.type) {
    case "season_announced":
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a> renewed —{" "}
          <strong>Season {ev.season} confirmed</strong> <span class="muted">· {date}</span>
        </>
      );
    case "premiere_set":
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a> Season {ev.season} premieres{" "}
          <strong>{ev.new_value}</strong> <span class="muted">· {date}</span>
        </>
      );
    case "premiere_moved":
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a> premiere moved{" "}
          <span class="muted">{ev.old_value}</span> → <strong>{ev.new_value}</strong>{" "}
          <span class="muted">· {date}</span>
        </>
      );
    default:
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a>:{" "}
          <span class="muted">{ev.old_value ?? "?"}</span> → <strong>{ev.new_value ?? "?"}</strong>{" "}
          <span class="muted">· {date}</span>
        </>
      );
  }
};

app.get("/renewals", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ev.type, ev.season, ev.old_value, ev.new_value, ev.detected_at, s.name, s.slug
     FROM show_events ev JOIN shows s ON s.id = ev.show_id
     ORDER BY ev.detected_at DESC LIMIT 100`,
  ).all<EventRow>();

  const renewed = results.filter((r) => r.type === "season_announced");
  const dates = results.filter((r) => r.type === "premiere_set" || r.type === "premiere_moved");
  const status = results.filter((r) => r.type === "status");

  const Section = ({ title, rows }: { title: string; rows: EventRow[] }) =>
    rows.length ? (
      <section>
        <h2>{title}</h2>
        <ul class="ep-list">
          {rows.map((r) => (
            <li>{eventLine(r)}</li>
          ))}
        </ul>
      </section>
    ) : null;

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="Renewed & cancelled TV shows — live tracker | TV Nightly"
      description="A live feed of TV renewals, cancellations, and premiere-date announcements, detected hourly from schedule data."
      canonical={canonical(c)}
    >
      <h1>Renewals, cancellations & premiere dates</h1>
      <p class="muted">
        Detected hourly from schedule data. <a href="/premieres">See upcoming premieres →</a>
      </p>
      {results.length === 0 ? (
        <p class="muted">No events detected yet — the sync job updates this hourly.</p>
      ) : null}
      <Section title="Renewed — new seasons confirmed" rows={renewed} />
      <Section title="Premiere dates set & moved" rows={dates} />
      <Section title="Status changes" rows={status} />
    </Layout>,
  );
});

// ------------------------------------------------------------- premieres

app.get("/premieres", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.number = 1 AND e.airstamp > datetime('now')
       AND e.airstamp < datetime('now', '+90 days')
     ORDER BY e.airstamp`,
  ).all<TonightRow & { season: number | null }>();

  const byMonth = new Map<string, typeof results>();
  for (const e of results) {
    const month = (e.airdate ?? e.airstamp ?? "").slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, [] as typeof results);
    byMonth.get(month)!.push(e);
  }

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Upcoming TV premieres — the next 90 days | TV Nightly"
      description="Every season premiere coming in the next three months, with dates and countdowns."
      canonical={canonical(c)}
    >
      <h1>Upcoming TV premieres</h1>
      {results.length === 0 ? (
        <p class="muted">No premieres scheduled in the next 90 days (yet).</p>
      ) : null}
      {[...byMonth.entries()].map(([month, eps]) => (
        <section>
          <h2>{month}</h2>
          <ul class="ep-list">
            {eps.map((e) => (
              <li>
                <span class="muted">{e.airdate}</span>{" "}
                <a href={`/show/${e.show_slug}/release-date`}>{e.show_name}</a>{" "}
                <strong>Season {e.season} premiere</strong>
                {e.network ? <span class="muted"> · {e.network}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Layout>,
  );
});

// --------------------------------------------------------------- search

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  // Leading-wildcard LIKE can't use an index; skip the movies scan for very
  // short queries to keep per-keystroke rows-read inside the D1 free budget.
  const includeMovies = q.length >= 3;
  const [shows, movies] = await Promise.all([
    c.env.DB.prepare(
      "SELECT name, slug, premiered FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 6",
    )
      .bind(q)
      .all<{ name: string; slug: string; premiered: string | null }>(),
    includeMovies
      ? c.env.DB.prepare(
          "SELECT title, slug, year FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 4",
        )
          .bind(q)
          .all<{ title: string; slug: string; year: number | null }>()
      : Promise.resolve({ results: [] as { title: string; slug: string; year: number | null }[] }),
  ]);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(
    [
      ...shows.results.map((r) => ({
        name: r.name,
        slug: r.slug,
        year: r.premiered?.slice(0, 4) ?? null,
        kind: "tv",
      })),
      ...movies.results.map((r) => ({
        name: r.title,
        slug: r.slug,
        year: r.year ? String(r.year) : null,
        kind: "movie",
      })),
    ].slice(0, 8),
  );
});

async function ipHash(secret: string, ip: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${secret}:${ip}`));
  return [...new Uint8Array(d)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

app.post("/api/vote", async (c) => {
  let body: { episodeId?: unknown; dir?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad request" }, 400);
  }
  const episodeId = Number(body.episodeId);
  const dir = body.dir === "up" ? "up" : body.dir === "down" ? "down" : null;
  if (!Number.isInteger(episodeId) || !dir) return c.json({ error: "bad request" }, 400);
  const db = c.env.DB;
  const exists = await db.prepare("SELECT 1 AS x FROM episodes WHERE id = ?").bind(episodeId).first();
  if (!exists) return c.json({ error: "not found" }, 404);

  // One vote per (HMAC-hashed IP, episode); raw IPs never touch the database.
  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
  const dup = await db
    .prepare("SELECT 1 AS x FROM vote_log WHERE ip_hash = ? AND episode_id = ?")
    .bind(hash, episodeId)
    .first();
  if (!dup) {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO vote_log (ip_hash, episode_id, created_at) VALUES (?,?,unixepoch())",
        )
        .bind(hash, episodeId),
      db
        .prepare(
          `INSERT INTO episode_votes (episode_id, up, down) VALUES (?,?,?)
           ON CONFLICT(episode_id) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`,
        )
        .bind(episodeId, dir === "up" ? 1 : 0, dir === "down" ? 1 : 0),
    ]);
  }
  const counts = await db
    .prepare("SELECT up, down FROM episode_votes WHERE episode_id = ?")
    .bind(episodeId)
    .first<{ up: number; down: number }>();
  return c.json({ up: counts?.up ?? 0, down: counts?.down ?? 0, deduped: !!dup });
});

app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const { results } = q
    ? await c.env.DB.prepare(
        `SELECT * FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 20`,
      )
        .bind(q)
        .all<ShowRow>()
    : { results: [] as ShowRow[] };
  const { results: movieResults } = q
    ? await c.env.DB.prepare(
        `SELECT * FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 12`,
      )
        .bind(q)
        .all<MovieRow>()
    : { results: [] as MovieRow[] };

  return c.html(
    <Layout title={`Search: ${q} | TV Nightly`}>
      <h1>Search{q ? `: ${q}` : ""}</h1>
      {q && results.length === 0 && movieResults.length === 0 ? (
        <p class="muted">Nothing found.</p>
      ) : null}
      {results.length ? (
        <section>
          <h2>TV shows</h2>
          <div class="grid">
            {results.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {movieResults.length ? (
        <section>
          <h2>Movies</h2>
          <div class="grid">
            {movieResults.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
    </Layout>,
  );
});

// ------------------------------------------------- subscribe / confirm

const VALID_KINDS = new Set(["renewal", "premiere", "daily"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MessagePage: FC<{ title: string; body: string }> = ({ title, body }) => (
  <Layout title={`${title} | TV Nightly`}>
    <h1>{title}</h1>
    <p>{body}</p>
    <p>
      <a href="/">← Back to TV Nightly</a>
    </p>
  </Layout>
);

app.post("/subscribe", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim().toLowerCase();
  const kind = String(body.kind ?? "");
  const showId = body.show_id ? Number(body.show_id) : null;

  if (!EMAIL_RE.test(email) || !VALID_KINDS.has(kind) || (kind !== "daily" && !showId)) {
    return c.html(
      <MessagePage title="Something's off" body="Please check the email address and try again." />,
      400,
    );
  }
  const show = showId
    ? await c.env.DB.prepare("SELECT id, name FROM shows WHERE id = ?")
        .bind(showId)
        .first<{ id: number; name: string }>()
    : null;
  if (showId && !show) return c.notFound();

  // Without a SECRET (fresh local dev) skip double opt-in so the flow still works.
  const confirmed = c.env.SECRET ? 0 : 1;
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (email, show_id, kind, confirmed, created_at)
     VALUES (?,?,?,?,unixepoch())
     ON CONFLICT(email, show_id, kind) DO NOTHING`,
  )
    .bind(email, showId, kind, confirmed)
    .run();

  if (c.env.SECRET) {
    const token = await signToken({ email, showId, kind, action: "confirm" }, c.env.SECRET);
    const what =
      kind === "daily" ? "the TV Nightly daily email" : `${show!.name} renewal & schedule alerts`;
    await sendEmails(c.env, [
      {
        to: email,
        subject: `Confirm: ${what}`,
        html:
          `<p>Confirm your subscription to <strong>${what}</strong>:</p>` +
          `<p><a href="${origin(c)}/confirm?token=${token}">Yes, sign me up</a></p>` +
          `<p style="color:#888;font-size:12px">If you didn't request this, ignore this email.</p>`,
      },
    ]);
  }

  return c.html(
    <MessagePage
      title="Almost there"
      body={
        c.env.SECRET
          ? "Check your inbox and click the confirmation link to activate your alerts."
          : "Subscribed (dev mode: auto-confirmed)."
      }
    />,
  );
});

app.get("/confirm", async (c) => {
  const token = c.req.query("token") ?? "";
  const payload = c.env.SECRET ? await verifyToken(token, c.env.SECRET) : null;
  if (!payload || payload.action !== "confirm") {
    return c.html(
      <MessagePage title="Invalid link" body="This confirmation link is invalid or expired." />,
      400,
    );
  }
  await c.env.DB.prepare(
    "UPDATE subscriptions SET confirmed = 1 WHERE email = ? AND kind = ? AND show_id IS ?",
  )
    .bind(payload.email, payload.kind, payload.showId)
    .run();
  return c.html(
    <MessagePage title="You're in" body="Subscription confirmed — we'll email you when there's news." />,
  );
});

app.get("/unsubscribe", async (c) => {
  const token = c.req.query("token") ?? "";
  const payload = c.env.SECRET ? await verifyToken(token, c.env.SECRET) : null;
  if (!payload || payload.action !== "unsub") {
    return c.html(
      <MessagePage title="Invalid link" body="This unsubscribe link is invalid or expired." />,
      400,
    );
  }
  await c.env.DB.prepare(
    "DELETE FROM subscriptions WHERE email = ? AND kind = ? AND show_id IS ?",
  )
    .bind(payload.email, payload.kind, payload.showId)
    .run();
  return c.html(<MessagePage title="Unsubscribed" body="You won't hear from us about this again." />);
});

// --------------------------------------------------------------- sitemaps

const SHOWS_PER_SITEMAP = 1000;
const xmlRes = (c: AppContext, xml: string) => {
  c.header("Content-Type", "application/xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};

app.get("/sitemap.xml", async (c) => {
  const site = origin(c);
  const showRow = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM shows").first<{ n: number }>();
  const movieRow = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM movies").first<{ n: number }>();
  const showShards = Math.max(1, Math.ceil((showRow?.n ?? 0) / SHOWS_PER_SITEMAP));
  const movieShards = Math.ceil((movieRow?.n ?? 0) / SHOWS_PER_SITEMAP);
  const entries = [
    "static.xml",
    ...Array.from({ length: showShards }, (_, i) => `shows-${i}.xml`),
    ...Array.from({ length: movieShards }, (_, i) => `movies-${i}.xml`),
  ]
    .map((f) => `<sitemap><loc>${site}/sitemaps/${f}</loc></sitemap>`)
    .join("");
  return xmlRes(c, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`);
});

app.get("/sitemaps/:file", async (c) => {
  const site = origin(c);
  const file = c.req.param("file");

  if (file === "static.xml") {
    const urls = ["/", "/recommend", "/loved", "/what-to-watch", "/movies", "/movies/best", "/best-episodes", "/premieres", "/tonight", "/calendar", "/renewals"]
      .map((p) => `<url><loc>${site}${p}</loc></url>`)
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const mv = /^movies-(\d+)\.xml$/.exec(file);
  if (mv) {
    const { results } = await c.env.DB.prepare(
      "SELECT slug FROM movies ORDER BY popularity DESC, imdb_id LIMIT ? OFFSET ?",
    )
      .bind(SHOWS_PER_SITEMAP, Number(mv[1]) * SHOWS_PER_SITEMAP)
      .all<{ slug: string }>();
    if (results.length === 0) return c.notFound();
    const urls = results
      .map((r) => `<url><loc>${site}/movie/${r.slug}</loc></url>`)
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const m = /^shows-(\d+)\.xml$/.exec(file);
  if (!m) return c.notFound();
  const { results } = await c.env.DB.prepare(
    "SELECT slug FROM shows ORDER BY weight DESC, id LIMIT ? OFFSET ?",
  )
    .bind(SHOWS_PER_SITEMAP, Number(m[1]) * SHOWS_PER_SITEMAP)
    .all<{ slug: string }>();
  if (results.length === 0) return c.notFound();

  const urls = results
    .map((r) =>
      ["", "/best-episodes", "/essential", "/ratings", "/next-episode", "/release-date"]
        .map((suffix) => `<url><loc>${site}/show/${r.slug}${suffix}</loc></url>`)
        .join(""),
    )
    .join("");
  return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

// ----------------------------------------------------------------- legal

app.get("/terms", (c) =>
  c.html(
    <Layout title="Terms of Service | TV Nightly" canonical={canonical(c)}>
      <h1>Terms of Service</h1>
      <p class="muted">Last updated: June 10, 2026</p>
      <p>
        By using TV Nightly ("the site") you agree to these terms. If you do not agree, please do
        not use the site.
      </p>
      <h2>What we provide</h2>
      <p>
        TV Nightly provides TV schedule, episode, and renewal information for personal,
        informational purposes only. Data is sourced from third parties (primarily{" "}
        <a href="https://www.tvmaze.com">TVmaze.com</a>, CC BY-SA) and is provided "as is" without
        warranty of accuracy, completeness, or timeliness. Air dates and statuses change without
        notice.
      </p>
      <h2>Acceptable use</h2>
      <p>
        You may not scrape the site at abusive rates, attempt to disrupt the service, or use it for
        unlawful purposes. Rankings and data derived from TVmaze are reusable under CC BY-SA with
        attribution.
      </p>
      <h2>Email alerts</h2>
      <p>
        Alert subscriptions are double opt-in and you can unsubscribe at any time via the link in
        every email. We may discontinue alerts at any time.
      </p>
      <h2>Liability</h2>
      <p>
        To the maximum extent permitted by law, TV Nightly is not liable for any damages arising
        from use of the site or reliance on its data.
      </p>
      <h2>Changes</h2>
      <p>We may update these terms; continued use after changes constitutes acceptance.</p>
    </Layout>,
  ),
);

app.get("/privacy", (c) =>
  c.html(
    <Layout title="Privacy Policy | TV Nightly" canonical={canonical(c)}>
      <h1>Privacy Policy</h1>
      <p class="muted">Last updated: June 10, 2026</p>
      <h2>What we collect</h2>
      <p>
        <strong>Email addresses</strong> you submit for show alerts or the daily email — used only
        to send what you signed up for. Subscriptions are double opt-in; every email includes an
        unsubscribe link that deletes your address for that list.
      </p>
      <p>
        <strong>Aggregate analytics</strong> via Cloudflare Web Analytics — privacy-first,
        cookie-less, and not tied to your identity. We do not use tracking cookies and we do not
        sell or share personal data.
      </p>
      <h2>Watch progress</h2>
      <p>
        Any "watched" marks are stored only in your browser's local storage — they never leave your
        device.
      </p>
      <h2>Advertising</h2>
      <p>
        If we introduce advertising, this policy will be updated first, and any ad partner's
        cookie/consent requirements will be disclosed here.
      </p>
      <h2>Contact</h2>
      <p>Questions or deletion requests: contact@tvnightly.com.</p>
    </Layout>,
  ),
);

app.notFound((c) =>
  c.html(
    <Layout title="Not found | TV Nightly">
      <h1>Page not found</h1>
      <p class="muted">
        Try <a href="/search">searching for a show</a> or head <a href="/">home</a>.
      </p>
    </Layout>,
    404,
  ),
);

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env));
  },
};
