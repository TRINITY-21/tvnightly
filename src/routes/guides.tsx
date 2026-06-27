// SEO guide pages — three programmatic templates over the movie catalog:
//   /movies/best/:year[/:genre]   "Best [genre] movies to watch in {year}"
//   /movies/underrated[/:genre]    "Underrated [genre] movies" (hidden gems)
//   /movies/featuring/:slug        "Best movies featuring [actor]"
// Each renders a keyword-matched H1, ranked list, internal genre/person links,
// a visible FAQ mirrored into FAQPage JSON-LD, and ItemList + BreadcrumbList.
import { Hono } from "hono";
import { IconStar } from "../components/icons";
import { Layout } from "../components/Layout";
import { ExploreCard, MovieCard } from "../components/cards";
import { ChartFilterBar } from "../components/chart-filters";
import { ChartHeroHead, ChartSpotlight } from "../components/chart-hero";
import {
  ChartRankCard,
  ChartRankGrid,
  movieChartRankItem,
} from "../components/chart-rank-card";
import { FilterSelect } from "../components/forms";
import { HomeSidebarRail } from "../components/home-sidebar";
import {
  fillKeepGoingBackdrops,
  KeepExploring,
  loadMovieChartDoorArts,
  loadMovieGuideDoorArts,
  movieKeepGoingBackdrop,
  showKeepGoingBackdrop,
} from "../components/keep-going";
import { chartBasePath, parseChartFilters } from "../lib/chart-filters";
import { CHART_PAGE_SIZE, fetchMovieChartResults, fetchMovieUnderratedResults } from "../lib/chart-results";
import { fmtRuntime, headshot, heroBg, slugifyName } from "../lib/format";
import { providerBrand, providersFor, visitorRegion } from "../lib/providers";
import { genreDirectory } from "../lib/queries";
import { canonical, faqLd, origin } from "../lib/seo";
import { movieSpotlightTrailer, tmdbMovieBackdrop, tmdbUpcomingBackdrop } from "../lib/tmdb";
import {
  movieBundleId,
  resolveMovie,
  resolveMovieBundleId,
  resolvePersonProfile,
} from "../lib/tmdb-show";
import { hubForGenres } from "../lib/verticals";
import { AppContext, Bindings, HonoEnv, MovieRow } from "../types";

const app = new Hono<HonoEnv>();

// "Underrated" = trustworthy rating, but far fewer votes than the blockbusters,
// AND out long enough to prove it was overlooked rather than merely new. The
// vote floor keeps the score real; the ceiling sits below where the famous canon
// lives (so masterpieces never get mislabeled "underrated"); the age gate drops
// just-released films, whose vote counts are low by recency, not obscurity.
const UNDERRATED_MIN_RATING = 7.0;
const UNDERRATED_MIN_VOTES = 1000;
const UNDERRATED_MAX_VOTES = 10000;
const UNDERRATED_MIN_AGE = 2; // years since release before a film can read as "overlooked"
// Oldest year a /movies/best/:year page will render — keeps the route from
// minting junk pages for nonsense years while leaving recent archives crawlable.
const YEAR_MIN = 2015;

const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const fmtVotes = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const titleList = (rows: MovieRow[], n: number) => rows.slice(0, n).map((m) => m.title).join(", ");

// the chart opens on its own #1 — the reigning film's real backdrop, with the
// poster as an ambient fallback when TMDB has no landscape art
async function topArt(c: AppContext, top: MovieRow | undefined) {
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (top && c.env.TMDB_API_KEY) {
    // D1 films carry a real imdb tt-id; a live-enriched film carries only a
    // tmdb id (synthetic "tmdb-<id>" imdb_id), so look that up by tmdb id.
    art = /^tt\d+$/.test(top.imdb_id)
      ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, top.imdb_id)
      : top.tmdb_id
        ? await tmdbUpcomingBackdrop(c.env.TMDB_API_KEY, top.tmdb_id)
        : null;
  }
  if (!art && top?.poster_url) {
    art = { x1: top.poster_url };
    ambient = true;
  }
  return { art, ambient };
}

