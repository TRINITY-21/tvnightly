import { Hono } from "hono";
import { IconStar } from "../components/icons";
import { Layout } from "../components/Layout";
import { ExploreCard, MovieCard, ShowCard, StatusBadge } from "../components/cards";
import { heroBg, hiRes, posterSrc, retinaSet, slugifyName, stripHtml } from "../lib/format";
import { diceSimilarity, foldSql, foldText } from "../lib/search";
import { origin } from "../lib/seo";
import { tmdbBackdrop, tmdbMovieBackdrop, tmdbSearch, tmdbSearchPeople } from "../lib/tmdb";
import { toMovieRow as tmdbMovieRow, toShowRow as tmdbShowRow } from "../lib/tmdb-rows";
import { TMDB_PERSON_OFFSET } from "../lib/tmdb-show";
import { Bindings, MovieRow, ShowRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// --------------------------------------------------------------- search

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  // Fold the query the same way the columns are folded so "spiderman",
  // "spider man", and "Spider-Man" all hit. Gate on the folded length so an
  // all-punctuation query doesn't become a match-everything '%%'.
  const qf = foldText(q);
  if (qf.length < 2) return c.json([]);
  const [shows, movies, people] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, name, slug, premiered, rating, COALESCE(poster_url, image_url) AS poster
       FROM shows WHERE ${foldSql("name")} LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 6`,
    )
      .bind(qf)
      .all<{ id: number; name: string; slug: string; premiered: string | null; rating: number | null; poster: string | null }>(),
    c.env.DB.prepare(
      `SELECT imdb_id, title, slug, year, rating, poster_url AS poster
       FROM movies WHERE ${foldSql("title")} LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 4`,
    )
      .bind(qf)
      .all<{ imdb_id: string; title: string; slug: string; year: number | null; rating: number | null; poster: string | null }>(),
    c.env.DB.prepare(
      `SELECT id, name, image_url FROM people WHERE ${foldSql("name")} LIKE '%' || ? || '%'
       ORDER BY (SELECT COUNT(*) FROM credits cr WHERE cr.person_id = people.id) DESC
       LIMIT 3`,
    )
      .bind(qf)
      .all<{ id: number; name: string; image_url: string | null }>(),
  ]);
  const out: {
    name: string;
    slug: string;
    ref: string | null;
    year: string | null;
    kind: string;
    rating: number | null;
    poster: string | null;
  }[] = [
    ...shows.results.map((r) => ({
      name: r.name,
      slug: r.slug,
      ref: String(r.id), // recommend flow keys titles by kind+ref, never name
      year: r.premiered?.slice(0, 4) ?? null,
      kind: "tv",
      rating: r.rating,
      poster: r.poster,
    })),
    ...movies.results.map((r) => ({
      name: r.title,
      slug: r.slug,
      ref: r.imdb_id,
      year: r.year ? String(r.year) : null,
      kind: "movie",
      rating: r.rating,
      poster: r.poster,
    })),
    ...people.results.map((r) => ({
      name: r.name,
      slug: `${slugifyName(r.name)}-${r.id}`,
      ref: null,
      year: null,
      kind: "person",
      rating: null,
      poster: r.image_url,
    })),
  ];
  // hybrid: surface TMDB titles + people the mirror doesn't have (deduped)
  if (c.env.TMDB_API_KEY) {
    const have = new Set(out.map((r) => r.slug));
    // people first — the mirror is TVmaze-only, so a TMDB-only person would be
    // completely unfindable from search otherwise
    if (people.results.length < 3) {
      const knownPeople = new Set(people.results.map((r) => foldText(r.name)));
      for (const p of await tmdbSearchPeople(c.env.TMDB_API_KEY, q)) {
        if (knownPeople.has(foldText(p.name))) continue;
        knownPeople.add(foldText(p.name));
        out.push({
          name: p.name,
          slug: `${slugifyName(p.name)}-${TMDB_PERSON_OFFSET + p.tmdbId}`,
          ref: null,
          year: null,
          kind: "person",
          rating: null,
          poster: p.profilePath ? `https://image.tmdb.org/t/p/w185${p.profilePath}` : null,
        });
        if (out.filter((r) => r.kind === "person").length >= 3) break;
      }
    }
    if (out.length < 9) {
      for (const h of await tmdbSearch(c.env.TMDB_API_KEY, q)) {
        const slug = slugifyName(h.name);
        if (have.has(slug) || out.length >= 9) continue;
        have.add(slug);
        out.push({
          name: h.name,
          slug,
          ref: null,
          year: h.year,
          kind: h.kind,
          rating: h.rating,
          poster: h.posterPath ? `https://image.tmdb.org/t/p/w185${h.posterPath}` : null,
        });
      }
    }
  }
  c.header("Cache-Control", "public, max-age=300");
  return c.json(out.slice(0, 9));
});

