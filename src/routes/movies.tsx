import { Hono } from "hono";
import { Bindings, MovieRow } from "../types";
import { franchiseOfMovie } from "../lib/franchises";
import { visitorRegion, providersFor } from "../lib/providers";
import { slugifyName, heroBg, stripHtml } from "../lib/format";
import { tmdbMovieBackdrop, tmdbMovieMedia } from "../lib/tmdb";
import { MovieTabs } from "../components/nav";
import { IconPlay } from "../components/icons";
import { origin, canonical } from "../lib/seo";
import { similarMovies } from "../lib/queries";
import { titleStat } from "../lib/ratings";
import { hubForGenres } from "../lib/verticals";
import { Layout } from "../components/Layout";
import { MovieCard, ExploreCard, ClampSummary } from "../components/cards";
import { ProviderLine } from "../components/providers";
import { RateInline } from "../components/forms";
import { buildMovieDossier } from "../lib/dossier";
import { DossierRow } from "../components/dossier";

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

  // the movie's real designed backdrop (TMDB takes the IMDb id directly);
  // the blurred poster stays as ambient fallback
  const backdrop = c.env.TMDB_API_KEY
    ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, movie.imdb_id)
    : null;
  const heroFrame = backdrop ? heroBg(backdrop.x1, backdrop.x2) : null;

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
          <nav class="pill-nav">
            <a class="chev-after" href={`/movie/${movie.slug}`}>
              {movie.title} overview
            </a>
            <a class="chev-after" href="/movies/best">
              Best movies
            </a>
            <a class="chev-after" href="/what-to-watch?type=movie">
              What should I watch tonight?
            </a>
          </nav>
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
          <nav class="pill-nav">
            <a class="chev-after" href={`/movie/${movie.slug}`}>
              {movie.title} overview
            </a>
            <a class="chev-after" href={`/movie/${movie.slug}/similar`}>
              Movies like {movie.title}
            </a>
            <a class="chev-after" href="/movies/best">
              Best movies
            </a>
          </nav>
        </section>
      </article>
    </Layout>,
  );
});

export default app;