// up to three internal links per row: where it streams, then its genres —
// the same cross-link shape the popular-movies chart uses
const rowLinks = (m: MovieRow, region: string) => {
  const provs = [...new Set(providersFor(m, region).names.map(providerBrand))].slice(0, 2);
  const gs: string[] = m.genres ? JSON.parse(m.genres) : [];
  return [
    ...provs.map((p) => ({ href: `/network/${slugifyName(p)}/movies`, label: p })),
    ...gs.slice(0, 2).map((g) => ({ href: `/genre/${slugifyName(g)}/movies`, label: g })),
  ].slice(0, 3);
};

const RankList = ({
  rows,
  region,
  showVotes,
}: {
  rows: (MovieRow & { character?: string | null })[];
  region: string;
  showVotes?: boolean;
}) => (
  <ol class="wo-list wo-ranked wo-ranked-meta">
    {rows.map((m, i) => {
      const links = rowLinks(m, region);
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
              loading={i < 6 ? "eager" : "lazy"}
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
            <span class="wo-provs">
              {m.character ? (
                <>
                  as {m.character}
                  {links.length ? <span class="wo-provs-sep"> · </span> : null}
                </>
              ) : null}
              {links.map((l, j) => (
                <>
                  {j > 0 ? " · " : null}
                  <a href={l.href}>{l.label}</a>
                </>
              ))}
            </span>
          </span>
          <span class="wo-side">
            {m.rating != null ? <span class="rating"><IconStar class="rating-star" />{m.rating.toFixed(1)}</span> : null}
            {showVotes && m.votes ? (
              <span class="wo-mins">{fmtVotes(m.votes)} votes</span>
            ) : m.runtime ? (
              <span class="wo-mins">{fmtRuntime(m.runtime)}</span>
            ) : null}
          </span>
        </li>
      );
    })}
  </ol>
);

// A visible FAQ whose answer text is mirrored verbatim into FAQPage JSON-LD —
// Google requires the answer to appear in the page body, so one source feeds both.
const FaqSection = ({ items }: { items: { q: string; a: string }[] }) => (
  <section class="hub-sec guide-faq">
    <h2>Good to know</h2>
    {items.map((f) => (
      <div class="guide-faq-item">
        <h3>{f.q}</h3>
        <p class="muted">{f.a}</p>
      </div>
    ))}
  </section>
);

// ----------------------------------------- Best [genre] movies to watch in {year}

