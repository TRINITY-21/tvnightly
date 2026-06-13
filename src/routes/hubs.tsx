import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ExploreCard, MovieCard, ShowCard } from "../components/cards";
import { heroBg, hiRes, premiereDateParts, shortDate, slugifyName } from "../lib/format";
import { FRANCHISE_BY_SLUG } from "../lib/franchises";
import { PROVIDER_LOGOS, visitorRegion } from "../lib/providers";
import { origin } from "../lib/seo";
import { tmdbBackdrop, tmdbMovieBackdrop } from "../lib/tmdb";
import { VERTICALS, Vertical, genreBinds, genreOr } from "../lib/verticals";
import { AppContext, Bindings, MovieRow, ShowRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

const hubHandler = (v: Vertical) => async (c: AppContext) => {
  const db = c.env.DB;
  const region = visitorRegion(c);

  type PremiereRow = {
    airdate: string | null;
    season: number | null;
    show_name: string;
    show_slug: string;
    poster: string | null;
    network: string | null;
  };
  type ArrivalRow = { title: string; slug: string; service: string; detected_at: number; poster: string | null };

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

  // five independent reads — fire them together, not in a five-deep waterfall
  const [showsR, moviesR, premieresR, newOnTvR, newOnMoviesR] = await Promise.all([
    v.tvGenres?.length
      ? db
          .prepare(
            `SELECT * FROM shows WHERE ${genreOr("genres", v.tvGenres)} AND rating IS NOT NULL AND weight >= 60
             ORDER BY rating DESC, weight DESC LIMIT 12`,
          )
          .bind(...genreBinds(v.tvGenres))
          .all<ShowRow>()
      : null,
    db
      .prepare(
        `SELECT * FROM movies WHERE ${movieConds.join(" AND ")}
         ORDER BY rating DESC, votes DESC LIMIT 12`,
      )
      .bind(...movieBinds)
      .all<MovieRow>(),
    v.tvGenres?.length
      ? db
          .prepare(
            `SELECT e.airdate, e.season, s.name AS show_name, s.slug AS show_slug,
                    COALESCE(s.poster_url, s.image_url) AS poster,
                    COALESCE(s.network, s.web_channel) AS network
             FROM episodes e JOIN shows s ON s.id = e.show_id
             WHERE e.number = 1 AND e.airstamp > datetime('now')
               AND e.airstamp < datetime('now', '+90 days') AND ${genreOr("s.genres", v.tvGenres)}
             ORDER BY e.airstamp LIMIT 6`,
          )
          .bind(...genreBinds(v.tvGenres))
          .all<PremiereRow>()
      : null,
    // What just arrived on streaming, for this genre, in the visitor's region.
    v.tvGenres?.length
      ? db
          .prepare(
            `SELECT pe.title, pe.slug, pe.service, pe.detected_at,
                    COALESCE(s.poster_url, s.image_url) AS poster
             FROM provider_events pe
             JOIN shows s ON pe.kind = 'tv' AND s.id = CAST(pe.ref AS INTEGER)
             WHERE pe.region = ? AND pe.change = 'added' AND ${genreOr("s.genres", v.tvGenres)}
             ORDER BY pe.detected_at DESC LIMIT 8`,
          )
          .bind(region, ...genreBinds(v.tvGenres))
          .all<ArrivalRow>()
      : null,
    db
      .prepare(
        `SELECT pe.title, pe.slug, pe.service, pe.detected_at, m.poster_url AS poster
         FROM provider_events pe
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
      .all<ArrivalRow>(),
  ]);
  const shows = showsR?.results ?? [];
  const movies = moviesR.results;
  const premieres = premieresR?.results ?? [];
  const newOnTv = newOnTvR?.results ?? [];
  const newOnMovies = newOnMoviesR.results;

  // one tile per title: a film added to three services shouldn't fill the shelf
  const seen = new Set<string>();
  const arrivals = [
    ...newOnTv.map((r) => ({ ...r, kind: "tv" as const })),
    ...newOnMovies.map((r) => ({ ...r, kind: "movie" as const })),
  ]
    .sort((a, b) => b.detected_at - a.detected_at)
    .filter((r) => {
      const k = `${r.kind}:${r.slug}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 10);

  // the hub opens on its own #1 title — the genre's best, in the house frame
  const topShow = shows[0] ?? null;
  const topMovie = movies[0] ?? null;
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (c.env.TMDB_API_KEY) {
    art = topShow?.tmdb_id
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, topShow.tmdb_id)
      : !topShow && topMovie
        ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, topMovie.imdb_id)
        : null;
  }
  if (!art) {
    const p = topShow ? hiRes(topShow.image_url) : (topMovie?.poster_url ?? null);
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }

  // the doors out, tuned per hub: its own chart first
  const chartDoor = v.tvGenres?.length
    ? {
        icon: "The chart",
        title: `Every ${v.name.toLowerCase()} show, ranked`,
        desc: "The full genre chart — series and films, by rating.",
        href: `/genre/${slugifyName(v.tvGenres[0])}`,
      }
    : {
        icon: "The chart",
        title: "The best films of all time",
        desc: "Every movie ranked by rating, with where to stream.",
        href: "/movies/best",
      };

  c.header("Cache-Control", "private, max-age=600");
  return c.html(
    <Layout
      title={`${v.pageTitle} | TV Nightly`}
      description={v.description}
      canonical={`${origin(c)}/${v.slug}`}
    >
      <header class={`wo-hero${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">{v.tvGenres?.length ? "Fandom hub" : "Film hub"}</p>
          <h1>{v.name}</h1>
          <p class="wo-intro">{v.intro}</p>
          <p class="hub-actions">
            <a class="verdict-btn" href={`/what-to-watch${v.pickerQS}`}>
              Pick me something {v.name.toLowerCase()}
            </a>
            {(v.watchOrders ?? []).map((slug) => {
              const fr = FRANCHISE_BY_SLUG.get(slug);
              return fr ? (
                <a class="btn-ghost" href={`/watch-order/${slug}`}>
                  {fr.name} watch order
                </a>
              ) : null;
            })}
          </p>
        </div>
      </header>

      {arrivals.length ? (
        <section class="sched-day">
          <h2>
            Just added to streaming ({region}){" "}
            <span class="sched-count">
              {arrivals.length} title{arrivals.length === 1 ? "" : "s"}
            </span>
          </h2>
          <ul class="poster-shelf">
            {arrivals.map((r) => (
              <li>
                <a
                  class="shelf-tile"
                  href={r.kind === "tv" ? `/show/${r.slug}` : `/movie/${r.slug}`}
                  title={`${r.title} — new on ${r.service}`}
                  aria-label={`${r.title} — new on ${r.service}`}
                >
                  {r.poster ? (
                    <img src={r.poster} alt="" width="92" height="138" loading="lazy" decoding="async" />
                  ) : (
                    <span class="shelf-fallback">{r.title}</span>
                  )}
                  {PROVIDER_LOGOS[r.service] ? (
                    <img class="shelf-logo" src={PROVIDER_LOGOS[r.service]} alt={r.service} width="22" height="22" loading="lazy" />
                  ) : null}
                  <span class="shelf-chip">{shortDate(r.detected_at)}</span>
                </a>
                <span class="shelf-name">{r.title}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {premieres.length ? (
        <section class="sched-day">
          <h2>
            Premiering soon{" "}
            <span class="sched-count">
              {premieres.length} premiere{premieres.length === 1 ? "" : "s"}
            </span>
          </h2>
          <ol class="sched-list">
            {premieres.map((p) => {
              const { day, month } = premiereDateParts(p.airdate);
              return (
                <li>
                  <a class="sched-row" href={`/show/${p.show_slug}/release-date`}>
                    <span class="sched-rail">{month ? `${month} ${day}` : "Soon"}</span>
                    {p.poster ? (
                      <img src={p.poster} alt="" width="46" height="69" loading="lazy" decoding="async" />
                    ) : (
                      <span class="sched-thumb-blank" aria-hidden="true"></span>
                    )}
                    <span class="sched-main">
                      <span class="sched-show">{p.show_name}</span>
                      <span class="sched-ep">Season {p.season} premiere</span>
                    </span>
                    {p.network ? <span class="sched-net">{p.network}</span> : null}
                  </a>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {shows.length ? (
        <section class="hub-sec">
          <h2>The best {v.name.toLowerCase()} series</h2>
          <div class="grid">
            {shows.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {movies.length ? (
        <section class="hub-sec">
          <h2>{v.movieSectionTitle}</h2>
          <div class="grid">
            {movies.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard icon={chartDoor.icon} title={chartDoor.title} desc={chartDoor.desc} href={chartDoor.href} />
          <ExploreCard
            icon="Tailored"
            title="Rate one thing, get a pick"
            desc="The recommender finds your next watch from one rating."
            href="/recommend"
          />
          <ExploreCard
            icon="Community"
            title="Loved by this community"
            desc="The chart built from real one-tap reader verdicts."
            href="/loved"
          />
        </div>
      </section>
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
