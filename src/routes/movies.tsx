import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ExploreCard } from "../components/cards";
import { ChartFilterBar } from "../components/chart-filters";
import { ChartHeroHead, ChartSpotlight } from "../components/chart-hero";
import {
    ChartRankCard,
    ChartRankGrid,
    movieChartRankItem,
} from "../components/chart-rank-card";
import { VsCard, VsSide } from "../components/compare";
import { DetailHero, communityRingScore, heroWatchProvider, tmdbRingScore } from "../components/detail-hero";
import { DossierRow } from "../components/dossier";
import { FilterSelect } from "../components/forms";
import { HomeSidebarRail } from "../components/home-sidebar";
import { IconPlay, IconStar } from "../components/icons";
import { KeepExploring, KeepGoing, loadMovieChartDoorArts, loadMovieKeepGoingArts, loadMoviesHubDoorArts, movieKeepGoingBackdrop } from "../components/keep-going";
import { MovieTabs } from "../components/nav";
import { PhotoGallery, mergeGalleryImages } from "../components/photo-gallery";
import { ShareBar } from "../components/share";
import { VideoGallery } from "../components/video-gallery";
import {
    chartBasePath,
    chartUrl,
    resolveChartPage,
} from "../lib/chart-filters";
import {
    CHART_PAGE_SIZE,
    fetchMovieChartResults,
} from "../lib/chart-results";
import {
    MOVIE_MORE_PER_ANCHOR,
    MOVIE_SIM_POOL,
    involvedMovies,
    involvedShows,
    movieMatchPairs,
    movieSides,
    showSides,
    tvMatchPairs,
} from "../lib/compare-pairs";
import { buildMovieDossier } from "../lib/dossier";
import { fetchMovieExploreArts, franchiseArt } from "../lib/explore-art";
import { comparePathFor, fmtRuntime, heroBg, isNewYear, movieComparePathFor, slugifyName, stripHtml } from "../lib/format";
import { franchiseOfMovie } from "../lib/franchises";
import { PROVIDER_LOGOS, REGIONS, providerBrand, providersFor, regionOptions, visitorRegion } from "../lib/providers";
import { crewLinkMap, genreDirectory, similarMovies } from "../lib/queries";
import { aggregateRatingLd, titleRaterCount, titleStat } from "../lib/ratings";
import { servePng } from "../lib/render";
import { foldSql, foldText } from "../lib/search";
import { breadcrumbTrail, canonical, faqLd, origin } from "../lib/seo";
import { posterDataUri } from "../lib/signal";
import { buildCompareOgCard, buildOgCard, type OgSide } from "../lib/social";
import {
    movieSpotlightTrailer,
    tmdbMovieBackdrop,
    tmdbMovieCast,
    tmdbMovieCrew,
    tmdbMovieFacts,
    tmdbMovieMedia,
    tmdbPopular,
    tmdbRecommendations
} from "../lib/tmdb";
import { toMovieRow } from "../lib/tmdb-rows";
import {
    TMDB_PERSON_OFFSET,
    movieBundleId,
    resolveMovie,
    resolveMovieBundleId,
    tmdbMovieData,
} from "../lib/tmdb-show";
import { hubForGenres } from "../lib/verticals";
import { AppContext, HonoEnv, MovieRow } from "../types";

const app = new Hono<HonoEnv>();

const fmtVotes = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

const MovieHeroPoster = (movie: MovieRow) =>
  movie.poster_url ? (
    <img
      class="poster"
      src={movie.poster_url}
      srcset={`${movie.poster_url} 1x, ${movie.poster_url.replace("/w342/", "/w780/")} 2x`}
      alt={`${movie.title} poster`}
      width="200"
      height="300"
      fetchpriority="high"
      decoding="async"
    />
  ) : (
    <div class="poster card-fallback">{movie.title}</div>
  );

// Truncate to `max` chars on the last whole-word boundary (no trailing fragment).
const wordTrunc = (s: string, max: number): string => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > 0 ? cut.slice(0, sp) : cut).trimEnd();
};

// SEO <title>: "[Title] ([Year]) - [Genre] Movie | TV Nightly", kept ≤60 chars.
// Over budget, we shed the genre descriptor first, then word-truncate the title,
// before ever sacrificing the year or the brand suffix.
const movieTitleTag = (movie: MovieRow, genres: string[]): string => {
  const brand = " | TV Nightly";
  const year = movie.year ? ` (${movie.year})` : "";
  const genreLabel = genres.slice(0, 2).join(" ");
  const withGenre = `${movie.title}${year} - ${genreLabel ? `${genreLabel} ` : ""}Movie${brand}`;
  if (withGenre.length <= 60) return withGenre;
  const noGenre = `${movie.title}${year}${brand}`;
  if (noGenre.length <= 60) return noGenre;
  const room = 60 - year.length - brand.length - 1; // 1 char for the ellipsis
  return `${movie.title.slice(0, Math.max(1, room)).trimEnd()}…${year}${brand}`;
};

// SEO meta description: "Watch [Title] ([Year]). [plot]. Directed by [Dir].
// Starring [A], [B]." — unique per film, ≤160 chars. The (unique, high-value)
// director + lead-cast credits are always kept; the plot is word-truncated to
// whatever budget remains, so even overview-less catalog films get a real line.
const movieDescriptionTag = (
  movie: MovieRow,
  directors: { name: string }[],
  cast: { name: string }[],
): string => {
  const year = movie.year ? ` (${movie.year})` : "";
  const head = `Watch ${movie.title}${year}.`;
  const dir = directors[0] ? `Directed by ${directors[0].name}.` : "";
  const leads = cast.slice(0, 2).map((p) => p.name);
  const starring = leads.length ? `Starring ${leads.join(", ")}.` : "";
  const tail = [dir, starring].filter(Boolean).join(" ");
  const overhead = head.length + (tail ? tail.length + 1 : 0) + 1; // +spaces
  const plotBudget = 160 - overhead;
  // Fill the plot slot with as many WHOLE sentences as fit (so it reads cleanly
  // before "Directed by …"); if not even one fits, word-truncate the first and
  // end on an ellipsis rather than running a fragment into the credits.
  const overview = (movie.overview ?? "").trim().replace(/\s+/g, " ");
  let plot = "";
  if (overview && plotBudget > 0) {
    for (const s of overview.match(/[^.!?]+[.!?]+/g) ?? [overview]) {
      const cand = plot ? `${plot} ${s.trim()}` : s.trim();
      if (cand.length <= plotBudget) plot = cand;
      else break;
    }
    if (!plot) plot = `${wordTrunc(overview, Math.max(0, plotBudget - 1)).replace(/[,.;:!?]+$/, "")}…`;
  }
  const desc = [head, plot, tail].filter(Boolean).join(" ").trim();
  return desc.length > 160 ? wordTrunc(desc, 160) : desc;
};

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

// Retired as a standalone page — upcoming films now live in the unified
// premieres hub (TV + Movie premieres together). Existing links 301 there.
app.get("/movies/upcoming", (c) => c.redirect("/premieres", 301));

// ------------------------------------------------------------- compare