async function bestYearPage(c: AppContext, year: number, genreSlug?: string) {
  const now = new Date().getFullYear();
  if (!Number.isInteger(year) || year < YEAR_MIN || year > now) return c.notFound();

  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = movieGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect(`/movies/best/${year}`, 301);
    genre = match;
  }
  const lower = genre.toLowerCase();
  if ((c.req.query("year") ?? "").trim()) {
    const sort = parseChartFilters(c, genre).sort;
    const qs = sort !== "rated" ? `?sort=${sort}` : "";
    return c.redirect(`${genreSlug ? `/movies/best/${year}/${genreSlug}` : `/movies/best/${year}`}${qs}`, 301);
  }
  const { sort } = parseChartFilters(c, genre);
  const filters = { genre, year, sort };
  const results = await fetchMovieChartResults(c, filters);

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

  const pageTitle = genre
    ? `Best ${genre} movies of ${year}`
    : `Best movies of ${year}`;
  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  const [chartArt, underratedArt, ordersArt, lovedArt] = await loadMovieChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    top,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — Top 50 Ranked | TV Nightly`}
      description={`${pageTitle}, ranked by viewer rating${top ? ` — led by ${top.title}` : ""}.`}
      canonical={canonical(c)}
      noindex={!results.length}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : art?.x1 ? { x1: art.x1, x2: art.x1 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: pageTitle,
          itemListElement: results.slice(0, 25).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${m.title}${m.year ? ` (${m.year})` : ""}`,
            url: `${site}/movie/${m.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
            { "@type": "ListItem", position: 2, name: "Best movies", item: `${site}/movies/best` },
            { "@type": "ListItem", position: 3, name: pageTitle, item: canonical(c) },
          ],
        },
      ]}
    >
      <ChartHeroHead
        eyebrow={`${year} watch guide`}
        title={pageTitle}
        intro={`The best ${genre ? `${lower} ` : ""}films of ${year}, ranked by viewer rating — what's worth watching this year.`}
      >
        <a
          class="verdict-btn"
          href={`/what-to-watch?type=movie${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`}
        >
          Pick me a movie
        </a>
        <a class="btn-ghost" href={genre ? `/movies/underrated/${genreSlug}` : "/movies/underrated"}>
          Underrated picks
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
      <ChartFilterBar kind="movie" filters={filters} genres={movieGenres} guideYear={year} />
      {!results.length ? (
        <p class="muted">No rated {genre ? `${lower} ` : ""}films for that filter yet.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one movie matches these filters — it&apos;s featured above.</p>
      ) : (
        <ChartRankGrid
          more={{
            kind: "movie",
            filters,
            genreSlug,
            total: results.length,
            guideYear: year,
          }}
        >
          {results.slice(1, CHART_PAGE_SIZE + 1).map((m, i) => (
            <ChartRankCard {...movieChartRankItem(m, i + 2)} />
          ))}
        </ChartRankGrid>
      )}

      <KeepExploring
        cards={[
          {
            icon: "The chart",
            title: genre ? `Best ${lower} movies of all time` : "Best movies of all time",
            desc: "The all-time ranking by viewer rating — a thousand-vote minimum.",
            href: genre ? chartBasePath("movie", genre) : "/movies/best",
            backdrop: chartArt,
          },
          {
            icon: "Hidden gems",
            title: genre ? `Underrated ${lower} movies` : "Underrated movies",
            desc: "High ratings, low profile — the great films most people have missed.",
            href: genre ? `/movies/underrated/${genreSlug}` : "/movies/underrated",
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

app.get("/movies/best/:year/:genre", (c) =>
  bestYearPage(c, Number(c.req.param("year")), c.req.param("genre")),
);
app.get("/movies/best/:year", (c) => {
  // ?genre=action filter (from the dropdown's no-JS path) maps to the clean path
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/movies/best/${c.req.param("year")}/${slugifyName(g)}`, 301);
  return bestYearPage(c, Number(c.req.param("year")));
});

// --------------------------------------------------- Underrated [genre] movies

async function underratedPage(c: AppContext, genreSlug?: string) {
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = movieGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect("/movies/underrated", 301);
    genre = match;
  }
  const lower = genre.toLowerCase();
  const { sort } = parseChartFilters(c, genre);
  const filters = { genre, year: null, sort };
  const results = await fetchMovieUnderratedResults(c, { genre, sort });

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

  const pageTitle = genre ? `Underrated ${genre} movies` : "Underrated movies";
  const site = origin(c);
  const year = new Date().getFullYear();
  const sidebar = c.get("siteSidebar");
  const [chartArt, yearArt, ordersArt, lovedArt] = await loadMovieChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    top,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — Hidden Gems to Stream | TV Nightly`}
      description={`${pageTitle} — highly rated but overlooked films${top ? ` like ${top.title}` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      noindex={!results.length}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : art?.x1 ? { x1: art.x1, x2: art.x1 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: pageTitle,
          itemListElement: results.slice(0, 25).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${m.title}${m.year ? ` (${m.year})` : ""}`,
            url: `${site}/movie/${m.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
            { "@type": "ListItem", position: 2, name: pageTitle, item: canonical(c) },
          ],
        },
      ]}
    >
      <ChartHeroHead
        eyebrow="Hidden gems"
        title={pageTitle}
        intro={`Great ${genre ? `${lower} ` : ""}films that flew under the radar — high ratings, low profile, ranked so the best-kept secrets come first.`}
      >
        <a
          class="verdict-btn"
          href={`/what-to-watch?type=movie${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`}
        >
          Surprise me with one
        </a>
        <a class="btn-ghost" href={genre ? `/movies/best/${year}/${genreSlug}` : `/movies/best/${year}`}>
          Best of {year}
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
      <ChartFilterBar kind="movie" filters={filters} genres={movieGenres} guideUnderrated />
      {!results.length ? (
        <p class="muted">No underrated {genre ? `${lower} ` : ""}films match yet — try another genre.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one movie matches these filters — it&apos;s featured above.</p>
      ) : (
        <ChartRankGrid
          more={{
            kind: "movie",
            filters,
            genreSlug,
            total: results.length,
            guideUnderrated: true,
          }}
        >
          {results.slice(1, CHART_PAGE_SIZE + 1).map((m, i) => (
            <ChartRankCard {...movieChartRankItem(m, i + 2)} />
          ))}
        </ChartRankGrid>
      )}

      <KeepExploring
        cards={[
          {
            icon: "The chart",
            title: genre ? `Best ${lower} movies of all time` : "Best movies of all time",
            desc: "The all-time ranking by viewer rating — a thousand-vote minimum.",
            href: genre ? chartBasePath("movie", genre) : "/movies/best",
            backdrop: chartArt,
          },
          {
            icon: "Watch guide",
            title: genre ? `Best ${lower} movies of ${year}` : `Best movies of ${year}`,
            desc: "The acclaimed films to watch this year, newest greats first.",
            href: genre ? `/movies/best/${year}/${genreSlug}` : `/movies/best/${year}`,
            backdrop: yearArt,
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

app.get("/movies/underrated/:genre", (c) => underratedPage(c, c.req.param("genre")));
app.get("/movies/underrated", (c) => {
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/movies/underrated/${slugifyName(g)}`, 301);
  return underratedPage(c);
});

// ----------------------------------------------- Best movies featuring [actor]

app.get("/movies/featuring/:slug", async (c) => {
  const slug = c.req.param("slug");
  const idMatch = /-(\d+)$/.exec(slug);
  if (!idMatch) return c.notFound();
  // Use the SAME enriched filmography as the person page (D1 + the rest from
  // TMDB) — querying movie_credits alone returned ~0 rows for a live-led actor
  // and bounced this page straight back to /person.
  const profile = await resolvePersonProfile(c, Number(idMatch[1]));
  if (!profile) return c.notFound();
  const { person, films, roles: shows } = profile;
  // one canonical URL per person — name drift 301s to the real slug
  const canonicalSlug = `${slugifyName(person.name)}-${person.id}`;
  if (slug !== canonicalSlug) return c.redirect(`/movies/featuring/${canonicalSlug}`, 301);
  // no films on record → the person page is the right destination
  if (!films.length) return c.redirect(`/person/${canonicalSlug}`, 302);

  const region = visitorRegion(c);
  const site = origin(c);
  const best = films.find((m) => m.rating != null) ?? films[0] ?? null;
  const rated = films.filter((m) => m.rating != null);
  const avg = rated.length
    ? (rated.reduce((s, m) => s + m.rating!, 0) / rated.length).toFixed(1)
    : null;
  const { art, ambient } = await topArt(c, films[0]);
  const first = person.name.split(" ")[0];
  const sidebar = c.get("siteSidebar");
  const apiKey = c.env.TMDB_API_KEY;
  const topShow = shows.find((s) => s.rating != null) ?? shows[0] ?? null;
  const profileFilm = films.find((m) => m.slug !== best?.slug) ?? films[0] ?? null;
  const [bestArt, profileArt, tvArt] = await Promise.all([
    best ? movieKeepGoingBackdrop(apiKey, best) : Promise.resolve(null),
    profileFilm ? movieKeepGoingBackdrop(apiKey, profileFilm) : Promise.resolve(null),
    topShow ? showKeepGoingBackdrop(apiKey, topShow) : Promise.resolve(null),
  ]);
  const featuringDoors = fillKeepGoingBackdrops([
    {
      icon: "Highest rated",
      title: best.title,
      desc: `${first}'s best-reviewed film — rating, runtime and where to watch.`,
      href: `/movie/${best.slug}`,
      backdrop: bestArt,
    },
    {
      icon: "Profile",
      title: `${person.name}: shows, age & roles`,
      desc: "The full profile — every TV role and film credit on one page.",
      href: `/person/${canonicalSlug}`,
      backdrop: profileArt,
    },
    {
      icon: "TV",
      title: `Best TV shows featuring ${first}`,
      desc: "The television side — every series ranked by viewer rating.",
      href: `/tv/featuring/${canonicalSlug}`,
      backdrop: tvArt,
    },
  ]);

  const faqs = [
    {
      q: `What is ${person.name}'s best movie?`,
      a: best
        ? `${best.title}${best.year ? ` (${best.year})` : ""} is ${person.name}'s highest-rated film here, at ★ ${best.rating!.toFixed(1)}.`
        : `We track ${films.length} ${person.name} ${films.length === 1 ? "film" : "films"}, ranked on this page.`,
    },
    {
      q: `How many movies has ${person.name} been in?`,
      a: `We track ${films.length} ${person.name} ${films.length === 1 ? "film" : "films"}${avg ? `, averaging ★ ${avg}` : ""} — ranked here by viewer rating.`,
    },
    {
      q: `Where can I watch ${first}'s movies?`,
      a: `Each film links to its page with live streaming availability for your country.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Best Movies Featuring ${person.name} — Ranked | TV Nightly`}
      description={`Every ${person.name} movie we track, ranked by viewer rating${best ? ` — from ${best.title} down` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      ogImage={person.image_url ?? undefined}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `Best movies featuring ${person.name}`,
          itemListElement: films.slice(0, 25).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${m.title}${m.year ? ` (${m.year})` : ""}`,
            url: `${site}/movie/${m.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
            { "@type": "ListItem", position: 2, name: person.name, item: `${site}/person/${canonicalSlug}` },
            { "@type": "ListItem", position: 3, name: "Best movies", item: canonical(c) },
          ],
        },
        faqLd(faqs),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed wo-hero-person${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          {(() => {
            const face = person.image_url ? headshot(person.image_url, true) : null;
            return face ? (
              <img
                class="wo-hero-face"
                src={face.src}
                srcset={face.srcset}
                width="84"
                height="112"
                alt={person.name}
                loading="eager"
                decoding="async"
              />
            ) : null;
          })()}
          <div class="wo-hero-text">
          <p class="section-eyebrow">Filmography</p>
          <h1>Best movies featuring {person.name}</h1>
          <p class="wo-intro">
            Every {person.name} film we track, ranked by real viewer rating
            {best ? <> — led by <a href={`/movie/${best.slug}`}>{best.title}</a> at <IconStar class="rating-star" /> {best.rating!.toFixed(1)}</> : null}
            . Where to stream each is one tap away.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href={`/person/${canonicalSlug}`}>
              {first}'s full profile
            </a>
            <a class="btn-ghost" href="/movies/best">
              Best movies, ranked
            </a>
          </p>
          </div>
        </div>
      </header>

      <div class="home-main-grid">
        <div class="home-col">
      <section class="hub-sec">
        <h2>
          {person.name}'s films, ranked <span class="sched-count">{films.length}</span>
        </h2>
        <RankList rows={films} region={region} />
      </section>

      <FaqSection items={faqs} />

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          {featuringDoors.map((card) => (
            <ExploreCard
              icon={card.icon}
              title={card.title}
              desc={card.desc}
              href={card.href}
              backdrop={card.backdrop ?? undefined}
              {...(card.href === `/movie/${best.slug}` && best.rating != null
                ? { rating: best.rating }
                : {})}
            />
          ))}
        </div>
      </section>
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

export default app;
