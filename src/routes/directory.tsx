import { Hono } from "hono";
import type { FC } from "hono/jsx";
import type { Child } from "hono/jsx";
import { Layout } from "../components/Layout";
import { MovieCard, ShowCard } from "../components/cards";
import { ChartFilterBar } from "../components/chart-filters";
import { ChartHeroHead, ChartSpotlight } from "../components/chart-hero";
import {
    ChartRankCard,
    ChartRankGrid,
    movieChartRankItem,
    showChartRankItem,
} from "../components/chart-rank-card";
import { HomeSidebarRail } from "../components/home-sidebar";
import { IconStar } from "../components/icons";
import {
    KeepExploring,
    loadMovieChartDoorArts,
    loadTvChartDoorArts,
    movieKeepGoingBackdrop,
    showKeepGoingBackdrop,
    spreadExploreArts,
} from "../components/keep-going";
import { chartBasePath, chartUrl, networkChartUrl, resolveChartPage, resolveNetworkChartPage, type GenreChartSurface } from "../lib/chart-filters";
import {
    CHART_PAGE_SIZE,
    fetchMovieChartResults,
    fetchTvChartResults,
} from "../lib/chart-results";
import {
    fetchNetworkMovieChartResults,
    fetchNetworkTvChartResults,
    listNetworkFilterOptions,
    networkHasStreamingCatalog,
    resolveNetwork,
    regionTester,
} from "../lib/network-chart";
import { genreShowArt, hubArt, networkShowArt, type ExploreArt } from "../lib/explore-art";
import { heroBg, hiRes, posterSrc, slugifyName } from "../lib/format";
import { FRANCHISE_BY_SLUG } from "../lib/franchises";
import { networkLogo, networkLogoForBrand, visitorRegion } from "../lib/providers";
import { genreDirectory, networkDirectory, showSeasonCounts } from "../lib/queries";
import { liveTonight } from "../lib/schedule-live";
import { breadcrumbTrail, canonical, itemListLd, origin } from "../lib/seo";
import {
    movieSpotlightTrailer,
    tmdbBackdrop,
    tmdbDiscoverGenre,
    tmdbGenreId,
    tmdbMovieBackdrop,
    tmdbTrailer
} from "../lib/tmdb";
import {
    movieBundleId,
    resolveMovie,
    resolveMovieBundleId,
} from "../lib/tmdb-show";
import { VERTICALS, Vertical, genreBinds, genreOr, hubForGenres } from "../lib/verticals";
import type { AppContext } from "../types";
import { Bindings, HonoEnv, MovieRow, ShowRow } from "../types";

// minimal context shape the live-blend helpers need (DB + TMDB key)
type Ctx = { env: Bindings };

/** Backdrops for network hub Keep exploring doors. */
async function loadNetworkDoorArts(
  c: AppContext,
  opts: {
    networkName?: string | null;
    leadShow?: ShowRow | null;
    runnerShow?: ShowRow | null;
    leadMovie?: MovieRow | null;
    runnerMovie?: MovieRow | null;
  },
): Promise<{ networks: ExploreArt; tonight: ExploreArt; tailored: ExploreArt }> {
  const apiKey = c.env.TMDB_API_KEY;
  const tonightHead = (await liveTonight(c))[0] ?? null;
  const [networks, tonight, tailored] = await Promise.all([
    opts.networkName && apiKey
      ? networkShowArt(c.env.DB, apiKey, opts.networkName)
      : opts.leadShow
        ? showKeepGoingBackdrop(apiKey, opts.leadShow)
        : opts.leadMovie
          ? movieKeepGoingBackdrop(apiKey, opts.leadMovie)
          : Promise.resolve(null),
    tonightHead
      ? showKeepGoingBackdrop(apiKey, {
          tmdb_id: null,
          image_url: tonightHead.show_image,
          poster_url: tonightHead.show_poster,
        })
      : opts.leadShow
        ? showKeepGoingBackdrop(apiKey, opts.leadShow)
        : opts.leadMovie
          ? movieKeepGoingBackdrop(apiKey, opts.leadMovie)
          : Promise.resolve(null),
    opts.runnerShow
      ? showKeepGoingBackdrop(apiKey, opts.runnerShow)
      : opts.runnerMovie
        ? movieKeepGoingBackdrop(apiKey, opts.runnerMovie)
        : opts.leadMovie
          ? movieKeepGoingBackdrop(apiKey, opts.leadMovie)
          : opts.leadShow
            ? showKeepGoingBackdrop(apiKey, opts.leadShow)
            : Promise.resolve(null),
  ]);
  return spreadExploreArts({ networks, tonight, tailored });
}

