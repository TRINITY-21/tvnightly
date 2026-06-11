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

// ---------------------------------------- network & provider brand pages

type NetEntry = { name: string; slug: string; count: number };

/** Three resolution tiers: directory (top 30), any network we hold shows
 *  for, then streaming brands the catalogs know but TVmaze doesn't call a
 *  network ("Paramount+", "fuboTV") — the dossier logos link here, so
 *  every brand we print must resolve. */
async function resolveNetwork(db: D1Database, slug: string): Promise<NetEntry | null> {
  const dir = await networkDirectory(db);
  const top = dir.find((n) => n.slug === slug);
  if (top) return top;
  const { results: nets } = await db
    .prepare(
      `SELECT n, COUNT(*) AS c FROM (
         SELECT COALESCE(network, web_channel) AS n FROM shows
       ) WHERE n IS NOT NULL GROUP BY n`,
    )
    .all<{ n: string; c: number }>();
  const net = nets.find((r) => slugifyName(r.n) === slug);
  if (net) return { name: net.n, slug, count: net.c };
  const { results: provRows } = await db
    .prepare(
      `SELECT DISTINCT j.value AS p FROM movies, json_tree(movies.providers_intl) AS j
         WHERE movies.providers_intl IS NOT NULL AND j.type = 'text'
       UNION
       SELECT DISTINCT j.value FROM shows, json_tree(shows.providers_intl) AS j
         WHERE shows.providers_intl IS NOT NULL AND j.type = 'text'`,
    )
    .all<{ p: string }>();
  const members = provRows.map((r) => r.p).filter((p) => slugifyName(providerBrand(p)) === slug);
  if (!members.length) return null;
  const name = members.reduce((a, b) => (b.trim().length < a.trim().length ? b : a)).trim();
  return { name, slug, count: 0 };
}

/** The visitor's region decides catalog membership for real, so no page
 *  ever claims a library they don't have. */
const regionTester = (region: string, brandName: string) => {
  const brand = providerBrand(brandName);
  return (json: string | null): boolean => {
    const intl: Record<string, string[]> = json ? JSON.parse(json) : {};
    return (intl[region] ?? []).some((p) => providerBrand(p) === brand);
  };
};

/** A brand's shows are its originals AND its regional catalog, merged —
 *  "Top Hulu shows" must contain the show whose receipt said "Streaming
 *  on Hulu", not just Hulu originals; FX simply has no catalog side. */
async function topNetworkShows(
  db: D1Database,
  entry: NetEntry,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<ShowRow[]> {
  const [byNet, pool] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND rating IS NOT NULL
         ORDER BY rating DESC, weight DESC LIMIT ?`,
      )
      .bind(entry.name, entry.name, limit)
      .all<ShowRow>(),
    db
      .prepare(
        `SELECT * FROM shows WHERE providers_intl IS NOT NULL AND rating IS NOT NULL
         AND weight >= 60 ORDER BY rating DESC, weight DESC LIMIT 400`,
      )
      .all<ShowRow>(),
  ]);
  const seen = new Set<number>();
  return [...byNet.results, ...pool.results.filter((s) => regionHas(s.providers_intl))]
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, limit);
}

async function topNetworkMovies(
  db: D1Database,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<MovieRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM movies WHERE providers_intl IS NOT NULL AND rating IS NOT NULL
       AND votes >= 1000 ORDER BY rating DESC, votes DESC LIMIT 400`,
    )
    .all<MovieRow>();
  return results.filter((m) => regionHas(m.providers_intl)).slice(0, limit);
}

