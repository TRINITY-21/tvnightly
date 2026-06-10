import { Hono } from "hono";
import type { Context } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import { runSync, providerPatrol, sendDailyDigest, type SyncEnv } from "./sync";
import { sendEmails } from "./email";
import { signToken, verifyToken } from "./tokens";
import franchisesData from "../data/franchises.json";

interface FranchiseEntry {
  title: string;
  year: number;
  chrono: number;
  note?: string;
}
interface Franchise {
  slug: string;
  name: string;
  aka?: string;
  intro: string;
  chronoNote?: string;
  entries: FranchiseEntry[];
}
const FRANCHISES = franchisesData as Franchise[];
const FRANCHISE_BY_SLUG = new Map(FRANCHISES.map((f) => [f.slug, f]));
// Reverse index for movie pages: "title|year" -> franchise (year fuzz handled at lookup).
const FRANCHISE_OF_TITLE = new Map<string, { slug: string; name: string }>();
for (const f of FRANCHISES) {
  for (const e of f.entries) {
    FRANCHISE_OF_TITLE.set(`${e.title.toLowerCase()}|${e.year}`, { slug: f.slug, name: f.name });
  }
}
const franchiseOfMovie = (m: { title: string; year: number | null }) =>
  m.year
    ? (FRANCHISE_OF_TITLE.get(`${m.title.toLowerCase()}|${m.year}`) ??
      FRANCHISE_OF_TITLE.get(`${m.title.toLowerCase()}|${m.year - 1}`) ??
      FRANCHISE_OF_TITLE.get(`${m.title.toLowerCase()}|${m.year + 1}`))
    : undefined;

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
  providers_intl: string | null; // JSON object: country code -> service names
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
  providers_intl: string | null; // JSON object: country code -> service names
}

// Regions we mirror providers for (must match scripts/seed-movies.mjs).
const REGIONS = ["US", "GB", "CA", "AU", "IN", "DE", "FR", "ES", "IT", "BR", "MX", "NG", "NL", "SE", "JP", "KR"];

/** Visitor region: explicit ?region= override, else Cloudflare geo, else US. */
function visitorRegion(c: AppContext): string {
  const param = (c.req.query("region") ?? "").toUpperCase();
  if (REGIONS.includes(param)) return param;
  const geo = (c.req.header("cf-ipcountry") ?? "").toUpperCase();
  return REGIONS.includes(geo) ? geo : "US";
}

/** Provider names for a title in the given region (US fallback marked). */
function providersFor(
  row: { providers_intl: string | null },
  region: string,
): { names: string[]; region: string } {
  const intl: Record<string, string[]> = row.providers_intl ? JSON.parse(row.providers_intl) : {};
  if (intl[region]?.length) return { names: intl[region], region };
  if (region !== "US" && intl.US?.length) return { names: intl.US, region: "US" };
  return { names: [], region };
}

const ProviderLine: FC<{ row: { providers_intl: string | null }; region: string }> = ({
  row,
  region,
}) => {
  const prov = providersFor(row, region);
  if (!prov.names.length) return null;
  return (
    <p class="provs">
      <span class="muted">
        Streaming on{prov.region !== region ? ` (${prov.region} — not on your region's services)` : ` (${prov.region})`}
      </span>{" "}
      {prov.names.map((p) => (
        <span class="prov">{p}</span>
      ))}
    </p>
  );
};

// "Standby Glow" mark: a TV on standby — thin 16:9 frame, one glowing LED.
const LogoMark: FC<{ size?: number }> = ({ size = 26 }) => (
  <svg
    class="logo-mark"
    viewBox="0 0 36 24"
    width={size}
    height={Math.round((size * 24) / 36)}
    aria-hidden="true"
  >
    <defs>
      <filter id="lg" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="1.6" />
      </filter>
    </defs>
    <rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5" />
    <circle cx="27" cy="17" r="4.6" fill="#2DD9FF" opacity="0.35" filter="url(#lg)" />
    <circle cx="27" cy="17" r="2.4" fill="#2DD9FF" />
  </svg>
);

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
      <meta name="theme-color" content="#0B0E14" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
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
          <LogoMark />
          TV NIGHTLY<span class="logo-dot">.</span>
        </a>
        <form action="/search" method="get" class="search">
          <input type="search" name="q" placeholder="Search shows…" required />
        </form>
        <nav>
          <a href="/recommend">Recommend me</a>
          <a href="/loved">Loved</a>
          <a href="/what-to-watch">What to watch</a>
          <a href="/movies">Movies</a>
          <a href="/watch-orders">Watch orders</a>
          <a href="/whats-new">Streaming news</a>
          <a href="/tonight">Tonight</a>
          <a href="/calendar">Calendar</a>
          <a href="/renewals">Renewals</a>
          <a href="/lists">Directory</a>
        </nav>
      </header>
      <main>{props.children}</main>
      <footer class="site-footer">
        <p class="tagline">
          Tonight, decided<span class="logo-dot">.</span>
        </p>
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
          Hubs:{" "}
          {VERTICALS.map((v, i) => (
            <>
              {i > 0 ? " · " : ""}
              <a href={`/${v.slug}`}>{v.name}</a>
            </>
          ))}
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

const ExploreCard: FC<{ icon: string; title: string; desc: string; href: string }> = ({
  icon,
  title,
  desc,
  href,
}) => (
  <a class="explore-card" href={href}>
    <span class="explore-icon">{icon}</span>
    <span>
      <strong>{title}</strong>
      <p class="muted">{desc}</p>
    </span>
    <span class="explore-arrow">→</span>
  </a>
);

