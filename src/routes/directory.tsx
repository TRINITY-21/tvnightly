import { Hono } from "hono";
import { Bindings, ShowRow, MovieRow } from "../types";
import { slugifyName } from "../lib/format";
import { canonical } from "../lib/seo";
import { networkDirectory, genreDirectory } from "../lib/queries";
import { visitorRegion, providerBrand } from "../lib/providers";
import { VERTICALS } from "../lib/verticals";
import { Layout } from "../components/Layout";
import { ShowCard, MovieCard, ExploreCard } from "../components/cards";

const app = new Hono<{ Bindings: Bindings }>();

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
      title="Browse — every chart, network & genre | TV Nightly"
      description="All of TV Nightly in one place: charts, networks, TV and movie genres, fandom hubs, and watch-order guides."
      canonical={canonical(c)}
    >
      <h1>Browse</h1>
      <section>
        <div class="explore-grid">
          <ExploreCard
            icon="Charts"
            title="Top TV shows"
            desc="The highest-rated series we track, ranked honestly."
            href="/top/tv"
          />
          <ExploreCard
            icon="Shortcut"
            title="All-time best episodes"
            desc="The single greatest hours of television, across every show."
            href="/best-episodes"
          />
          <ExploreCard
            icon="Film"
            title="Top movies"
            desc="The best films of all time, with where to stream them."
            href="/movies/best"
          />
          <ExploreCard
            icon="Community"
            title="Most loved (community)"
            desc="What TV Nightly visitors actually loved — voted here, not imported."
            href="/loved"
          />
          <ExploreCard
            icon="Matchup"
            title="Compare two shows"
            desc="Episode-by-episode rating history, head to head on one chart."
            href="/compare"
          />
          <ExploreCard
            icon="Guides"
            title="Watch-order guides"
            desc="Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked."
            href="/watch-orders"
          />
        </div>
      </section>
      <section>
        <h2>More charts</h2>
        <p class="quick-picks">
          {CHARTS.filter(
            ([, href]) =>
              !["/top/tv", "/movies/best", "/best-episodes", "/loved", "/compare"].includes(href),
          ).map(([label, href]) => (
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
              best episodes
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

app.get("/network/:slug", async (c) => {
  const db = c.env.DB;
  const dir = await networkDirectory(db);
  let entry = dir.find((n) => n.slug === c.req.param("slug"));
  // long-tail fallback: network links now appear on every detail page, so
  // any network we actually hold shows for must resolve, not just the top 30
  if (!entry) {
    const { results: nets } = await db
      .prepare(
        `SELECT n, COUNT(*) AS c FROM (
           SELECT COALESCE(network, web_channel) AS n FROM shows
         ) WHERE n IS NOT NULL GROUP BY n`,
      )
      .all<{ n: string; c: number }>();
    const hit = nets.find((r) => slugifyName(r.n) === c.req.param("slug"));
    if (hit) entry = { name: hit.n, slug: slugifyName(hit.n), count: hit.c };
  }
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
  // streaming brands double as movie catalogs — surface their top films the
  // way genre pages do; broadcast networks simply match nothing and skip it.
  // LIKE is the coarse pass over the whole intl JSON; the visitor's region
  // decides for real, so we never claim a catalog they don't have.
  const region = visitorRegion(c);
  const netBrand = providerBrand(entry.name);
  const { results: filmPool } = await db
    .prepare(
      `SELECT * FROM movies WHERE providers_intl LIKE ? AND rating IS NOT NULL AND votes >= 1000
       ORDER BY rating DESC, votes DESC LIMIT 60`,
    )
    .bind(`%"${entry.name}%`)
    .all<MovieRow>();
  const films = filmPool
    .filter((m) => {
      const intl: Record<string, string[]> = m.providers_intl ? JSON.parse(m.providers_intl) : {};
      return (intl[region] ?? []).some((p) => providerBrand(p) === netBrand);
    })
    .slice(0, 12);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={
        films.length
          ? `The best ${entry.name} shows & movies — ranked | TV Nightly`
          : `The best ${entry.name} shows — ranked | TV Nightly`
      }
      description={`Every ${entry.name} ${films.length ? "show and movie" : "show"} worth watching, ranked by rating, plus what's currently airing.`}
      canonical={canonical(c)}
    >
      <h1>The best of {entry.name}</h1>
      <section>
        <h2>Top {entry.name} shows</h2>
        <div class="grid">
          {best.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      </section>
      {films.length ? (
        <section>
          <h2>Top {entry.name} movies</h2>
          <div class="grid">
            {films.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
      {airing.length ? (
        <section>
          <h2>Currently running</h2>
          <ul class="ep-list">
            {airing.map((s) => (
              <li>
                <a href={`/show/${s.slug}`}>{s.name}</a>{" "}
                <a class="muted" href={`/show/${s.slug}/next-episode`}>
                  next episode
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p>
        <a class="chev-after" href="/top/networks">All networks ranked</a> · <a href="/lists">Directory</a>
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
            Pick me a {label.toLowerCase()} show
          </a>
        ) : null}{" "}
        {movieGenre ? (
          <a class="verdict-btn" href={`/what-to-watch?type=movie&genre=${encodeURIComponent(movieGenre)}`}>
            Pick me a {label.toLowerCase()} movie
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
        <a class="chev-after" href="/lists">All genres</a>
      </p>
    </Layout>,
  );
});

export default app;