/** Backdrops for the /lists browse hub footer. */
async function loadBrowseDoorArts(c: AppContext): Promise<{
  charts: ExploreArt;
  networks: ExploreArt;
  news: ExploreArt;
}> {
  const apiKey = c.env.TMDB_API_KEY;
  const [topShow, topMovie, topNet] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM shows WHERE rating IS NOT NULL AND weight >= 75
       ORDER BY rating DESC, weight DESC LIMIT 1`,
    ).first<ShowRow>(),
    c.env.DB.prepare(
      `SELECT * FROM movies WHERE rating IS NOT NULL AND votes >= 1000
       ORDER BY rating DESC, votes DESC LIMIT 1`,
    ).first<MovieRow>(),
    c.env.DB.prepare(
      `SELECT COALESCE(network, web_channel) AS n FROM shows
       WHERE rating IS NOT NULL AND weight >= 60 AND (network IS NOT NULL OR web_channel IS NOT NULL)
       GROUP BY n ORDER BY MAX(rating) DESC LIMIT 1`,
    ).first<{ n: string }>(),
  ]);
  const [charts, networks, news] = await Promise.all([
    topShow ? showKeepGoingBackdrop(apiKey, topShow) : Promise.resolve(null),
    topNet?.n && apiKey ? networkShowArt(c.env.DB, apiKey, topNet.n) : Promise.resolve(null),
    topMovie ? movieKeepGoingBackdrop(apiKey, topMovie) : Promise.resolve(null),
  ]);
  return spreadExploreArts({ charts, networks, news });
}

const app = new Hono<HonoEnv>();

// "Pick me an action show" vs "a drama" — genre names decide the article
const aOrAn = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");

const showProvLinks = (s: {
  network: string | null;
  web_channel: string | null;
  genres: string | null;
}) => {
  const links: { href: string; label: string }[] = [];
  const home = s.network ?? s.web_channel ?? null;
  if (home) links.push({ href: `/network/${slugifyName(home)}`, label: home });
  const genres: string[] = s.genres ? JSON.parse(s.genres) : [];
  for (const g of genres.slice(0, 2)) {
    links.push({ href: `/genre/${slugifyName(g)}/shows`, label: g });
  }
  return links;
};

const FEATURED = [
  {
    kicker: "Charts",
    title: "Top TV shows",
    desc: "The highest-rated series we track, ranked honestly.",
    href: "/top/tv",
  },
  {
    kicker: "Shortcut",
    title: "All-time best episodes",
    desc: "The single greatest hours of television, across every show.",
    href: "/best-episodes",
  },
  {
    kicker: "Film",
    title: "Top movies",
    desc: "The best films of all time, with where to stream them.",
    href: "/movies/best",
  },
  {
    kicker: "Community",
    title: "Most loved",
    desc: "What TV Nightly visitors actually loved — voted here, not imported.",
    href: "/loved",
  },
  {
    kicker: "Matchup",
    title: "Compare two shows",
    desc: "Episode-by-episode rating history, head to head on one chart.",
    href: "/compare",
  },
  {
    kicker: "Guides",
    title: "Watch-order guides",
    desc: "Marvel, Star Wars, Middle-earth — release vs chronological, fact-checked.",
    href: "/watch-orders",
  },
] as const;

async function lovedFeaturedArt(
  db: D1Database,
  key: string,
): Promise<{ x1: string; x2?: string } | null> {
  const top = await db
    .prepare(
      `SELECT kind, ref FROM (
         SELECT kind, ref, (loved + liked + meh) AS total,
                (loved + 0.5 * liked) / CAST(loved + liked + meh AS REAL) AS score
         FROM title_ratings
       ) WHERE total >= 2 ORDER BY score DESC, total DESC LIMIT 1`,
    )
    .first<{ kind: string; ref: string }>();
  if (!top) return null;
  if (top.kind === "tv") {
    const s = await db
      .prepare(`SELECT tmdb_id, image_url FROM shows WHERE id = ?`)
      .bind(Number(top.ref))
      .first<{ tmdb_id: number | null; image_url: string | null }>();
    if (s?.tmdb_id) {
      const bd = await tmdbBackdrop(key, s.tmdb_id);
      if (bd) return bd;
    }
    const p = hiRes(s?.image_url ?? null);
    return p ? { x1: p } : null;
  }
  const bd = await tmdbMovieBackdrop(key, top.ref);
  if (bd) return bd;
  const m = await db
    .prepare(`SELECT poster_url FROM movies WHERE imdb_id = ?`)
    .bind(top.ref)
    .first<{ poster_url: string | null }>();
  return m?.poster_url ? { x1: m.poster_url } : null;
}

async function movieFeaturedArt(
  db: D1Database,
  key: string,
): Promise<{ x1: string; x2?: string } | null> {
  const top = await db
    .prepare(
      `SELECT imdb_id, poster_url FROM movies
       WHERE rating IS NOT NULL AND votes >= 1000
       ORDER BY rating DESC, votes DESC LIMIT 1`,
    )
    .first<{ imdb_id: string; poster_url: string | null }>();
  if (!top?.imdb_id) return top?.poster_url ? { x1: top.poster_url } : null;
  const bd = await tmdbMovieBackdrop(key, top.imdb_id);
  if (bd) return bd;
  return top.poster_url ? { x1: top.poster_url } : null;
}

/** Backdrop art for the six featured doors — each wears its destination's
 *  reigning #1, never stock. */
async function featuredArts(c: { env: Bindings }): Promise<({ x1: string; x2?: string } | null)[]> {
  const key = c.env.TMDB_API_KEY;
  const blank = new Array<null>(FEATURED.length).fill(null);
  if (!key) return blank;
  try {
    const [topShow, topEp, topMovieArt, compareShow, lovedArt, guideArt] = await Promise.all([
      c.env.DB.prepare(
        `SELECT tmdb_id FROM shows WHERE rating IS NOT NULL AND weight >= 75
         ORDER BY rating DESC, weight DESC LIMIT 1`,
      ).first<{ tmdb_id: number }>(),
      c.env.DB.prepare(
        `SELECT s.tmdb_id FROM episodes e JOIN shows s ON s.id = e.show_id
         WHERE e.rating IS NOT NULL AND s.tmdb_id IS NOT NULL
         ORDER BY e.rating DESC LIMIT 1`,
      ).first<{ tmdb_id: number }>(),
      movieFeaturedArt(c.env.DB, key),
      c.env.DB.prepare(
        `SELECT tmdb_id FROM shows WHERE rating IS NOT NULL AND weight >= 75
         ORDER BY rating DESC, weight DESC LIMIT 1 OFFSET 2`,
      ).first<{ tmdb_id: number }>(),
      lovedFeaturedArt(c.env.DB, key),
      guidesHubCardArt(c.env.DB, key),
    ]);
    return await Promise.all([
      topShow?.tmdb_id ? tmdbBackdrop(key, topShow.tmdb_id) : null,
      topEp?.tmdb_id ? tmdbBackdrop(key, topEp.tmdb_id) : null,
      topMovieArt,
      lovedArt,
      compareShow?.tmdb_id ? tmdbBackdrop(key, compareShow.tmdb_id) : null,
      guideArt,
    ]);
  } catch {
    return blank;
  }
}

/** Faint card backdrops for the browse hub grid — each hub's own #1 title. */
async function hubCardArt(
  db: D1Database,
  key: string | undefined,
  v: Vertical,
): Promise<{ x1: string; x2?: string } | null> {
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

  const [topShow, topMovie] = await Promise.all([
    v.tvGenres?.length
      ? db
          .prepare(
            `SELECT tmdb_id, image_url FROM shows
             WHERE ${genreOr("genres", v.tvGenres)} AND rating IS NOT NULL AND weight >= 60
             ORDER BY rating DESC, weight DESC LIMIT 1`,
          )
          .bind(...genreBinds(v.tvGenres))
          .first<{ tmdb_id: number | null; image_url: string | null }>()
      : null,
    db
      .prepare(
        `SELECT imdb_id, poster_url FROM movies WHERE ${movieConds.join(" AND ")}
         ORDER BY rating DESC, votes DESC LIMIT 1`,
      )
      .bind(...movieBinds)
      .first<{ imdb_id: string; poster_url: string | null }>(),
  ]);

  if (key) {
    if (topShow?.tmdb_id) {
      const bd = await tmdbBackdrop(key, topShow.tmdb_id);
      if (bd) return bd;
    }
    if (!topShow && topMovie?.imdb_id) {
      const bd = await tmdbMovieBackdrop(key, topMovie.imdb_id);
      if (bd) return bd;
    }
  }
  const p = topShow ? hiRes(topShow.image_url) : (topMovie?.poster_url ?? null);
  return p ? { x1: p } : null;
}

async function guidesHubCardArt(
  db: D1Database,
  key: string | undefined,
): Promise<{ x1: string; x2?: string } | null> {
  const opener = FRANCHISE_BY_SLUG.get("star-wars")?.entries[0];
  if (!opener) return null;
  const rep = await db
    .prepare(
      `SELECT imdb_id, poster_url FROM movies
       WHERE title = ? AND year BETWEEN ? AND ? AND imdb_id IS NOT NULL
       ORDER BY rating DESC LIMIT 1`,
    )
    .bind(opener.title, opener.year - 1, opener.year + 1)
    .first<{ imdb_id: string; poster_url: string | null }>();
  if (key && rep?.imdb_id) {
    const bd = await tmdbMovieBackdrop(key, rep.imdb_id);
    if (bd) return bd;
  }
  return rep?.poster_url ? { x1: rep.poster_url } : null;
}

async function hubCardArts(c: { env: Bindings }): Promise<({ x1: string; x2?: string } | null)[]> {
  const key = c.env.TMDB_API_KEY;
  return Promise.all(VERTICALS.map((v) => hubCardArt(c.env.DB, key, v)));
}

const hubCardBg = (art: { x1: string; x2?: string } | null): string | undefined =>
  art ? `--hub-art:url('${(art.x2 ?? art.x1).replace(/'/g, "%27")}')` : undefined;

const NET_COPY: { match: RegExp; line: string }[] = [
  { match: /\bhbo\b|\bmax\b/i, line: "Prestige drama and limited series — appointment television with a budget line to match." },
  { match: /netflix/i, line: "Global originals at volume — binge drops, true crime, and something for every mood." },
  { match: /apple/i, line: "Curated and cinematic — fewer shows, but most of them look like movies." },
  { match: /disney/i, line: "Franchise gravity — Marvel, Star Wars, and the family canon under one roof." },
  { match: /prime|amazon/i, line: "Wide catalog, global reach — originals riding alongside the everything bundle." },
  { match: /hulu/i, line: "Next-day network TV and bold originals — the cord-cutter's living room." },
  { match: /\bfx\b/i, line: "Adult-skewing prestige — antiheroes, auteurs, and water-cooler risk-taking." },
  { match: /amc/i, line: "Genre-defining cable drama — proof that basic cable could outclass broadcast." },
  { match: /paramount/i, line: "Legacy studios meet streaming — depth from CBS plus Paramount+ originals." },
  { match: /peacock/i, line: "Broadcast heritage streaming — NBC next-day, sports, and reboot season." },
  { match: /showtime/i, line: "Premium cable grit — crime, comedy, and a reputation for going there." },
  { match: /starz/i, line: "Premium genre fare — historical epics, crime, and franchise deep cuts." },
  { match: /syfy/i, line: "Science fiction and fantasy — cult genre TV with cult followings." },
  { match: /bbc/i, line: "British broadcasting gold — period drama, documentary, and dry wit." },
  { match: /\bnbc\b/i, line: "Broad mainstream reach — sitcoms, procedurals, and live spectacle." },
  { match: /\bcbs\b/i, line: "Procedural machines and comfort classics — the most-watched playbook." },
  { match: /\babc\b/i, line: "Broadcast tentpoles — soaps, Shondaland, and family event TV." },
  { match: /\bcw\b/i, line: "Young-adult genre television — superhero soaps and long-running cult hooks." },
  { match: /adult swim/i, line: "Late-night irreverence — animation, absurdism, and midnight cult." },
  { match: /\btnt\b/i, line: "Populist drama and sports — broad-appeal scripted with event-TV energy." },
];