app.get("/movies", async (c) => {
  // "Popular" should be what's popular *now* — lead with live TMDB (rating-floored,
  // like the homepage rail), then fill from the D1 mirror, deduped by tmdb id, so
  // the page reflects the live catalog rather than only the engaged subset.
  const key = c.env.TMDB_API_KEY;
  const live = key
    ? (await tmdbPopular(key, "movie")).filter((h) => h.rating != null && h.rating >= 7).map(toMovieRow)
    : [];
  const d1 = (
    await c.env.DB.prepare("SELECT * FROM movies WHERE rating >= 7 ORDER BY popularity DESC LIMIT 48").all<MovieRow>()
  ).results;
  const seen = new Set(live.map((m) => m.tmdb_id).filter(Boolean));
  const results = [...live, ...d1.filter((m) => !m.tmdb_id || !seen.has(m.tmdb_id))].slice(0, 48);
  const region = visitorRegion(c);
  const [bestArt, ordersArt, compareArt, lovedArt] = await loadMoviesHubDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    results,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
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
                <a class="chev-after" href="/premieres?tab=movies">
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
                      alt={`${m.title} poster`}
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
                    {m.overview ? <span class="wo-synopsis">{m.overview}</span> : null}
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
                      <span class="rating"><IconStar class="rating-star" />{m.rating.toFixed(1)}</span>
                    ) : null}
                    {m.runtime ? (
                      <span class="wo-mins">{fmtRuntime(m.runtime)}</span>
                    ) : m.votes ? (
                      <span class="wo-mins">{fmtVotes(m.votes)} votes</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <KeepExploring
          cards={[
            {
              icon: "Charts",
              title: "Best movies, ranked",
              desc: "The highest-rated films we track — a thousand votes minimum, no flukes.",
              href: "/movies/best",
              backdrop: bestArt,
            },
            {
              icon: "Guides",
              title: "Watch every saga in order",
              desc: "Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked.",
              href: "/watch-orders",
              backdrop: ordersArt,
            },
            {
              icon: "Compare",
              title: "Compare two movies",
              desc: "Ratings, runtimes, and streaming — head-to-head on one page.",
              href: "/movies/compare",
              backdrop: compareArt,
            },
            {
              icon: "Community",
              title: "Loved by this community",
              desc: "The chart built from real one-tap reader verdicts.",
              href: "/loved",
              backdrop: lovedArt,
            },
          ]}
        />
      </article>
    </Layout>,
  );
});