app.get("/network/:slug", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const entry = await resolveNetwork(db, slug);
  if (!entry) return c.notFound();
  const regionHas = regionTester(visitorRegion(c), entry.name);

  const [best, films, airingRes] = await Promise.all([
    topNetworkShows(db, entry, regionHas, 12),
    topNetworkMovies(db, regionHas, 12),
    db
      .prepare(
        `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND status = 'Running'
         ORDER BY weight DESC LIMIT 10`,
      )
      .bind(entry.name, entry.name)
      .all<ShowRow>(),
  ]);
  const airing = airingRes.results;

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
      {best.length ? (
        <section>
          <h2>
            Top {entry.name} shows{" "}
            <a class="more" href={`/network/${slug}/shows`}>
              see all
            </a>
          </h2>
          <div class="grid">
            {best.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {films.length ? (
        <section>
          <h2>
            Top {entry.name} movies{" "}
            <a class="more" href={`/network/${slug}/movies`}>
              see all
            </a>
          </h2>
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

// The per-medium top pages the provider logos deep-link into: a show
// context lands on shows, a movie context on movies.
app.get("/network/:slug/shows", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const entry = await resolveNetwork(db, slug);
  if (!entry) return c.notFound();
  const regionHas = regionTester(visitorRegion(c), entry.name);
  const rows = await topNetworkShows(db, entry, regionHas, 48);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${entry.name} shows — ranked | TV Nightly`}
      description={`The best TV shows on ${entry.name}, ranked by viewer rating.`}
      canonical={canonical(c)}
    >
      <h1>Top {entry.name} shows</h1>
      {rows.length ? (
        <div class="grid">
          {rows.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      ) : (
        <p class="muted">No {entry.name} shows in this region's catalog yet.</p>
      )}
      <p>
        <a class="chev-after" href={`/network/${slug}/movies`}>Top {entry.name} movies</a> ·{" "}
        <a href={`/network/${slug}`}>The best of {entry.name}</a>
      </p>
    </Layout>,
  );
});

app.get("/network/:slug/movies", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const entry = await resolveNetwork(db, slug);
  if (!entry) return c.notFound();
  const regionHas = regionTester(visitorRegion(c), entry.name);
  const rows = await topNetworkMovies(db, regionHas, 48);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${entry.name} movies — ranked | TV Nightly`}
      description={`The best movies on ${entry.name}, ranked by viewer rating.`}
      canonical={canonical(c)}
    >
      <h1>Top {entry.name} movies</h1>
      {rows.length ? (
        <div class="grid">
          {rows.map((m) => (
            <MovieCard movie={m} />
          ))}
        </div>
      ) : (
        <p class="muted">No {entry.name} movies in this region's catalog yet.</p>
      )}
      <p>
        <a class="chev-after" href={`/network/${slug}/shows`}>Top {entry.name} shows</a> ·{" "}
        <a href={`/network/${slug}`}>The best of {entry.name}</a>
      </p>
    </Layout>,
  );
});

// ------------------------------------------------------------ genre pages

async function topGenreShows(db: D1Database, genre: string, limit: number): Promise<ShowRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM shows WHERE genres LIKE ? AND rating IS NOT NULL AND weight >= 60
       ORDER BY rating DESC, weight DESC LIMIT ?`,
    )
    .bind(`%"${genre}"%`, limit)
    .all<ShowRow>();
  return results;
}

async function topGenreMovies(db: D1Database, genre: string, limit: number): Promise<MovieRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM movies WHERE genres LIKE ? AND rating IS NOT NULL AND votes >= 1000
       ORDER BY rating DESC, votes DESC LIMIT ?`,
    )
    .bind(`%"${genre}"%`, limit)
    .all<MovieRow>();
  return results;
}

app.get("/genre/:slug", async (c) => {
  const db = c.env.DB;
  const dir = await genreDirectory(db);
  const slug = c.req.param("slug");
  const tvGenre = dir.tv.find((g) => slugifyName(g) === slug);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === slug);
  if (!tvGenre && !movieGenre) return c.notFound();
  const label = tvGenre ?? movieGenre!;

  const shows = tvGenre ? await topGenreShows(db, tvGenre, 12) : [];
  const movies = movieGenre ? await topGenreMovies(db, movieGenre, 12) : [];

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
          <h2>
            Top {label.toLowerCase()} series{" "}
            <a class="more" href={`/genre/${slug}/shows`}>
              see all
            </a>
          </h2>
          <div class="grid">
            {shows.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {movies.length ? (
        <section>
          <h2>
            Top {label.toLowerCase()} films{" "}
            <a class="more" href={`/genre/${slug}/movies`}>
              see all
            </a>
          </h2>
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

// Per-medium genre top pages — the genre chyrons deep-link by context:
// a show page lands on shows, a movie page on movies.
app.get("/genre/:slug/shows", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const dir = await genreDirectory(db);
  const tvGenre = dir.tv.find((g) => slugifyName(g) === slug);
  if (!tvGenre) return c.notFound();
  const rows = await topGenreShows(db, tvGenre, 48);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${tvGenre.toLowerCase()} shows — ranked | TV Nightly`}
      description={`The best ${tvGenre.toLowerCase()} TV shows, ranked by viewer rating, with streaming availability.`}
      canonical={canonical(c)}
    >
      <h1>Top {tvGenre.toLowerCase()} shows</h1>
      <div class="grid">
        {rows.map((s) => (
          <ShowCard show={s} />
        ))}
      </div>
      <p>
        {dir.movie.some((g) => slugifyName(g) === slug) ? (
          <>
            <a class="chev-after" href={`/genre/${slug}/movies`}>
              Top {tvGenre.toLowerCase()} movies
            </a>{" "}
            ·{" "}
          </>
        ) : null}
        <a href={`/genre/${slug}`}>The best of {tvGenre}</a>
      </p>
    </Layout>,
  );
});

app.get("/genre/:slug/movies", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const dir = await genreDirectory(db);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === slug);
  if (!movieGenre) return c.notFound();
  const rows = await topGenreMovies(db, movieGenre, 48);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${movieGenre.toLowerCase()} movies — ranked | TV Nightly`}
      description={`The best ${movieGenre.toLowerCase()} films, ranked by viewer rating, with streaming availability.`}
      canonical={canonical(c)}
    >
      <h1>Top {movieGenre.toLowerCase()} movies</h1>
      <div class="grid">
        {rows.map((m) => (
          <MovieCard movie={m} />
        ))}
      </div>
      <p>
        {dir.tv.some((g) => slugifyName(g) === slug) ? (
          <>
            <a class="chev-after" href={`/genre/${slug}/shows`}>
              Top {movieGenre.toLowerCase()} shows
            </a>{" "}
            ·{" "}
          </>
        ) : null}
        <a href={`/genre/${slug}`}>The best of {movieGenre}</a>
      </p>
    </Layout>,
  );
});

export default app;