const NET_COLORS: { match: RegExp; bg: string }[] = [
  { match: /\bhbo\b|\bmax\b/i, bg: "#3b1a7a" },
  { match: /netflix/i, bg: "#8f0a12" },
  { match: /apple/i, bg: "#2a2a2e" },
  { match: /disney/i, bg: "#0c2480" },
  { match: /prime|amazon/i, bg: "#0a4d6e" },
  { match: /hulu/i, bg: "#0d3d24" },
  { match: /\bfx\b/i, bg: "#141414" },
  { match: /amc/i, bg: "#3a2414" },
  { match: /paramount/i, bg: "#0047c7" },
  { match: /peacock/i, bg: "#061428" },
  { match: /showtime/i, bg: "#7a0a18" },
  { match: /starz/i, bg: "#1a1018" },
  { match: /syfy/i, bg: "#1a2840" },
  { match: /bbc/i, bg: "#0a2850" },
  { match: /\bnbc\b/i, bg: "#6a1078" },
  { match: /\bcbs\b/i, bg: "#0a2858" },
  { match: /\babc\b/i, bg: "#5c4808" },
  { match: /\bcw\b/i, bg: "#0a4028" },
  { match: /adult swim/i, bg: "#1a2848" },
  { match: /\btnt\b/i, bg: "#4a1018" },
];

const networkTagline = (name: string) =>
  NET_COPY.find(({ match }) => match.test(name))?.line ??
  "Every series we track on this network — with streaming availability in your country.";