async function bestMoviesChart(c: AppContext, genreSlug?: string) {
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  const { filters, redirect } = resolveChartPage(c, "movie", movieGenres, genreSlug);
  if (redirect) return redirect;
  const genre = filters.genre;

  const results = await fetchMovieChartResults(c, filters);
  const region = visitorRegion(c);

  // the chart opens on its own #1 — full TMDB row (imdb bridge) + backdrop + trailer
  const top = results[0] ?? null;
  const topMovie = top ? (await resolveMovie(c, top.slug))?.movie ?? top : null;
  const topBundleId =
    topMovie && c.env.TMDB_API_KEY
      ? await resolveMovieBundleId(c, topMovie)
      : topMovie
        ? movieBundleId(topMovie)
        : "";
  let art: { x1: string; x2?: string } | null = null;
  let topTrailer: { key: string; name: string } | null = null;
  if (topMovie && c.env.TMDB_API_KEY && topBundleId) {
    [art, topTrailer] = await Promise.all([
      tmdbMovieBackdrop(c.env.TMDB_API_KEY, topBundleId),
      movieSpotlightTrailer(c.env.TMDB_API_KEY, topBundleId),
    ]);
  }
  if (!art && topMovie?.poster_url) {
    art = { x1: topMovie.poster_url.replace("/t/p/w342/", "/t/p/w780/") };
  }
  const moviePoster = (m: MovieRow) => {
    if (!m.poster_url) return null;
    const hi = m.poster_url.replace("/t/p/w342/", "/t/p/w500/");
    return { src: m.poster_url, srcset: `${m.poster_url} 1x, ${hi} 2x` };
  };

  const heading = genre
    ? `The best ${genre.toLowerCase()} movies, ranked`
    : filters.year
      ? `The best movies of ${filters.year}, ranked`
      : "The best movies of all time, ranked";
  const year = new Date().getFullYear();
  const gSlug = genre ? slugifyName(genre) : "";
  const sidebar = c.get("siteSidebar");
  const [yearArt, underratedArt, ordersArt, lovedArt] = await loadMovieChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    top,
  );
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${heading} | TV Nightly`}
      description={`${heading} by viewer rating${results[0] ? `, from ${results[0].title} down` : ""}.`}
      canonical={`${origin(c)}${chartUrl("movie", filters)}`}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : art?.x1 ? { x1: art.x1, x2: art.x1 } : undefined}
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
      <ChartHeroHead
        eyebrow="The chart"
        title={heading}
        intro="Ranked by viewer rating — a thousand-vote minimum, so nothing here is a fluke."
      >
        <a class="verdict-btn" href="/what-to-watch?type=movie">
          Pick me a movie
        </a>
        <a class="btn-ghost" href="/premieres?tab=movies">
          What&apos;s coming next
        </a>
      </ChartHeroHead>

      <div class="home-main-grid">
        <div class="home-col">
      {topMovie ? (
        <div class="chart-hero-spotlight-wrap">
          <ChartSpotlight
            featured={{
              href: `/movie/${topMovie.slug}`,
              name: topMovie.title,
              poster: moviePoster(topMovie),
              trailer: topTrailer,
              fallbackBackdrop: art,
              rating: topMovie.rating,
            }}
          />
        </div>
      ) : null}
      <ChartFilterBar kind="movie" filters={filters} genres={movieGenres} />
      {results.length === 0 ? (
        <p class="muted">No rated movies for that filter yet.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one movie matches these filters — it&apos;s featured above.</p>
      ) : (
      <ChartRankGrid
        more={{
          kind: "movie",
          filters,
          genreSlug: genreSlug,
          total: results.length,
        }}
      >
        {results.slice(1, CHART_PAGE_SIZE + 1).map((m, i) => (
          <ChartRankCard {...movieChartRankItem(m, i + 2)} />
        ))}
      </ChartRankGrid>
      )}
      <section class="hub-sec">
        <h2>Cut the chart by genre</h2>
        <div class="footer-picks">
          {movieGenres
            .filter((g) => g !== genre)
            .map((g) => (
              <a class="footer-card" href={chartBasePath("movie", g)}>
                {g}
              </a>
            ))}
          {genre ? (
            <a class="footer-card" href="/movies/best">
              All genres
            </a>
          ) : null}
        </div>
      </section>
      <KeepExploring
        cards={[
          {
            icon: "Watch guide",
            title: genre ? `Best ${genre.toLowerCase()} movies of ${year}` : `Best movies of ${year}`,
            desc: "The acclaimed films to watch this year, newest greats first.",
            href: genre ? `/movies/best/${year}/${gSlug}` : `/movies/best/${year}`,
            backdrop: yearArt,
          },
          {
            icon: "Hidden gems",
            title: genre ? `Underrated ${genre.toLowerCase()} movies` : "Underrated movies",
            desc: "High ratings, low profile — the great films most people have missed.",
            href: genre ? `/movies/underrated/${gSlug}` : "/movies/underrated",
            backdrop: underratedArt,
          },
          {
            icon: "Guides",
            title: "Watch every saga in order",
            desc: "Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked.",
            href: "/watch-orders",
            backdrop: ordersArt,
          },
          {
            icon: "Community",
            title: "Loved by this community",
            desc: "The chart built from real one-tap reader verdicts.",
            href: "/loved",
            backdrop: lovedArt,
          },
        ]}
      />
        </div>
        <HomeSidebarRail
          trailers={sidebar?.trailers ?? []}
          topSeries={sidebar?.topSeries ?? []}
          topMovies={sidebar?.topMovies ?? []}
        />
      </div>
    </Layout>,
  );
}

app.get("/movies/best", (c) => bestMoviesChart(c));

// 1200×630 branded card for link unfurls.
app.get("/movie/:slug/og.png", async (c) => {
  const slug = c.req.param("slug");
  return servePng(c, `movie/${slug}`, async () => {
    const r = await resolveMovie(c, slug);
    if (!r) return null;
    const movie = r.movie;
    const bd =
      c.env.TMDB_API_KEY && movie.imdb_id
        ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, movie.imdb_id)
        : null;
    const [backdropUri, posterUri] = await Promise.all([
      posterDataUri(bd?.x1 ?? null),
      posterDataUri(movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? null),
    ]);
    const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
    const { names } = providersFor(movie, "US");
    const meta = [genres.slice(0, 3).join(" · "), movie.year ? String(movie.year) : ""]
      .filter(Boolean)
      .join(" · ");
    return buildOgCard({
      kicker: "Movie",
      title: movie.title,
      meta: meta || null,
      rating: movie.rating,
      note: names.length ? `Streaming on ${names[0].trim()}` : null,
      posterUri,
      backdropUri,
    });
  });
});

app.get("/movie/:slug", async (c) => {
  const slug = c.req.param("slug");
  let movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?").bind(slug).first<MovieRow>();
  let ratingRef: string;
  if (movie) {
    ratingRef = movie.imdb_id;
  } else {
    // hybrid: build the SAME page live from TMDB for a film not in the mirror
    const built = await tmdbMovieData(c, slug);
    if (!built) return c.notFound();
    movie = built.movie;
    ratingRef = `t${built.tmdbId}`;
  }
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const region = visitorRegion(c);
  const [stat, aggRating, raterCount, d1Similar, communityCounts] = await Promise.all([
    titleStat(c.env.DB, "movie", ratingRef),
    aggregateRatingLd(c.env.DB, "movie", ratingRef),
    titleRaterCount(c.env.DB, "movie", ratingRef),
    similarMovies(c.env.DB, movie),
    c.env.DB
      .prepare("SELECT loved, liked, meh, awful FROM title_ratings WHERE kind = ? AND ref = ?")
      .bind("movie", ratingRef)
      .first<{ loved: number; liked: number; meh: number; awful: number }>(),
  ]);
  let simMovies = d1Similar;
  if (!simMovies.length && movie.tmdb_id && c.env.TMDB_API_KEY) {
    simMovies = (await tmdbRecommendations(c.env.TMDB_API_KEY, "movie", movie.tmdb_id))
      .slice(0, 6)
      .map(toMovieRow);
  }
  const movieFranchise = franchiseOfMovie(movie);

  // the movie's real designed backdrop + billed cast (TMDB takes the IMDb id
  // directly; both ride one edge-cached bundle). Blurred poster = fallback.
  // `facts` (original title/language/studio/trailer) rides the SAME cached
  // bundle, so enriching the Movie JSON-LD costs no extra round-trip. A live
  // film without an IMDb id carries a synthetic "tmdb-<id>" — look it up by its
  // tmdb id instead so cast/backdrop don't silently come up empty.
  const bundleId = await resolveMovieBundleId(c, movie);
  const [backdrop, cast, crew, facts, media] = c.env.TMDB_API_KEY
    ? await Promise.all([
        tmdbMovieBackdrop(c.env.TMDB_API_KEY, bundleId),
        tmdbMovieCast(c.env.TMDB_API_KEY, bundleId, 8),
        tmdbMovieCrew(c.env.TMDB_API_KEY, bundleId, 12),
        tmdbMovieFacts(c.env.TMDB_API_KEY, bundleId),
        tmdbMovieMedia(c.env.TMDB_API_KEY, bundleId),
      ])
    : [null, [], [], null, null];
  // the director is the headline credit on a film — pulled from the same cached
  // bundle as the cast, linked to a person page where we track them
  const directors = crew.filter((p) => p.jobs.split(" · ").includes("Director"));
  const directorLinks = directors.length
    ? await crewLinkMap(c.env.DB, directors)
    : new Map<number, number>();
  const writers = crew
    .filter((p) => p.jobs.split(" · ").some((j) => j === "Writer" || j === "Screenplay"))
    .slice(0, 3);
  const writerLinks = writers.length ? await crewLinkMap(c.env.DB, writers) : new Map<number, number>();
  const prov = providersFor(movie, region);
  const watchProv = heroWatchProvider(prov.names, movie.title, prov.region, "movie");
  let trailerVid =
    facts?.trailer ??
    media?.videos.find((v) => v.type === "Trailer") ??
    media?.videos[0] ??
    null;
  if (!trailerVid && c.env.TMDB_API_KEY && bundleId) {
    const spotlight = await movieSpotlightTrailer(c.env.TMDB_API_KEY, bundleId);
    // the spotlight helper carries no publish date; the hero only needs key/name
    if (spotlight) trailerVid = { ...spotlight, published: null };
  }
  const highlights = (media?.videos ?? [])
    .filter((v) => v.key !== trailerVid?.key)
    .slice(0, 14);
  const galleryPhotos = mergeGalleryImages(media?.posters ?? [], media?.backdrops ?? [], 12);
  const galleryVideos = (media?.videos ?? []).slice(0, 12);
  // mirror the show hero: a real backdrop leads; otherwise the poster itself
  // feeds the frame-hero wash (not an ambient blur), so no-backdrop movies read
  // like no-backdrop shows
  // the rivals' backdrops for the head-to-head split cards (edge-cached)
  const [rivalBackdrops] = await Promise.all([
    c.env.TMDB_API_KEY
      ? Promise.all(
          simMovies.slice(0, 3).map((m) => tmdbMovieBackdrop(c.env.TMDB_API_KEY!, m.imdb_id)),
        )
      : Promise.resolve([] as Awaited<ReturnType<typeof tmdbMovieBackdrop>>[]),
  ]);
  const sidebar = c.get("siteSidebar");

  const exploreHub = hubForGenres(genres, movie.year);
  const exploreArts = c.env.TMDB_API_KEY
    ? await fetchMovieExploreArts(c.env.DB, c.env.TMDB_API_KEY, {
        movieBackdrop: backdrop,
        franchiseSlug: movieFranchise?.slug ?? null,
        genres: genres.slice(0, 2),
        provider: prov.names[0] ?? null,
        hubSlug: exploreHub?.slug ?? null,
      })
    : {
        franchise: null,
        compare: backdrop,
        genres: [],
        provider: null,
        hub: null,
      };
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

  // Build the Movie node AFTER the cast/crew bundle resolves so director, actor,
  // genre and runtime are all available (they aren't earlier). aggregateRating is
  // sourced ONLY from our own community verdicts (visible in the body), never
  // republished TMDB votes — publishing third-party ratings as structured data
  // risks a manual action; aggregateRatingLd returns null below a rater threshold.
  const site = origin(c);
  const directorNodes = directors.map((d) => {
    const pid = directorLinks.get(d.id) ?? (d.id ? TMDB_PERSON_OFFSET + d.id : undefined);
    return {
      "@type": "Person",
      name: d.name,
      ...(pid ? { url: `${site}/person/${slugifyName(d.name)}-${pid}` } : {}),
    };
  });
  const actorNodes = cast.slice(0, 8).map((p) => {
    const pid = linkable.get(p.name.toLowerCase()) ?? (p.id ? TMDB_PERSON_OFFSET + p.id : undefined);
    return {
      "@type": "Person",
      name: p.name,
      ...(pid ? { url: `${site}/person/${slugifyName(p.name)}-${pid}` } : {}),
    };
  });
  // ISO 8601 runtime: PT[H]H[M]M (e.g. 138 min → PT2H18M), per schema.org.
  const isoDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}` || "PT0M";
  };
  // original-language title, only when it actually differs from our display title
  const altName =
    facts?.originalTitle && facts.originalTitle.toLowerCase() !== movie.title.toLowerCase()
      ? facts.originalTitle
      : null;
  const trailerNode = facts?.trailer
    ? {
        "@type": "VideoObject",
        name: `${movie.title} — Official Trailer`,
        description: `Official trailer for ${movie.title}.`,
        thumbnailUrl: `https://img.youtube.com/vi/${facts.trailer.key}/hqdefault.jpg`,
        embedUrl: `https://www.youtube-nocookie.com/embed/${facts.trailer.key}`,
        ...(facts.trailer.published ? { uploadDate: facts.trailer.published } : {}),
      }
    : null;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Movie",
    name: movie.title,
    ...(altName ? { alternateName: altName } : {}),
    url: `${site}/movie/${movie.slug}`,
    ...(movie.poster_url ? { image: movie.poster_url } : {}),
    ...(movie.overview ? { description: movie.overview } : {}),
    ...(movie.release_date ? { datePublished: movie.release_date } : {}),
    ...(movie.runtime ? { duration: isoDuration(movie.runtime) } : {}),
    ...(facts?.language ? { inLanguage: facts.language } : {}),
    ...(genres.length ? { genre: genres } : {}),
    ...(directorNodes.length ? { director: directorNodes } : {}),
    ...(actorNodes.length ? { actor: actorNodes } : {}),
    ...(facts?.studio ? { productionCompany: { "@type": "Organization", name: facts.studio } } : {}),
    ...(aggRating ? { aggregateRating: aggRating } : {}),
    ...(trailerNode ? { trailer: trailerNode } : {}),
  };
  const breadcrumb = breadcrumbTrail([
    { name: "TV Nightly", url: site },
    { name: "Movies", url: `${site}/movies` },
    { name: movie.title, url: `${site}/movie/${movie.slug}` },
  ]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title={movieTitleTag(movie, genres)}
      description={movieDescriptionTag(movie, directors, cast)}
      canonical={canonical(c)}
      ogType="video.movie"
      ogTitle={`${movie.title}${movie.year ? ` (${movie.year})` : ""}`}
      ogImage={`${canonical(c)}/og.png`}
      ogImageLarge
      ogImageAlt={`${movie.title} — TV Nightly`}
      preloadImage={backdrop?.x2 ? { x1: backdrop.x1, x2: backdrop.x2 } : undefined}
      ld={[ld, breadcrumb]}
      scripts={["/js/share.js"]}
    >
      <article class="show-hub">
        <DetailHero
          kind="movie"
          title={movie.title}
          yearLabel={movie.year ? ` (${movie.year})` : null}
          shareTitle={`${movie.title}${movie.year ? ` (${movie.year})` : ""} on TV Nightly`}
          shareUrl={canonical(c)}
          typeLabel="Movie"
          typeHref="/movies/best"
          tmdbScore={tmdbRingScore(movie.rating)}
          communityScore={communityRingScore(communityCounts ?? null)}
          poster={
            movie.poster_url ? (
              <img
                class="poster"
                src={movie.poster_url}
                srcset={`${movie.poster_url} 1x, ${movie.poster_url.replace("/w342/", "/w780/")} 2x`}
                alt={`${movie.title}${movie.year ? ` (${movie.year})` : ""} movie poster`}
                width="200"
                height="300"
                fetchpriority="high"
                decoding="async"
              />
            ) : (
              <div class="poster card-fallback">{movie.title}</div>
            )
          }
          trailer={
            trailerVid
              ? { key: trailerVid.key, name: trailerVid.name, type: "Trailer" }
              : null
          }
          highlights={highlights}
          starring={cast.slice(0, 4).map((p) => {
            const id =
              linkable.get(p.name.toLowerCase()) ?? (p.id ? TMDB_PERSON_OFFSET + p.id : null);
            return {
              name: p.name,
              href: id ? `/person/${slugifyName(p.name)}-${id}` : null,
            };
          })}
          directors={directors.map((d) => {
            const pid = directorLinks.get(d.id) ?? (d.id ? TMDB_PERSON_OFFSET + d.id : null);
            return {
              name: d.name,
              href: pid ? `/person/${slugifyName(d.name)}-${pid}` : null,
            };
          })}
          writers={writers.map((p) => {
            const pid = writerLinks.get(p.id) ?? (p.id ? TMDB_PERSON_OFFSET + p.id : null);
            return {
              name: p.name,
              href: pid ? `/person/${slugifyName(p.name)}-${pid}` : null,
            };
          })}
          watchProvider={
            watchProv
              ? {
                  ...watchProv,
                  href: watchProv.href ?? `/movie/${movie.slug}/where-to-watch`,
                }
              : null
          }
          metaBadge={isNewYear(movie.year) ? "New" : null}
          genres={genres.slice(0, 4).map((g) => ({
            name: g,
            href: `/genre/${slugifyName(g)}/movies`,
          }))}
          metaExtra={movie.runtime ? fmtRuntime(movie.runtime) : null}
          plot={movie.overview ?? null}
          rateKind="movie"
          rateRef={ratingRef}
          rateStat={stat}
          mediaHref={`/movie/${movie.slug}/media`}
          fallbackBackdrop={backdrop}
        />
        <MovieTabs slug={movie.slug} current="overview" />
        <div class="home-main-grid">
          <div class="home-col">
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
                const id =
                  linkable.get(p.name.toLowerCase()) ??
                  (p.id ? TMDB_PERSON_OFFSET + p.id : null);
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
        {galleryPhotos.length ? (
          <PhotoGallery
            entityName={movie.title}
            mediaHref={`/movie/${movie.slug}/media`}
            images={galleryPhotos}
          />
        ) : null}
        {galleryVideos.length ? (
          <VideoGallery
            mediaHref={`/movie/${movie.slug}/media`}
            videos={galleryVideos}
          />
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
                    backdrop={exploreArts.franchise}
                  />
                ) : null}
                <ExploreCard
                  icon="Matchup"
                  title="Compare with another movie"
                  desc="Two films' ratings, runtimes and streaming, side by side."
                  href={`/movie/${movie.slug}/compare`}
                  backdrop={exploreArts.compare}
                />
                {genres.slice(0, 2).map((g, i) => (
                  <ExploreCard
                    icon="Genre"
                    title={`Best ${g.toLowerCase()} films & shows`}
                    desc={`The top of the ${g.toLowerCase()} pile, across both mediums.`}
                    href={`/genre/${slugifyName(g)}`}
                    backdrop={exploreArts.genres[i] ?? null}
                  />
                ))}
                {prov0 ? (
                  <ExploreCard
                    icon="Picker"
                    title={`Spin a ${prov0} movie`}
                    desc="Random great pick from the same service you already pay for."
                    href={`/what-to-watch?type=movie&service=${encodeURIComponent(prov0)}`}
                    backdrop={exploreArts.provider}
                  />
                ) : null}
                {hub ? (
                  <ExploreCard
                    icon="Fandom hub"
                    title={`The ${hub.name.toLowerCase()} hub`}
                    desc="The whole fandom on one bookmarkable page — rankings, premieres, what's new."
                    href={`/${hub.slug}`}
                    backdrop={exploreArts.hub}
                  />
                ) : null}
              </div>
            </section>
          );
        })()}
          </div>
          <HomeSidebarRail
            trailers={sidebar?.trailers ?? []}
            topSeries={sidebar?.topSeries ?? []}
            topMovies={sidebar?.topMovies ?? []}
          />
        </div>
      </article>
    </Layout>,
  );
});