/** First vertical hub matching a title's genres (or the classics year cutoff). */
function hubForGenres(genres: string[], movieYear: number | null): { slug: string; name: string } | null {
  for (const v of VERTICALS) {
    if (v.movieYearMax && movieYear && movieYear <= v.movieYearMax) return { slug: v.slug, name: v.name };
    const all = [...(v.tvGenres ?? []), ...(v.movieGenres ?? [])];
    if (genres.some((g) => all.includes(g))) return { slug: v.slug, name: v.name };
  }
  return null;
}

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
      {tonight.length ? (
        <section>
          <h2>
            <span class="live-dot"></span>On tonight{" "}
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
      <p class="quick-picks">
        {VERTICALS.map((v) => (
          <a class="chip" href={`/${v.slug}`}>
            {v.name} hub
          </a>
        ))}
        <a class="chip" href="/watch-orders">
          Watch orders
        </a>
        <a class="chip" href="/whats-new">
          Streaming news
        </a>
      </p>
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
  const netName = show.network ?? show.web_channel;
  const netEntry = netName
    ? (await networkDirectory(c.env.DB)).find((n) => n.name === netName)
    : undefined;

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
            <ProviderLine row={show} region={visitorRegion(c)} />
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
                  top shows →
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
      `<rect x="${bandStart}" y="${PAD}" width="${endX - bandStart}" height="${H - PAD * 2}" fill="${bandIdx % 2 ? "#141a26" : "#0e121b"}"/>`,
      `<text x="${(bandStart + endX) / 2}" y="${H - 10}" fill="#97a1b5" font-size="10" text-anchor="middle">S${season}</text>`,
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
      `<line x1="${PAD}" y1="${yFor(r)}" x2="${x}" y2="${yFor(r)}" stroke="#222b3b" stroke-width="0.5"/>`,
      `<text x="${PAD - 6}" y="${yFor(r) + 3}" fill="#97a1b5" font-size="10" text-anchor="end">${r}</text>`,
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
      <h1>
        <span class="live-dot"></span>On TV tonight
      </h1>
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

// --------------------------------------------------- directory & charts

const slugifyName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Networks + streamers with enough mirrored shows to deserve a page. */
async function networkDirectory(db: D1Database): Promise<{ name: string; slug: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT n, COUNT(*) AS c FROM (
         SELECT COALESCE(network, web_channel) AS n FROM shows WHERE weight >= 60
       ) WHERE n IS NOT NULL GROUP BY n HAVING c >= 3 ORDER BY c DESC LIMIT 30`,
    )
    .all<{ n: string; c: number }>();
  return results.map((r) => ({ name: r.n, slug: slugifyName(r.n), count: r.c }));
}

async function genreDirectory(db: D1Database): Promise<{ tv: string[]; movie: string[] }> {
  const [tv, movie] = await Promise.all([
    db
      .prepare(
        `SELECT DISTINCT value AS g FROM shows, json_each(shows.genres) WHERE shows.weight >= 60 ORDER BY 1`,
      )
      .all<{ g: string }>(),
    db.prepare("SELECT DISTINCT value AS g FROM movies, json_each(movies.genres) ORDER BY 1").all<{ g: string }>(),
  ]);
  return { tv: tv.results.map((r) => r.g), movie: movie.results.map((r) => r.g) };
}

app.get("/lists", async (c) => {
  const [networks, genres] = await Promise.all([networkDirectory(c.env.DB), genreDirectory(c.env.DB)]);
  const CHARTS: [string, string][] = [
    ["Top TV shows", "/top/tv"],
    ["Top movies", "/movies/best"],
    ["Top TV seasons", "/top/seasons"],
    ["Top networks", "/top/networks"],
    ["All-time top episodes", "/best-episodes"],
    ["Most loved (community)", "/loved"],
    ["Compare two shows", "/compare"],
    ["Upcoming TV premieres", "/premieres"],
    ["Upcoming movies", "/movies/upcoming"],
    ["Streaming news", "/whats-new"],
  ];
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Directory — every chart, network & genre | TV Nightly"
      description="All of TV Nightly in one place: charts, networks, TV and movie genres, fandom hubs, and watch-order guides."
      canonical={canonical(c)}
    >
      <h1>Directory</h1>
      <section>
        <h2>Charts</h2>
        <p class="quick-picks">
          {CHARTS.map(([label, href]) => (
            <a class="chip" href={href}>
              {label}
            </a>
          ))}
        </p>
      </section>
      <section>
        <h2>Networks & streamers</h2>
        <p class="quick-picks">
          {networks.map((n) => (
            <a class="chip" href={`/network/${n.slug}`}>
              {n.name}
            </a>
          ))}
        </p>
      </section>
      <section>
        <h2>TV genres</h2>
        <p class="quick-picks">
          {genres.tv.map((g) => (
            <a class="chip" href={`/genre/${slugifyName(g)}`}>
              {g}
            </a>
          ))}
        </p>
      </section>
      <section>
        <h2>Movie genres</h2>
        <p class="quick-picks">
          {genres.movie.map((g) => (
            <a class="chip" href={`/genre/${slugifyName(g)}`}>
              {g}
            </a>
          ))}
        </p>
      </section>
      <section>
        <h2>Hubs & guides</h2>
        <p class="quick-picks">
          {VERTICALS.map((v) => (
            <a class="chip" href={`/${v.slug}`}>
              {v.name} hub
            </a>
          ))}
          <a class="chip" href="/watch-orders">
            Watch-order guides
          </a>
        </p>
      </section>
    </Layout>,
  );
});

app.get("/top/tv", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM shows WHERE rating IS NOT NULL AND weight >= 75
     ORDER BY rating DESC, weight DESC LIMIT 100`,
  ).all<ShowRow>();
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="The 100 top-rated TV shows | TV Nightly"
      description={`The best TV shows ranked by viewer rating${results[0] ? `, starting with ${results[0].name}` : ""}.`}
      canonical={canonical(c)}
    >
      <h1>The top-rated TV shows</h1>
      <ol class="ranked">
        {results.map((s) => (
          <li>
            <strong>
              <a href={`/show/${s.slug}`}>{s.name}</a>
            </strong>{" "}
            {s.premiered ? <span class="muted">({s.premiered.slice(0, 4)})</span> : null}
            <span class="rating"> ★ {s.rating!.toFixed(1)}</span>{" "}
            <a class="muted" href={`/show/${s.slug}/best-episodes`}>
              best episodes →
            </a>
          </li>
        ))}
      </ol>
    </Layout>,
  );
});

