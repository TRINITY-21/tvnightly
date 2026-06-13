import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ExploreCard, MovieCard, ShowCard, StatusBadge } from "../components/cards";
import { heroBg, hiRes, retinaSet, slugifyName, stripHtml } from "../lib/format";
import { tmdbBackdrop, tmdbMovieBackdrop } from "../lib/tmdb";
import { Bindings, MovieRow, ShowRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// --------------------------------------------------------------- search

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  // Leading-wildcard LIKE can't use an index; skip the movie and people
  // scans for very short queries to keep per-keystroke rows-read inside
  // the D1 free budget.
  const includeMovies = q.length >= 3;
  const [shows, movies, people] = await Promise.all([
    c.env.DB.prepare(
      `SELECT name, slug, premiered, rating, COALESCE(poster_url, image_url) AS poster
       FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 6`,
    )
      .bind(q)
      .all<{ name: string; slug: string; premiered: string | null; rating: number | null; poster: string | null }>(),
    includeMovies
      ? c.env.DB.prepare(
          `SELECT title, slug, year, rating, poster_url AS poster
           FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 4`,
        )
          .bind(q)
          .all<{ title: string; slug: string; year: number | null; rating: number | null; poster: string | null }>()
      : Promise.resolve({
          results: [] as { title: string; slug: string; year: number | null; rating: number | null; poster: string | null }[],
        }),
    includeMovies
      ? c.env.DB.prepare(
          `SELECT id, name, image_url FROM people WHERE name LIKE '%' || ? || '%'
           ORDER BY (SELECT COUNT(*) FROM credits cr WHERE cr.person_id = people.id) DESC
           LIMIT 3`,
        )
          .bind(q)
          .all<{ id: number; name: string; image_url: string | null }>()
      : Promise.resolve({ results: [] as { id: number; name: string; image_url: string | null }[] }),
  ]);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(
    [
      ...shows.results.map((r) => ({
        name: r.name,
        slug: r.slug,
        year: r.premiered?.slice(0, 4) ?? null,
        kind: "tv",
        rating: r.rating,
        poster: r.poster,
      })),
      ...movies.results.map((r) => ({
        name: r.title,
        slug: r.slug,
        year: r.year ? String(r.year) : null,
        kind: "movie",
        rating: r.rating,
        poster: r.poster,
      })),
      ...people.results.map((r) => ({
        name: r.name,
        slug: `${slugifyName(r.name)}-${r.id}`,
        year: null,
        kind: "person",
        rating: null,
        poster: r.image_url,
      })),
    ].slice(0, 9),
  );
});