app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const qf = foldText(q);
  type PersonHit = { id: number; name: string; image_url: string | null; known_dept: string | null; roles: number };
  const [{ results }, { results: movieResults }, { results: personResults }] =
    qf.length >= 2
      ? await Promise.all([
          c.env.DB.prepare(
            `SELECT * FROM shows WHERE ${foldSql("name")} LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 20`,
          )
            .bind(qf)
            .all<ShowRow>(),
          c.env.DB.prepare(
            `SELECT * FROM movies WHERE ${foldSql("title")} LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 12`,
          )
            .bind(qf)
            .all<MovieRow>(),
          // ranked by body of work — both screens count
          c.env.DB.prepare(
            `SELECT id, name, image_url, known_dept,
                    (SELECT COUNT(*) FROM credits cr WHERE cr.person_id = people.id) +
                    (SELECT COUNT(*) FROM movie_credits mc WHERE mc.person_id = people.id) AS roles
             FROM people WHERE ${foldSql("name")} LIKE '%' || ? || '%'
             ORDER BY roles DESC LIMIT 8`,
          )
            .bind(qf)
            .all<PersonHit>(),
        ])
      : [{ results: [] as ShowRow[] }, { results: [] as MovieRow[] }, { results: [] as PersonHit[] }];

  // hybrid: backfill with live TMDB so any real title is findable, deduped vs the
  // mirror. Appended after the D1 hits, so our curated/engaged rows still lead.
  if (c.env.TMDB_API_KEY && qf.length >= 2) {
    const haveTv = new Set(results.map((s) => s.tmdb_id).filter(Boolean));
    const haveMovie = new Set(movieResults.map((m) => m.tmdb_id).filter(Boolean));
    for (const h of await tmdbSearch(c.env.TMDB_API_KEY, q)) {
      if (h.kind === "tv" && !haveTv.has(h.tmdbId) && results.length < 20) results.push(tmdbShowRow(h));
      else if (h.kind === "movie" && !haveMovie.has(h.tmdbId) && movieResults.length < 12)
        movieResults.push(tmdbMovieRow(h));
    }
    // people too — the mirror is TVmaze-only, so a TMDB-only person (and anyone
    // newer than our seed) would otherwise be unsearchable
    if (personResults.length < 8) {
      const havePeople = new Set(personResults.map((p) => foldText(p.name)));
      for (const p of await tmdbSearchPeople(c.env.TMDB_API_KEY, q)) {
        if (havePeople.has(foldText(p.name)) || personResults.length >= 8) continue;
        havePeople.add(foldText(p.name));
        personResults.push({
          id: TMDB_PERSON_OFFSET + p.tmdbId,
          name: p.name,
          image_url: p.profilePath ? `https://image.tmdb.org/t/p/w185${p.profilePath}` : null,
          known_dept: null,
          roles: 0,
        });
      }
    }
  }

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

  // Did-you-mean: when nothing matched, score the most popular titles against the
  // query by bigram similarity to catch a wrong/missing letter ("breqking bad").
  // Bounded pool (only fetched on a miss), not run per-keystroke. Reaches popular
  // titles — an obscure show typed wrong still falls through to the popular shelf.
  const dym: { shows: ShowRow[]; movies: MovieRow[] } = { shows: [], movies: [] };
  if (nothing && qf.length >= 4) {
    const THRESH = 0.34;
    const [poolShows, poolMovies] = await Promise.all([
      c.env.DB.prepare(`SELECT * FROM shows ORDER BY weight DESC LIMIT 300`).all<ShowRow>(),
      c.env.DB.prepare(`SELECT * FROM movies ORDER BY popularity DESC LIMIT 300`).all<MovieRow>(),
    ]);
    dym.shows = poolShows.results
      .map((s) => ({ s, score: diceSimilarity(qf, foldText(s.name)) }))
      .filter((x) => x.score >= THRESH)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((x) => x.s);
    dym.movies = poolMovies.results
      .map((m) => ({ m, score: diceSimilarity(qf, foldText(m.title)) }))
      .filter((x) => x.score >= THRESH)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.m);
  }
  const hasSuggestions = dym.shows.length > 0 || dym.movies.length > 0;

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
  const bestPoster = best
    ? best.kind === "tv"
      ? posterSrc(best.show)
      : posterSrc({ poster_url: best.movie.poster_url, image_url: null })
    : null;

  const filterCounts = {
    all: total,
    tv: results.length,
    movie: movieResults.length,
    person: personResults.length,
  };

  c.header("Cache-Control", "public, max-age=300");
  // infinite ?q= variants must not enter the index (doorway/thin-content risk)
  return c.html(
    <Layout
      title={q ? `Search results for '${q}' | TV Nightly` : `Search | TV Nightly`}
      description="Search TV Nightly for shows, movies and people — episode rankings, release dates, and where to stream."
      canonical={`${origin(c)}/search${q ? `?q=${encodeURIComponent(q)}` : ""}`}
      noindex
      scripts={["/js/search-live.js"]}
    >
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
            <div class="srch-hero-row">
            {bestPoster ? (
              <img
                class="srch-poster"
                src={bestPoster.src}
                srcset={bestPoster.srcset}
                alt=""
                width="128"
                height="192"
                fetchpriority="high"
              />
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
                    <span class="rating"><IconStar class="rating-star" />{bestRating.toFixed(1)}</span>
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
            </div>
          </article>
        ) : null}

        {nothing && hasSuggestions ? (
          <>
            <p class="srch-empty">
              Nothing exactly matched “{q}”. Did you mean:
            </p>
            {dym.shows.length ? (
              <section class="srch-section">
                <h2>
                  TV shows <span class="srch-count">{dym.shows.length}</span>
                </h2>
                <div class="grid">
                  {dym.shows.map((s) => (
                    <ShowCard show={s} />
                  ))}
                </div>
              </section>
            ) : null}
            {dym.movies.length ? (
              <section class="srch-section">
                <h2>
                  Movies <span class="srch-count">{dym.movies.length}</span>
                </h2>
                <div class="grid">
                  {dym.movies.map((m) => (
                    <MovieCard movie={m} />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : nothing ? (
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
