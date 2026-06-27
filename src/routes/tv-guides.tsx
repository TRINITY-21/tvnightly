// SEO guide pages for TV — the show counterparts of src/routes/guides.tsx:
//   /tv/best/:year[/:genre]   "Best [genre] TV shows to watch in {year}"
//   /tv/underrated[/:genre]    "Underrated [genre] shows" (cult / overlooked)
//   /tv/featuring/:slug        "Best TV shows featuring [actor]"
// Shows differ from movies: popularity is TVmaze `weight` (not vote count),
// the year comes from `premiered`/`status`, TV credits live in `credits`, and
// backdrops key off `tmdb_id`. Otherwise the SEO shape mirrors the movie guides:
// keyword H1, ranked list, genre/person cross-links, visible FAQ → FAQPage LD,
// plus ItemList + BreadcrumbList.
import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ExploreCard } from "../components/cards";
import { ChartFilterBar } from "../components/chart-filters";
import { ChartHeroHead, ChartSpotlight } from "../components/chart-hero";
import {
    ChartRankCard,
    ChartRankGrid,
    showChartRankItem,
} from "../components/chart-rank-card";
import { HomeSidebarRail } from "../components/home-sidebar";
import { IconStar } from "../components/icons";
import {
    KeepExploring,
    fillKeepGoingBackdrops,
    loadTvChartDoorArts,
    movieKeepGoingBackdrop,
    showKeepGoingBackdrop
} from "../components/keep-going";
import { parseChartFilters } from "../lib/chart-filters";
import { CHART_PAGE_SIZE, fetchTvChartResults, fetchTvDecadeChartResults, fetchTvUnderratedResults } from "../lib/chart-results";
import { parseDecadeSlug } from "../lib/decades";
import { headshot, heroBg, hiRes, posterSrc, slugifyName } from "../lib/format";
import { providerBrand, providersFor, visitorRegion } from "../lib/providers";
import { genreDirectory, showSeasonCounts } from "../lib/queries";
import { canonical, faqLd, origin } from "../lib/seo";
import { tmdbBackdrop, tmdbTrailer } from "../lib/tmdb";
import { resolvePersonProfile } from "../lib/tmdb-show";
import { AppContext, HonoEnv, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

// recognizable-popularity floor — the same TVmaze weight the genre charts use,
// so guide pages rank the same trustworthy pool
const SHOW_QUALITY_WEIGHT = 60;
// "Underrated" for shows: a strong rating, but parked outside the most-watched
// tier. Weight is saturated near 100 for household names, so the ceiling drops
// them while the floor keeps recognizable (not junk) series.
const SHOW_UNDERRATED_MIN_RATING = 7.8;
const SHOW_UNDERRATED_MIN_WEIGHT = 40;
const SHOW_UNDERRATED_MAX_WEIGHT = 96;
// Match the year picker's range (chartYearOptions starts at 1907) — live TMDB +
// adaptive fill serves any year, so every option the dropdown offers resolves.
const YEAR_MIN = 1907;

const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const nameList = (rows: ShowRow[], n: number) => rows.slice(0, n).map((s) => s.name).join(", ");
const showYears = (s: ShowRow) =>
  s.premiered
    ? `${s.premiered.slice(0, 4)}${s.ended ? `–${s.ended.slice(0, 4)}` : s.status === "Running" ? "–present" : ""}`
    : null;

// the chart opens on its own #1 — the reigning show's real backdrop, with its
// hi-res still as the ambient fallback when TMDB has no landscape art
async function topArt(c: AppContext, top: ShowRow | undefined) {
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (top?.tmdb_id && c.env.TMDB_API_KEY) art = await tmdbBackdrop(c.env.TMDB_API_KEY, top.tmdb_id);
  if (!art && top) {
    const p = hiRes(top.image_url);
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }
  return { art, ambient };
}

// up to three internal links per row: where it streams, then its genres
const rowLinks = (s: ShowRow, region: string) => {
  const provs = [...new Set(providersFor(s, region).names.map(providerBrand))].slice(0, 2);
  const gs: string[] = s.genres ? JSON.parse(s.genres) : [];
  return [
    ...provs.map((p) => ({ href: `/network/${slugifyName(p)}`, label: p })),
    ...gs.slice(0, 2).map((g) => ({ href: `/genre/${slugifyName(g)}/shows`, label: g })),
  ].slice(0, 3);
};

const ShowRankList = ({
  rows,
  region,
}: {
  rows: (ShowRow & { character?: string | null })[];
  region: string;
}) => (
  <ol class="wo-list wo-ranked wo-ranked-meta">
    {rows.map((s, i) => {
      const links = rowLinks(s, region);
      const p = posterSrc(s);
      const yr = showYears(s);
      return (
        <li class="wo-row">
          <span class="wo-num" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          {p ? (
            <img
              class="wo-poster"
              src={p.src}
              srcset={p.srcset}
              alt={`${s.name} poster`}
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
              <a href={`/show/${s.slug}`}>{s.name}</a>
              {yr ? <span class="muted"> ({yr})</span> : null}
            </span>
            <span class="wo-provs">
              {s.character ? (
                <>
                  as {s.character}
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
            {s.rating != null ? <span class="rating"><IconStar class="rating-star" />{s.rating.toFixed(1)}</span> : null}
            {s.status === "Running" ? <span class="wo-mins">Airing now</span> : null}
          </span>
        </li>
      );
    })}
  </ol>
);

// Visible FAQ mirrored verbatim into FAQPage JSON-LD (Google requires the answer
// in the page body, so one source feeds both).
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

// ------------------------------------------ Best [genre] TV shows to watch in {year}

async function bestYearPage(c: AppContext, year: number, genreSlug?: string) {
  const now = new Date().getFullYear();
  if (!Number.isInteger(year) || year < YEAR_MIN || year > now) return c.notFound();

  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = tvGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect(`/tv/best/${year}`, 301);
    genre = match;
  }
  const lower = genre.toLowerCase();
  if ((c.req.query("year") ?? "").trim()) {
    const sort = parseChartFilters(c, genre).sort;
    const qs = sort !== "rated" ? `?sort=${sort}` : "";
    return c.redirect(`${genreSlug ? `/tv/best/${year}/${genreSlug}` : `/tv/best/${year}`}${qs}`, 301);
  }
  const { sort } = parseChartFilters(c, genre);
  const filters = { genre, year, sort };
  const results = await fetchTvChartResults(c, filters);

  const champ = results[0] ?? null;
  let art: { x1: string; x2?: string } | null = null;
  if (champ?.tmdb_id && c.env.TMDB_API_KEY) {
    art = await tmdbBackdrop(c.env.TMDB_API_KEY, champ.tmdb_id);
  }
  if (!art && champ) {
    const p = posterSrc(champ);
    if (p) art = { x1: p.src };
  }
  const champTrailer =
    champ?.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbTrailer(c.env.TMDB_API_KEY, "tv", champ.tmdb_id)
      : null;
  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    results.slice(0, CHART_PAGE_SIZE).map((s) => s.id),
  );
  const showMeta = (s: ShowRow) => {
    const n = s.id != null ? seasonCounts.get(s.id) : undefined;
    if (n && n > 0) return `${n} Season${n === 1 ? "" : "s"}`;
    if (s.premiered) return s.premiered.slice(0, 4);
    return s.network ?? s.web_channel ?? "TV Series";
  };

  const pageTitle = genre
    ? `Best ${genre} TV shows of ${year}`
    : `Best TV shows of ${year}`;
  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  const [underratedArt, episodesArt, compareArt, chartArt] = await loadTvChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    champ,
    results[1] ?? null,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — Top 100 Ranked | TV Nightly`}
      description={`${pageTitle}, ranked by viewer rating${champ ? ` — led by ${champ.name}` : ""}.`}
      canonical={canonical(c)}
      noindex={!results.length}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: pageTitle,
          itemListElement: results.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "TV shows", item: `${site}/top/tv` },
            { "@type": "ListItem", position: 2, name: pageTitle, item: canonical(c) },
          ],
        },
      ]}
    >
      <ChartHeroHead
        eyebrow={`${year} watch guide`}
        title={pageTitle}
        intro={`The best ${genre ? `${lower} ` : ""}series of ${year}, ranked by viewer rating — what's worth starting this year.`}
      >
        <a
          class="verdict-btn"
          href={`/what-to-watch?type=tv${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`}
        >
          Pick me a show
        </a>
        <a class="btn-ghost" href={genre ? `/tv/underrated/${genreSlug}` : "/tv/underrated"}>
          Underrated picks
        </a>
        <a class="btn-ghost" href="/premieres">
          What&apos;s coming next
        </a>
      </ChartHeroHead>

      <div class="home-main-grid">
        <div class="home-col">
      {champ ? (
        <div class="chart-hero-spotlight-wrap">
          <ChartSpotlight
            featured={{
              href: `/show/${champ.slug}`,
              name: champ.name,
              poster: posterSrc(champ),
              trailer: champTrailer,
              fallbackBackdrop: art,
              rating: champ.rating,
            }}
          />
        </div>
      ) : null}
      <ChartFilterBar kind="tv" filters={filters} genres={tvGenres} guideYear={year} />
      {!results.length ? (
        <p class="muted">No rated {genre ? `${lower} ` : ""}shows for that filter yet.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one show matches these filters — it&apos;s featured above.</p>
      ) : (
        <ChartRankGrid
          more={{
            kind: "tv",
            filters,
            genreSlug,
            total: results.length,
            guideYear: year,
          }}
        >
          {results.slice(1, CHART_PAGE_SIZE + 1).map((s, i) => (
            <ChartRankCard {...showChartRankItem(s, i + 2, showMeta(s))} />
          ))}
        </ChartRankGrid>
      )}

      <KeepExploring
        cards={[
          {
            icon: "The chart",
            title: genre ? `Top ${lower} shows, all time` : "Top TV shows of all time",
            desc: "The all-time ranking by viewer rating, with where to stream.",
            href: genre ? `/top/tv/${genreSlug}` : "/top/tv",
            backdrop: chartArt,
          },
          {
            icon: "Hidden gems",
            title: genre ? `Underrated ${lower} shows` : "Underrated TV shows",
            desc: "High ratings, low profile — the great series most people have missed.",
            href: genre ? `/tv/underrated/${genreSlug}` : "/tv/underrated",
            backdrop: underratedArt,
          },
          {
            icon: "Shortcut",
            title: "All-time best episodes",
            desc: "The single greatest hours of television, across every show.",
            href: "/best-episodes",
            backdrop: episodesArt,
          },
          {
            icon: "Compare",
            title: "Compare two shows",
            desc: "Episode ratings head-to-head on one chart — settle the argument.",
            href: "/compare",
            backdrop: compareArt,
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

// ------------------------------------------ Best [genre] TV shows of the {decade}

async function bestDecadePage(c: AppContext, decadeSlug: string, genreSlug?: string) {
  const decade = parseDecadeSlug(decadeSlug);
  if (!decade) return c.notFound();

  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = tvGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect(`/tv/best/${decade.label}`, 301);
    genre = match;
  }
  const lower = genre.toLowerCase();
  if ((c.req.query("year") ?? "").trim()) {
    const sort = parseChartFilters(c, genre).sort;
    const qs = sort !== "rated" ? `?sort=${sort}` : "";
    return c.redirect(`${genreSlug ? `/tv/best/${decade.label}/${genreSlug}` : `/tv/best/${decade.label}`}${qs}`, 301);
  }
  const { sort } = parseChartFilters(c, genre);
  const filters = { genre, year: null, sort };
  const results = await fetchTvDecadeChartResults(c, decade, { genre, sort });

  const champ = results[0] ?? null;
  let art: { x1: string; x2?: string } | null = null;
  if (champ?.tmdb_id && c.env.TMDB_API_KEY) {
    art = await tmdbBackdrop(c.env.TMDB_API_KEY, champ.tmdb_id);
  }
  if (!art && champ) {
    const p = posterSrc(champ);
    if (p) art = { x1: p.src };
  }
  const champTrailer =
    champ?.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbTrailer(c.env.TMDB_API_KEY, "tv", champ.tmdb_id)
      : null;
  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    results.slice(0, CHART_PAGE_SIZE).map((s) => s.id),
  );
  const showMeta = (s: ShowRow) => {
    const n = s.id != null ? seasonCounts.get(s.id) : undefined;
    if (n && n > 0) return `${n} Season${n === 1 ? "" : "s"}`;
    if (s.premiered) return s.premiered.slice(0, 4);
    return s.network ?? s.web_channel ?? "TV Series";
  };

  const pageTitle = genre
    ? `Best ${genre} TV shows of the ${decade.label}`
    : `Best TV shows of the ${decade.label}`;
  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  const [underratedArt, episodesArt, compareArt, chartArt] = await loadTvChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    champ,
    results[1] ?? null,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — Top 100 Ranked | TV Nightly`}
      description={`${pageTitle}, ranked by viewer rating${champ ? ` — led by ${champ.name}` : ""}.`}
      canonical={canonical(c)}
      noindex={!results.length}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: pageTitle,
          itemListElement: results.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "TV shows", item: `${site}/top/tv` },
            { "@type": "ListItem", position: 2, name: pageTitle, item: canonical(c) },
          ],
        },
      ]}
    >
      <ChartHeroHead
        eyebrow={`${decade.label} watch guide`}
        title={pageTitle}
        intro={`The defining ${genre ? `${lower} ` : ""}series of the ${decade.label} — ranked by viewer rating among shows that premiered ${decade.start}–${decade.end}.`}
      >
        <a
          class="verdict-btn"
          href={`/what-to-watch?type=tv${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`}
        >
          Pick me a show
        </a>
        <a class="btn-ghost" href="/best-episodes">
          Best episodes ever
        </a>
        <a class="btn-ghost" href="/premieres">
          What&apos;s coming next
        </a>
      </ChartHeroHead>

      <div class="home-main-grid">
        <div class="home-col">
      {champ ? (
        <div class="chart-hero-spotlight-wrap">
          <ChartSpotlight
            featured={{
              href: `/show/${champ.slug}`,
              name: champ.name,
              poster: posterSrc(champ),
              trailer: champTrailer,
              fallbackBackdrop: art,
              rating: champ.rating,
            }}
          />
        </div>
      ) : null}
      <ChartFilterBar kind="tv" filters={filters} genres={tvGenres} guideDecade={decade.label} />
      {!results.length ? (
        <p class="muted">No rated {genre ? `${lower} ` : ""}shows for that filter yet.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one show matches these filters — it&apos;s featured above.</p>
      ) : (
        <ChartRankGrid
          more={{
            kind: "tv",
            filters,
            genreSlug,
            total: results.length,
            guideDecade: decade.label,
          }}
        >
          {results.slice(1, CHART_PAGE_SIZE + 1).map((s, i) => (
            <ChartRankCard {...showChartRankItem(s, i + 2, showMeta(s))} />
          ))}
        </ChartRankGrid>
      )}

      <KeepExploring
        cards={[
          {
            icon: "The chart",
            title: genre ? `Top ${lower} shows, all time` : "Top TV shows of all time",
            desc: "The all-time ranking by viewer rating, with where to stream.",
            href: genre ? `/top/tv/${genreSlug}` : "/top/tv",
            backdrop: chartArt,
          },
          {
            icon: "Hidden gems",
            title: genre ? `Underrated ${lower} shows` : "Underrated TV shows",
            desc: "High ratings, low profile — the great series most people have missed.",
            href: genre ? `/tv/underrated/${genreSlug}` : "/tv/underrated",
            backdrop: underratedArt,
          },
          {
            icon: "Shortcut",
            title: "All-time best episodes",
            desc: "The single greatest hours of television, across every show.",
            href: "/best-episodes",
            backdrop: episodesArt,
          },
          {
            icon: "Compare",
            title: "Compare two shows",
            desc: "Episode ratings head-to-head on one chart — settle the argument.",
            href: "/compare",
            backdrop: compareArt,
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

app.get("/tv/best/:yearOrDecade/:genre", (c) => {
  const p = c.req.param("yearOrDecade");
  if (parseDecadeSlug(p)) return bestDecadePage(c, p, c.req.param("genre"));
  return bestYearPage(c, Number(p), c.req.param("genre"));
});
app.get("/tv/best/:yearOrDecade", (c) => {
  const p = c.req.param("yearOrDecade");
  if (parseDecadeSlug(p)) {
    const g = (c.req.query("genre") ?? "").trim();
    if (g) return c.redirect(`/tv/best/${p}/${slugifyName(g)}`, 301);
    return bestDecadePage(c, p);
  }
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/tv/best/${p}/${slugifyName(g)}`, 301);
  return bestYearPage(c, Number(p));
});

// --------------------------------------------------- Underrated [genre] shows

async function underratedPage(c: AppContext, genreSlug?: string) {
  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  let genre = "";
  if (genreSlug) {
    const match = tvGenres.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect("/tv/underrated", 301);
    genre = match;
  }
  const lower = genre.toLowerCase();
  const { sort } = parseChartFilters(c, genre);
  const filters = { genre, year: null, sort };
  const results = await fetchTvUnderratedResults(c, { genre, sort });

  const champ = results[0] ?? null;
  let art: { x1: string; x2?: string } | null = null;
  if (champ?.tmdb_id && c.env.TMDB_API_KEY) {
    art = await tmdbBackdrop(c.env.TMDB_API_KEY, champ.tmdb_id);
  }
  if (!art && champ) {
    const p = posterSrc(champ);
    if (p) art = { x1: p.src };
  }
  const champTrailer =
    champ?.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbTrailer(c.env.TMDB_API_KEY, "tv", champ.tmdb_id)
      : null;
  const seasonCounts = await showSeasonCounts(
    c.env.DB,
    results.slice(0, CHART_PAGE_SIZE).map((s) => s.id),
  );
  const showMeta = (s: ShowRow) => {
    const n = s.id != null ? seasonCounts.get(s.id) : undefined;
    if (n && n > 0) return `${n} Season${n === 1 ? "" : "s"}`;
    if (s.premiered) return s.premiered.slice(0, 4);
    return s.network ?? s.web_channel ?? "TV Series";
  };

  const pageTitle = genre ? `Underrated ${genre} shows` : "Underrated TV shows";
  const site = origin(c);
  const year = new Date().getFullYear();
  const sidebar = c.get("siteSidebar");
  const [chartArt, yearArt, episodesArt, compareArt] = await loadTvChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    champ,
    results[1] ?? null,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — Hidden Gems to Stream | TV Nightly`}
      description={`${pageTitle} — highly rated but overlooked series${champ ? ` like ${champ.name}` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      noindex={!results.length}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: pageTitle,
          itemListElement: results.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "TV shows", item: `${site}/top/tv` },
            { "@type": "ListItem", position: 2, name: pageTitle, item: canonical(c) },
          ],
        },
      ]}
    >
      <ChartHeroHead
        eyebrow="Hidden gems"
        title={pageTitle}
        intro={`Great ${genre ? `${lower} ` : ""}series that flew under the radar — high ratings, smaller audience, ranked so the best-kept secrets come first.`}
      >
        <a
          class="verdict-btn"
          href={`/what-to-watch?type=tv${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`}
        >
          Surprise me with one
        </a>
        <a class="btn-ghost" href={genre ? `/tv/best/${year}/${genreSlug}` : `/tv/best/${year}`}>
          Best of {year}
        </a>
      </ChartHeroHead>

      <div class="home-main-grid">
        <div class="home-col">
      {champ ? (
        <div class="chart-hero-spotlight-wrap">
          <ChartSpotlight
            featured={{
              href: `/show/${champ.slug}`,
              name: champ.name,
              poster: posterSrc(champ),
              trailer: champTrailer,
              fallbackBackdrop: art,
              rating: champ.rating,
            }}
          />
        </div>
      ) : null}
      <ChartFilterBar kind="tv" filters={filters} genres={tvGenres} guideUnderrated />
      {!results.length ? (
        <p class="muted">No underrated {genre ? `${lower} ` : ""}shows match yet — try another genre.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one show matches these filters — it&apos;s featured above.</p>
      ) : (
        <ChartRankGrid
          more={{
            kind: "tv",
            filters,
            genreSlug,
            total: results.length,
            guideUnderrated: true,
          }}
        >
          {results.slice(1, CHART_PAGE_SIZE + 1).map((s, i) => (
            <ChartRankCard {...showChartRankItem(s, i + 2, showMeta(s))} />
          ))}
        </ChartRankGrid>
      )}

      <KeepExploring
        cards={[
          {
            icon: "The chart",
            title: genre ? `Top ${lower} shows, all time` : "Top TV shows of all time",
            desc: "The all-time ranking by viewer rating, with where to stream.",
            href: genre ? `/top/tv/${genreSlug}` : "/top/tv",
            backdrop: chartArt,
          },
          {
            icon: "Watch guide",
            title: genre ? `Best ${lower} shows of ${year}` : `Best shows of ${year}`,
            desc: "The acclaimed series to watch this year.",
            href: genre ? `/tv/best/${year}/${genreSlug}` : `/tv/best/${year}`,
            backdrop: yearArt,
          },
          {
            icon: "Shortcut",
            title: "All-time best episodes",
            desc: "The single greatest hours of television, across every show.",
            href: "/best-episodes",
            backdrop: episodesArt,
          },
          {
            icon: "Compare",
            title: "Compare two shows",
            desc: "Episode ratings head-to-head on one chart — settle the argument.",
            href: "/compare",
            backdrop: compareArt,
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

app.get("/tv/underrated/:genre", (c) => underratedPage(c, c.req.param("genre")));
app.get("/tv/underrated", (c) => {
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/tv/underrated/${slugifyName(g)}`, 301);
  return underratedPage(c);
});

// --------------------------------------------- Best TV shows featuring [actor]

app.get("/tv/featuring/:slug", async (c) => {
  const slug = c.req.param("slug");
  const idMatch = /-(\d+)$/.exec(slug);
  if (!idMatch) return c.notFound();
  // Same enriched roles as the person page (D1 + the rest from TMDB) — the
  // credits table alone misses most of a live-led actor's shows and bounced
  // this page straight back to /person.
  const profile = await resolvePersonProfile(c, Number(idMatch[1]));
  if (!profile) return c.notFound();
  const { person, roles: shows, films } = profile;
  // one canonical URL per person — name drift 301s to the real slug
  const canonicalSlug = `${slugifyName(person.name)}-${person.id}`;
  if (slug !== canonicalSlug) return c.redirect(`/tv/featuring/${canonicalSlug}`, 301);
  // no TV roles on record → the person page is the right destination
  if (!shows.length) return c.redirect(`/person/${canonicalSlug}`, 302);

  const region = visitorRegion(c);
  const site = origin(c);
  const best = shows.find((s) => s.rating != null) ?? null;
  const rated = shows.filter((s) => s.rating != null);
  const avg = rated.length
    ? (rated.reduce((sum, s) => sum + s.rating!, 0) / rated.length).toFixed(1)
    : null;
  const { art, ambient } = await topArt(c, shows[0]);
  const first = person.name.split(" ")[0];
  const sidebar = c.get("siteSidebar");
  const apiKey = c.env.TMDB_API_KEY;
  const bestFilm = films.find((m) => m.rating != null) ?? films[0] ?? null;
  const profileSpot = shows.find((s) => s.slug !== best?.slug) ?? shows[0] ?? null;
  const [bestArt, profileArt, moviesArt] = await Promise.all([
    best ? showKeepGoingBackdrop(apiKey, best) : Promise.resolve(null),
    profileSpot ? showKeepGoingBackdrop(apiKey, profileSpot) : Promise.resolve(null),
    bestFilm ? movieKeepGoingBackdrop(apiKey, bestFilm) : Promise.resolve(null),
  ]);
  const featuringDoors = fillKeepGoingBackdrops([
    ...(best
      ? [
          {
            icon: "Highest rated",
            title: best.name,
            desc: `${first}'s best-reviewed series — rating and where to watch.`,
            href: `/show/${best.slug}`,
            backdrop: bestArt,
          },
        ]
      : []),
    {
      icon: "Profile",
      title: `${person.name}: shows, age & roles`,
      desc: "The full profile — every TV role and film credit on one page.",
      href: `/person/${canonicalSlug}`,
      backdrop: profileArt,
    },
    {
      icon: "Movies",
      title: `Best movies featuring ${first}`,
      desc: "The film side — every credit ranked by viewer rating.",
      href: `/movies/featuring/${canonicalSlug}`,
      backdrop: moviesArt,
    },
  ]);

  const faqs = [
    {
      q: `What is ${person.name}'s best TV show?`,
      a: best
        ? `${best.name}${showYears(best) ? ` (${showYears(best)})` : ""} is ${person.name}'s highest-rated series here, at ★ ${best.rating!.toFixed(1)}.`
        : `We track ${shows.length} ${person.name} ${shows.length === 1 ? "show" : "shows"}, ranked on this page.`,
    },
    {
      q: `How many TV shows has ${person.name} been in?`,
      a: `We track ${shows.length} ${person.name} ${shows.length === 1 ? "show" : "shows"}${avg ? `, averaging ★ ${avg}` : ""} — ranked here by viewer rating.`,
    },
    {
      q: `Where can I watch ${first}'s shows?`,
      a: `Each series links to its page with live streaming availability for your country.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Best TV Shows Featuring ${person.name} — Ranked | TV Nightly`}
      description={`Every ${person.name} TV show we track, ranked by viewer rating${best ? ` — from ${best.name} down` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      ogImage={person.image_url ?? undefined}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `Best TV shows featuring ${person.name}`,
          itemListElement: shows.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "TV shows", item: `${site}/top/tv` },
            { "@type": "ListItem", position: 2, name: person.name, item: `${site}/person/${canonicalSlug}` },
            { "@type": "ListItem", position: 3, name: "Best TV shows", item: canonical(c) },
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
          <p class="section-eyebrow">TV roles</p>
          <h1>Best TV shows featuring {person.name}</h1>
          <p class="wo-intro">
            Every {person.name} series we track, ranked by real viewer rating
            {best ? <> — led by <a href={`/show/${best.slug}`}>{best.name}</a> at <IconStar class="rating-star" /> {best.rating!.toFixed(1)}</> : null}
            . Where to stream each is one tap away.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href={`/person/${canonicalSlug}`}>
              {first}'s full profile
            </a>
            <a class="btn-ghost" href="/top/tv">
              Top TV shows, ranked
            </a>
          </p>
          </div>
        </div>
      </header>

      <div class="home-main-grid">
        <div class="home-col">
      <section class="hub-sec">
        <h2>
          {person.name}'s shows, ranked <span class="sched-count">{shows.length}</span>
        </h2>
        <ShowRankList rows={shows} region={region} />
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
              {...(best && card.href === `/show/${best.slug}`
                ? { rating: best.rating ?? undefined }
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