// "Movies like X" gets the full dossier on its own page, same as shows.
app.get("/movie/:slug/similar", async (c) => {
  const resolved = await resolveMovie(c, c.req.param("slug"));
  if (!resolved) return c.notFound();
  const movie = resolved.movie;
  let simMovies = await similarMovies(c.env.DB, movie, 18);
  // live-only / genre-less films get nothing from D1 — fall back to TMDB recs
  if (!simMovies.length && movie.tmdb_id && c.env.TMDB_API_KEY) {
    simMovies = (await tmdbRecommendations(c.env.TMDB_API_KEY, "movie", movie.tmdb_id))
      .slice(0, 18)
      .map(toMovieRow);
  }
  if (!simMovies.length) return c.redirect(`/movie/${movie.slug}`, 302);
  const movieFranchise = franchiseOfMovie(movie);
  const sidebar = c.get("siteSidebar");
  const region = visitorRegion(c);
  const site = origin(c);
  const base = `/movie/${movie.slug}/similar`;

  const keepGoingArts = await loadMovieKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    movie,
    simMovies[0]?.imdb_id,
  );
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
    <Layout c={c}
      sidebarInline
      title={`Movies like ${movie.title} — ${simMovies.length} similar movies ranked | TV Nightly`}
      description={`The ${simMovies.length} closest matches to ${movie.title}: ${simMovies
        .slice(0, 4)
        .map((m) => m.title)
        .join(", ")} and more, ranked by match strength with ratings and where to stream.`}
      canonical={`${site}${base}`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={ld}
      scripts={["/js/share.js"]}
    >
      <article class="show-hub">
        <header class="detail-hero media-hero">
          <div class="detail-head">
            <div class="detail-side">{MovieHeroPoster(movie)}</div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/movie/${movie.slug}`}>{movie.title}</a>
                <span class="sep">·</span> More like this
              </p>
              <div class="detail-title-row">
                <h1>Movies like {movie.title}</h1>
                <ShareBar url={`${site}${base}`} title={`Movies like ${movie.title}`} />
              </div>
              <p class="summary">
                The {simMovies.length} closest matches on shared genres, ranked by match strength
                and rating — with where each is streaming in your region.
              </p>
            </div>
          </div>
        </header>
        <MovieTabs slug={movie.slug} current="similar" />
        <div class="home-main-grid">
          <div class="home-col">
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
        <KeepGoing
          cards={[
            {
              icon: "Overview",
              title: `${movie.title} overview`,
              desc: "Cast, ratings, trailers and the full film dossier.",
              href: `/movie/${movie.slug}`,
              backdrop: keepGoingArts.overview,
            },
            {
              icon: "Charts",
              title: "Best movies",
              desc: "The highest-rated films we track, ranked by score.",
              href: "/movies/best",
              backdrop: keepGoingArts.bestMovies,
            },
            {
              icon: "Picker",
              title: "What should I watch tonight?",
              desc: "Filter by mood, service and runtime — pick in seconds.",
              href: "/what-to-watch?type=movie",
              backdrop: keepGoingArts.tonight,
            },
          ]}
        />
          </div>
          <HomeSidebarRail
            trailers={sidebar?.trailers ?? []}
            topSeries={sidebar?.topSeries ?? []}
            topMovies={sidebar?.topMovies ?? []}
          />
        </div>
      </article>
    </Layout>,
  );
});

// Media: the movie's artwork and YouTube trailers, one edge-cached call.
app.get("/movie/:slug/media", async (c) => {
  const resolved = await resolveMovie(c, c.req.param("slug"));
  if (!resolved) return c.notFound();
  const movie = resolved.movie;
  const movieFranchise = franchiseOfMovie(movie);
  const bundleId = await resolveMovieBundleId(c, movie);
  const media = c.env.TMDB_API_KEY
    ? await tmdbMovieMedia(c.env.TMDB_API_KEY, bundleId)
    : null;
  const base = `/movie/${movie.slug}/media`;
  const site = origin(c);

  const trailer = media?.videos.find((v) => v.type === "Trailer") ?? media?.videos[0] ?? null;
  const clips = (media?.videos ?? []).filter((v) => v !== trailer).slice(0, 9);
  const backdrops = (media?.backdrops ?? []).slice(0, 12);
  const posters = (media?.posters ?? []).slice(0, 12);
  const hasAny = Boolean(trailer || clips.length || backdrops.length || posters.length);

  let simMovies = await similarMovies(c.env.DB, movie, 6);
  if (!simMovies.length && movie.tmdb_id && c.env.TMDB_API_KEY) {
    simMovies = (await tmdbRecommendations(c.env.TMDB_API_KEY, "movie", movie.tmdb_id))
      .slice(0, 6)
      .map(toMovieRow);
  }
  const region = visitorRegion(c);
  const keepGoingArts = await loadMovieKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    movie,
    simMovies[0]?.imdb_id,
  );
  const sidebar = c.get("siteSidebar");

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
    <Layout c={c}
      sidebarInline
      title={`${movie.title} — trailer, posters & artwork | TV Nightly`}
      description={`Every trailer, clip, poster and backdrop for ${movie.title} in one place.`}
      canonical={`${site}${base}`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={ld}
      scripts={["/js/media-lightbox.js"]}
    >
      <article class="show-hub">
        <header class="detail-hero media-hero">
          <div class="detail-head">
            <div class="detail-side">{MovieHeroPoster(movie)}</div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/movie/${movie.slug}`}>{movie.title}</a>
                <span class="sep">·</span> Media
              </p>
              <h1>{movie.title} — trailers & artwork</h1>
              <p class="summary">
                {hasAny
                  ? `The official trailers, clips, posters and backdrops for ${movie.title}.`
                  : `No media available for ${movie.title} yet.`}
              </p>
            </div>
          </div>
        </header>
        <MovieTabs slug={movie.slug} current="media" />
        <div class="home-main-grid">
          <div class="home-col">
        {trailer ? (
          <section>
            <h2>Trailer</h2>
            <a
              class="media-player media-player-cta"
              href={`https://www.youtube.com/watch?v=${trailer.key}`}
              target="_blank"
              rel="noopener"
              data-video-key={trailer.key}
              data-video-name={trailer.name}
              aria-label={`Play trailer: ${trailer.name}`}
            >
              <img
                src={`https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <IconPlay size={56} />
            </a>
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
                  data-video-key={v.key}
                  data-video-name={v.name}
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
                    alt={`${movie.title} backdrop ${i + 1}`}
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
                    alt={`${movie.title} poster ${i + 1}`}
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
        {simMovies.length ? (
          <section>
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
        <KeepGoing
          cards={[
            {
              icon: "Overview",
              title: `${movie.title} overview`,
              desc: "Cast, ratings, trailers and the full film dossier.",
              href: `/movie/${movie.slug}`,
              backdrop: keepGoingArts.overview,
            },
            {
              icon: "Matchup",
              title: `Movies like ${movie.title}`,
              desc: "The closest matches, ranked by overlap and rating.",
              href: `/movie/${movie.slug}/similar`,
              backdrop: keepGoingArts.similar,
            },
            {
              icon: "Charts",
              title: "Best movies",
              desc: "The highest-rated films we track, ranked by score.",
              href: "/movies/best",
              backdrop: keepGoingArts.bestMovies,
            },
          ]}
        />
          </div>
          <HomeSidebarRail
            trailers={sidebar?.trailers ?? []}
            topSeries={sidebar?.topSeries ?? []}
            topMovies={sidebar?.topMovies ?? []}
          />
        </div>
      </article>
    </Layout>,
  );
});

// Full billed cast, linked into our person pages where we track the actor.
app.get("/movie/:slug/cast", async (c) => {
  const resolved = await resolveMovie(c, c.req.param("slug"));
  if (!resolved) return c.notFound();
  const movie = resolved.movie;
  const movieFranchise = franchiseOfMovie(movie);
  // a live film without an IMDb id carries a synthetic "tmdb-<id>" — look it up
  // by tmdb id so the full cast doesn't come up empty
  const bundleId = /^tt\d+$/.test(movie.imdb_id)
    ? movie.imdb_id
    : movie.tmdb_id
      ? String(movie.tmdb_id)
      : movie.imdb_id;
  const [cast, crew] = c.env.TMDB_API_KEY
    ? await Promise.all([
        tmdbMovieCast(c.env.TMDB_API_KEY, bundleId, 24),
        tmdbMovieCrew(c.env.TMDB_API_KEY, bundleId, 12),
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
  let simMovies = await similarMovies(c.env.DB, movie, 6);
  if (!simMovies.length && movie.tmdb_id && c.env.TMDB_API_KEY) {
    simMovies = (await tmdbRecommendations(c.env.TMDB_API_KEY, "movie", movie.tmdb_id))
      .slice(0, 6)
      .map(toMovieRow);
  }
  const region = visitorRegion(c);
  const keepGoingArts = await loadMovieKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    movie,
    simMovies[0]?.imdb_id,
  );
  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
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
      ld={[
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Movies", url: `${site}/movies` },
          { name: movie.title, url: `${site}/movie/${movie.slug}` },
          { name: "Cast", url: `${site}/movie/${movie.slug}/cast` },
        ]),
      ]}
    >
      <h1>
        Cast of <a href={`/movie/${movie.slug}`}>{movie.title}</a>
      </h1>
      <MovieTabs slug={movie.slug} current="cast" />
      <div class="home-main-grid">
        <div class="home-col">
      {cast.length ? (
        <>
          <p class="muted">{cast.length} credited, in billing order.</p>
          <div class="cast-grid">
            {cast.map((p) => {
              const id =
                linkable.get(p.name.toLowerCase()) ??
                (p.id ? TMDB_PERSON_OFFSET + p.id : null);
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
              const pid = crewLinks.get(p.id) ?? (p.id ? TMDB_PERSON_OFFSET + p.id : null);
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
      {simMovies.length ? (
        <section>
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
      <KeepGoing
        cards={[
          {
            icon: "Overview",
            title: `${movie.title} overview`,
            desc: "Cast, ratings, trailers and the full film dossier.",
            href: `/movie/${movie.slug}`,
            backdrop: keepGoingArts.overview,
          },
          {
            icon: "Matchup",
            title: `Movies like ${movie.title}`,
            desc: "The closest matches, ranked by overlap and rating.",
            href: `/movie/${movie.slug}/similar`,
            backdrop: keepGoingArts.similar,
          },
          {
            icon: "Charts",
            title: "Best movies",
            desc: "The highest-rated films we track, ranked by score.",
            href: "/movies/best",
            backdrop: keepGoingArts.bestMovies,
          },
          {
            icon: "Picker",
            title: "What should I watch tonight?",
            desc: "Filter by mood, service and runtime — pick in seconds.",
            href: "/what-to-watch?type=movie",
            backdrop: keepGoingArts.tonight,
          },
        ]}
      />
        </div>
        <HomeSidebarRail
          trailers={sidebar?.trailers ?? []}
          topSeries={sidebar?.topSeries ?? []}
          topMovies={sidebar?.topMovies ?? []}
        />
      </div>
    </Layout>,
  );
});

// Where to watch, region by region — the movie counterpart of the show page.
app.get("/movie/:slug/where-to-watch", async (c) => {
  const resolved = await resolveMovie(c, c.req.param("slug"));
  if (!resolved) return c.notFound();
  const movie = resolved.movie;
  const movieFranchise = franchiseOfMovie(movie);
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
  const heroFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : movie.poster_url
      ? heroBg(movie.poster_url.replace("/w342/", "/w780/"))
      : null;
  const site = origin(c);
  const similarPick = await similarMovies(c.env.DB, movie, 1);
  const keepGoingArts = await loadMovieKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    movie,
    similarPick[0]?.imdb_id,
  );
  const sidebar = c.get("siteSidebar");
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Where to watch ${movie.title} — streaming options | TV Nightly`}
      description={
        names.length
          ? `${movie.title} is streaming on ${names.slice(0, 4).join(", ")} in ${region}. Every service and region.`
          : `Where ${movie.title} is streaming, region by region.`
      }
      canonical={`${site}${base}`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={
        names.length
          ? [
              faqLd([
                {
                  q: `Where can I watch ${movie.title}?`,
                  a: `${movie.title} is streaming on ${names.slice(0, 6).join(", ")} in ${region}.`,
                },
              ]),
            ]
          : []
      }
      scripts={["/js/dropdown.js"]}
    >
      <article class={`show-hub${backdrop ? " hub-backdrop" : ""}`}>
        <header class="detail-hero frame-hero">
          {heroFrame ? <div class="hero-backdrop" style={heroFrame}></div> : null}
          <div class="detail-head">
            <div class="detail-side">{MovieHeroPoster(movie)}</div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/movie/${movie.slug}`}>{movie.title}</a>
                <span class="sep">·</span> Streaming guide
              </p>
              <h1>Where to watch {movie.title}</h1>
              <form method="get" action={base} class="region-line watch-region" data-submit-on-change>
                <FilterSelect
                  label="Showing options for"
                  name="region"
                  current={region}
                  options={regionOptions()}
                />
              </form>
            </div>
          </div>
        </header>
        <MovieTabs slug={movie.slug} current="watch" />
        <div class="home-main-grid">
          <div class="home-col">
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
        <KeepGoing
          cards={[
            {
              icon: "Overview",
              title: `${movie.title} overview`,
              desc: "Cast, ratings, trailers and the full film dossier.",
              href: `/movie/${movie.slug}`,
              backdrop: keepGoingArts.overview,
            },
            {
              icon: "Matchup",
              title: `Movies like ${movie.title}`,
              desc: "The closest matches, ranked by overlap and rating.",
              href: `/movie/${movie.slug}/similar`,
              backdrop: keepGoingArts.similar,
            },
            {
              icon: "Picker",
              title: "What should I watch tonight?",
              desc: "Filter by mood, service and runtime — pick in seconds.",
              href: "/what-to-watch?type=movie",
              backdrop: keepGoingArts.tonight,
            },
          ]}
        />
          </div>
          <HomeSidebarRail
            trailers={sidebar?.trailers ?? []}
            topSeries={sidebar?.topSeries ?? []}
            topMovies={sidebar?.topMovies ?? []}
          />
        </div>
      </article>
    </Layout>,
  );
});

app.get("/movies/compare", async (c) => {
  const db = c.env.DB;
  const resolve = async (q: string): Promise<MovieRow | null> => {
    if (!q) return null;
    return (
      (await db.prepare("SELECT * FROM movies WHERE slug = ?").bind(q).first<MovieRow>()) ??
      (await db
        .prepare(
          `SELECT * FROM movies WHERE ${foldSql("title")} LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 1`,
        )
        .bind(foldText(q))
        .first<MovieRow>())
    );
  };
  const qa = (c.req.query("a") ?? "").trim();
  const qb = (c.req.query("b") ?? "").trim();
  const [ma, mb] = await Promise.all([resolve(qa), resolve(qb)]);
  if (ma && mb && ma.slug !== mb.slug)
    return c.redirect(movieComparePathFor(ma.slug, mb.slug), 301);

  // featured matchups as versus cards — a picked film's neighbours, else the
  // most-popular films paired off (mirrors the show compare landing)
  const cmpAnchor = ma ?? mb ?? null;
  const cmpPairs = await movieMatchPairs(db, cmpAnchor);
  const cmpSides = await movieSides(c.env.TMDB_API_KEY, [...involvedMovies(cmpPairs).values()]);
  const cmpHeading = cmpAnchor ? `${cmpAnchor.title} vs…` : "Popular movie matchups";

  const tvPairs = await tvMatchPairs(db, null);
  const tvSideMap = await showSides(c.env.TMDB_API_KEY, [...involvedShows(tvPairs).values()]);

  const cmpMovies = [...involvedMovies(cmpPairs).values()];
  const movieLead = cmpAnchor ?? cmpMovies[0] ?? null;
  const movieRunner = cmpMovies[1] ?? cmpMovies[0] ?? null;
  const apiKey = c.env.TMDB_API_KEY;
  const [bestArt, lovedArt, ordersArt] = await Promise.all([
    movieLead ? movieKeepGoingBackdrop(apiKey, movieLead) : Promise.resolve(null),
    movieRunner ? movieKeepGoingBackdrop(apiKey, movieRunner) : Promise.resolve(null),
    apiKey ? franchiseArt(db, apiKey, "marvel") : Promise.resolve(null),
  ]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      title="Compare two movies — head-to-head | TV Nightly"
      description="Put two films side by side: ratings, votes, runtime and where to stream."
      canonical={`${origin(c)}/movies/compare`}
      scripts={["/js/compare-typeahead.js"]}
    >
      <header class="chart-head cmp-head">
        <p class="chart-kicker">Head to head</p>
        <h1>Compare movies</h1>
        <p class="chart-intro">
          Put two films side by side — rating, votes, runtime, and where each one streams in your
          country, on a single card.
        </p>
        <p class="cmp-xlink">
          <a class="chev-after" href="/compare">
            Comparing TV shows instead?
          </a>
        </p>
      </header>
      <form method="get" action="/movies/compare" class="picker-form compare-form" data-cmp-kind="movie">
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
        <span class="cmp-or" aria-hidden="true">vs</span>
        <label>
          Movie B <input type="search" name="b" value={qb} placeholder="Interstellar" required />
        </label>
        <button type="submit">Compare</button>
      </form>
      {(qa || qb) && (!ma || !mb) ? (
        <p class="muted">Couldn't find one of those movies — try different names.</p>
      ) : null}
      {cmpPairs.length ? (
        <section class="vsx-sec">
          <h2 class="vsx-h2">{cmpHeading}</h2>
          <div class="vs-grid">
            {cmpPairs.map(([a, b]) => (
              <VsCard
                href={movieComparePathFor(a.slug, b.slug)}
                a={cmpSides.get(a.slug)!}
                b={cmpSides.get(b.slug)!}
                cta="Side by side"
              />
            ))}
          </div>
        </section>
      ) : null}
      {tvPairs.length ? (
        <section class="vsx-sec">
          <h2 class="vsx-h2">Popular TV matchups</h2>
          <div class="vs-grid">
            {tvPairs.map(([a, b]) => (
              <VsCard
                href={comparePathFor(a.slug, b.slug)}
                a={tvSideMap.get(a.slug)!}
                b={tvSideMap.get(b.slug)!}
                cta="Side by side"
              />
            ))}
          </div>
        </section>
      ) : null}
      <KeepExploring
        cards={[
          {
            icon: "Film",
            title: "The best movies of all time",
            desc: "Every movie ranked by rating, with where to stream.",
            href: "/movies/best",
            backdrop: bestArt,
          },
          {
            icon: "Community",
            title: "Loved by this community",
            desc: "The chart built from real one-tap reader verdicts.",
            href: "/loved",
            backdrop: lovedArt,
          },
          {
            icon: "Guides",
            title: "Watch every saga in order",
            desc: "Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked.",
            href: "/watch-orders",
            backdrop: ordersArt,
          },
        ]}
      />
    </Layout>,
  );
});

app.get("/movies/:genreSlug", (c) => bestMoviesChart(c, c.req.param("genreSlug")));

// The matchup hub: every rival as a versus card, the tab's stable home.
app.get("/movie/:slug/compare", async (c) => {
  const resolved = await resolveMovie(c, c.req.param("slug"));
  if (!resolved) return c.notFound();
  const movie = resolved.movie;
  const rivals = await similarMovies(c.env.DB, movie, 24);
  if (!rivals.length) return c.redirect(`/movie/${movie.slug}`, 302);
  const movieFranchise = franchiseOfMovie(movie);
  const [backdrop, ...rivalBackdrops] = c.env.TMDB_API_KEY
    ? await Promise.all([
        tmdbMovieBackdrop(c.env.TMDB_API_KEY, movie.imdb_id),
        ...rivals.map((m) => tmdbMovieBackdrop(c.env.TMDB_API_KEY!, m.imdb_id)),
      ])
    : [null];
  const small = (u: string) => u.replace("/w1280/", "/w780/");
  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Compare ${movie.title} — head-to-head matchups | TV Nightly`}
      description={`${movie.title} against ${rivals
        .slice(0, 3)
        .map((m) => m.title)
        .join(", ")} and more — ratings, votes, runtime and streaming, side by side.`}
      canonical={`${site}/movie/${movie.slug}/compare`}
      ogImage={movie.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? undefined}
      ld={[
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Movies", url: `${site}/movies` },
          { name: movie.title, url: `${site}/movie/${movie.slug}` },
          { name: "Compare", url: `${site}/movie/${movie.slug}/compare` },
        ]),
      ]}
    >
      <h1>
        Compare <a href={`/movie/${movie.slug}`}>{movie.title}</a>
      </h1>
      <MovieTabs slug={movie.slug} current="compare" />
      <div class="home-main-grid">
        <div class="home-col">
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
        </div>
        <HomeSidebarRail
          trailers={sidebar?.trailers ?? []}
          topSeries={sidebar?.topSeries ?? []}
          topMovies={sidebar?.topMovies ?? []}
        />
      </div>
    </Layout>,
  );
});