app.get("/top/seasons", async (c) => {
  // Same shrink as /best-episodes: TVmaze has no episode vote counts, so pull
  // season averages toward the show's overall rating; max 2 seasons per show.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT e.show_id, e.season, COUNT(*) AS eps, AVG(e.rating) AS avg_r,
              (AVG(e.rating) + 2.0 * s.rating) / 3.0 AS score, s.name, s.slug,
              ROW_NUMBER() OVER (PARTITION BY e.show_id ORDER BY AVG(e.rating) DESC) AS rn
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.rating IS NOT NULL AND s.rating IS NOT NULL AND s.weight >= 75
         AND e.season IS NOT NULL
       GROUP BY e.show_id, e.season HAVING COUNT(*) >= 6
     ) WHERE rn <= 2 ORDER BY score DESC LIMIT 50`,
  ).all<{ show_id: number; season: number; eps: number; avg_r: number; name: string; slug: string }>();
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="The 50 best TV seasons of all time | TV Nightly"
      description="Whole seasons ranked by their average episode rating — the greatest single runs in TV history."
      canonical={canonical(c)}
    >
      <h1>The best TV seasons of all time</h1>
      <p class="muted">
        Ranked by average episode rating (seasons with at least 6 rated episodes).
      </p>
      <ol class="ranked">
        {results.map((r) => (
          <li>
            <strong>
              <a href={`/show/${r.slug}/season/${r.season}`}>
                {r.name} — Season {r.season}
              </a>
            </strong>
            <span class="rating"> ★ {r.avg_r.toFixed(2)}</span>{" "}
            <span class="muted">avg over {r.eps} episodes</span>
          </li>
        ))}
      </ol>
    </Layout>,
  );
});

app.get("/top/networks", async (c) => {
  // Bayesian prior toward a 7.5 global mean (m=5) so a 3-show boutique can't
  // outrank a 30-show network on a lucky sample.
  const { results } = await c.env.DB.prepare(
    `SELECT n, c, r FROM (
       SELECT n, COUNT(*) AS c, AVG(rating) AS r,
              (SUM(rating) + 7.5 * 5) / (COUNT(*) + 5.0) AS score
       FROM (
         SELECT COALESCE(network, web_channel) AS n, rating FROM shows
         WHERE rating IS NOT NULL AND weight >= 60
       ) WHERE n IS NOT NULL GROUP BY n HAVING c >= 3
     ) ORDER BY score DESC LIMIT 30`,
  ).all<{ n: string; c: number; r: number }>();
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="TV networks & streamers ranked by show quality | TV Nightly"
      description="Which network actually makes the best TV? Every major network and streamer ranked by the average rating of its shows."
      canonical={canonical(c)}
    >
      <h1>Networks ranked by show quality</h1>
      <p class="muted">Average rating across each network's shows (minimum 3 rated shows).</p>
      <ol class="ranked">
        {results.map((r) => (
          <li>
            <strong>
              <a href={`/network/${slugifyName(r.n)}`}>{r.n}</a>
            </strong>
            <span class="rating"> ★ {r.r.toFixed(2)}</span>{" "}
            <span class="muted">across {r.c} shows</span>
          </li>
        ))}
      </ol>
    </Layout>,
  );
});

app.get("/movies/upcoming", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM upcoming_movies WHERE release_date >= date('now')
     ORDER BY release_date LIMIT 40`,
  ).all<{ tmdb_id: number; title: string; release_date: string; poster_url: string | null; overview: string | null }>();
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Upcoming movies — release dates | TV Nightly"
      description="Every major movie coming to theaters, in release order."
      canonical={canonical(c)}
    >
      <h1>Upcoming movies</h1>
      {results.length === 0 ? <p class="muted">No upcoming snapshot loaded yet.</p> : null}
      <ul class="ep-list">
        {results.map((m) => (
          <li class="wo-row">
            {m.poster_url ? <img class="wo-poster" src={m.poster_url} alt={m.title} loading="lazy" /> : null}
            <span>
              <strong>{m.title}</strong> <span class="muted">· {m.release_date}</span>
              {m.overview ? <p class="muted">{m.overview.slice(0, 160)}…</p> : null}
            </span>
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

// ------------------------------------------------------------- compare

function compareSvg(a: EpisodeRow[], b: EpisodeRow[]): string {
  const ra = a.filter((e) => e.rating != null);
  const rb = b.filter((e) => e.rating != null);
  if (!ra.length && !rb.length) return "";
  const n = Math.max(ra.length, rb.length);
  const PAD = 34;
  const STEP = Math.max(4, Math.min(9, Math.floor(800 / Math.max(n, 1))));
  const W = Math.max(420, n * STEP + PAD * 2);
  const H = 240;
  const yFor = (r: number) => PAD + (10 - Math.max(5, Math.min(10, r))) * ((H - PAD * 2) / 5);
  // Brand chart duotone: series A in phosphor cyan, series B in marquee pink.
  const line = (eps: EpisodeRow[], color: string) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${eps
      .map((e, i) => `${PAD + i * STEP + STEP / 2},${yFor(e.rating!)}`)
      .join(" ")}"/>`;
  const parts = [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Episode ratings comparison">`,
  ];
  for (const r of [5, 6, 7, 8, 9, 10]) {
    parts.push(
      `<line x1="${PAD}" y1="${yFor(r)}" x2="${W - PAD}" y2="${yFor(r)}" stroke="#222b3b" stroke-width="0.5"/>`,
      `<text x="${PAD - 6}" y="${yFor(r) + 3}" fill="#97a1b5" font-size="10" text-anchor="end">${r}</text>`,
    );
  }
  parts.push(line(ra, "#2DD9FF"), line(rb, "#FF5C8A"), "</svg>");
  return parts.join("");
}

const showBySlug = (db: D1Database, slug: string) =>
  db.prepare("SELECT * FROM shows WHERE slug = ?").bind(slug).first<ShowRow>();

/** Canonical matchup path: slugs in alphabetical order. */
const comparePathFor = (a: string, b: string) =>
  a.localeCompare(b) <= 0 ? `/compare/${a}-vs-${b}` : `/compare/${b}-vs-${a}`;

async function renderComparePage(c: AppContext, showA: ShowRow, showB: ShowRow) {
  const db = c.env.DB;
  const [epsA, epsB] = await Promise.all([
    db
      .prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number")
      .bind(showA.id)
      .all<EpisodeRow>()
      .then((r) => r.results),
    db
      .prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number")
      .bind(showB.id)
      .all<EpisodeRow>()
      .then((r) => r.results),
  ]);
  const svg = compareSvg(epsA, epsB);
  const best = (eps: EpisodeRow[]) =>
    eps.filter((e) => e.rating != null).sort((x, y) => y.rating! - x.rating!)[0];
  const bA = best(epsA);
  const bB = best(epsB);
  const stats = [
    { label: "Show rating", a: showA.rating?.toFixed(1) ?? "—", b: showB.rating?.toFixed(1) ?? "—" },
    { label: "Episodes", a: String(epsA.length), b: String(epsB.length) },
    {
      label: "Best episode",
      a: bA ? `${bA.name} (★${bA.rating!.toFixed(1)})` : "—",
      b: bB ? `${bB.name} (★${bB.rating!.toFixed(1)})` : "—",
    },
    { label: "Status", a: showA.status ?? "—", b: showB.status ?? "—" },
  ];

  // More matchups: each show's genre neighbors become suggested comparisons —
  // this link mesh is also what makes /compare/* pages crawlable.
  const [simA, simB] = await Promise.all([similarShows(db, showA), similarShows(db, showB)]);
  const seen = new Set([showA.slug, showB.slug]);
  const suggestions: { label: string; href: string }[] = [];
  for (const [base, sims] of [
    [showA, simA] as const,
    [showB, simB] as const,
  ]) {
    for (const s of sims.slice(0, 4)) {
      if (seen.has(s.slug)) continue;
      seen.add(s.slug);
      suggestions.push({ label: `${base.name} vs ${s.name}`, href: comparePathFor(base.slug, s.slug) });
    }
  }

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${showA.name} vs ${showB.name} — episode ratings compared | TV Nightly`}
      description={`${showA.name} or ${showB.name}? Both shows' full episode-rating histories on one chart, plus head-to-head stats.`}
      canonical={`${origin(c)}${comparePathFor(showA.slug, showB.slug)}`}
      ogImage={showA.image_url ?? showB.image_url ?? undefined}
    >
      <h1>
        <a href={`/show/${showA.slug}`}>{showA.name}</a> vs{" "}
        <a href={`/show/${showB.slug}`}>{showB.name}</a>
      </h1>
      <form method="get" action="/compare" class="picker-form">
        <label>
          Show A <input type="search" name="a" value={showA.name} required />
        </label>
        <label>
          Show B <input type="search" name="b" value={showB.name} required />
        </label>
        <button type="submit">Compare</button>
      </form>
      <p>
        <span class="prov" style="border-color:#2DD9FF">{showA.name}</span>{" "}
        <span class="prov" style="border-color:#FF5C8A;background:rgba(255,92,138,0.12)">{showB.name}</span>
      </p>
      {svg ? (
        <div class="graph-wrap">{raw(svg)}</div>
      ) : (
        <p class="muted">
          We don't have rated episodes for one of these yet — episode data fills in as the mirror
          grows.
        </p>
      )}
      <ul class="ep-list">
        {stats.map((s) => (
          <li>
            <span class="muted">{s.label}:</span> {s.a} <span class="muted">vs</span> {s.b}
          </li>
        ))}
      </ul>
      {suggestions.length ? (
        <section>
          <h2>More comparisons</h2>
          <p class="quick-picks">
            {suggestions.map((s) => (
              <a class="chip" href={s.href}>
                {s.label}
              </a>
            ))}
          </p>
        </section>
      ) : null}
    </Layout>,
  );
}

app.get("/compare/:pair", async (c) => {
  const db = c.env.DB;
  const pair = c.req.param("pair");
  // Slugs may themselves contain "-vs-": try each split until both resolve.
  const parts = pair.split("-vs-");
  let showA: ShowRow | null = null;
  let showB: ShowRow | null = null;
  for (let i = 1; i < parts.length && !showB; i++) {
    const [ra, rb] = await Promise.all([
      showBySlug(db, parts.slice(0, i).join("-vs-")),
      showBySlug(db, parts.slice(i).join("-vs-")),
    ]);
    if (ra && rb) {
      showA = ra;
      showB = rb;
    }
  }
  if (!showA || !showB) return c.notFound();
  const canonicalPath = comparePathFor(showA.slug, showB.slug);
  if (`/compare/${pair}` !== canonicalPath) return c.redirect(canonicalPath, 301);
  return renderComparePage(c, showA, showB);
});

app.get("/compare", async (c) => {
  const db = c.env.DB;
  const resolve = async (q: string): Promise<ShowRow | null> => {
    if (!q) return null;
    return (
      (await showBySlug(db, q)) ??
      (await db
        .prepare("SELECT * FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 1")
        .bind(q)
        .first<ShowRow>())
    );
  };
  const qa = (c.req.query("a") ?? "").trim();
  const qb = (c.req.query("b") ?? "").trim();
  const [showA, showB] = await Promise.all([resolve(qa), resolve(qb)]);
  // The form is the doorway; the matchup lives at its own canonical URL.
  if (showA && showB) return c.redirect(comparePathFor(showA.slug, showB.slug), 301);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Compare two TV shows — episode ratings head-to-head | TV Nightly"
      description="Put two shows' full episode-rating histories on one chart and settle the argument."
      canonical={`${origin(c)}/compare`}
    >
      <h1>Compare two shows</h1>
      <form method="get" action="/compare" class="picker-form">
        <label>
          Show A <input type="search" name="a" value={qa} placeholder="Breaking Bad" required />
        </label>
        <label>
          Show B <input type="search" name="b" value={qb} placeholder="The Wire" required />
        </label>
        <button type="submit">Compare</button>
      </form>
      {(qa || qb) && (!showA || !showB) ? (
        <p class="muted">Couldn't find one of those shows — try different names.</p>
      ) : null}
    </Layout>,
  );
});

// ------------------------------------------------- network & genre pages

app.get("/network/:slug", async (c) => {
  const db = c.env.DB;
  const dir = await networkDirectory(db);
  const entry = dir.find((n) => n.slug === c.req.param("slug"));
  if (!entry) return c.notFound();

  const { results: best } = await db
    .prepare(
      `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND rating IS NOT NULL
       ORDER BY rating DESC, weight DESC LIMIT 12`,
    )
    .bind(entry.name, entry.name)
    .all<ShowRow>();
  const { results: airing } = await db
    .prepare(
      `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND status = 'Running'
       ORDER BY weight DESC LIMIT 10`,
    )
    .bind(entry.name, entry.name)
    .all<ShowRow>();

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`The best ${entry.name} shows — ranked | TV Nightly`}
      description={`Every ${entry.name} show worth watching, ranked by rating, plus what's currently airing.`}
      canonical={canonical(c)}
    >
      <h1>The best of {entry.name}</h1>
      <section>
        <h2>Top-rated {entry.name} shows</h2>
        <div class="grid">
          {best.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      </section>
      {airing.length ? (
        <section>
          <h2>Currently running</h2>
          <ul class="ep-list">
            {airing.map((s) => (
              <li>
                <a href={`/show/${s.slug}`}>{s.name}</a>{" "}
                <a class="muted" href={`/show/${s.slug}/next-episode`}>
                  next episode →
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p>
        <a href="/top/networks">All networks ranked →</a> · <a href="/lists">Directory</a>
      </p>
    </Layout>,
  );
});

app.get("/genre/:slug", async (c) => {
  const db = c.env.DB;
  const dir = await genreDirectory(db);
  const slug = c.req.param("slug");
  const tvGenre = dir.tv.find((g) => slugifyName(g) === slug);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === slug);
  if (!tvGenre && !movieGenre) return c.notFound();
  const label = tvGenre ?? movieGenre!;

  const shows = tvGenre
    ? (
        await db
          .prepare(
            `SELECT * FROM shows WHERE genres LIKE ? AND rating IS NOT NULL AND weight >= 60
             ORDER BY rating DESC, weight DESC LIMIT 12`,
          )
          .bind(`%"${tvGenre}"%`)
          .all<ShowRow>()
      ).results
    : [];
  const movies = movieGenre
    ? (
        await db
          .prepare(
            `SELECT * FROM movies WHERE genres LIKE ? AND rating IS NOT NULL AND votes >= 1000
             ORDER BY rating DESC, votes DESC LIMIT 12`,
          )
          .bind(`%"${movieGenre}"%`)
          .all<MovieRow>()
      ).results
    : [];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`The best ${label.toLowerCase()} shows & movies | TV Nightly`}
      description={`Top-rated ${label.toLowerCase()} TV series and films, with streaming availability.`}
      canonical={canonical(c)}
    >
      <h1>The best of {label}</h1>
      <p>
        {tvGenre ? (
          <a class="verdict-btn" href={`/what-to-watch?genre=${encodeURIComponent(tvGenre)}`}>
            Pick me a {label.toLowerCase()} show 🎲
          </a>
        ) : null}{" "}
        {movieGenre ? (
          <a class="verdict-btn" href={`/what-to-watch?type=movie&genre=${encodeURIComponent(movieGenre)}`}>
            Pick me a {label.toLowerCase()} movie 🎲
          </a>
        ) : null}
      </p>
      {shows.length ? (
        <section>
          <h2>Top {label.toLowerCase()} series</h2>
          <div class="grid">
            {shows.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {movies.length ? (
        <section>
          <h2>Top {label.toLowerCase()} films</h2>
          <div class="grid">
            {movies.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
      <p>
        <a href="/lists">All genres →</a>
      </p>
    </Layout>,
  );
});

// ------------------------------------------------- niche vertical hubs

interface Vertical {
  slug: string;
  name: string;
  pageTitle: string;
  description: string;
  intro: string;
  tvGenres?: string[];
  movieGenres?: string[];
  movieYearMax?: number;
  movieSectionTitle: string;
  watchOrders?: string[];
  pickerQS: string;
}

const genreOr = (col: string, genres: string[]) =>
  `(${genres.map(() => `${col} LIKE ?`).join(" OR ")})`;
const genreBinds = (genres: string[]) => genres.map((g) => `%"${g}"%`);

const VERTICALS: Vertical[] = [
  {
    slug: "anime",
    name: "Anime",
    pageTitle: "Anime — where to watch, the best series & what's new",
    description:
      "The anime hub: top-rated series with streaming availability, upcoming premieres, what just hit your services, and a picker when you can't decide.",
    intro:
      "Everything anime in one place — bookmark this page. Rankings from real ratings, availability checked around the clock, localized to your country.",
    tvGenres: ["Anime"],
    movieGenres: ["Animation"],
    movieSectionTitle: "Top animation & anime films",
    pickerQS: "?genre=Anime",
  },
  {
    slug: "horror",
    name: "Horror",
    pageTitle: "Horror — where to watch, the best series & films, what's new",
    description:
      "The horror hub: the best horror shows and films with streaming availability, upcoming premieres, and what just arrived on your services.",
    intro:
      "For the people who watch through their fingers — bookmark this page. The best of the genre, where it's streaming, and what's new, updated daily.",
    tvGenres: ["Horror"],
    movieGenres: ["Horror"],
    movieSectionTitle: "Top horror films",
    watchOrders: ["conjuring-universe"],
    pickerQS: "?genre=Horror",
  },
  {
    slug: "classics",
    name: "Classic film",
    pageTitle: "Classic films — the greatest movies before 1980 & where to stream them",
    description:
      "The classic-film hub: the greatest pre-1980 movies ranked by rating, with current streaming availability in your country.",
    intro:
      "The canon, minus the dust — bookmark this page. Every classic ranked by rating, with live streaming availability so you can actually watch them tonight.",
    movieYearMax: 1979,
    movieSectionTitle: "The greatest films before 1980",
    pickerQS: "?type=movie&min=8",
  },
  {
    slug: "sci-fi",
    name: "Sci-fi & fantasy",
    pageTitle: "Sci-fi & fantasy — where to watch, the best series & films, what's new",
    description:
      "The sci-fi & fantasy hub: the best series and films with streaming availability, upcoming premieres, and what just arrived on your services.",
    intro:
      "Other worlds, one page — bookmark it. The best of both genres, where to stream them in your country, and every upcoming premiere.",
    tvGenres: ["Science-Fiction", "Fantasy"],
    movieGenres: ["Science Fiction", "Fantasy"],
    movieSectionTitle: "Top sci-fi & fantasy films",
    watchOrders: ["star-wars", "middle-earth", "terminator"],
    pickerQS: "?genre=Science-Fiction",
  },
];

const hubHandler = (v: Vertical) => async (c: AppContext) => {
  const db = c.env.DB;
  const region = visitorRegion(c);

  const shows = v.tvGenres?.length
    ? (
        await db
          .prepare(
            `SELECT * FROM shows WHERE ${genreOr("genres", v.tvGenres)} AND rating IS NOT NULL AND weight >= 60
             ORDER BY rating DESC, weight DESC LIMIT 12`,
          )
          .bind(...genreBinds(v.tvGenres))
          .all<ShowRow>()
      ).results
    : [];

  const movieConds = ["rating IS NOT NULL", "votes >= 1000"];
  const movieBinds: (string | number)[] = [];
  if (v.movieGenres?.length) {
    movieConds.push(genreOr("genres", v.movieGenres));
    movieBinds.push(...genreBinds(v.movieGenres));
  }
  if (v.movieYearMax) {
    movieConds.push("year <= ?");
    movieBinds.push(v.movieYearMax);
  }
  const movies = (
    await db
      .prepare(
        `SELECT * FROM movies WHERE ${movieConds.join(" AND ")}
         ORDER BY rating DESC, votes DESC LIMIT 12`,
      )
      .bind(...movieBinds)
      .all<MovieRow>()
  ).results;

  const premieres = v.tvGenres?.length
    ? (
        await db
          .prepare(
            `SELECT e.airdate, e.season, s.name AS show_name, s.slug AS show_slug
             FROM episodes e JOIN shows s ON s.id = e.show_id
             WHERE e.number = 1 AND e.airstamp > datetime('now')
               AND e.airstamp < datetime('now', '+90 days') AND ${genreOr("s.genres", v.tvGenres)}
             ORDER BY e.airstamp LIMIT 6`,
          )
          .bind(...genreBinds(v.tvGenres))
          .all<{ airdate: string | null; season: number | null; show_name: string; show_slug: string }>()
      ).results
    : [];

  // What just arrived on streaming, for this genre, in the visitor's region.
  const newOnTv = v.tvGenres?.length
    ? (
        await db
          .prepare(
            `SELECT pe.title, pe.slug, pe.service, pe.detected_at FROM provider_events pe
             JOIN shows s ON pe.kind = 'tv' AND s.id = CAST(pe.ref AS INTEGER)
             WHERE pe.region = ? AND pe.change = 'added' AND ${genreOr("s.genres", v.tvGenres)}
             ORDER BY pe.detected_at DESC LIMIT 8`,
          )
          .bind(region, ...genreBinds(v.tvGenres))
          .all<{ title: string; slug: string; service: string; detected_at: number }>()
      ).results
    : [];
  const newOnMovies = (
    await db
      .prepare(
        `SELECT pe.title, pe.slug, pe.service, pe.detected_at FROM provider_events pe
         JOIN movies m ON pe.kind = 'movie' AND m.imdb_id = pe.ref
         WHERE pe.region = ? AND pe.change = 'added'
           ${v.movieGenres?.length ? `AND ${genreOr("m.genres", v.movieGenres)}` : ""}${v.movieYearMax ? " AND m.year <= ?" : ""}
         ORDER BY pe.detected_at DESC LIMIT 8`,
      )
      .bind(
        region,
        ...(v.movieGenres?.length ? genreBinds(v.movieGenres) : []),
        ...(v.movieYearMax ? [v.movieYearMax] : []),
      )
      .all<{ title: string; slug: string; service: string; detected_at: number }>()
  ).results;

  c.header("Cache-Control", "private, max-age=600");
  return c.html(
    <Layout
      title={`${v.pageTitle} | TV Nightly`}
      description={v.description}
      canonical={`${origin(c)}/${v.slug}`}
    >
      <h1>{v.name}</h1>
      <p>{v.intro}</p>
      <p>
        <a class="verdict-btn" href={`/what-to-watch${v.pickerQS}`}>
          Pick me something {v.name.toLowerCase()} 🎲
        </a>
        {(v.watchOrders ?? []).map((slug) => {
          const fr = FRANCHISE_BY_SLUG.get(slug);
          return fr ? (
            <>
              {" "}
              <a class="verdict-btn" href={`/watch-order/${slug}`}>
                {fr.name} watch order
              </a>
            </>
          ) : null;
        })}
      </p>
      {newOnTv.length || newOnMovies.length ? (
        <section>
          <h2>Just added to streaming ({region})</h2>
          <ul class="ep-list">
            {[...newOnTv.map((r) => ({ ...r, kind: "tv" })), ...newOnMovies.map((r) => ({ ...r, kind: "movie" }))]
              .sort((a, b) => b.detected_at - a.detected_at)
              .slice(0, 10)
              .map((r) => (
                <li>
                  <a href={r.kind === "tv" ? `/show/${r.slug}` : `/movie/${r.slug}`}>{r.title}</a>{" "}
                  <span class="muted">→ {r.service}</span>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      {premieres.length ? (
        <section>
          <h2>Premiering soon</h2>
          <ul class="ep-list">
            {premieres.map((p) => (
              <li>
                <span class="muted">{p.airdate}</span>{" "}
                <a href={`/show/${p.show_slug}/release-date`}>{p.show_name}</a> Season {p.season}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {shows.length ? (
        <section>
          <h2>The best {v.name.toLowerCase()} series</h2>
          <div class="grid">
            {shows.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {movies.length ? (
        <section>
          <h2>{v.movieSectionTitle}</h2>
          <div class="grid">
            {movies.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
      <div class="sub-form inline">
        <form method="post" action="/subscribe" class="sub-form">
          <input type="hidden" name="kind" value="daily" />
          <label>New {v.name.toLowerCase()} worth watching, in your inbox:</label>
          <input type="email" name="email" placeholder="you@example.com" required />
          <button type="submit">Sign me up</button>
        </form>
      </div>
    </Layout>,
  );
};

for (const v of VERTICALS) {
  app.get(`/${v.slug}`, hubHandler(v));
}

// ------------------------------------------------- franchise watch orders

const fmtMarathon = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

app.get("/watch-orders", (c) => {
  c.header("Cache-Control", "public, max-age=86400");
  return c.html(
    <Layout
      title="Franchise watch-order guides — release & chronological | TV Nightly"
      description="How to watch every big movie franchise in order: Marvel, Star Wars, Harry Potter and more — release and chronological orders with runtimes and streaming info."
      canonical={canonical(c)}
    >
      <h1>Watch-order guides</h1>
      <p class="muted">
        Release order and chronological order for every major franchise — with ratings, runtimes,
        and where to stream.
      </p>
      <ul class="ep-list">
        {FRANCHISES.map((f) => (
          <li>
            <strong>
              <a href={`/watch-order/${f.slug}`}>How to watch {f.name} in order</a>
            </strong>{" "}
            <span class="muted">· {f.entries.length} films</span>
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

app.get("/watch-order/:slug", async (c) => {
  const fr = FRANCHISE_BY_SLUG.get(c.req.param("slug"));
  if (!fr) return c.notFound();

  // Join the curated list against the movie mirror for posters/ratings/
  // runtimes/providers. Unmatched entries render as plain rows.
  const titles = fr.entries.map((e) => e.title);
  const placeholders = titles.map(() => "?").join(",");
  const { results: rows } = await c.env.DB.prepare(
    `SELECT * FROM movies WHERE title IN (${placeholders})`,
  )
    .bind(...titles)
    .all<MovieRow>();
  const byTitle = new Map(rows.map((m) => [`${m.title.toLowerCase()}`, m]));
  const movieFor = (e: FranchiseEntry): MovieRow | undefined => {
    const m = byTitle.get(e.title.toLowerCase());
    return m && m.year != null && Math.abs(m.year - e.year) <= 1 ? m : undefined;
  };

  const release = fr.entries;
  const chrono = [...fr.entries].sort((a, b) => a.chrono - b.chrono);
  const matchedRuntimes = release.map((e) => movieFor(e)?.runtime ?? 0);
  const marathonMins = matchedRuntimes.reduce((a, b) => a + b, 0);
  const allMatched = matchedRuntimes.every((r) => r > 0);

  const Row = ({ e, idx }: { e: FranchiseEntry; idx: number }) => {
    const m = movieFor(e);
    const provs: string[] = m?.providers ? JSON.parse(m.providers) : [];
    return (
      <li class="wo-row">
        <span class="wo-num">{idx + 1}</span>
        {m?.poster_url ? <img class="wo-poster" src={m.poster_url} alt={e.title} loading="lazy" /> : null}
        <span>
          {m ? <a href={`/movie/${m.slug}`}>{e.title}</a> : <strong>{e.title}</strong>}{" "}
          <span class="muted">({e.year})</span>
          {m?.rating != null ? <span class="rating"> ★ {m.rating.toFixed(1)}</span> : null}
          {m?.runtime ? <span class="muted"> · {m.runtime} min</span> : null}
          {provs.length ? <span class="muted"> · {provs.slice(0, 3).join(", ")}</span> : null}
          {e.note ? <span class="why-tag">{e.note}</span> : null}
        </span>
      </li>
    );
  };

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`How to watch ${fr.name} in order (release & chronological) | TV Nightly`}
      description={`${fr.name} watch order: all ${fr.entries.length} films in release and chronological order, with runtimes and streaming availability.`}
      canonical={canonical(c)}
      ogImage={movieFor(fr.entries[0])?.poster_url ?? undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `How to watch ${fr.name} in order`,
          itemListElement: release.map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${e.title} (${e.year})`,
          })),
        },
      ]}
    >
      <h1>How to watch {fr.name} in order</h1>
      <p>{fr.intro}</p>
      {marathonMins > 0 ? (
        <p class="muted">
          Full marathon: <strong>{fmtMarathon(marathonMins)}</strong>
          {allMatched ? "" : " (counting the films we have runtimes for)"} · {fr.entries.length}{" "}
          films
        </p>
      ) : null}
      <section>
        <h2>Release order (best first watch)</h2>
        <ol class="ep-list wo-list">
          {release.map((e, i) => (
            <Row e={e} idx={i} />
          ))}
        </ol>
      </section>
      <section>
        <h2>Chronological order (story timeline)</h2>
        {fr.chronoNote ? <p class="muted">{fr.chronoNote}</p> : null}
        <ol class="ep-list wo-list">
          {chrono.map((e, i) => (
            <Row e={e} idx={i} />
          ))}
        </ol>
      </section>
      <p>
        <a href="/watch-orders">All watch-order guides →</a>
      </p>
    </Layout>,
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
  const simMovies = await similarMovies(c.env.DB, movie);

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
            <ProviderLine row={movie} region={visitorRegion(c)} />
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
        {simMovies.length ? (
          <section>
            <h2>Movies like {movie.title}</h2>
            <div class="grid">
              {simMovies.map((m) => (
                <MovieCard movie={m} />
              ))}
            </div>
          </section>
        ) : null}
        {(() => {
          const fr = franchiseOfMovie(movie);
          const hub = hubForGenres(genres, movie.year);
          const prov0 = providersFor(movie, visitorRegion(c)).names[0];
          return (
            <section>
              <h2>
                Keep exploring{" "}
                <a class="more" href="/movies/best">
                  top movies →
                </a>
              </h2>
              <div class="explore-grid">
                {fr ? (
                  <ExploreCard
                    icon="📋"
                    title={`${fr.name} watch order`}
                    desc="Every film in the franchise, release and chronological order."
                    href={`/watch-order/${fr.slug}`}
                  />
                ) : null}
                {genres.slice(0, 2).map((g) => (
                  <ExploreCard
                    icon="GEN"
                    title={`Best ${g.toLowerCase()} films & shows`}
                    desc={`The top of the ${g.toLowerCase()} pile, across both mediums.`}
                    href={`/genre/${slugifyName(g)}`}
                  />
                ))}
                {prov0 ? (
                  <ExploreCard
                    icon="🎲"
                    title={`Spin a ${prov0} movie`}
                    desc="Random great pick from the same service you already pay for."
                    href={`/what-to-watch?type=movie&service=${encodeURIComponent(prov0)}`}
                  />
                ) : null}
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

// ----------------------------------------------------- what-to-watch picker

// Pool floor: TVmaze weight >= 75 keeps picks recognizable (and the indexed
// range scan keeps D1 rows-read low even on a full 80K-show mirror).
const PICKER_MIN_WEIGHT = 75;

// "Who's watching?" — situational facts, not feelings. Genre lists carry both
// TVmaze ("Science-Fiction", "Children") and TMDB ("Science Fiction") names.
const COMPANY: Record<
  string,
  { label: string; include: string[]; exclude?: string[]; min?: number }
> = {
  date: { label: "Date night", include: ["Romance", "Comedy", "Music"], min: 7 },
  family: {
    label: "Family night",
    include: ["Family", "Children", "Animation", "Adventure", "Fantasy"],
    exclude: ["Horror", "Crime", "Thriller", "War"],
  },
  friends: {
    label: "With friends",
    include: ["Action", "Comedy", "Horror", "Adventure", "Science-Fiction", "Science Fiction", "Thriller"],
  },
};

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

  // Service filter (both mediums): dropdown derived from real provider data,
  // localized to the visitor's region (CF geo, ?region= override).
  const region = visitorRegion(c);
  const serviceRows =
    type === "movie"
      ? (
          await db
            .prepare(
              `SELECT value AS p, COUNT(*) AS n
               FROM movies, json_each(json_extract(movies.providers_intl, ?))
               GROUP BY value ORDER BY n DESC LIMIT 12`,
            )
            .bind(`$.${region}`)
            .all<{ p: string }>()
        ).results
      : (
          await db
            .prepare(
              `SELECT value AS p, COUNT(*) AS n
               FROM shows, json_each(json_extract(shows.providers_intl, ?))
               WHERE shows.weight >= ?
               GROUP BY value ORDER BY n DESC LIMIT 12`,
            )
            .bind(`$.${region}`, PICKER_MIN_WEIGHT)
            .all<{ p: string }>()
        ).results;
  const reqService = (c.req.query("service") ?? "").trim();
  const service = serviceRows.some((r) => r.p === reqService) ? reqService : "";

  const who = COMPANY[c.req.query("who") ?? ""] ? (c.req.query("who") as string) : "";

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
    conds.push("json_extract(providers_intl, ?) LIKE ?");
    binds.push(`$.${region}`, `%"${service}"%`);
  }
  if (who) {
    const cfg = COMPANY[who];
    conds.push(`(${cfg.include.map(() => "genres LIKE ?").join(" OR ")})`);
    binds.push(...cfg.include.map((g) => `%"${g}"%`));
    for (const g of cfg.exclude ?? []) {
      conds.push("genres NOT LIKE ?");
      binds.push(`%"${g}"%`);
    }
    if (cfg.min && !minRating) {
      conds.push("rating >= ?");
      binds.push(cfg.min);
    }
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
        providers: providersFor(m, region).names,
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
        providers: providersFor(s, region).names,
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
          {/* Filters are per-medium (movies: service; TV: status) to keep the
              form lean — auto-submit so switching reveals them immediately. */}
          <select name="type" onchange="this.form.submit()">
            <option value="tv" selected={type === "tv"}>
              TV show
            </option>
            <option value="movie" selected={type === "movie"}>
              Movie
            </option>
          </select>
        </label>
        <label>
          Who's watching?{" "}
          <select name="who">
            <option value="" selected={!who}>
              Anyone
            </option>
            {Object.entries(COMPANY).map(([key, cfg]) => (
              <option value={key} selected={who === key}>
                {cfg.label}
              </option>
            ))}
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
        {serviceRows.length ? (
          <label>
            Streaming on ({region}){" "}
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
        <button type="submit">Settle it for us 🎲</button>
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

// -------------------------------------------------- what's new on streaming

app.get("/whats-new", async (c) => {
  const region = visitorRegion(c);
  const { results } = await c.env.DB.prepare(
    `SELECT kind, slug, title, service, change, detected_at FROM provider_events
     WHERE region = ? ORDER BY detected_at DESC LIMIT 150`,
  )
    .bind(region)
    .all<{ kind: string; slug: string; title: string; service: string; change: string; detected_at: number }>();

  const href = (r: { kind: string; slug: string }) =>
    r.kind === "movie" ? `/movie/${r.slug}` : `/show/${r.slug}`;
  const added = results.filter((r) => r.change === "added");
  const removed = results.filter((r) => r.change === "removed");
  const byService = (rows: typeof results) => {
    const m = new Map<string, typeof results>();
    for (const r of rows) {
      if (!m.has(r.service)) m.set(r.service, [] as typeof results);
      m.get(r.service)!.push(r);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  c.header("Cache-Control", "private, max-age=300");
  return c.html(
    <Layout
      title={`What's new on streaming (${region}) — and what just left | TV Nightly`}
      description="Titles that just arrived on or left Netflix, Prime Video, Disney+ and more — tracked by our availability patrol, localized to your country."
      canonical={`${origin(c)}/whats-new`}
    >
      <h1>What's new on streaming ({region})</h1>
      <p class="muted">
        Our patrol re-checks availability around the clock and logs every change. Yesterday's
        catalog shuffle, today's news.
      </p>
      {results.length === 0 ? (
        <p class="muted">
          No changes logged for {region} yet — the patrol cycles the whole catalog every couple of
          days. Check back soon.
        </p>
      ) : null}
      {added.length ? (
        <section>
          <h2>Just added</h2>
          {byService(added).map(([service, rows]) => (
            <section>
              <h3>New on {service}</h3>
              <ul class="ep-list">
                {rows.map((r) => (
                  <li>
                    <a href={href(r)}>{r.title}</a>{" "}
                    <span class="muted">
                      · {r.kind === "movie" ? "Movie" : "TV"} ·{" "}
                      {new Date(r.detected_at * 1000).toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      ) : null}
      {removed.length ? (
        <section>
          <h2>Just left</h2>
          {byService(removed).map(([service, rows]) => (
            <section>
              <h3>Left {service}</h3>
              <ul class="ep-list">
                {rows.map((r) => (
                  <li>
                    <a href={href(r)}>{r.title}</a>{" "}
                    <span class="muted">
                      · {r.kind === "movie" ? "Movie" : "TV"} ·{" "}
                      {new Date(r.detected_at * 1000).toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      ) : null}
      <div class="sub-form inline">
        <form method="post" action="/subscribe" class="sub-form">
          <input type="hidden" name="kind" value="daily" />
          <label>Get the streaming shuffle in your inbox:</label>
          <input type="email" name="email" placeholder="you@example.com" required />
          <button type="submit">Sign me up</button>
        </form>
      </div>
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
    const [networks, genres] = await Promise.all([
      networkDirectory(c.env.DB),
      genreDirectory(c.env.DB),
    ]);
    const genreSlugs = [...new Set([...genres.tv, ...genres.movie].map((g) => slugifyName(g)))];
    const urls = [
      "/",
      "/recommend",
      "/loved",
      "/what-to-watch",
      "/movies",
      "/movies/best",
      "/movies/upcoming",
      "/best-episodes",
      "/premieres",
      "/whats-new",
      "/tonight",
      "/calendar",
      "/renewals",
      "/watch-orders",
      "/lists",
      "/top/tv",
      "/top/seasons",
      "/top/networks",
      "/compare",
      ...FRANCHISES.map((f) => `/watch-order/${f.slug}`),
      ...VERTICALS.map((v) => `/${v.slug}`),
      ...networks.map((n) => `/network/${n.slug}`),
      ...genreSlugs.map((g) => `/genre/${g}`),
    ]
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
  scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    // :30 = provider patrol; 22:00 = daily digest; :00 (and manual) = sync.
    ctx.waitUntil(
      event.cron === "30 * * * *"
        ? providerPatrol(env)
        : event.cron === "0 22 * * *"
          ? sendDailyDigest(env)
          : runSync(env),
    );
  },
};