app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  type PersonHit = { id: number; name: string; image_url: string | null; known_dept: string | null; roles: number };
  const [{ results }, { results: movieResults }, { results: personResults }] = q
    ? await Promise.all([
        c.env.DB.prepare(
          `SELECT * FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 20`,
        )
          .bind(q)
          .all<ShowRow>(),
        c.env.DB.prepare(
          `SELECT * FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 12`,
        )
          .bind(q)
          .all<MovieRow>(),
        // ranked by body of work — both screens count
        c.env.DB.prepare(
          `SELECT id, name, image_url, known_dept,
                  (SELECT COUNT(*) FROM credits cr WHERE cr.person_id = people.id) +
                  (SELECT COUNT(*) FROM movie_credits mc WHERE mc.person_id = people.id) AS roles
           FROM people WHERE name LIKE '%' || ? || '%'
           ORDER BY roles DESC LIMIT 8`,
        )
          .bind(q)
          .all<PersonHit>(),
      ])
    : [{ results: [] as ShowRow[] }, { results: [] as MovieRow[] }, { results: [] as PersonHit[] }];

  // the strongest hit takes the hero: an exact title match outranks the
  // weight order; otherwise TV (the house specialty) leads
  type Best = { kind: "tv"; show: ShowRow } | { kind: "movie"; movie: MovieRow };
  const ql = q.toLowerCase();
  const exactShow = results.find((s) => s.name.toLowerCase() === ql);
  const exactMovie = movieResults.find((m) => m.title.toLowerCase() === ql);
  const best: Best | null = exactShow
    ? { kind: "tv", show: exactShow }
    : exactMovie
      ? { kind: "movie", movie: exactMovie }
      : results[0]
        ? { kind: "tv", show: results[0] }
        : movieResults[0]
          ? { kind: "movie", movie: movieResults[0] }
          : null;

  // hero art: the match's real designed backdrop, else its poster as
  // ambient light — same chain the show pages ride
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (best && c.env.TMDB_API_KEY) {
    art =
      best.kind === "tv"
        ? best.show.tmdb_id
          ? await tmdbBackdrop(c.env.TMDB_API_KEY, best.show.tmdb_id)
          : null
        : await tmdbMovieBackdrop(c.env.TMDB_API_KEY, best.movie.imdb_id);
  }
  if (!art && best) {
    const p = best.kind === "tv" ? hiRes(best.show.image_url) : best.movie.poster_url;
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }

  const restShows = best?.kind === "tv" ? results.filter((s) => s !== best.show) : results;
  const restMovies = best?.kind === "movie" ? movieResults.filter((m) => m !== best.movie) : movieResults;
  const total = results.length + movieResults.length + personResults.length;
  const nothing = Boolean(q) && total === 0;

  // a launch pad instead of a dead end: the bare page and the zero-result
  // page both get the catalog's most-returned-to shelf
  const popular =
    !q || nothing
      ? await c.env.DB.prepare(
          `SELECT name, slug, COALESCE(poster_url, image_url) AS poster
           FROM shows WHERE poster_url IS NOT NULL OR image_url IS NOT NULL
           ORDER BY weight DESC LIMIT 12`,
        )
          .all<{ name: string; slug: string; poster: string | null }>()
          .then((r) => r.results)
      : [];

  const bestGenres: string[] = best
    ? JSON.parse((best.kind === "tv" ? best.show.genres : best.movie.genres) ?? "[]")
    : [];
  const bestRating = best ? (best.kind === "tv" ? best.show.rating : best.movie.rating) : null;
  const bestYear = best
    ? best.kind === "tv"
      ? (best.show.premiered?.slice(0, 4) ?? null)
      : best.movie.year
        ? String(best.movie.year)
        : null
    : null;
  const bestDek = best
    ? stripHtml((best.kind === "tv" ? best.show.summary : best.movie.overview) ?? "")
    : "";
  const bestHref = best
    ? best.kind === "tv"
      ? `/show/${best.show.slug}`
      : `/movie/${best.movie.slug}`
    : "#";

  const filterCounts = {
    all: total,
    tv: results.length,
    movie: movieResults.length,
    person: personResults.length,
  };

  c.header("Cache-Control", "public, max-age=300");
  // infinite ?q= variants must not enter the index (doorway/thin-content risk)
  return c.html(
    <Layout title={`Search${q ? `: ${q}` : ""} | TV Nightly`} noindex scripts={["/js/search-live.js"]}>
      <div class="srch">
        <p class="section-eyebrow">Search</p>
        <h1 class="srch-title">{q ? "Results" : "Find a show, movie, or person"}</h1>
        <div class="srch-bar">
          <form method="get" action="/search" class="srch-form" role="search">
            <input
              type="search"
              name="q"
              value={q}
              placeholder="A show, a movie, a person…"
              aria-label="Search shows and movies"
              autofocus={!q}
            />
          </form>
          <div class="srch-tools">
            <a class="footer-card srch-browse" href="/lists">
              Browse
            </a>
            <div class="srch-filter-dd dd" hidden={!q}>
              <button
                type="button"
                class="dd-btn srch-filter-btn"
                aria-haspopup="listbox"
                aria-expanded="false"
              >
                Filter
              </button>
              <ul class="dd-list srch-filter-menu" role="listbox">
                <li
                  role="option"
                  class="srch-filter-opt is-active"
                  data-filter="all"
                  aria-selected="true"
                >
                  <span class="srch-filter-name">All results</span>
                  {filterCounts.all ? <span class="srch-filter-count">{filterCounts.all}</span> : null}
                </li>
                <li
                  role="option"
                  class={`srch-filter-opt${results.length ? "" : " is-disabled"}`}
                  data-filter="tv"
                  aria-selected="false"
                  aria-disabled={!results.length}
                >
                  <span class="srch-filter-name">TV shows</span>
                  {results.length ? <span class="srch-filter-count">{filterCounts.tv}</span> : null}
                </li>
                <li
                  role="option"
                  class={`srch-filter-opt${movieResults.length ? "" : " is-disabled"}`}
                  data-filter="movie"
                  aria-selected="false"
                  aria-disabled={!movieResults.length}
                >
                  <span class="srch-filter-name">Movies</span>
                  {movieResults.length ? (
                    <span class="srch-filter-count">{filterCounts.movie}</span>
                  ) : null}
                </li>
                <li
                  role="option"
                  class={`srch-filter-opt${personResults.length ? "" : " is-disabled"}`}
                  data-filter="person"
                  aria-selected="false"
                  aria-disabled={!personResults.length}
                >
                  <span class="srch-filter-name">People</span>
                  {personResults.length ? (
                    <span class="srch-filter-count">{filterCounts.person}</span>
                  ) : null}
                </li>
                <li role="separator" class="srch-filter-sep" aria-hidden="true"></li>
                <li role="option" class="srch-filter-opt srch-filter-clear" data-action="clear">
                  <span class="srch-filter-name">Clear search</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div class="srch-live">
        {q && total > 0 ? (
          <p class="srch-sum">
            <strong>{total}</strong> {total === 1 ? "match" : "matches"} for “{q}”
            <span class="srch-sum-split">
              {[
                results.length ? `${results.length} TV ${results.length === 1 ? "show" : "shows"}` : null,
                movieResults.length
                  ? `${movieResults.length} ${movieResults.length === 1 ? "movie" : "movies"}`
                  : null,
                personResults.length
                  ? `${personResults.length} ${personResults.length === 1 ? "person" : "people"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
        ) : null}

        {best ? (
          <article class={`srch-hero${ambient ? " srch-ambient" : ""}`} data-srch-kind={best.kind === "tv" ? "tv" : "movie"}>
            {art ? (
              <div class="srch-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div>
            ) : null}
            <div class="srch-hero-body">
              <p class="srch-kicker">
                Top match · {best.kind === "tv" ? "TV show" : "Movie"}
              </p>
              <h2 class="srch-hero-title">
                <a href={bestHref}>{best.kind === "tv" ? best.show.name : best.movie.title}</a>
              </h2>
              <p class="meta-strip">
                {best.kind === "tv" ? <StatusBadge status={best.show.status} /> : null}
                {bestYear ? <span>{bestYear}</span> : null}
                {bestGenres.length ? (
                  <>
                    <span class="sep">·</span>
                    <span>{bestGenres.slice(0, 3).join(", ")}</span>
                  </>
                ) : null}
                {bestRating != null ? (
                  <>
                    <span class="sep">·</span>
                    <span class="rating">★ {bestRating.toFixed(1)}</span>
                  </>
                ) : null}
              </p>
              {bestDek ? <p class="srch-dek">{bestDek}</p> : null}
              <p class="srch-hero-actions">
                <a class="btn-ghost chev-after" href={bestHref}>
                  {best.kind === "tv" ? "Episode guide & ratings" : "Where to watch & details"}
                </a>
              </p>
            </div>
          </article>
        ) : null}

        {nothing ? (
          <p class="srch-empty">
            Nothing matched “{q}”. Check the spelling, or try fewer words — we match titles and
            names, not descriptions.
          </p>
        ) : null}

        {restShows.length ? (
          <section class="srch-section" data-srch-kind="tv">
            <h2>
              TV shows <span class="srch-count">{restShows.length}</span>
            </h2>
            <div class="grid">
              {restShows.map((s) => (
                <ShowCard show={s} />
              ))}
            </div>
          </section>
        ) : null}
        {restMovies.length ? (
          <section class="srch-section" data-srch-kind="movie">
            <h2>
              Movies <span class="srch-count">{restMovies.length}</span>
            </h2>
            <div class="grid">
              {restMovies.map((m) => (
                <MovieCard movie={m} />
              ))}
            </div>
          </section>
        ) : null}
        {personResults.length ? (
          <section class="srch-section" data-srch-kind="person">
            <h2>
              People <span class="srch-count">{personResults.length}</span>
            </h2>
            <div class="cast-grid">
              {personResults.map((p) => (
                <a class="cast-tile" href={`/person/${slugifyName(p.name)}-${p.id}`}>
                  {p.image_url ? (
                    <img src={p.image_url} srcset={retinaSet(p.image_url)} alt={p.name} loading="lazy" />
                  ) : (
                    <div class="cast-fallback">{p.name}</div>
                  )}
                  <div class="cast-tile-body">
                    <strong>{p.name}</strong>
                    {p.roles ? (
                      <span class="cast-char">
                        {p.roles} {p.roles === 1 ? "credit" : "credits"}
                      </span>
                    ) : null}
                  </div>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {popular.length ? (
          <section class="srch-section">
            <h2>{nothing ? "Popular right now instead" : "People keep coming back to these"}</h2>
            <ul class="poster-shelf">
              {popular.map((s) => (
                <li>
                  <a class="shelf-tile" href={`/show/${s.slug}`} title={s.name}>
                    {s.poster ? (
                      <img src={s.poster} alt="" width="92" height="138" loading="lazy" decoding="async" />
                    ) : (
                      <span class="shelf-fallback">{s.name}</span>
                    )}
                  </a>
                  <span class="shelf-name">{s.name}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        </div>

        <section class="srch-doors">
          <h2>Keep exploring</h2>
          <div class="explore-grid">
            <ExploreCard
              icon="Browse"
              title="Every chart & list"
              desc="Networks, genres, hubs, and the full canon — one directory."
              href="/lists"
            />
            <ExploreCard
              icon="Tonight"
              title="What's actually on"
              desc="Tonight's schedule, in air-time order."
              href="/tonight"
            />
            <ExploreCard
              icon="Tailored"
              title="Rate one thing, get a pick"
              desc="The recommender finds your next show from one rating."
              href="/recommend"
            />
          </div>
        </section>
      </div>
    </Layout>,
  );
});

export default app;