// One matchup, settled with facts: /compare/movie/{a}-vs-{b}, alphabetical
// canonical (reversed forms 301). "-vs-" can appear inside a slug, so every
// split is tried until both sides resolve.
app.get("/compare/movie/:pair{[^/]+-vs-[^/]+}", async (c) => {
  const pair = c.req.param("pair");
  let a: MovieRow | null = null;
  let b: MovieRow | null = null;
  let idx = pair.indexOf("-vs-");
  while (idx !== -1) {
    const left = pair.slice(0, idx);
    const right = pair.slice(idx + 4);
    // resolveMovie checks D1 then falls back to live TMDB, so two live-only films
    // can be compared just like two mirrored ones
    const [l, r] = await Promise.all([resolveMovie(c, left), resolveMovie(c, right)]);
    if (l && r) {
      a = l.movie;
      b = r.movie;
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
  const key = c.env.TMDB_API_KEY;
  const sidebar = c.get("siteSidebar");

  // backdrops for the versus hero + the rival mesh, on one round trip
  const [simA, simB, bdA, bdB] = await Promise.all([
    similarMovies(c.env.DB, a, MOVIE_SIM_POOL),
    similarMovies(c.env.DB, b, MOVIE_SIM_POOL),
    key ? tmdbMovieBackdrop(key, a.imdb_id) : Promise.resolve(null),
    key ? tmdbMovieBackdrop(key, b.imdb_id) : Promise.resolve(null),
  ]);
  const artA = bdA?.x1 ?? a.poster_url ?? null;
  const artB = bdB?.x1 ?? b.poster_url ?? null;
  const bgUrl = (u: string) => u.replace(/'/g, "%27");

  // the tale of the tape: win is +1 for A, -1 for B, 0 = neutral. Only the
  // rating settles a winner; the rest are facts, not verdicts.
  const cmp = (x: number | null, y: number | null) =>
    x == null || y == null ? 0 : x > y ? 1 : x < y ? -1 : 0;
  const tape: { label: string; a: unknown; b: unknown; win: number; minor?: boolean }[] = [
    {
      label: "Rating",
      a: a.rating != null ? <><IconStar class="rating-star" /> {a.rating.toFixed(1)}</> : "—",
      b: b.rating != null ? <><IconStar class="rating-star" /> {b.rating.toFixed(1)}</> : "—",
      win: cmp(a.rating, b.rating),
    },
    {
      label: "Votes",
      a: a.votes ? a.votes.toLocaleString("en-US") : "—",
      b: b.votes ? b.votes.toLocaleString("en-US") : "—",
      win: 0,
    },
    { label: "Year", a: a.year ?? "—", b: b.year ?? "—", win: 0 },
    {
      label: "Runtime",
      a: a.runtime ? fmtRuntime(a.runtime) : "—",
      b: b.runtime ? fmtRuntime(b.runtime) : "—",
      win: 0,
    },
    {
      label: "Genres",
      a: genresOf(a).slice(0, 3).join(", ") || "—",
      b: genresOf(b).slice(0, 3).join(", ") || "—",
      win: 0,
      minor: true,
    },
    {
      label: `Streaming (${region})`,
      a: provs(a).slice(0, 3).join(", ") || "Not streaming",
      b: provs(b).slice(0, 3).join(", ") || "Not streaming",
      win: 0,
      minor: true,
    },
  ];
  const cls = (win: number, side: "a" | "b") =>
    win === 0 ? "tape-val" : (side === "a" ? win > 0 : win < 0) ? "tape-val tape-win" : "tape-val tape-lose";

  const seen = new Set([a.slug, b.slug]);
  const moreFor = (anchor: MovieRow, sims: MovieRow[]) =>
    sims
      .filter((m) => !seen.has(m.slug) && seen.add(m.slug))
      .slice(0, MOVIE_MORE_PER_ANCHOR)
      .map((m) => ({ anchor, other: m }));
  const more = [...moreFor(a, simA), ...moreFor(b, simB)];
  // posters + backdrops for the versus cards (each backdrop is 7-day cached)
  const involvedMovies = new Map<string, MovieRow>([
    [a.slug, a],
    [b.slug, b],
  ]);
  for (const { other } of more) involvedMovies.set(other.slug, other);
  const mList = [...involvedMovies.values()];
  const mBds = key
    ? await Promise.all(mList.map((m) => tmdbMovieBackdrop(key, m.imdb_id)))
    : mList.map(() => null);
  const smallBd = (u: string) => u.replace("/w1280/", "/w780/");
  const movieSides = new Map<string, VsSide>(
    mList.map((m, i) => [
      m.slug,
      { name: m.title, poster: m.poster_url, backdrop: mBds[i] ? smallBd(mBds[i]!.x1) : null },
    ]),
  );

  const [bestArt, lovedArt, ordersArt] = await Promise.all([
    movieKeepGoingBackdrop(key, a),
    movieKeepGoingBackdrop(key, b),
    key ? franchiseArt(c.env.DB, key, "marvel") : Promise.resolve(null),
  ]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${a.title} vs ${b.title} — which should you watch? | TV Nightly`}
      description={`${a.title} or ${b.title}? Ratings, votes, runtime and where to stream, side by side.`}
      canonical={`${site}${canonicalPath}`}
      ogImage={`${site}${canonicalPath}/og.png`}
      ogImageLarge
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
      <header class="vsx-hero">
        <div class="vsx-art" aria-hidden="true">
          {artA ? <span class="vsx-art-a" style={`background-image:url('${bgUrl(artA)}')`}></span> : null}
          {artB ? <span class="vsx-art-b" style={`background-image:url('${bgUrl(artB)}')`}></span> : null}
          <span class="vsx-seam"></span>
        </div>
        <h1 class="sr-only">
          {a.title} versus {b.title}
        </h1>
        <span class="vsx-badge" aria-hidden="true">VS</span>
        <a class="vsx-name vsx-name-a" href={`/movie/${a.slug}`}>{a.title}</a>
        <a class="vsx-name vsx-name-b" href={`/movie/${b.slug}`}>{b.title}</a>
      </header>

      <div class="home-main-grid">
        <div class="home-col">
      <section class="vsx-sec">
        <h2 class="vsx-h2">By the numbers</h2>
        <table class="tape">
          <caption class="sr-only">
            {a.title} versus {b.title}, head-to-head stats
          </caption>
          <thead>
            <tr>
              <th scope="col" class="tape-team">
                <span class="tape-dot tape-dot-a" aria-hidden="true"></span>
                {a.title}
              </th>
              <th scope="col" class="tape-vs" aria-hidden="true"></th>
              <th scope="col" class="tape-team tape-team-b">
                {b.title}
                <span class="tape-dot tape-dot-b" aria-hidden="true"></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tape.map((r) => (
              <tr>
                <td class={`${cls(r.win, "a")}${r.minor ? " tape-minor" : ""}`}>{r.a}</td>
                <th scope="row" class="tape-metric">
                  {r.label}
                </th>
                <td class={`${cls(r.win, "b")}${r.minor ? " tape-minor" : ""}`}>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {more.length > 0 ? (
        <section class="vsx-sec">
          <h2 class="vsx-h2">More comparisons</h2>
          <div class="vs-grid">
            {more.map(({ anchor, other }) => (
              <VsCard
                href={movieComparePathFor(anchor.slug, other.slug)}
                a={movieSides.get(anchor.slug)!}
                b={movieSides.get(other.slug)!}
                cta="Side by side"
              />
            ))}
          </div>
        </section>
      ) : null}
      <div class="vsx-actions">
        <a class="btn-ghost" href="/movies/compare">
          Compare a different pair
        </a>
        <a class="btn-ghost" href="/compare">
          Compare TV shows instead
        </a>
      </div>
      <KeepExploring
        cards={[
          {
            icon: "Film",
            title: "The best movies of all time",
            desc: "Every movie ranked by rating, with where to stream.",
            href: "/movies/best",
            backdrop: bestArt,
          },
          {
            icon: "Community",
            title: "Loved by this community",
            desc: "The chart built from real one-tap reader verdicts.",
            href: "/loved",
            backdrop: lovedArt,
          },
          {
            icon: "Guides",
            title: "Watch every saga in order",
            desc: "Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked.",
            href: "/watch-orders",
            backdrop: ordersArt,
          },
        ]}
      />
        </div>
        <HomeSidebarRail
          trailers={sidebar?.trailers ?? []}
          topSeries={sidebar?.topSeries ?? []}
          topMovies={sidebar?.topMovies ?? []}
        />
      </div>
    </Layout>,
  );
});

// One OG side per film — real backdrop → poster, inlined as data URIs for resvg.
async function movieCompareOgSide(c: AppContext, m: MovieRow): Promise<OgSide> {
  const bd =
    c.env.TMDB_API_KEY && m.imdb_id ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, m.imdb_id) : null;
  const poster = m.poster_url?.replace("/t/p/w342/", "/t/p/w780/") ?? null;
  const [backdropUri, posterUri] = await Promise.all([
    posterDataUri(bd?.x1 ?? poster),
    posterDataUri(poster),
  ]);
  return { name: m.title, posterUri, backdropUri, rating: m.rating };
}

// 1200×630 head-to-head card for movie matchup unfurls — the film equivalent of
// the show /compare/:pair/og.png card, so a shared "X vs Y" link no longer shows
// just one poster.
app.get("/compare/movie/:pair{[^/]+-vs-[^/]+}/og.png", async (c) => {
  const pair = c.req.param("pair");
  return servePng(c, `compare/movie/${pair}`, async () => {
    let a: MovieRow | null = null;
    let b: MovieRow | null = null;
    let idx = pair.indexOf("-vs-");
    while (idx !== -1) {
      const left = pair.slice(0, idx);
      const right = pair.slice(idx + 4);
      const [l, r] = await Promise.all([resolveMovie(c, left), resolveMovie(c, right)]);
      if (l && r) {
        a = l.movie;
        b = r.movie;
        break;
      }
      idx = pair.indexOf("-vs-", idx + 1);
    }
    if (!a || !b) return null;
    const [sa, sb] = await Promise.all([movieCompareOgSide(c, a), movieCompareOgSide(c, b)]);
    return buildCompareOgCard(sa, sb);
  });
});

export default app;