/** Brand tint for ambient glow — not flat card fills. */
const networkGlow = (name: string) => {
  const hit = NET_COLORS.find(({ match }) => match.test(name));
  if (hit) return hit.bg;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 42% 42%)`;
};

const networkEyebrow = (name: string) =>
  /netflix|hulu|disney|prime|amazon|apple|paramount|peacock|\bmax\b|showtime|starz|fubo/i.test(name)
    ? "Streamer"
    : "Network";

async function networkHeroArt(
  key: string | undefined,
  best: ShowRow[],
  films: MovieRow[],
): Promise<{ art: { x1: string; x2?: string } | null; ambient: boolean }> {
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (key) {
    art = best[0]?.tmdb_id
      ? await tmdbBackdrop(key, best[0].tmdb_id)
      : films[0]
        ? await tmdbMovieBackdrop(key, films[0].imdb_id)
        : null;
  }
  if (!art) {
    const p = best[0] ? hiRes(best[0].image_url) : (films[0]?.poster_url ?? null);
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }
  return { art, ambient };
}

const NetworkHero: FC<{
  name: string;
  art: { x1: string; x2?: string } | null;
  ambient: boolean;
  eyebrow: string;
  title: string;
  intro: string;
  stats?: { label: string; value: string }[];
  children?: unknown;
}> = ({ name, art, ambient, eyebrow, title, intro, children }) => (
  <header
    class={`net-hero wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}${art ? "" : " net-hero-glow-only"}`}
    style={`--net-glow: ${networkGlow(name)}`}
  >
    <span class="net-hero-glow" aria-hidden="true"></span>
    {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
    <div class="wo-hero-body">
      <div class="net-hero-head">
        <span class="net-hero-logo">
          <NetLogo name={name} size="lg" />
        </span>
        <div class="net-hero-copy">
          <p class="section-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p class="wo-intro">{intro}</p>
        </div>
      </div>
      {children ? <p class="hub-actions">{children}</p> : null}
    </div>
  </header>
);

const NetworkKeepExploring: FC<{
  doors: { networks: ExploreArt; tonight: ExploreArt; tailored: ExploreArt };
}> = ({ doors }) => (
  <KeepExploring
    cards={[
      {
        icon: "Networks",
        title: "All networks ranked",
        desc: "Netflix, HBO, Disney+, and every major home — browse by brand.",
        href: "/top/networks",
        backdrop: doors.networks,
      },
      {
        icon: "Tonight",
        title: "What's actually on",
        desc: "Tonight's schedule, in air-time order.",
        href: "/tonight",
        backdrop: doors.tonight,
      },
      {
        icon: "Tailored",
        title: "Rate one thing, get a pick",
        desc: "The recommender finds your next watch from one rating.",
        href: "/recommend",
        backdrop: doors.tailored,
      },
    ]}
  />
);

const BrowseKeepExploring: FC<{
  doors: { charts: ExploreArt; networks: ExploreArt; news: ExploreArt };
}> = ({ doors }) => (
  <KeepExploring
    cards={[
      {
        icon: "Charts",
        title: "Top TV shows",
        desc: "The highest-rated series we track — ranked honestly.",
        href: "/top/tv",
        backdrop: doors.charts,
      },
      {
        icon: "Networks",
        title: "All networks ranked",
        desc: "Netflix, HBO, Disney+, and every major home by quality.",
        href: "/top/networks",
        backdrop: doors.networks,
      },
      {
        icon: "News",
        title: "Streaming news",
        desc: "What just landed, what's leaving, and what's coming.",
        href: "/whats-new",
        backdrop: doors.news,
      },
    ]}
  />
);

const TOOLS: [string, string][] = [
  ["What to watch", "/what-to-watch"],
  ["Tonight's schedule", "/tonight"],
  ["Full TV calendar", "/calendar"],
  ["Get a recommendation", "/recommend"],
];

// Major streamers & networks first — the names people actually search for.
const HEADLINE_PATTERNS: RegExp[] = [
  /netflix/i,
  /hulu/i,
  /\bhbo\b|hbo max/i,
  /disney/i,
  /prime video|amazon prime/i,
  /apple tv/i,
  /paramount/i,
  /peacock/i,
  /showtime/i,
  /\bfx\b/i,
  /amc/i,
  /\bnbc\b/i,
  /\bcbs\b/i,
  /\babc\b/i,
  /\bcw\b/i,
  /syfy/i,
  /bbc one/i,
  /bbc two/i,
  /adult swim/i,
  /starz/i,
  /\btnt\b/i,
];

type BrowseNet = { name: string; slug: string; count: number };

function sortBrowseNetworks(networks: BrowseNet[]): BrowseNet[] {
  const used = new Set<string>();
  const sorted: BrowseNet[] = [];
  for (const pat of HEADLINE_PATTERNS) {
    const hit = networks.find((n) => !used.has(n.name) && pat.test(n.name));
    if (hit) {
      sorted.push(hit);
      used.add(hit.name);
    }
  }
  for (const n of networks) {
    if (!used.has(n.name)) sorted.push(n);
  }
  return sorted;
}

const NetLogo: FC<{ name: string; size?: "lg" | "md" | "sm"; wordmark?: boolean }> = ({
  name,
  size = "md",
  wordmark,
}) => {
  const src = wordmark ? networkLogoForBrand(name) : networkLogo(name);
  const cls = `net-logo net-logo-${size}${wordmark ? " net-logo-wordmark" : ""}`;
  const px = size === "lg" ? 56 : size === "md" ? 44 : 36;
  if (src) {
    return wordmark ? (
      <img class={cls} src={src} alt="" loading="lazy" decoding="async" />
    ) : (
      <img class={cls} src={src} alt="" width={px} height={px} loading="lazy" decoding="async" />
    );
  }
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <span class={`${cls} net-logo-fallback`} aria-hidden="true">
      {initials}
    </span>
  );
};

const NetBrandCard: FC<{ name: string; href: string }> = ({ name, href }) => (
  <a class="net-brand" href={href} style={`--net-brand: ${networkGlow(name)}`}>
    <span class="net-brand-copy">
      <h2 class="net-brand-name">{name}</h2>
    </span>
    <span class="net-brand-logo">
      <NetLogo name={name} wordmark />
    </span>
  </a>
);

const BrowseNetTile: FC<{ name: string; slug: string }> = ({ name, slug }) => (
  <a class="browse-net-tile" href={`/network/${slug}`}>
    <span class="browse-net-logo">
      <NetLogo name={name} size="md" />
    </span>
    <span class="browse-net-name">{name}</span>
  </a>
);

const BrowseTile: FC<{
  kicker: string;
  title: string;
  desc: string;
  href: string;
  hero?: boolean;
  art?: { x1: string; x2?: string } | null;
}> = ({ kicker, title, desc, href, hero, art }) => (
  <a
    class={`browse-tile${hero ? " browse-tile-hero" : ""}${art ? "" : " browse-tile-plain"}`}
    href={href}
  >
    {art ? (
      <span class="browse-tile-art" style={heroBg(art.x1, art.x2)} aria-hidden="true"></span>
    ) : null}
    <span class="browse-tile-body">
      <span class="browse-tile-kicker">{kicker}</span>
      <strong>{title}</strong>
      <span class="browse-tile-dek">{desc}</span>
    </span>
    <span class="chev-icon browse-tile-chev" aria-hidden="true"></span>
  </a>
);

app.get("/lists", async (c) => {
  const [networks, genres, arts, hubArts, browseDoors] = await Promise.all([
    networkDirectory(c.env.DB),
    genreDirectory(c.env.DB),
    featuredArts(c),
    hubCardArts(c),
    loadBrowseDoorArts(c),
  ]);
  const year = new Date().getFullYear();
  const CHARTS: [string, string][] = [
    ["Top TV shows", "/top/tv"],
    ["Top movies", "/movies/best"],
    ["Top TV seasons", "/top/seasons"],
    ["All-time top episodes", "/best-episodes"],
    ["Best TV of the 2010s", "/tv/best/2010s"],
    ["Upcoming TV shows", "/upcoming"],
    [`Emmy Awards ${year}`, `/awards/emmys/${year}`],
    [`Golden Globe Awards ${year}`, `/awards/golden-globes/${year}`],
    ["Actors", "/actors"],
    ["Directors", "/directors"],
    ["Halloween horror TV", "/halloween"],
    ["Christmas TV", "/christmas-tv"],
    ["Thanksgiving episodes", "/best-thanksgiving-episodes"],
    ["Most loved (community)", "/loved"],
    ["Compare two shows", "/compare"],
    ["Compare two movies", "/movies/compare"],
    ["Upcoming TV premieres", "/premieres"],
    ["Upcoming movies", "/movies/upcoming"],
    ["Streaming arrivals", "/whats-new"],
    ["Renewals & cancellations", "/renewals"],
    ["Popular movies", "/movies"],
  ];
  // the year/genre guide pages get their own labelled block below
  const GUIDES: [string, string][] = [
    [`Best TV shows of ${year}`, `/tv/best/${year}`],
    [`Best movies of ${year}`, `/movies/best/${year}`],
    ["Best TV of the 2010s", "/tv/best/2010s"],
    ["Underrated TV shows", "/tv/underrated"],
    ["Underrated movies", "/movies/underrated"],
  ];
  const moreCharts = CHARTS.filter(
    ([, href]) =>
      !["/top/tv", "/movies/best", "/best-episodes", "/loved", "/compare"].includes(href),
  );
  const sortedNets = sortBrowseNetworks(networks);
  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      title="Browse — every chart, network & genre | TV Nightly"
      description="All of TV Nightly in one place: top charts, networks, genres, fandom hubs, and tools to pick your next watch."
      canonical={canonical(c)}
      ld={[
        itemListLd(
          "TV Nightly charts & guides",
          [...CHARTS, ...GUIDES].map(([name, href]) => ({ name, url: `${site}${href}` })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Browse everything", url: canonical(c) },
        ]),
      ]}
    >
      <div class="browse">
        <header class="browse-hero">
          <p class="section-eyebrow">Directory</p>
          <h1>Browse everything</h1>
          <p class="browse-lead muted">
            Charts, networks, genres, and fandom hubs — one map of everything TV Nightly tracks.
          </p>
          <div class="browse-hero-foot">
            <dl class="browse-stats">
              <div>
                <dt>Charts</dt>
                <dd>{CHARTS.length}</dd>
              </div>
              <div>
                <dt>Guides</dt>
                <dd>{GUIDES.length}</dd>
              </div>
              <div>
                <dt>Tools</dt>
                <dd>{TOOLS.length}</dd>
              </div>
              <div>
                <dt>Networks</dt>
                <dd>{networks.length}</dd>
              </div>
              <div>
                <dt>Genres</dt>
                <dd>{genres.tv.length + genres.movie.length}</dd>
              </div>
              <div>
                <dt>Hubs</dt>
                <dd>{VERTICALS.length}</dd>
              </div>
            </dl>
            <a class="browse-search" href="/search">
              Search all titles
              <span class="chev-icon" aria-hidden="true"></span>
            </a>
          </div>
        </header>

        <section class="browse-sec browse-featured">
          <div class="browse-sec-head">
            <div>
              <h2>Start here</h2>
              <p class="section-lead muted">The six doors everyone bookmarks.</p>
            </div>
          </div>
          <div class="browse-bento">
            {FEATURED.map((f, i) => (
              <BrowseTile {...f} hero={i < 2} art={arts[i]} />
            ))}
          </div>
        </section>

        <section class="browse-sec browse-duo">
          <div class="browse-duo-panel">
            <div class="browse-duo-col">
              <div class="browse-duo-head">
                <h2>More charts</h2>
                <p class="browse-duo-lead muted">Ranked lists, premieres, and what's new.</p>
              </div>
              <ul class="browse-index browse-index-grow" aria-label="More charts">
                {moreCharts.map(([label, href]) => (
                  <li>
                    <a href={href}>
                      <span class="browse-index-label">{label}</span>
                      <span class="chev-icon" aria-hidden="true"></span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div class="browse-duo-col">
              <div class="browse-duo-head">
                <h2>Tools</h2>
                <p class="browse-duo-lead muted">Pick, plan, and get a recommendation.</p>
              </div>
              <ul class="browse-index browse-index-grow" aria-label="Tools">
                {TOOLS.map(([label, href]) => (
                  <li>
                    <a href={href}>
                      <span class="browse-index-label">{label}</span>
                      <span class="chev-icon" aria-hidden="true"></span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section class="browse-sec">
          <div class="browse-sec-head">
            <div>
              <h2>Watch guides</h2>
              <p class="section-lead muted">
                Best-of-{year} picks and underrated gems, cut by genre.
              </p>
            </div>
          </div>
          <ul class="browse-index" aria-label="Watch guides">
            {GUIDES.map(([label, href]) => (
              <li>
                <a href={href}>
                  <span class="browse-index-label">{label}</span>
                  <span class="chev-icon" aria-hidden="true"></span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section class="browse-sec browse-nets">
          <div class="browse-nets-head">
            <div>
              <h2>TV networks</h2>
            </div>
            <div class="browse-nets-meta">
              <span class="browse-nets-count muted">
                {networks.length} {networks.length === 1 ? "network" : "networks"}
              </span>
              <a class="more" href="/top/networks">
                ranked by quality
              </a>
            </div>
          </div>
          <div class="browse-netgrid" role="list">
            {sortedNets.map((n) => (
              <BrowseNetTile name={n.name} slug={n.slug} />
            ))}
          </div>
        </section>

        <section class="browse-sec browse-genres">
          <div class="browse-sec-head">
            <div>
              <h2>Genres</h2>
              <p class="section-lead muted">Ranked charts for every TV and movie genre.</p>
            </div>
          </div>
          <div class="browse-genre-stack">
            <div class="browse-genre-pane">
              <div class="browse-genre-head">
                <h3 class="browse-subhead">TV genres</h3>
                <span class="browse-genre-count muted">
                  {genres.tv.length} {genres.tv.length === 1 ? "genre" : "genres"}
                </span>
              </div>
              <div class="browse-genre-grid" role="list" aria-label="TV genres">
                {genres.tv.map((g) => (
                  <a class="browse-genre-tile" href={`/genre/${slugifyName(g)}`} role="listitem">
                    {g}
                  </a>
                ))}
              </div>
            </div>
            <div class="browse-genre-pane">
              <div class="browse-genre-head">
                <h3 class="browse-subhead">Movie genres</h3>
                <span class="browse-genre-count muted">
                  {genres.movie.length} {genres.movie.length === 1 ? "genre" : "genres"}
                </span>
              </div>
              <div class="browse-genre-grid" role="list" aria-label="Movie genres">
                {genres.movie.map((g) => (
                  <a
                    class="browse-genre-tile"
                    href={`/genre/${slugifyName(g)}/movies`}
                    role="listitem"
                  >
                    {g}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section class="browse-sec">
          <div class="browse-sec-head">
            <div>
              <h2>Fandom hubs</h2>
              <p class="section-lead muted">Niche verticals — anime, horror, classics, sci-fi.</p>
            </div>
          </div>
          <div class="browse-hub-grid">
            {VERTICALS.map((v, i) => (
              <a class="browse-hub-card" href={`/${v.slug}`} style={hubCardBg(hubArts[i])}>
                <span class="browse-hub-kicker">Fandom hub</span>
                <strong>{v.name}</strong>
                <p>{v.intro.split("—")[0].trim()}</p>
              </a>
            ))}
          </div>
        </section>

        <BrowseKeepExploring doors={browseDoors} />
      </div>
    </Layout>,
  );
});

async function topTvChart(
  c: AppContext,
  genreSlug?: string,
  opts?: {
    canonicalUrl?: string;
    eyebrow?: string;
    pageTitle?: string;
    intro?: string;
    heroActions?: Child;
    guideGenre?: { surface: GenreChartSurface; slug: string };
  },
) {
  const { tv: tvGenres } = await genreDirectory(c.env.DB);
  const { filters, redirect } = resolveChartPage(
    c,
    "tv",
    tvGenres,
    genreSlug,
    !opts?.guideGenre,
  );
  if (redirect) return redirect;

  const results = await fetchTvChartResults(c, filters);

  const showYear = (s: ShowRow) => (s.premiered ? s.premiered.slice(0, 4) : null);

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

  const sidebar = c.get("siteSidebar");
  const [yearArt, underratedArt, episodesArt, compareArt] = await loadTvChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    champ,
    results[1] ?? null,
  );

  const gSlug = genreSlug ?? (filters.genre ? slugifyName(filters.genre) : "");
  const pageTitle =
    opts?.pageTitle ??
    (filters.genre
      ? `Best ${filters.genre} TV shows${filters.year ? ` of ${filters.year}` : ""}`
      : filters.year
        ? `Best TV shows of ${filters.year}`
        : "Best TV shows of all time");
  const site = origin(c);
  const canonicalOut = opts?.canonicalUrl ?? `${site}${chartUrl("tv", filters)}`;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — Top 100 Ranked | TV Nightly`}
      description={`${pageTitle}, ranked by viewer rating${results[0] ? ` — led by ${results[0].name}` : ""}.`}
      canonical={canonicalOut}
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
            name: `${s.name}${showYear(s) ? ` (${showYear(s)})` : ""}`,
            url: `${site}/show/${s.slug}`,
          })),
        },
      ]}
    >
      <ChartHeroHead
        eyebrow={opts?.eyebrow ?? "All-time top 100"}
        title={pageTitle}
        intro={
          opts?.intro ??
          "The greatest series ever ranked by viewer rating — weighted so a fluke never outranks the classics."
        }
      >
        {opts?.heroActions ?? (
          <>
            <a class="verdict-btn" href="/what-to-watch?type=tv">
              Pick me a show
            </a>
            <a class="btn-ghost" href="/premieres">
              What&apos;s coming next
            </a>
          </>
        )}
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
      <ChartFilterBar
        kind="tv"
        filters={filters}
        genres={tvGenres}
        {...(opts?.guideGenre ? { guideGenre: opts.guideGenre } : {})}
      />
      {!results.length ? (
        <p class="muted">Ratings are still loading — check back soon.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one show matches these filters — it&apos;s featured above.</p>
      ) : (
        <ChartRankGrid
          more={{
            kind: "tv",
            filters,
            genreSlug,
            total: results.length,
            ...(opts?.guideGenre
              ? { guideGenre: { surface: opts.guideGenre.surface, slug: opts.guideGenre.slug } }
              : {}),
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
            icon: "Watch guide",
            title: filters.genre
              ? `Best ${filters.genre.toLowerCase()} shows of ${new Date().getFullYear()}`
              : `Best shows of ${new Date().getFullYear()}`,
            desc: "The acclaimed series to watch this year, what's airing now first.",
            href: filters.genre
              ? `/tv/best/${new Date().getFullYear()}/${gSlug}`
              : `/tv/best/${new Date().getFullYear()}`,
            backdrop: yearArt,
          },
          {
            icon: "Hidden gems",
            title: filters.genre
              ? `Underrated ${filters.genre.toLowerCase()} shows`
              : "Underrated TV shows",
            desc: "High ratings, low profile — the great series most people have missed.",
            href: filters.genre ? `/tv/underrated/${gSlug}` : "/tv/underrated",
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

async function genreMovieChart(
  c: AppContext,
  genreSlug: string,
  opts?: {
    canonicalUrl?: string;
    eyebrow?: string;
    pageTitle?: string;
    intro?: string;
    heroActions?: Child;
    guideGenre?: { surface: GenreChartSurface; slug: string };
  },
) {
  const { movie: movieGenres } = await genreDirectory(c.env.DB);
  const { filters, redirect } = resolveChartPage(
    c,
    "movie",
    movieGenres,
    genreSlug,
    !opts?.guideGenre,
  );
  if (redirect) return redirect;
  const genre = filters.genre;

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

  const pageTitle =
    opts?.pageTitle ??
    (genre
      ? `The best ${genre.toLowerCase()} movies, ranked`
      : filters.year
        ? `The best movies of ${filters.year}, ranked`
        : "The best movies of all time, ranked");
  const year = new Date().getFullYear();
  const gSlug = genreSlug;
  const sidebar = c.get("siteSidebar");
  const [yearArt, underratedArt, ordersArt, lovedArt] = await loadMovieChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    top,
  );
  const site = origin(c);
  const canonicalOut = opts?.canonicalUrl ?? `${site}${chartUrl("movie", filters)}`;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} | TV Nightly`}
      description={`${pageTitle} by viewer rating${results[0] ? `, from ${results[0].title} down` : ""}.`}
      canonical={canonicalOut}
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
      ]}
    >
      <ChartHeroHead
        eyebrow={opts?.eyebrow ?? "The chart"}
        title={pageTitle}
        intro={
          opts?.intro ??
          "Ranked by viewer rating — a thousand-vote minimum, so nothing here is a fluke."
        }
      >
        {opts?.heroActions ?? (
          <>
            <a class="verdict-btn" href="/what-to-watch?type=movie">
              Pick me a movie
            </a>
            <a class="btn-ghost" href="/premieres?tab=movies">
              What&apos;s coming next
            </a>
          </>
        )}
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
      <ChartFilterBar
        kind="movie"
        filters={filters}
        genres={movieGenres}
        {...(opts?.guideGenre ? { guideGenre: opts.guideGenre } : {})}
      />
      {!results.length ? (
        <p class="muted">No rated movies for that filter yet.</p>
      ) : results.length === 1 ? (
        <p class="muted">Only one movie matches these filters — it&apos;s featured above.</p>
      ) : (
        <ChartRankGrid
          more={{
            kind: "movie",
            filters,
            genreSlug,
            total: results.length,
            ...(opts?.guideGenre
              ? { guideGenre: { surface: opts.guideGenre.surface, slug: opts.guideGenre.slug } }
              : {}),
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

async function networkTvChart(c: AppContext, slug: string) {
  const entry = await resolveNetwork(c.env.DB, slug);
  if (!entry) return c.notFound();
  const region = visitorRegion(c);
  const regionHas = regionTester(region, entry.name);

  const [networks, { tv: tvGenres }] = await Promise.all([
    listNetworkFilterOptions(c.env.DB, entry),
    genreDirectory(c.env.DB),
  ]);
  const hasMovies = networkHasStreamingCatalog(entry.name, c.env.TMDB_API_KEY);
  const genres = tvGenres;
  const { filters, redirect } = resolveNetworkChartPage(c, slug, "tv", genres);
  if (redirect) return redirect;

  const results = await fetchNetworkTvChartResults(c, entry, filters, region, regionHas);
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

  const pageTitle = filters.genre
    ? `Top ${filters.genre} shows on ${entry.name}${filters.year ? ` (${filters.year})` : ""}`
    : filters.year
      ? `Top ${entry.name} shows of ${filters.year}`
      : `Top ${entry.name} shows`;
  const gSlug = filters.genre ? slugifyName(filters.genre) : "";
  const site = origin(c);
  const [yearArt, underratedArt, episodesArt, compareArt] = await loadTvChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    champ,
    results[1] ?? null,
  );
  const sidebar = c.get("siteSidebar");

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — ranked | TV Nightly`}
      description={`The best TV shows on ${entry.name}, ranked by viewer rating${results[0] ? ` — led by ${results[0].name}` : ""}.`}
      canonical={`${site}${networkChartUrl(slug, "tv", filters)}`}
      noindex={!results.length}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        itemListLd(
          pageTitle,
          results.slice(0, 25).map((s) => ({ name: s.name, url: `${site}/show/${s.slug}` })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Top networks", url: `${site}/top/networks` },
          { name: entry.name, url: `${site}/network/${slug}/shows` },
        ]),
      ]}
    >
      <ChartHeroHead
        eyebrow={networkEyebrow(entry.name)}
        title={pageTitle}
        intro={`Every ${entry.name} series we track with a real rating, ranked — originals and catalog titles in your region.`}
      >
        {hasMovies ? (
          <a class="btn-ghost" href={networkChartUrl(slug, "movie", { genre: "", year: null, sort: "rated" })}>
            Top {entry.name} movies
          </a>
        ) : null}
        <a class="btn-ghost" href="/top/networks">
          All networks ranked
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
          <ChartFilterBar
            kind="tv"
            filters={filters}
            genres={genres}
            guideNetwork={{ slug, name: entry.name }}
            networks={networks}
          />
          {!results.length ? (
            <p class="muted">No {entry.name} shows in this region&apos;s catalog yet.</p>
          ) : results.length === 1 ? (
            <p class="muted">Only one show matches these filters — it&apos;s featured above.</p>
          ) : (
            <ChartRankGrid
              more={{
                kind: "tv",
                filters,
                total: results.length,
                guideNetwork: slug,
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
                icon: "Watch guide",
                title: filters.genre
                  ? `Best ${filters.genre.toLowerCase()} shows of ${new Date().getFullYear()}`
                  : `Best shows of ${new Date().getFullYear()}`,
                desc: "The acclaimed series to watch this year, what's airing now first.",
                href: filters.genre
                  ? `/tv/best/${new Date().getFullYear()}/${gSlug}`
                  : `/tv/best/${new Date().getFullYear()}`,
                backdrop: yearArt,
              },
              {
                icon: "Hidden gems",
                title: filters.genre
                  ? `Underrated ${filters.genre.toLowerCase()} shows`
                  : "Underrated TV shows",
                desc: "High ratings, low profile — the great series most people have missed.",
                href: filters.genre ? `/tv/underrated/${gSlug}` : "/tv/underrated",
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

async function networkMovieChart(c: AppContext, slug: string) {
  const entry = await resolveNetwork(c.env.DB, slug);
  if (!entry) return c.notFound();
  const region = visitorRegion(c);
  const regionHas = regionTester(region, entry.name);

  const [networks, { movie: movieGenres }] = await Promise.all([
    listNetworkFilterOptions(c.env.DB, entry),
    genreDirectory(c.env.DB),
  ]);
  const hasShows = networkHasStreamingCatalog(entry.name, c.env.TMDB_API_KEY);
  const genres = movieGenres;
  const { filters, redirect } = resolveNetworkChartPage(c, slug, "movie", genres);
  if (redirect) return redirect;

  const results = await fetchNetworkMovieChartResults(c, entry, filters, region, regionHas);
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

  const pageTitle = filters.genre
    ? `Top ${filters.genre} movies on ${entry.name}${filters.year ? ` (${filters.year})` : ""}`
    : filters.year
      ? `Top ${entry.name} movies of ${filters.year}`
      : `Top ${entry.name} movies`;
  const gSlug = filters.genre ? slugifyName(filters.genre) : "";
  const year = new Date().getFullYear();
  const site = origin(c);
  const [yearArt, underratedArt, ordersArt, lovedArt] = await loadMovieChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    top,
  );
  const sidebar = c.get("siteSidebar");

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${pageTitle} — ranked | TV Nightly`}
      description={`The best movies on ${entry.name}, ranked by viewer rating${results[0] ? ` — led by ${results[0].title}` : ""}.`}
      canonical={`${site}${networkChartUrl(slug, "movie", filters)}`}
      noindex={!results.length}
      scripts={["/js/dropdown.js", "/js/chart-filter.js", "/js/chart-scroll.js"]}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : art?.x1 ? { x1: art.x1, x2: art.x1 } : undefined}
      ld={[
        itemListLd(
          pageTitle,
          results.slice(0, 25).map((m) => ({ name: m.title, url: `${site}/movie/${m.slug}` })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Top networks", url: `${site}/top/networks` },
          { name: entry.name, url: `${site}/network/${slug}/movies` },
          { name: "Movies", url: `${site}${networkChartUrl(slug, "movie", filters)}` },
        ]),
      ]}
    >
      <ChartHeroHead
        eyebrow={networkEyebrow(entry.name)}
        title={pageTitle}
        intro={`Every ${entry.name} film in your regional catalog with a real rating — ranked honestly, no sponsorships.`}
      >
        {hasShows ? (
          <a class="btn-ghost" href={networkChartUrl(slug, "tv", { genre: "", year: null, sort: "rated" })}>
            Top {entry.name} shows
          </a>
        ) : null}
        <a class="btn-ghost" href="/top/networks">
          All networks ranked
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
          <ChartFilterBar
            kind="movie"
            filters={filters}
            genres={genres}
            guideNetwork={{ slug, name: entry.name }}
            networks={networks}
          />
          {!results.length ? (
            <p class="muted">No {entry.name} movies in this region&apos;s catalog yet.</p>
          ) : results.length === 1 ? (
            <p class="muted">Only one movie matches these filters — it&apos;s featured above.</p>
          ) : (
            <ChartRankGrid
              more={{
                kind: "movie",
                filters,
                total: results.length,
                guideNetwork: slug,
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
                icon: "Watch guide",
                title: filters.genre
                  ? `Best ${filters.genre.toLowerCase()} movies of ${year}`
                  : `Best movies of ${year}`,
                desc: "The acclaimed films to watch this year, newest greats first.",
                href: filters.genre ? `/movies/best/${year}/${gSlug}` : `/movies/best/${year}`,
                backdrop: yearArt,
              },
              {
                icon: "Hidden gems",
                title: filters.genre
                  ? `Underrated ${filters.genre.toLowerCase()} movies`
                  : "Underrated movies",
                desc: "High ratings, low profile — the great films most people have missed.",
                href: filters.genre ? `/movies/underrated/${gSlug}` : "/movies/underrated",
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

app.get("/top/tv", (c) => topTvChart(c));
app.get("/top/tv/:genreSlug", (c) => topTvChart(c, c.req.param("genreSlug")));

app.get("/top/seasons", async (c) => {
  // Same shrink as /best-episodes: TVmaze has no episode vote counts, so pull
  // season averages toward the show's overall rating; max 2 seasons per show.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT e.show_id, e.season, COUNT(*) AS eps, AVG(e.rating) AS avg_r,
              (AVG(e.rating) + 2.0 * s.rating) / 3.0 AS score, s.name, s.slug,
              s.genres, s.network, s.web_channel, s.poster_url, s.image_url, s.tmdb_id,
              ROW_NUMBER() OVER (PARTITION BY e.show_id ORDER BY AVG(e.rating) DESC) AS rn
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.rating IS NOT NULL AND s.rating IS NOT NULL AND s.weight >= 75
         AND e.season IS NOT NULL
       GROUP BY e.show_id, e.season HAVING COUNT(*) >= 6
     ) WHERE rn <= 2 ORDER BY score DESC LIMIT 50`,
  ).all<{
    show_id: number;
    season: number;
    eps: number;
    avg_r: number;
    name: string;
    slug: string;
    genres: string | null;
    network: string | null;
    web_channel: string | null;
    poster_url: string | null;
    image_url: string | null;
    tmdb_id: number | null;
  }>();

  // the chart opens on its #1 season's show — its real backdrop in the hero,
  // with a blurred-poster ambient fallback when there's no designed still
  const champ = results[0] ?? null;
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (champ?.tmdb_id && c.env.TMDB_API_KEY) {
    art = await tmdbBackdrop(c.env.TMDB_API_KEY, champ.tmdb_id);
  }
  if (!art && champ) {
    const p = posterSrc(champ);
    if (p) {
      art = { x1: p.src };
      ambient = true;
    }
  }

  const sidebar = c.get("siteSidebar");
  const runner = results[1] ?? null;
  const apiKey = c.env.TMDB_API_KEY;
  const champGenres: string[] = champ?.genres ? JSON.parse(champ.genres) : [];
  const [topTvArt, episodesArt, browseArt] = await Promise.all([
    champ ? showKeepGoingBackdrop(apiKey, champ) : Promise.resolve(null),
    runner ? showKeepGoingBackdrop(apiKey, runner) : Promise.resolve(null),
    champGenres[0] && apiKey
      ? genreShowArt(c.env.DB, apiKey, champGenres[0])
      : Promise.resolve(null),
  ]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title="The 50 best TV seasons of all time | TV Nightly"
      description="Whole seasons ranked by their average episode rating — the greatest single runs in TV history."
      canonical={canonical(c)}
      noindex={!results.length}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "The best TV seasons of all time",
          itemListElement: results.slice(0, 25).map((r, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${r.name} — Season ${r.season}`,
            url: `${origin(c)}/show/${r.slug}/season/${r.season}`,
          })),
        },
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">The all-time 50</p>
          <h1>The best TV seasons of all time</h1>
          <p class="wo-intro">
            Ranked by average episode rating, weighted against flukes — six-episode minimum, two per show.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href="/what-to-watch?type=tv">
              Pick me a show
            </a>
            <a class="btn-ghost" href="/premieres">
              What&apos;s coming next
            </a>
          </p>
        </div>
      </header>

      <div class="home-main-grid">
        <div class="home-col">
        {!results.length ? (
          <p class="muted">Ratings are still loading — check back soon.</p>
        ) : (
          <ol class="wo-list wo-ranked wo-ranked-meta">
            {results.map((r, i) => {
              const art = posterSrc(r);
              const provLinks = showProvLinks(r);
              return (
                <li class="wo-row">
                  <span class="wo-num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {art ? (
                    <img
                      class="wo-poster"
                      src={art.src}
                      srcset={art.srcset}
                      alt={`${r.name} poster`}
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
                      <a href={`/show/${r.slug}`}>{r.name}</a>
                      <a class="wo-season" href={`/show/${r.slug}/season/${r.season}`}>
                        Season {r.season}
                      </a>
                    </span>
                    {/* phones: rating rides the genre line so the title gets the full
                        width (see .wo-ranked-meta); desktop uses .wo-side below */}
                    <span class="wo-provs">
                      {provLinks.map((l, j) => (
                        <>
                          {j > 0 ? " · " : null}
                          <a href={l.href}>{l.label}</a>
                        </>
                      ))}
                      {provLinks.length ? <span class="wo-provs-sep"> · </span> : null}
                      <span class="rating"><IconStar class="rating-star" />{r.avg_r.toFixed(2)}</span>
                    </span>
                  </span>
                  <span class="wo-side">
                    <span class="rating"><IconStar class="rating-star" />{r.avg_r.toFixed(2)}</span>
                    <span class="wo-mins">{r.eps} episodes</span>
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
              title: "Top TV shows",
              desc: "The highest-rated series we track — weight and popularity gate the board.",
              href: "/top/tv",
              backdrop: topTvArt,
            },
            {
              icon: "Shortcut",
              title: "All-time best episodes",
              desc: "The single greatest hours of television, across every show.",
              href: "/best-episodes",
              backdrop: episodesArt,
            },
            {
              icon: "Directory",
              title: "Browse everything",
              desc: "Networks, genres, hubs, and every chart in one directory.",
              href: "/lists",
              backdrop: browseArt,
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

app.get("/top/networks", async (c) => {
  // Bayesian prior toward a 7.5 global mean (m=5) so a 3-show boutique can't
  // outrank a 30-show network on a lucky sample.
  const { results } = await c.env.DB.prepare(
    `SELECT n, c, r, score FROM (
       SELECT n, COUNT(*) AS c, AVG(rating) AS r,
              (SUM(rating) + 7.5 * 5) / (COUNT(*) + 5.0) AS score
       FROM (
         SELECT COALESCE(network, web_channel) AS n, rating FROM shows
         WHERE rating IS NOT NULL AND weight >= 60
       ) WHERE n IS NOT NULL GROUP BY n HAVING c >= 3
     ) ORDER BY score DESC`,
  ).all<{ n: string; c: number; r: number; score: number }>();

  // Lead with the headline networks people actually use (Netflix, Hulu, HBO …) in
  // the same order as the directory grid, then the rest by quality score — a pure
  // average-rating sort floats boutiques (Adult Swim, Syfy) above the majors.
  const ranked = (() => {
    const used = new Set<string>();
    const head: typeof results = [];
    for (const pat of HEADLINE_PATTERNS) {
      const hit = results.find((x) => !used.has(x.n) && pat.test(x.n));
      if (hit) {
        head.push(hit);
        used.add(hit.n);
      }
    }
    return [...head, ...results.filter((x) => !used.has(x.n))];
  })();

  // Full-bleed hero backdrop from the top network's single best show — the same
  // champion-frame the chart pages use, with a blurred-poster ambient fallback.
  const topNet = ranked[0]?.n ?? null;
  const [champShow, runnerShow] = topNet
    ? await Promise.all([
        c.env.DB.prepare(
          `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND rating IS NOT NULL
           ORDER BY rating DESC, weight DESC LIMIT 1`,
        )
          .bind(topNet, topNet)
          .first<ShowRow>(),
        c.env.DB.prepare(
          `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND rating IS NOT NULL
           ORDER BY rating DESC, weight DESC LIMIT 1 OFFSET 1`,
        )
          .bind(topNet, topNet)
          .first<ShowRow>(),
      ])
    : [null, null];
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (champShow?.tmdb_id && c.env.TMDB_API_KEY) {
    art = await tmdbBackdrop(c.env.TMDB_API_KEY, champShow.tmdb_id);
  }
  if (!art && champShow) {
    const p = posterSrc(champShow);
    if (p) {
      art = { x1: p.src };
      ambient = true;
    }
  }

  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  const [browseArt, episodesArt, compareArt] = await loadTvChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    champShow,
    runnerShow,
  );
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title="Top TV networks & streamers | TV Nightly"
      description="Netflix, Hulu, HBO, Disney+, and every major network and streamer — browse the best shows on each."
      canonical={canonical(c)}
      noindex={!ranked.length}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        itemListLd(
          "Top TV networks & streamers",
          ranked.map((n) => ({
            name: n.n,
            url: `${site}/network/${slugifyName(n.n)}`,
          })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Browse everything", url: `${site}/lists` },
          { name: "Top networks", url: canonical(c) },
        ]),
      ]}
    >
      <header
        class={`nets-hero net-hero wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}${art ? "" : " net-hero-glow-only"}`}
      >
        {art ? (
          <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div>
        ) : (
          <span class="net-hero-glow" aria-hidden="true"></span>
        )}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Networks &amp; streamers</p>
          <h1>Top TV networks</h1>
          <p class="wo-intro">
            Netflix, Hulu, HBO, and every major home — pick a network and see what&apos;s worth
            watching in your country.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href="/lists">
              Browse everything
            </a>
            <a class="btn-ghost" href="/top/tv">
              Top TV shows
            </a>
          </p>
        </div>
      </header>

      <div class="home-main-grid">
        <div class="home-col">
      {!results.length ? (
        <p class="muted">Not enough shows tracked yet — check back soon.</p>
      ) : (
        <section class="hub-sec nets-grid-sec">
          <div class="nets-grid">
            {ranked.map((r) => (
              <NetBrandCard name={r.n} href={`/network/${slugifyName(r.n)}`} />
            ))}
          </div>
        </section>
      )}

      <KeepExploring
        cards={[
          {
            icon: "Directory",
            title: "Browse everything",
            desc: "Networks, genres, hubs, and every chart in one directory.",
            href: "/lists",
            backdrop: browseArt,
          },
          {
            icon: "Shortcut",
            title: "Best episodes ever",
            desc: "The single greatest hours of television, across every show.",
            href: "/best-episodes",
            backdrop: episodesArt,
          },
          {
            icon: "Matchup",
            title: "Compare two shows",
            desc: "Episode-by-episode rating history, head to head on one chart.",
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
});

// ---------------------------------------- network & provider brand pages

app.get("/network/:slug", async (c) => {
  const entry = await resolveNetwork(c.env.DB, c.req.param("slug"));
  if (!entry) return c.notFound();
  return c.redirect(`/network/${c.req.param("slug")}/shows`, 301);
});

app.get("/network/:slug/shows", (c) => networkTvChart(c, c.req.param("slug")));
app.get("/network/:slug/movies", (c) => networkMovieChart(c, c.req.param("slug")));

/** Does a title's genres array (JSON) contain this label? */
// "Best {genre} on {service}" — the high-intent long-tail page ("best horror on
// netflix"). Registered AFTER /shows + /movies so those literal paths win; any
// other 3rd segment is treated as a genre. 404s on combos with no titles so we
// never publish a thin/empty page.
app.get("/network/:slug/:genre", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const genreSlug = c.req.param("genre");
  const entry = await resolveNetwork(db, slug);
  if (!entry) return c.notFound();
  const dir = await genreDirectory(db);
  const tvGenre = dir.tv.find((g) => slugifyName(g) === genreSlug);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === genreSlug);
  if (!tvGenre && !movieGenre) return c.notFound();
  const label = tvGenre ?? movieGenre!;

  const region = visitorRegion(c);
  const regionHas = regionTester(region, entry.name);
  // Filter the genre at the TMDB-discover level (with_genres) instead of pulling
  // the network's top-300 and filtering in JS — the latter starved niche genres.
  // Each fetcher is live-TMDB-first with an adaptive low-vote fill, so a network ×
  // genre combo returns a full chart wherever the provider has a catalogue.
  const [shows, movies] = await Promise.all([
    tvGenre
      ? fetchNetworkTvChartResults(c, entry, { genre: tvGenre, year: null, sort: "rated" }, region, regionHas).then(
          (r) => r.slice(0, CHART_PAGE_SIZE),
        )
      : Promise.resolve([] as ShowRow[]),
    movieGenre
      ? fetchNetworkMovieChartResults(c, entry, { genre: movieGenre, year: null, sort: "rated" }, region, regionHas).then(
          (r) => r.slice(0, CHART_PAGE_SIZE),
        )
      : Promise.resolve([] as MovieRow[]),
  ]);
  if (!shows.length && !movies.length) return c.notFound();

  const { art, ambient } = await networkHeroArt(c.env.TMDB_API_KEY, shows, movies);
  const stats: { label: string; value: string }[] = [];
  if (shows.length) stats.push({ label: "Series", value: String(shows.length) });
  if (movies.length) stats.push({ label: "Films", value: String(movies.length) });
  const topRated = shows[0]?.rating ?? movies[0]?.rating ?? null;
  if (topRated != null) stats.push({ label: "Top rating", value: `★ ${topRated.toFixed(1)}` });

  const lc = label.toLowerCase();
  const kindWord = shows.length && movies.length ? "shows and movies" : movies.length && !shows.length ? "movies" : "shows";

  const site = origin(c);
  const doors = await loadNetworkDoorArts(c, {
    networkName: entry.name,
    leadShow: shows[0] ?? null,
    runnerShow: shows[1] ?? null,
    leadMovie: movies[0] ?? null,
    runnerMovie: movies[1] ?? null,
  });
  const sidebar = c.get("siteSidebar");
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Best ${lc} on ${entry.name} — ranked | TV Nightly`}
      description={`The best ${lc} ${kindWord} on ${entry.name}, ranked by viewer rating — with where to watch in your region.`}
      canonical={canonical(c)}
      ld={[
        itemListLd(`Best ${label} on ${entry.name}`, [
          ...shows.map((s) => ({ name: s.name, url: `${site}/show/${s.slug}` })),
          ...movies.map((m) => ({ name: m.title, url: `${site}/movie/${m.slug}` })),
        ]),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Top networks", url: `${site}/top/networks` },
          { name: entry.name, url: `${site}/network/${slug}` },
          { name: `Best ${label}`, url: canonical(c) },
        ]),
      ]}
    >
      <NetworkHero
        name={entry.name}
        art={art}
        ambient={ambient}
        eyebrow={`${entry.name} · ${label}`}
        title={`Best ${label} on ${entry.name}`}
        intro={`The top-rated ${lc} on ${entry.name} in your region, ranked honestly by viewer rating — no sponsorships.`}
        stats={stats.length ? stats : undefined}
      >
        <a class="verdict-btn" href={`/network/${slug}`}>
          The best of {entry.name}
        </a>
        <a class="btn-ghost" href={`/genre/${genreSlug}`}>
          All {lc}
        </a>
        <a class="btn-ghost" href="/top/networks">
          All networks ranked
        </a>
      </NetworkHero>
      <div class="home-main-grid">
        <div class="home-col">
          {shows.length ? (
            <section class="hub-sec">
              <h2>
                Top {lc} series on {entry.name}{" "}
                {tvGenre ? (
                  <a class="more" href={`/network/${slug}/shows`}>
                    all shows
                  </a>
                ) : null}
              </h2>
              <div class="grid">
                {shows.map((s) => (
                  <ShowCard show={s} />
                ))}
              </div>
            </section>
          ) : null}
          {movies.length ? (
            <section class="hub-sec">
              <h2>
                Top {lc} movies on {entry.name}{" "}
                {movieGenre ? (
                  <a class="more" href={`/network/${slug}/movies`}>
                    all movies
                  </a>
                ) : null}
              </h2>
              <div class="grid">
                {movies.map((m) => (
                  <MovieCard movie={m} />
                ))}
              </div>
            </section>
          ) : null}
          <NetworkKeepExploring doors={doors} />
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

// ------------------------------------------------------------ genre pages

app.get("/genre/:slug", async (c) => {
  const dir = await genreDirectory(c.env.DB);
  const slug = c.req.param("slug");
  const tvGenre = dir.tv.find((g) => slugifyName(g) === slug);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === slug);
  if (!tvGenre && !movieGenre) return c.notFound();
  const label = tvGenre ?? movieGenre!;
  const lower = label.toLowerCase();

  if (tvGenre) {
    return topTvChart(c, slug, {
      canonicalUrl: canonical(c),
      eyebrow: "Genre",
      pageTitle: `The best of ${label}`,
      intro: `Every ${lower} title we track, ranked by real ratings — with live streaming availability in your country.`,
      guideGenre: { surface: "hub", slug },
      heroActions: (
        <>
          <a
            class="verdict-btn"
            href={`/what-to-watch?type=tv&genre=${encodeURIComponent(tvGenre)}`}
          >
            Pick me {aOrAn(label)} {lower} show
          </a>
          {movieGenre ? (
            <a
              class="btn-ghost"
              href={`/what-to-watch?type=movie&genre=${encodeURIComponent(movieGenre)}`}
            >
              Pick me {aOrAn(label)} {lower} movie
            </a>
          ) : null}
          {movieGenre ? (
            <a class="btn-ghost" href={`/genre/${slug}/movies`}>
              Top {lower} movies
            </a>
          ) : null}
        </>
      ),
    });
  }

  return genreMovieChart(c, slug, {
    canonicalUrl: canonical(c),
    eyebrow: "Genre",
    pageTitle: `The best of ${label}`,
    intro: `Every ${lower} title we track, ranked by real ratings — with live streaming availability in your country.`,
    guideGenre: { surface: "hub", slug },
    heroActions: (
      <a
        class="verdict-btn"
        href={`/what-to-watch?type=movie&genre=${encodeURIComponent(movieGenre!)}`}
      >
        Pick me {aOrAn(label)} {lower} movie
      </a>
    ),
  });
});

app.get("/genre/:slug/shows", async (c) => {
  const slug = c.req.param("slug");
  const dir = await genreDirectory(c.env.DB);
  const tvGenre = dir.tv.find((g) => slugifyName(g) === slug);
  if (!tvGenre) return c.notFound();
  const hasMovies = dir.movie.some((g) => slugifyName(g) === slug);
  const lower = tvGenre.toLowerCase();

  return topTvChart(c, slug, {
    canonicalUrl: canonical(c),
    guideGenre: { surface: "shows", slug },
    heroActions: (
      <>
        <a
          class="verdict-btn"
          href={`/what-to-watch?type=tv&genre=${encodeURIComponent(tvGenre)}`}
        >
          Pick me {aOrAn(lower)} {lower} show
        </a>
        {hasMovies ? (
          <a class="btn-ghost" href={`/genre/${slug}/movies`}>
            Top {lower} movies
          </a>
        ) : null}
        <a class="btn-ghost" href={`/genre/${slug}`}>
          The best of {tvGenre}
        </a>
      </>
    ),
  });
});

app.get("/genre/:slug/movies", async (c) => {
  const slug = c.req.param("slug");
  const dir = await genreDirectory(c.env.DB);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === slug);
  if (!movieGenre) return c.notFound();
  const hasShows = dir.tv.some((g) => slugifyName(g) === slug);
  const lower = movieGenre.toLowerCase();

  return genreMovieChart(c, slug, {
    canonicalUrl: canonical(c),
    guideGenre: { surface: "movies", slug },
    heroActions: (
      <>
        <a
          class="verdict-btn"
          href={`/what-to-watch?type=movie&genre=${encodeURIComponent(movieGenre)}`}
        >
          Pick me {aOrAn(lower)} {lower} movie
        </a>
        {hasShows ? (
          <a class="btn-ghost" href={`/genre/${slug}/shows`}>
            Top {lower} shows
          </a>
        ) : null}
        <a class="btn-ghost" href={`/genre/${slug}`}>
          The best of {movieGenre}
        </a>
      </>
    ),
  });
});

export default app;
