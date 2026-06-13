import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ClampSummary, ExploreCard } from "../components/cards";
import { VsCard } from "../components/compare";
import { DossierRow } from "../components/dossier";
import { FilterSelect, RateInline } from "../components/forms";
import { IconPlay } from "../components/icons";
import { MovieTabs } from "../components/nav";
import { ProviderLine } from "../components/providers";
import { buildMovieDossier } from "../lib/dossier";
import { MONTHS, heroBg, longDate, movieComparePathFor, premiereDateParts, slugifyName, stripHtml } from "../lib/format";
import { franchiseOfMovie } from "../lib/franchises";
import { PROVIDER_LOGOS, REGIONS, providerBrand, providersFor, visitorRegion } from "../lib/providers";
import { crewLinkMap, similarMovies } from "../lib/queries";
import { titleStat } from "../lib/ratings";
import { canonical, origin } from "../lib/seo";
import { tmdbMovieBackdrop, tmdbMovieCast, tmdbMovieCrew, tmdbMovieMedia, tmdbUpcomingBackdrop } from "../lib/tmdb";
import { hubForGenres } from "../lib/verticals";
import { Bindings, MovieRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

const fmtVotes = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

const movieProvLinks = (m: MovieRow, region: string) => {
  const links: { href: string; label: string }[] = [];
  const provs = [...new Set(providersFor(m, region).names.map(providerBrand))];
  for (const p of provs.slice(0, 2)) {
    links.push({ href: `/network/${slugifyName(p)}/movies`, label: p });
  }
  const genres: string[] = m.genres ? JSON.parse(m.genres) : [];
  for (const g of genres.slice(0, 2)) {
    if (links.length >= 3) break;
    links.push({ href: `/genre/${slugifyName(g)}/movies`, label: g });
  }
  return links;
};

app.get("/movies/upcoming", async (c) => {
  type UpcomingRow = {
    tmdb_id: number;
    title: string;
    release_date: string;
    poster_url: string | null;
    overview: string | null;
    slug: string | null;
    imdb_id: string | null;
  };
  const { results } = await c.env.DB.prepare(
    `SELECT u.tmdb_id, u.title, u.release_date, u.poster_url, u.overview,
            m.slug, m.imdb_id
     FROM upcoming_movies u
     LEFT JOIN movies m ON m.tmdb_id = u.tmdb_id
     WHERE u.release_date >= date('now')
     ORDER BY u.release_date LIMIT 40`,
  ).all<UpcomingRow>();

  const daysUntil = (iso: string) => {
    const d = Math.ceil((new Date(`${iso}T12:00:00`).getTime() - Date.now()) / 86400000);
    if (d < 0) return null;
    if (d === 0) return "Opens today";
    if (d === 1) return "Tomorrow";
    return `In ${d} days`;
  };
  const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

  // the page opens on the nearest wide release — promoted out of the board
  const head = results[0] ?? null;
  const tail = head ? results.slice(1) : results;
  const soonCutoff = new Date();
  soonCutoff.setUTCDate(soonCutoff.getUTCDate() + 21);
  const soonCut = soonCutoff.toISOString().slice(0, 10);
  const openingSoon = tail.filter((m) => m.release_date <= soonCut);
  const later = tail.filter((m) => m.release_date > soonCut);

  const byMonth = new Map<string, UpcomingRow[]>();
  for (const m of later) {
    const month = m.release_date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(m);
  }

  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (head && c.env.TMDB_API_KEY) {
    art =
      (head.imdb_id ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, head.imdb_id) : null) ??
      (await tmdbUpcomingBackdrop(c.env.TMDB_API_KEY, head.tmdb_id));
  }
  if (!art && head?.poster_url) {
    art = { x1: head.poster_url };
    ambient = true;
  }

  const span =
    results.length > 1
      ? `${MONTHS[Number(results[0].release_date.slice(5, 7)) - 1].slice(0, 3)} – ${MONTHS[Number(results[results.length - 1].release_date.slice(5, 7)) - 1]} ${results[results.length - 1].release_date.slice(0, 4)}`
      : head
        ? longDate(head.release_date)
        : null;

  const Row = ({ m }: { m: UpcomingRow }) => {
    const { day, month } = premiereDateParts(m.release_date);
    const countdown = daysUntil(m.release_date);
    const body = (
      <>
        <span class="sched-rail">{month ? `${month} ${day}` : "TBA"}</span>
        {m.poster_url ? (
          <img src={m.poster_url} alt="" width="46" height="69" loading="lazy" decoding="async" />
        ) : (
          <span class="sched-thumb-blank" aria-hidden="true"></span>
        )}
        <span class="sched-main">
          <span class="sched-show">{m.title}</span>
          <span class="sched-ep">{longDate(m.release_date)}</span>
          {m.overview ? <span class="sched-blurb">{stripHtml(m.overview)}</span> : null}
        </span>
        {countdown ? <span class="upcoming-chip">{countdown}</span> : null}
      </>
    );
    return (
      <li>
        {m.slug ? (
          <a class="sched-row" href={`/movie/${m.slug}`}>
            {body}
          </a>
        ) : (
          <div class="sched-row sched-row-static">{body}</div>
        )}
      </li>
    );
  };

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Upcoming movies — theatrical release dates | TV Nightly"
      description="Every major movie heading to theaters soon, in release order — with dates, posters, and what to watch while you wait."
      canonical={canonical(c)}
    >
      <header class={`wo-hero${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Release radar</p>
          <h1>Upcoming movies</h1>
          <p class="wo-intro">
            The theatrical calendar, distilled — every wide release we are tracking from TMDB's
            upcoming feed, in date order. Bookmark it before the trailers pile up.
          </p>
          {results.length ? (
            <dl class="wo-stats">
              <div>
                <dt>On the board</dt>
                <dd>{results.length}</dd>
              </div>
              {span ? (
                <div>
                  <dt>Window</dt>
                  <dd>{span}</dd>
                </div>
              ) : null}
              {head ? (
                <div>
                  <dt>Next up</dt>
                  <dd>{daysUntil(head.release_date) ?? longDate(head.release_date)}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {head ? (
            <div class="upcoming-spotlight">
              <p class="sched-kicker">
                Next wide release · {daysUntil(head.release_date) ?? longDate(head.release_date)}
              </p>
              <h2 class="upcoming-spotlight-title">
                {head.slug ? <a href={`/movie/${head.slug}`}>{head.title}</a> : head.title}
              </h2>
              <p class="sched-hero-ep">
                <strong>{longDate(head.release_date)}</strong>
                {head.slug ? <span class="muted"> · already in our catalog</span> : null}
              </p>
              {head.overview ? <p class="sched-dek">{stripHtml(head.overview)}</p> : null}
            </div>
          ) : null}
          <p class="hub-actions">
            <a class="verdict-btn" href="/what-to-watch?type=movie">
              Pick me a movie tonight
            </a>
            <a class="btn-ghost" href="/movies/best">
              Best movies, ranked
            </a>
          </p>
        </div>
      </header>

      {results.length === 0 ? (
        <p class="muted">No upcoming snapshot loaded yet — the movie seed refreshes this chart.</p>
      ) : null}

      {openingSoon.length ? (
        <section class="upcoming-shelf">
          <h2>
            Opening soon{" "}
            <span class="sched-count">
              {openingSoon.length} premiere{openingSoon.length === 1 ? "" : "s"}
            </span>
          </h2>
          <p class="muted upcoming-lead">The next three weeks on the theatrical calendar.</p>
          <ul class="poster-shelf">
            {openingSoon.map((m) => {
              const { day, month } = premiereDateParts(m.release_date);
              const href = m.slug ? `/movie/${m.slug}` : null;
              const tile = (
                <>
                  {m.poster_url ? (
                    <img src={m.poster_url} alt="" width="92" height="138" loading="lazy" decoding="async" />
                  ) : (
                    <span class="shelf-fallback">{m.title}</span>
                  )}
                  <span class="shelf-chip shelf-chip-date">
                    {daysUntil(m.release_date) === "Tomorrow" || daysUntil(m.release_date) === "Opens today" ? (
                      <span class="chip-soon">{daysUntil(m.release_date)}</span>
                    ) : null}
                    {month ? `${month} ${day}` : "Soon"}
                  </span>
                </>
              );
              return (
                <li>
                  {href ? (
                    <a class="shelf-tile" href={href} title={`${m.title} · ${longDate(m.release_date)}`}>
                      {tile}
                    </a>
                  ) : (
                    <span class="shelf-tile shelf-tile-static" title={m.title}>
                      {tile}
                    </span>
                  )}
                  <span class="shelf-name">{m.title}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {[...byMonth.entries()].map(([month, rows]) => (
        <section class="sched-day">
          <h2>
            {monthLabel(month)}{" "}
            <span class="sched-count">
              {rows.length} film{rows.length === 1 ? "" : "s"}
            </span>
          </h2>
          <ol class="sched-list">
            {rows.map((m) => (
              <Row m={m} />
            ))}
          </ol>
        </section>
      ))}

      <p class="wire-foot muted">
        Dates come from TMDB's theatrical feed and can move — we refresh the snapshot when the movie
        catalog syncs. Already in theaters?{" "}
        <a class="chev-after" href="/what-to-watch?type=movie">
          Spin the movie picker
        </a>
      </p>

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="The chart"
            title="The best films of all time"
            desc="Every movie ranked by rating, with where to stream."
            href="/movies/best"
          />
          <ExploreCard
            icon="Tonight"
            title="Upcoming TV premieres"
            desc="Season premieres in the next ninety days — the small-screen calendar."
            href="/premieres"
          />
          <ExploreCard
            icon="Guides"
            title="Watch every saga in order"
            desc="Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked."
            href="/watch-orders"
          />
          <ExploreCard
            icon="Tailored"
            title="Rate one thing, get a pick"
            desc="The recommender finds your next watch from one rating."
            href="/recommend"
          />
        </div>
      </section>
    </Layout>,
  );
});

// ------------------------------------------------------------- compare

app.get("/movies", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM movies ORDER BY popularity DESC LIMIT 48",
  ).all<MovieRow>();
  const region = visitorRegion(c);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Popular movies — ratings, runtimes & picks | TV Nightly"
      description="The most popular movies with ratings, runtimes and genres — plus ranked best-of lists and a what-to-watch picker."
      canonical={canonical(c)}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Popular movies",
          itemListElement: results.slice(0, 24).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: m.title,
            url: `${origin(c)}/movie/${m.slug}`,
          })),
        },
      ]}
    >
      <article class="chart-page">
        <header class="chart-head">
          <p class="section-eyebrow">The catalog</p>
          <h1 class="chart-h1">Popular movies</h1>
          <p class="section-lead">
            What people are looking at right now — every title here has ratings, runtimes, genres,
            and where to stream it.
          </p>
          {results.length ? (
            <p class="chart-statline">
              <span class="chart-statline-main">
                <strong>{results.length}</strong> films
              </span>
              <span class="chart-statline-links">
                <a class="chev-after" href="/movies/best">
                  Best movies, ranked
                </a>
                <a class="chev-after" href="/what-to-watch?type=movie">
                  Pick one for me
                </a>
                <a class="chev-after" href="/movies/upcoming">
                  Upcoming
                </a>
              </span>
            </p>
          ) : null}
        </header>

        {!results.length ? (
          <p class="muted">No movies loaded yet — the catalog is on its way.</p>
        ) : (
          <ol class="wo-list">
            {results.map((m, i) => {
              const provLinks = movieProvLinks(m, region);
              return (
                <li class="wo-row">
                  <span class="wo-num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {m.poster_url ? (
                    <img
                      class="wo-poster"
                      src={m.poster_url}
                      alt=""
                      width="46"
                      height="69"
                      loading={i < 8 ? "eager" : "lazy"}
                      decoding="async"
                    />
                  ) : (
                    <span class="wo-poster wo-poster-blank" aria-hidden="true"></span>
                  )}
                  <span class="wo-main">
                    <span class="wo-title">
                      <a href={`/movie/${m.slug}`}>{m.title}</a>
                      {m.year ? <span class="muted"> ({m.year})</span> : null}
                    </span>
                    {provLinks.length ? (
                      <span class="wo-provs">
                        {provLinks.map((l, j) => (
                          <>
                            {j > 0 ? " · " : null}
                            <a href={l.href}>{l.label}</a>
                          </>
                        ))}
                      </span>
                    ) : null}
                  </span>
                  <span class="wo-side">
                    {m.rating != null ? (
                      <span class="rating">★ {m.rating.toFixed(1)}</span>
                    ) : null}
                    {m.runtime ? (
                      <span class="wo-mins">{m.runtime} min</span>
                    ) : m.votes ? (
                      <span class="wo-mins">{fmtVotes(m.votes)} votes</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <section class="wo-doors">
          <h2>Keep exploring</h2>
          <div class="explore-grid">
            <ExploreCard
              icon="Charts"
              title="Best movies, ranked"
              desc="The highest-rated films we track — a thousand votes minimum, no flukes."
              href="/movies/best"
            />
            <ExploreCard
              icon="Guides"
              title="Watch every saga in order"
              desc="Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked."
              href="/watch-orders"
            />
            <ExploreCard
              icon="Compare"
              title="Compare two movies"
              desc="Ratings, runtimes, and streaming — head-to-head on one page."
              href="/movies/compare"
            />
            <ExploreCard
              icon="Community"
              title="Loved by this community"
              desc="The chart built from real one-tap reader verdicts."
              href="/loved"
            />
          </div>
        </section>
      </article>
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
  const region = visitorRegion(c);

  // the chart opens on its own #1 — the reigning film's real backdrop
  const top = results[0] ?? null;
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (top && c.env.TMDB_API_KEY) {
    art = await tmdbMovieBackdrop(c.env.TMDB_API_KEY, top.imdb_id);
  }
  if (!art && top?.poster_url) {
    art = { x1: top.poster_url };
    ambient = true;
  }

  const years = results.map((m) => m.year).filter((y): y is number => y != null);
  const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : null;

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
      scripts={["/js/dropdown.js"]}
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
      <header class={`wo-hero${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">The chart</p>
          <h1>{heading}</h1>
          <p class="wo-intro">
            Ranked by viewer rating alone — every film here cleared a thousand votes, so nothing
            on the board is a fluke. Cut it by genre, or let the picker choose for you.
          </p>
          {results.length ? (
            <dl class="wo-stats">
              <div>
                <dt>Films</dt>
                <dd>{results.length}</dd>
              </div>
              <div>
                <dt>Top rating</dt>
                <dd>★ {results[0].rating!.toFixed(1)}</dd>
              </div>
              {span ? (
                <div>
                  <dt>Years</dt>
                  <dd>{span}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <p class="hub-actions">
            <a class="verdict-btn" href="/what-to-watch?type=movie">
              Pick me a movie
            </a>
            <a class="btn-ghost" href="/movies/upcoming">
              What's coming next
            </a>
          </p>
        </div>
      </header>
      {/* data-submit-on-change: dropdown.js submits on pick (no Go button) */}
      <form method="get" action="/movies/best" class="region-line watch-region" data-submit-on-change>
        <FilterSelect
          label="Genre"
          name="genre"
          current={genre}
          options={[
            { value: "", text: "All genres" },
            ...genreRows.map((r) => ({ value: r.g, text: r.g })),
          ]}
        />
      </form>
      {results.length === 0 ? <p class="muted">No rated movies for that filter yet.</p> : null}
      <ol class="wo-list">
        {results.map((m, i) => {
          const provs = [...new Set(providersFor(m, region).names.map(providerBrand))];
          const gs: string[] = m.genres ? JSON.parse(m.genres) : [];
          return (
            <li class="wo-row">
              <span class="wo-num" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              {m.poster_url ? (
                <img class="wo-poster" src={m.poster_url} alt="" width="46" height="69" loading="lazy" decoding="async" />
              ) : (
                <span class="wo-poster wo-poster-blank" aria-hidden="true"></span>
              )}
              <span class="wo-main">
                <span class="wo-title">
                  <a href={`/movie/${m.slug}`}>{m.title}</a>{" "}
                  {m.year ? <span class="muted">({m.year})</span> : null}
                </span>
                <span class="wo-provs">
                  {(provs.length ? provs.slice(0, 3) : gs.slice(0, 2)).join(" · ")}
                </span>
              </span>
              <span class="wo-side">
                <span class="rating">★ {m.rating!.toFixed(1)}</span>
                {m.votes ? <span class="wo-mins">{fmtVotes(m.votes)} votes</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <section class="hub-sec">
        <h2>Cut the chart by genre</h2>
        <div class="footer-picks">
          {genreRows
            .filter((r) => r.g !== genre)
            .map((r) => (
              <a class="footer-card" href={`/movies/best?genre=${encodeURIComponent(r.g)}`}>
                {r.g}
              </a>
            ))}
          {genre ? (
            <a class="footer-card" href="/movies/best">
              All genres
            </a>
          ) : null}
        </div>
      </section>
      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Guides"
            title="Watch every saga in order"
            desc="Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked."
            href="/watch-orders"
          />
          <ExploreCard
            icon="The canon"
            title="The classic films page"
            desc="The best of cinema's first eighty years, ranked and streamable."
            href="/classics"
          />
          <ExploreCard
            icon="Community"
            title="Loved by this community"
            desc="The chart built from real one-tap reader verdicts."
            href="/loved"
          />
        </div>
      </section>
    </Layout>,
  );
});

app.get("/movie/:slug", async (c) => {
  const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<MovieRow>();
  if (!movie) return c.notFound();
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const region = visitorRegion(c);
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

  // the movie's real designed backdrop + billed cast (TMDB takes the IMDb id
  // directly; both ride one edge-cached bundle). Blurred poster = fallback.
  const [backdrop, cast] = c.env.TMDB_API_KEY
    ? await Promise.all([
        tmdbMovieBackdrop(c.env.TMDB_API_KEY, movie.imdb_id),
        tmdbMovieCast(c.env.TMDB_API_KEY, movie.imdb_id, 8),
      ])
    : [null, []];
  const heroFrame = backdrop ? heroBg(backdrop.x1, backdrop.x2) : null;
  // the rivals' backdrops for the head-to-head split cards (edge-cached)
  const rivalBackdrops = c.env.TMDB_API_KEY
    ? await Promise.all(
        simMovies.slice(0, 3).map((m) => tmdbMovieBackdrop(c.env.TMDB_API_KEY!, m.imdb_id)),
      )
    : [];
  // link the actors we already track (scoped to this movie's enriched credits)
  const linkable = new Map<string, number>();
  if (cast.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name FROM movie_credits mc JOIN people p ON p.id = mc.person_id
       WHERE mc.movie_id = ?`,
    )
      .bind(movie.imdb_id)
      .all<{ id: number; name: string }>();
    for (const r of results) linkable.set(r.name.toLowerCase(), r.id);
  }

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
        <header class={heroFrame ? "detail-hero frame-hero" : "detail-hero"}>
          {heroFrame ? (
            <div class="hero-backdrop" style={heroFrame}></div>
          ) : movie.poster_url ? (
            <div class="hero-backdrop" style={`background-image:url('${movie.poster_url}')`}></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side">
              {movie.poster_url ? (
                <img class="poster" src={movie.poster_url} srcset={`${movie.poster_url} 1x, ${movie.poster_url.replace("/w342/", "/w780/")} 2x`} alt={movie.title} />
              ) : (
                <div class="poster card-fallback">{movie.title}</div>
              )}
              <RateInline kind="movie" refId={movie.imdb_id} stat={stat} />
            </div>
            <div class="detail-info">
              <h1>{movie.title}</h1>
              <p class="meta-strip">
                <span>
                  <a href="/movies/best" title="The best movies, ranked">Movie</a>
                </span>
                {movie.year ? (
                  <>
                    <span class="sep">·</span>
                    <span>{movie.year}</span>
                  </>
                ) : null}
                {genres.length ? (
                  <>
                    <span class="sep">·</span>
                    <span>
                      {genres.slice(0, 3).map((g, i) => (
                        <>
                          {i > 0 ? ", " : ""}
                          <a href={`/genre/${slugifyName(g)}/movies`}>{g}</a>
                        </>
                      ))}
                    </span>
                  </>
                ) : null}
                {movie.runtime ? (
                  <>
                    <span class="sep">·</span>
                    <span>{movie.runtime} min</span>
                  </>
                ) : null}
                {movie.rating != null ? (
                  <>
                    <span class="sep">·</span>
                    <span class="rating">★ {movie.rating.toFixed(1)}</span>
                    {movie.votes ? <span> ({movie.votes.toLocaleString()})</span> : null}
                  </>
                ) : null}
              </p>
              <ProviderLine
                row={movie}
                region={region}
                fallbackHref="/what-to-watch?type=movie"
                pickerType="movie"
                allHref={`/movie/${movie.slug}/where-to-watch`}
              />
              {movie.overview ? (
                movie.overview.length > 280 ? (
                  <ClampSummary id="synopsis-clamp">{movie.overview}</ClampSummary>
                ) : (
                  <div class="summary">{movie.overview}</div>
                )
              ) : null}
            </div>
          </div>
        </header>
        <MovieTabs slug={movie.slug} current="overview" />
        {cast.length ? (
          <section id="cast">
            <h2>
              Cast
              <a class="more" href={`/movie/${movie.slug}/cast`}>
                full cast & details
              </a>
            </h2>
            <div class="cast-row">
              {cast.map((p) => {
                const id = linkable.get(p.name.toLowerCase());
                const inner = (
                  <>
                    {p.profile_path ? (
                      <img
                        src={`https://image.tmdb.org/t/p/w342${p.profile_path}`}
                        alt={p.name}
                        loading="lazy"
                      />
                    ) : (
                      <div class="cast-fallback">{p.name}</div>
                    )}
                    <span class="cast-name">{p.name}</span>
                    {p.character ? <span class="cast-char muted">{p.character}</span> : null}
                  </>
                );
                return id ? (
                  <a class="cast-card" href={`/person/${slugifyName(p.name)}-${id}`}>
                    {inner}
                  </a>
                ) : (
                  <div class="cast-card">{inner}</div>
                );
              })}
            </div>
          </section>
        ) : null}
        {simMovies.length ? (
          <section id="similar">
            <h2>
              Movies like {movie.title}{" "}
              <a class="more" href={`/movie/${movie.slug}/similar`}>
                all similar movies
              </a>
            </h2>
            <p class="dossier-method">
              The closest matches on shared genres, ranked by match strength and rating.
            </p>
            <ol class="dossier-board">
              {simMovies.map((m, i) => (
                <DossierRow
                  i={i}
                  href={`/movie/${m.slug}`}
                  name={m.title}
                  d={buildMovieDossier(movie, m, region)}
                  rating={m.rating}
                  poster={
                    m.poster_url
                      ? {
                          src: m.poster_url,
                          srcset: `${m.poster_url} 1x, ${m.poster_url.replace("/w342/", "/w780/")} 2x`,
                        }
                      : null
                  }
                />
              ))}
            </ol>
          </section>
        ) : null}
        {simMovies.length ? (
          <section id="head-to-head">
            <h2>
              Head-to-head{" "}
              <a class="more" href={`/movie/${movie.slug}/compare`}>
                all matchups
              </a>
            </h2>
            <p class="dossier-method">
              {movie.title} against its closest rivals — ratings, votes, runtime and where to
              stream, side by side.
            </p>
            <div class="vs-grid">
              {simMovies.slice(0, 3).map((m, i) => {
                const small = (u: string) => u.replace("/w1280/", "/w780/");
                return (
                  <VsCard
                    href={movieComparePathFor(movie.slug, m.slug)}
                    a={{
                      name: movie.title,
                      poster: movie.poster_url,
                      backdrop: backdrop ? small(backdrop.x1) : null,
                    }}
                    b={{
                      name: m.title,
                      poster: m.poster_url,
                      backdrop: rivalBackdrops[i] ? small(rivalBackdrops[i]!.x1) : null,
                    }}
                    cta="Side by side"
                  />
                );
              })}
            </div>
          </section>
        ) : null}
        {(() => {
          const fr = franchiseOfMovie(movie);
          const hub = hubForGenres(genres, movie.year);
          const prov0 = providersFor(movie, region).names[0];
          return (
            <section>
              <h2>
                Keep exploring{" "}
                <a class="more" href="/movies/best">
                  top movies
                </a>
              </h2>
              <div class="explore-grid">
                {fr ? (
                  <ExploreCard
                    icon="Guides"
                    title={`${fr.name} watch order`}
                    desc="Every film in the franchise, release and chronological order."
                    href={`/watch-order/${fr.slug}`}
                  />
                ) : null}
                <ExploreCard
                  icon="Matchup"
                  title="Compare with another movie"
                  desc="Two films' ratings, runtimes and streaming, side by side."
                  href={`/movie/${movie.slug}/compare`}
                />
                {genres.slice(0, 2).map((g) => (
                  <ExploreCard
                    icon="Genre"
                    title={`Best ${g.toLowerCase()} films & shows`}
                    desc={`The top of the ${g.toLowerCase()} pile, across both mediums.`}
                    href={`/genre/${slugifyName(g)}`}
                  />
                ))}
                {prov0 ? (
                  <ExploreCard
                    icon="Picker"
                    title={`Spin a ${prov0} movie`}
                    desc="Random great pick from the same service you already pay for."
                    href={`/what-to-watch?type=movie&service=${encodeURIComponent(prov0)}`}
                  />
                ) : null}
                {hub ? (
                  <ExploreCard
                    icon="Fandom hub"
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

// "Movies like X" gets the full dossier on its own page, same as shows.
app.get("/movie/:slug/similar", async (c) => {
  const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<MovieRow>();
  if (!movie) return c.notFound();
  const simMovies = await similarMovies(c.env.DB, movie, 18);
  if (!simMovies.length) return c.redirect(`/movie/${movie.slug}`, 302);
  const region = visitorRegion(c);
  const site = origin(c);
  const base = `/movie/${movie.slug}/similar`;
  const backdrop = c.env.TMDB_API_KEY
    ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, movie.imdb_id)
    : null;
  const heroFrame = backdrop ? heroBg(backdrop.x1, backdrop.x2) : null;

  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
        { "@type": "ListItem", position: 2, name: movie.title, item: `${site}/movie/${movie.slug}` },
        { "@type": "ListItem", position: 3, name: "Similar movies", item: `${site}${base}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Movies like ${movie.title}`,
      itemListElement: simMovies.map((m, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${site}/movie/${m.slug}`,
        name: m.title,
      })),
    },
  ];
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Movies like ${movie.title} — ${simMovies.length} similar movies ranked | TV Nightly`}
      description={`The ${simMovies.length} closest matches to ${movie.title}: ${simMovies
        .slice(0, 4)
        .map((m) => m.title)
        .join(", ")} and more, ranked by match strength with ratings and where to stream.`}
      canonical={`${site}${base}`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={ld}
    >
      <article class="show-hub">
        <header class={heroFrame ? "detail-hero frame-hero" : "detail-hero"}>
          {heroFrame ? (
            <div class="hero-backdrop" style={heroFrame}></div>
          ) : movie.poster_url ? (
            <div class="hero-backdrop" style={`background-image:url('${movie.poster_url}')`}></div>
          ) : null}
          <div class="detail-head">
            {movie.poster_url ? (
              <img
                class="poster"
                src={movie.poster_url}
                srcset={`${movie.poster_url} 1x, ${movie.poster_url.replace("/w342/", "/w780/")} 2x`}
                alt={movie.title}
              />
            ) : (
              <div class="poster card-fallback">{movie.title}</div>
            )}
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/movie/${movie.slug}`}>{movie.title}</a>
                <span class="sep">·</span> More like this
              </p>
              <h1>Movies like {movie.title}</h1>
              <p class="summary">
                The {simMovies.length} closest matches on shared genres, ranked by match strength
                and rating — with where each is streaming in your region.
              </p>
            </div>
          </div>
        </header>
        <MovieTabs slug={movie.slug} current="similar" />
        <section>
          <h2>The closest matches</h2>
          <ol class="dossier-board">
            {simMovies.map((m, i) => (
              <DossierRow
                i={i}
                href={`/movie/${m.slug}`}
                name={m.title}
                d={buildMovieDossier(movie, m, region)}
                rating={m.rating}
                poster={
                  m.poster_url
                    ? {
                        src: m.poster_url,
                        srcset: `${m.poster_url} 1x, ${m.poster_url.replace("/w342/", "/w780/")} 2x`,
                      }
                    : null
                }
              />
            ))}
          </ol>
        </section>
        <section>
          <h2>Keep going</h2>
          <div class="footer-picks">
            <a class="footer-card" href={`/movie/${movie.slug}`}>
              {movie.title} overview
            </a>
            <a class="footer-card" href="/movies/best">
              Best movies
            </a>
            <a class="footer-card" href="/what-to-watch?type=movie">
              What should I watch tonight?
            </a>
          </div>
        </section>
      </article>
    </Layout>,
  );
});

// Media: the movie's artwork and YouTube trailers, one edge-cached call.
app.get("/movie/:slug/media", async (c) => {
  const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<MovieRow>();
  if (!movie) return c.notFound();
  const media = c.env.TMDB_API_KEY
    ? await tmdbMovieMedia(c.env.TMDB_API_KEY, movie.imdb_id)
    : null;
  const base = `/movie/${movie.slug}/media`;
  const site = origin(c);

  const trailer = media?.videos.find((v) => v.type === "Trailer") ?? media?.videos[0] ?? null;
  const clips = (media?.videos ?? []).filter((v) => v !== trailer).slice(0, 9);
  const backdrops = (media?.backdrops ?? []).slice(0, 12);
  const posters = (media?.posters ?? []).slice(0, 12);
  const hasAny = Boolean(trailer || clips.length || backdrops.length || posters.length);

  const heroArt = backdrops.length
    ? heroBg(
        `https://image.tmdb.org/t/p/w1280${backdrops[0]}`,
        `https://image.tmdb.org/t/p/original${backdrops[0]}`,
      )
    : null;

  const ld: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
        { "@type": "ListItem", position: 2, name: movie.title, item: `${site}/movie/${movie.slug}` },
        { "@type": "ListItem", position: 3, name: "Media", item: `${site}${base}` },
      ],
    },
  ];
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
      title={`${movie.title} — trailer, posters & artwork | TV Nightly`}
      description={`Every trailer, clip, poster and backdrop for ${movie.title} in one place.`}
      canonical={`${site}${base}`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={ld}
      scripts={["/js/media-lightbox.js"]}
    >
      <article class="show-hub">
        <header class={heroArt ? "detail-hero frame-hero" : "detail-hero"}>
          {heroArt ? (
            <div class="hero-backdrop" style={heroArt}></div>
          ) : movie.poster_url ? (
            <div class="hero-backdrop" style={`background-image:url('${movie.poster_url}')`}></div>
          ) : null}
          <div class="detail-head">
            {movie.poster_url ? (
              <img
                class="poster"
                src={movie.poster_url}
                srcset={`${movie.poster_url} 1x, ${movie.poster_url.replace("/w342/", "/w780/")} 2x`}
                alt={movie.title}
              />
            ) : (
              <div class="poster card-fallback">{movie.title}</div>
            )}
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/movie/${movie.slug}`}>{movie.title}</a>
                <span class="sep">·</span> Media
              </p>
              <h1>{movie.title} — trailer & artwork</h1>
              <p class="summary">
                {hasAny
                  ? `The official trailers, clips, posters and backdrops for ${movie.title}.`
                  : `No media available for ${movie.title} yet.`}
              </p>
            </div>
          </div>
        </header>
        <MovieTabs slug={movie.slug} current="media" />
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
            <div class="media-backdrops" data-gallery-title={movie.title} data-gallery-kind="Backdrop">
              {backdrops.map((p, i) => (
                <a
                  class="media-art"
                  href={`https://image.tmdb.org/t/p/original${p}`}
                  target="_blank"
                  rel="noopener"
                  data-gallery="backdrops"
                  data-view={`https://image.tmdb.org/t/p/w1280${p}`}
                  data-alt={`${movie.title} backdrop ${i + 1} of ${backdrops.length}`}
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
            <div class="media-posters" data-gallery-title={movie.title} data-gallery-kind="Poster">
              {posters.map((p, i) => (
                <a
                  class="media-art"
                  href={`https://image.tmdb.org/t/p/original${p}`}
                  target="_blank"
                  rel="noopener"
                  data-gallery="posters"
                  data-view={`https://image.tmdb.org/t/p/w780${p}`}
                  data-alt={`${movie.title} poster ${i + 1} of ${posters.length}`}
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
          <div class="footer-picks">
            <a class="footer-card" href={`/movie/${movie.slug}`}>
              {movie.title} overview
            </a>
            <a class="footer-card" href={`/movie/${movie.slug}/similar`}>
              Movies like {movie.title}
            </a>
            <a class="footer-card" href="/movies/best">
              Best movies
            </a>
          </div>
        </section>
      </article>
    </Layout>,
  );
});

// Full billed cast, linked into our person pages where we track the actor.
app.get("/movie/:slug/cast", async (c) => {
  const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<MovieRow>();
  if (!movie) return c.notFound();
  const [cast, crew] = c.env.TMDB_API_KEY
    ? await Promise.all([
        tmdbMovieCast(c.env.TMDB_API_KEY, movie.imdb_id, 24),
        tmdbMovieCrew(c.env.TMDB_API_KEY, movie.imdb_id, 12),
      ])
    : [[], []];
  const linkable = new Map<string, number>();
  if (cast.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name FROM movie_credits mc JOIN people p ON p.id = mc.person_id
       WHERE mc.movie_id = ?`,
    )
      .bind(movie.imdb_id)
      .all<{ id: number; name: string }>();
    for (const r of results) linkable.set(r.name.toLowerCase(), r.id);
  }
  const crewLinks = await crewLinkMap(c.env.DB, crew);
  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${movie.title} cast — who's in it | TV Nightly`}
      description={
        cast.length
          ? `The cast of ${movie.title}: ${cast
              .slice(0, 5)
              .map((p) => p.name)
              .join(", ")} — with roles.`
          : `The cast of ${movie.title}.`
      }
      canonical={`${site}/movie/${movie.slug}/cast`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
    >
      <h1>
        Cast of <a href={`/movie/${movie.slug}`}>{movie.title}</a>
      </h1>
      <MovieTabs slug={movie.slug} current="cast" />
      {cast.length ? (
        <>
          <p class="muted">{cast.length} credited, in billing order.</p>
          <div class="cast-grid">
            {cast.map((p) => {
              const id = linkable.get(p.name.toLowerCase());
              const img = p.profile_path
                ? `https://image.tmdb.org/t/p/w342${p.profile_path}`
                : null;
              const inner = (
                <>
                  {img ? (
                    <img
                      src={img}
                      srcset={`${img} 1x, https://image.tmdb.org/t/p/w500${p.profile_path} 2x`}
                      alt={p.name}
                      loading="lazy"
                    />
                  ) : (
                    <div class="cast-fallback">{p.name}</div>
                  )}
                  <div class="cast-tile-body">
                    <strong>{p.name}</strong>
                    {p.character ? <span class="cast-char">as {p.character}</span> : null}
                  </div>
                </>
              );
              return id ? (
                <a class="cast-tile" href={`/person/${slugifyName(p.name)}-${id}`}>
                  {inner}
                </a>
              ) : (
                <div class="cast-tile">{inner}</div>
              );
            })}
          </div>
        </>
      ) : (
        <p class="muted">Cast data isn't available for this film yet.</p>
      )}
      {crew.length ? (
        <section>
          <h2>Crew</h2>
          <div class="guest-list">
            {crew.map((p) => {
              const img = p.profile_path
                ? `https://image.tmdb.org/t/p/w185${p.profile_path}`
                : null;
              const pid = crewLinks.get(p.id);
              const inner = (
                <>
                  {img ? (
                    <img src={img} alt={p.name} loading="lazy" />
                  ) : (
                    <span class="guest-fallback" aria-hidden="true">
                      {p.name.slice(0, 1)}
                    </span>
                  )}
                  <span class="guest-who">
                    <span class="guest-name">{p.name}</span>
                    <span class="guest-char muted">{p.jobs}</span>
                  </span>
                </>
              );
              return pid != null ? (
                <a class="guest-row" href={`/person/${slugifyName(p.name)}-${pid}`}>
                  {inner}
                </a>
              ) : (
                <div class="guest-row">{inner}</div>
              );
            })}
          </div>
        </section>
      ) : null}
    </Layout>,
  );
});

// Where to watch, region by region — the movie counterpart of the show page.
app.get("/movie/:slug/where-to-watch", async (c) => {
  const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<MovieRow>();
  if (!movie) return c.notFound();
  const base = `/movie/${movie.slug}/where-to-watch`;
  const reqRegion = (c.req.query("region") ?? "").trim().toUpperCase();
  if (reqRegion && !REGIONS.includes(reqRegion)) return c.redirect(base, 301);
  const region = reqRegion || visitorRegion(c);
  const intl: Record<string, string[]> = movie.providers_intl
    ? JSON.parse(movie.providers_intl)
    : {};
  const names = intl[region] ?? [];
  const elsewhere = REGIONS.filter((r) => r !== region && intl[r]?.length);

  const backdrop = c.env.TMDB_API_KEY
    ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, movie.imdb_id)
    : null;
  const heroFrame = backdrop ? heroBg(backdrop.x1, backdrop.x2) : null;
  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Where to watch ${movie.title} — streaming options | TV Nightly`}
      description={
        names.length
          ? `${movie.title} is streaming on ${names.slice(0, 4).join(", ")} in ${region}. Every service and region.`
          : `Where ${movie.title} is streaming, region by region.`
      }
      canonical={`${site}${base}`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      scripts={["/js/dropdown.js"]}
    >
      <article class="show-hub">
        <header class={heroFrame ? "detail-hero frame-hero" : "detail-hero"}>
          {heroFrame ? (
            <div class="hero-backdrop" style={heroFrame}></div>
          ) : movie.poster_url ? (
            <div class="hero-backdrop" style={`background-image:url('${movie.poster_url}')`}></div>
          ) : null}
          <div class="detail-head">
            {movie.poster_url ? (
              <img
                class="poster"
                src={movie.poster_url}
                srcset={`${movie.poster_url} 1x, ${movie.poster_url.replace("/w342/", "/w780/")} 2x`}
                alt={movie.title}
              />
            ) : (
              <div class="poster card-fallback">{movie.title}</div>
            )}
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/movie/${movie.slug}`}>{movie.title}</a>
                <span class="sep">·</span> Streaming guide
              </p>
              <h1>Where to watch {movie.title}</h1>
              <p class="summary">{stripHtml(movie.overview ?? "").slice(0, 180)}</p>
              {/* data-submit-on-change: dropdown.js submits on pick (no Go button) */}
              <form method="get" action={base} class="region-line watch-region" data-submit-on-change>
                <FilterSelect
                  label="Showing options for"
                  name="region"
                  current={region}
                  options={REGIONS.map((r) => ({ value: r, text: r }))}
                />
              </form>
            </div>
          </div>
        </header>
        <MovieTabs slug={movie.slug} current="watch" />
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
                    href={`/network/${slugifyName(providerBrand(n))}/movies`}
                  >
                    More on {providerBrand(n)}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p class="muted">
                Not on a subscription service in {region} right now.
                {!elsewhere.length ? (
                  <>
                    {" "}
                    <a class="chev-after" href="/what-to-watch?type=movie">
                      Find one that is streaming
                    </a>
                  </>
                ) : null}
              </p>
              {elsewhere.length ? (
                <>
                  <p class="watch-elsewhere-eyebrow muted">Also streaming in</p>
                  <div class="footer-picks watch-region-picks">
                    {elsewhere.map((r) => (
                      <a class="footer-card" href={`${base}?region=${r}`}>
                        {r}
                      </a>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </section>
        <section>
          <h2>Keep going</h2>
          <div class="footer-picks">
            <a class="footer-card" href={`/movie/${movie.slug}`}>
              {movie.title} overview
            </a>
            <a class="footer-card" href={`/movie/${movie.slug}/similar`}>
              Movies like {movie.title}
            </a>
            <a class="footer-card" href="/what-to-watch?type=movie">
              What should I watch tonight?
            </a>
          </div>
        </section>
      </article>
    </Layout>,
  );
});

// The movie compare doorway — same anatomy as /compare for shows: resolve
// names, redirect to the canonical matchup, help when only one side lands.
app.get("/movies/compare", async (c) => {
  const db = c.env.DB;
  const resolve = async (q: string): Promise<MovieRow | null> => {
    if (!q) return null;
    return (
      (await db.prepare("SELECT * FROM movies WHERE slug = ?").bind(q).first<MovieRow>()) ??
      (await db
        .prepare(
          "SELECT * FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 1",
        )
        .bind(q)
        .first<MovieRow>())
    );
  };
  const qa = (c.req.query("a") ?? "").trim();
  const qb = (c.req.query("b") ?? "").trim();
  const [ma, mb] = await Promise.all([resolve(qa), resolve(qb)]);
  if (ma && mb && ma.slug !== mb.slug)
    return c.redirect(movieComparePathFor(ma.slug, mb.slug), 301);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Compare two movies — head-to-head | TV Nightly"
      description="Put two films side by side: ratings, votes, runtime and where to stream."
      canonical={`${origin(c)}/movies/compare`}
    >
      <h1>Compare two movies</h1>
      <form method="get" action="/movies/compare" class="picker-form">
        <label>
          Movie A{" "}
          <input
            type="search"
            name="a"
            value={ma?.title ?? qa}
            placeholder="Inception"
            required
          />
        </label>
        <label>
          Movie B <input type="search" name="b" value={qb} placeholder="Interstellar" required />
        </label>
        <button type="submit">Compare</button>
      </form>
      {(qa || qb) && (!ma || !mb) ? (
        <p class="muted">Couldn't find one of those movies — try different names.</p>
      ) : null}
      {ma && !mb ? (
        <section>
          <h2>Compare {ma.title} with…</h2>
          <div class="footer-picks">
            {(await similarMovies(db, ma)).slice(0, 6).map((m) => (
              <a class="footer-card" href={movieComparePathFor(ma.slug, m.slug)}>
                {ma.title} vs {m.title}
              </a>
            ))}
          </div>
        </section>
      ) : null}
      {!ma && !mb ? (
        <section>
          <h2>Popular matchups</h2>
          <div class="footer-picks">
            {await (async () => {
              const { results: tops } = await db
                .prepare("SELECT slug, title FROM movies ORDER BY popularity DESC LIMIT 8")
                .all<{ slug: string; title: string }>();
              return tops.slice(0, 6).map((m, i) => {
                const other = tops[(i + 1) % tops.length];
                return (
                  <a class="footer-card" href={movieComparePathFor(m.slug, other.slug)}>
                    {m.title} vs {other.title}
                  </a>
                );
              });
            })()}
          </div>
        </section>
      ) : null}
    </Layout>,
  );
});

// The matchup hub: every rival as a versus card, the tab's stable home.
app.get("/movie/:slug/compare", async (c) => {
  const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
    .bind(c.req.param("slug"))
    .first<MovieRow>();
  if (!movie) return c.notFound();
  const rivals = await similarMovies(c.env.DB, movie, 6);
  if (!rivals.length) return c.redirect(`/movie/${movie.slug}`, 302);
  const [backdrop, ...rivalBackdrops] = c.env.TMDB_API_KEY
    ? await Promise.all([
        tmdbMovieBackdrop(c.env.TMDB_API_KEY, movie.imdb_id),
        ...rivals.map((m) => tmdbMovieBackdrop(c.env.TMDB_API_KEY!, m.imdb_id)),
      ])
    : [null];
  const small = (u: string) => u.replace("/w1280/", "/w780/");
  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Compare ${movie.title} — head-to-head matchups | TV Nightly`}
      description={`${movie.title} against ${rivals
        .slice(0, 3)
        .map((m) => m.title)
        .join(", ")} and more — ratings, votes, runtime and streaming, side by side.`}
      canonical={`${site}/movie/${movie.slug}/compare`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
    >
      <h1>
        Compare <a href={`/movie/${movie.slug}`}>{movie.title}</a>
      </h1>
      <MovieTabs slug={movie.slug} current="compare" />
      <p class="dossier-method">
        Pick a matchup — ratings, votes, runtime and where to stream, side by side.
      </p>
      <div class="vs-grid">
        {rivals.map((m, i) => (
          <VsCard
            href={movieComparePathFor(movie.slug, m.slug)}
            a={{
              name: movie.title,
              poster: movie.poster_url,
              backdrop: backdrop ? small(backdrop.x1) : null,
            }}
            b={{
              name: m.title,
              poster: m.poster_url,
              backdrop: rivalBackdrops[i] ? small(rivalBackdrops[i]!.x1) : null,
            }}
            cta="Side by side"
          />
        ))}
      </div>
    </Layout>,
  );
});

// One matchup, settled with facts: /compare/movie/{a}-vs-{b}, alphabetical
// canonical (reversed forms 301). "-vs-" can appear inside a slug, so every
// split is tried until both sides resolve.
app.get("/compare/movie/:pair{.+-vs-.+}", async (c) => {
  const pair = c.req.param("pair");
  let a: MovieRow | null = null;
  let b: MovieRow | null = null;
  let idx = pair.indexOf("-vs-");
  while (idx !== -1) {
    const left = pair.slice(0, idx);
    const right = pair.slice(idx + 4);
    const rows = await c.env.DB.prepare(
      "SELECT * FROM movies WHERE slug IN (?, ?)",
    )
      .bind(left, right)
      .all<MovieRow>();
    const l = rows.results.find((m) => m.slug === left);
    const r = rows.results.find((m) => m.slug === right);
    if (l && r) {
      a = l;
      b = r;
      break;
    }
    idx = pair.indexOf("-vs-", idx + 1);
  }
  if (!a || !b || a.slug === b.slug) return c.notFound();
  const canonicalPath = movieComparePathFor(a.slug, b.slug);
  if (`/compare/movie/${pair}` !== canonicalPath) return c.redirect(canonicalPath, 301);

  const region = visitorRegion(c);
  const provs = (m: MovieRow): string[] => {
    const intl: Record<string, string[]> = m.providers_intl ? JSON.parse(m.providers_intl) : {};
    const seen = new Set<string>();
    return (intl[region] ?? []).filter((n) => {
      const k = providerBrand(n);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const genresOf = (m: MovieRow): string[] => (m.genres ? JSON.parse(m.genres) : []);
  const site = origin(c);
  const rows: { label: string; a: string | null; b: string | null }[] = [
    {
      label: "Rating",
      a: a.rating != null ? `★ ${a.rating.toFixed(1)}` : null,
      b: b.rating != null ? `★ ${b.rating.toFixed(1)}` : null,
    },
    {
      label: "Votes",
      a: a.votes ? a.votes.toLocaleString() : null,
      b: b.votes ? b.votes.toLocaleString() : null,
    },
    { label: "Year", a: a.year ? String(a.year) : null, b: b.year ? String(b.year) : null },
    {
      label: "Runtime",
      a: a.runtime ? `${a.runtime} min` : null,
      b: b.runtime ? `${b.runtime} min` : null,
    },
    {
      label: "Genres",
      a: genresOf(a).slice(0, 3).join(", ") || null,
      b: genresOf(b).slice(0, 3).join(", ") || null,
    },
    {
      label: `Streaming (${region})`,
      a: provs(a).slice(0, 3).join(", ") || "Not streaming",
      b: provs(b).slice(0, 3).join(", ") || "Not streaming",
    },
  ];

  // The same mesh the show duel earns: each side's closest matches become
  // the next matchup, deduped so shared rivals appear once.
  const [simA, simB] = await Promise.all([
    similarMovies(c.env.DB, a, 5),
    similarMovies(c.env.DB, b, 5),
  ]);
  const seen = new Set([a.slug, b.slug]);
  const moreFor = (anchor: MovieRow, sims: MovieRow[]) =>
    sims
      .filter((m) => !seen.has(m.slug) && seen.add(m.slug))
      .slice(0, 4)
      .map((m) => ({ anchor, other: m }));
  const more = [...moreFor(a, simA), ...moreFor(b, simB)];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${a.title} vs ${b.title} — which should you watch? | TV Nightly`}
      description={`${a.title} or ${b.title}? Ratings, votes, runtime and where to stream, side by side.`}
      canonical={`${site}${canonicalPath}`}
      ogImage={a.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
            { "@type": "ListItem", position: 2, name: a.title, item: `${site}/movie/${a.slug}` },
            { "@type": "ListItem", position: 3, name: `vs ${b.title}`, item: `${site}${canonicalPath}` },
          ],
        },
      ]}
    >
      <h1>
        <a href={`/movie/${a.slug}`}>{a.title}</a> <span class="vs-v">vs</span>{" "}
        <a href={`/movie/${b.slug}`}>{b.title}</a>
      </h1>
      <form method="get" action="/movies/compare" class="picker-form">
        <label>
          Movie A <input type="search" name="a" value={a.title} required />
        </label>
        <label>
          Movie B <input type="search" name="b" value={b.title} required />
        </label>
        <button type="submit">Compare</button>
      </form>
      <div class="duel-board">
        <div class="duel-head">
          <a class="duel-side" href={`/movie/${a.slug}`}>
            {a.poster_url ? (
              <img src={a.poster_url} alt={a.title} width="120" height="180" loading="lazy" />
            ) : null}
            <strong>{a.title}</strong>
          </a>
          <span class="vs-badge" aria-hidden="true">
            VS
          </span>
          <a class="duel-side" href={`/movie/${b.slug}`}>
            {b.poster_url ? (
              <img src={b.poster_url} alt={b.title} width="120" height="180" loading="lazy" />
            ) : null}
            <strong>{b.title}</strong>
          </a>
        </div>
        <dl class="duel-ledger">
          {rows.map((r) => (
            <div class="duel-row">
              <dd class="duel-a">{r.a ?? <span class="muted">—</span>}</dd>
              <dt>{r.label}</dt>
              <dd class="duel-b">{r.b ?? <span class="muted">—</span>}</dd>
            </div>
          ))}
        </dl>
      </div>
      {more.length > 0 ? (
        <section>
          <h2>More comparisons</h2>
          <div class="footer-picks">
            {more.map(({ anchor, other }) => (
              <a class="footer-card" href={movieComparePathFor(anchor.slug, other.slug)}>
                {anchor.title} vs {other.title}
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <section>
        <h2>Keep going</h2>
        <div class="footer-picks">
          <a class="footer-card" href={`/movie/${a.slug}`}>
            {a.title} overview
          </a>
          <a class="footer-card" href={`/movie/${b.slug}`}>
            {b.title} overview
          </a>
          <a class="footer-card" href={`/movie/${a.slug}/compare`}>
            More {a.title} matchups
          </a>
        </div>
      </section>
    </Layout>,
  );
});

export default app;
