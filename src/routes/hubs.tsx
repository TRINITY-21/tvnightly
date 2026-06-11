import { Hono } from "hono";
import { Bindings, AppContext, ShowRow, MovieRow } from "../types";
import { FRANCHISE_BY_SLUG } from "../lib/franchises";
import { visitorRegion } from "../lib/providers";
import { origin, canonical } from "../lib/seo";
import { Vertical, genreOr, genreBinds, VERTICALS } from "../lib/verticals";
import { Layout } from "../components/Layout";
import { ShowCard, MovieCard } from "../components/cards";

const app = new Hono<{ Bindings: Bindings }>();

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
          Pick me something {v.name.toLowerCase()}
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
                  <span class="muted">
                    <span class="chev-icon chev-icon-sm" aria-hidden="true"></span> {r.service}
                  </span>
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

export default app;
