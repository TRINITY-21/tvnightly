import { Hono } from "hono";
import { Bindings, MovieRow } from "../types";
import { franchiseOfMovie } from "../lib/franchises";
import { visitorRegion, providersFor } from "../lib/providers";
import { slugifyName } from "../lib/format";
import { origin, canonical } from "../lib/seo";
import { similarMovies } from "../lib/queries";
import { titleStat } from "../lib/ratings";
import { hubForGenres } from "../lib/verticals";
import { Layout } from "../components/Layout";
import { MovieCard, ExploreCard, ClampSummary } from "../components/cards";
import { ProviderLine } from "../components/providers";
import { RateInline } from "../components/forms";

const app = new Hono<{ Bindings: Bindings }>();

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
        <a class="chev-after" href="/movies/best">Best movies, ranked</a> ·{" "}
        <a href="/what-to-watch?type=movie">Pick one for me</a>
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
        <header class="detail-hero">
          {movie.poster_url ? (
            <div class="hero-backdrop" style={`background-image:url('${movie.poster_url}')`}></div>
          ) : null}
          <div class="detail-head">
            {movie.poster_url ? (
              <img class="poster" src={movie.poster_url} alt={movie.title} />
            ) : (
              <div class="poster card-fallback">{movie.title}</div>
            )}
            <div class="detail-info">
              <h1>{movie.title}</h1>
              <p class="meta-strip">
                <span>Movie</span>
                {movie.year ? (
                  <>
                    <span class="sep">·</span>
                    <span>{movie.year}</span>
                  </>
                ) : null}
                {genres.length ? (
                  <>
                    <span class="sep">·</span>
                    <span>{genres.slice(0, 3).join(", ")}</span>
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
                region={visitorRegion(c)}
                fallbackHref="/what-to-watch?type=movie"
                pickerType="movie"
              />
              <nav class="pill-nav">
                <a href={`https://www.imdb.com/title/${movie.imdb_id}/`} rel="noopener">
                  IMDb
                </a>
                <a href="/what-to-watch?type=movie">Pick me another</a>
              </nav>
              {movie.overview ? (
                movie.overview.length > 280 ? (
                  <ClampSummary id="synopsis-clamp">{movie.overview}</ClampSummary>
                ) : (
                  <div class="summary">{movie.overview}</div>
                )
              ) : null}
              <RateInline kind="movie" refId={movie.imdb_id} stat={stat} />
            </div>
          </div>
        </header>
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
                  top movies
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
                    icon="PICK"
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

export default app;
