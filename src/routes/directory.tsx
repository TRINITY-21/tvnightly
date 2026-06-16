import { Hono } from "hono";
import { IconStar } from "../components/icons";
import type { FC } from "hono/jsx";
import { Layout } from "../components/Layout";
import { ExploreCard, MovieCard, ShowCard } from "../components/cards";
import { heroBg, hiRes, posterSrc, slugifyName } from "../lib/format";
import { FRANCHISE_BY_SLUG } from "../lib/franchises";
import { networkLogo, networkLogoForBrand, providerBrand, visitorRegion } from "../lib/providers";
import { genreDirectory, networkDirectory } from "../lib/queries";
import { canonical, origin } from "../lib/seo";
import { tmdbBackdrop, tmdbMovieBackdrop } from "../lib/tmdb";
import { VERTICALS, Vertical, genreBinds, genreOr, hubForGenres } from "../lib/verticals";
import { Bindings, MovieRow, ShowRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

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

const NetworkDoors: FC = () => (
  <section class="wo-doors">
    <h2>Keep exploring</h2>
    <div class="explore-grid">
      <ExploreCard
        icon="Networks"
        title="All networks ranked"
        desc="Netflix, HBO, Disney+, and every major home — browse by brand."
        href="/top/networks"
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
        desc="The recommender finds your next watch from one rating."
        href="/recommend"
      />
    </div>
  </section>
);

const BrowseDoors: FC = () => (
  <section class="wo-doors">
    <h2>Keep exploring</h2>
    <div class="explore-grid">
      <ExploreCard
        icon="Charts"
        title="Top TV shows"
        desc="The highest-rated series we track — ranked honestly."
        href="/top/tv"
      />
      <ExploreCard
        icon="Networks"
        title="All networks ranked"
        desc="Netflix, HBO, Disney+, and every major home by quality."
        href="/top/networks"
      />
      <ExploreCard
        icon="News"
        title="Streaming news"
        desc="What just landed, what's leaving, and what's coming."
        href="/whats-new"
      />
    </div>
  </section>
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
  const [networks, genres, arts, hubArts] = await Promise.all([
    networkDirectory(c.env.DB),
    genreDirectory(c.env.DB),
    featuredArts(c),
    hubCardArts(c),
  ]);
  const year = new Date().getFullYear();
  const CHARTS: [string, string][] = [
    ["Top TV shows", "/top/tv"],
    ["Top movies", "/movies/best"],
    ["Top TV seasons", "/top/seasons"],
    ["All-time top episodes", "/best-episodes"],
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
    ["Underrated TV shows", "/tv/underrated"],
    ["Underrated movies", "/movies/underrated"],
  ];
  const moreCharts = CHARTS.filter(
    ([, href]) =>
      !["/top/tv", "/movies/best", "/best-episodes", "/loved", "/compare"].includes(href),
  );
  const sortedNets = sortBrowseNetworks(networks);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Browse — every chart, network & genre | TV Nightly"
      description="All of TV Nightly in one place: top charts, networks, genres, fandom hubs, and tools to pick your next watch."
      canonical={canonical(c)}
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

        <BrowseDoors />
      </div>
    </Layout>,
  );
});

app.get("/top/tv", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM shows WHERE rating IS NOT NULL AND weight >= 75
     ORDER BY rating DESC, weight DESC LIMIT 100`,
  ).all<ShowRow>();

  const showYear = (s: ShowRow) => (s.premiered ? s.premiered.slice(0, 4) : null);
  const showHome = (s: ShowRow) => s.network ?? s.web_channel ?? null;

  // the chart opens on its own #1 — the reigning show's real backdrop in the
  // hero card, with a blurred-poster ambient fallback when there's no still
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

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="The 100 top-rated TV shows | TV Nightly"
      description={`The best TV shows ranked by viewer rating${results[0] ? `, starting with ${results[0].name}` : ""}.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "The top-rated TV shows",
          itemListElement: results.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${s.name}${showYear(s) ? ` (${showYear(s)})` : ""}`,
            url: `${origin(c)}/show/${s.slug}`,
          })),
        },
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">The all-time 100</p>
          <h1>The top-rated TV shows</h1>
          <p class="wo-intro">
            Ranked by viewer rating — weighted so a fluke never outranks the classics.
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

      {!results.length ? (
        <p class="muted">Ratings are still loading — check back soon.</p>
      ) : (
        <ol class="wo-list wo-ranked wo-ranked-meta">
          {results.map((s, i) => {
            const art = posterSrc(s);
            const provLinks = showProvLinks(s);
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
                    alt=""
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
                    <a href={`/show/${s.slug}`}>{s.name}</a>
                    {showYear(s) ? <span class="muted"> ({showYear(s)})</span> : null}
                  </span>
                  <span class="wo-provs">
                    {provLinks.map((l, j) => (
                      <>
                        {j > 0 ? " · " : null}
                        <a href={l.href}>{l.label}</a>
                      </>
                    ))}
                    {provLinks.length ? <span class="wo-provs-sep"> · </span> : null}
                    <span class="rating"><IconStar class="rating-star" />{s.rating!.toFixed(1)}</span>
                  </span>
                </span>
                <span class="wo-side">
                  <span class="rating"><IconStar class="rating-star" />{s.rating!.toFixed(1)}</span>
                  <a class="wo-mins" href={`/show/${s.slug}/best-episodes`}>
                    best episodes
                  </a>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Watch guide"
            title={`Best shows of ${new Date().getFullYear()}`}
            desc="The acclaimed series to watch this year, what's airing now first."
            href={`/tv/best/${new Date().getFullYear()}`}
          />
          <ExploreCard
            icon="Hidden gems"
            title="Underrated TV shows"
            desc="High ratings, low profile — the great series most people have missed."
            href="/tv/underrated"
          />
          <ExploreCard
            icon="Shortcut"
            title="All-time best episodes"
            desc="The single greatest hours of television, across every show."
            href="/best-episodes"
          />
          <ExploreCard
            icon="Compare"
            title="Compare two shows"
            desc="Episode ratings head-to-head on one chart — settle the argument."
            href="/compare"
          />
        </div>
      </section>
    </Layout>,
  );
});

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

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="The 50 best TV seasons of all time | TV Nightly"
      description="Whole seasons ranked by their average episode rating — the greatest single runs in TV history."
      canonical={canonical(c)}
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
      <article class="chart-page">
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
                      alt=""
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

        <section class="wo-doors">
          <h2>Keep exploring</h2>
          <div class="explore-grid">
            <ExploreCard
              icon="Charts"
              title="Top TV shows"
              desc="The highest-rated series we track — weight and popularity gate the board."
              href="/top/tv"
            />
            <ExploreCard
              icon="Shortcut"
              title="All-time best episodes"
              desc="The single greatest hours of television, across every show."
              href="/best-episodes"
            />
            <ExploreCard
              icon="Directory"
              title="Browse everything"
              desc="Networks, genres, hubs, and every chart in one directory."
              href="/lists"
            />
          </div>
        </section>
      </article>
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
     ) ORDER BY score DESC LIMIT 30`,
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
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (topNet) {
    const champShow = await c.env.DB.prepare(
      `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND rating IS NOT NULL
       ORDER BY rating DESC, weight DESC LIMIT 1`,
    )
      .bind(topNet, topNet)
      .first<ShowRow>();
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
  }

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Top TV networks & streamers | TV Nightly"
      description="Netflix, Hulu, HBO, Disney+, and every major network and streamer — browse the best shows on each."
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
    >
      <div class="nets">
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

        <section class="wo-doors">
          <h2>Keep exploring</h2>
          <div class="explore-grid">
            <ExploreCard
              icon="Directory"
              title="Browse everything"
              desc="Networks, genres, hubs, and every chart in one directory."
              href="/lists"
            />
            <ExploreCard
              icon="Shortcut"
              title="Best episodes ever"
              desc="The single greatest hours of television, across every show."
              href="/best-episodes"
            />
            <ExploreCard
              icon="Matchup"
              title="Compare two shows"
              desc="Episode-by-episode rating history, head to head on one chart."
              href="/compare"
            />
          </div>
        </section>
      </div>
    </Layout>,
  );
});

// ---------------------------------------- network & provider brand pages

type NetEntry = { name: string; slug: string; count: number };

/** Three resolution tiers: directory (top 30), any network we hold shows
 *  for, then streaming brands the catalogs know but TVmaze doesn't call a
 *  network ("Paramount+", "fuboTV") — the dossier logos link here, so
 *  every brand we print must resolve. */
async function resolveNetwork(db: D1Database, slug: string): Promise<NetEntry | null> {
  const dir = await networkDirectory(db);
  const top = dir.find((n) => n.slug === slug);
  if (top) return top;
  const { results: nets } = await db
    .prepare(
      `SELECT n, COUNT(*) AS c FROM (
         SELECT COALESCE(network, web_channel) AS n FROM shows
       ) WHERE n IS NOT NULL GROUP BY n`,
    )
    .all<{ n: string; c: number }>();
  const net = nets.find((r) => slugifyName(r.n) === slug);
  if (net) return { name: net.n, slug, count: net.c };
  const { results: provRows } = await db
    .prepare(
      `SELECT DISTINCT j.value AS p FROM movies, json_tree(movies.providers_intl) AS j
         WHERE movies.providers_intl IS NOT NULL AND j.type = 'text'
       UNION
       SELECT DISTINCT j.value FROM shows, json_tree(shows.providers_intl) AS j
         WHERE shows.providers_intl IS NOT NULL AND j.type = 'text'`,
    )
    .all<{ p: string }>();
  const members = provRows.map((r) => r.p).filter((p) => slugifyName(providerBrand(p)) === slug);
  if (!members.length) return null;
  const name = members.reduce((a, b) => (b.trim().length < a.trim().length ? b : a)).trim();
  return { name, slug, count: 0 };
}

/** The visitor's region decides catalog membership for real, so no page
 *  ever claims a library they don't have. */
const regionTester = (region: string, brandName: string) => {
  const brand = providerBrand(brandName);
  return (json: string | null): boolean => {
    const intl: Record<string, string[]> = json ? JSON.parse(json) : {};
    return (intl[region] ?? []).some((p) => providerBrand(p) === brand);
  };
};

/** A brand's shows are its originals AND its regional catalog, merged —
 *  "Top Hulu shows" must contain the show whose receipt said "Streaming
 *  on Hulu", not just Hulu originals; FX simply has no catalog side. */
async function topNetworkShows(
  db: D1Database,
  entry: NetEntry,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<ShowRow[]> {
  const [byNet, pool] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND rating IS NOT NULL
         ORDER BY rating DESC, weight DESC LIMIT ?`,
      )
      .bind(entry.name, entry.name, limit)
      .all<ShowRow>(),
    db
      .prepare(
        `SELECT * FROM shows WHERE providers_intl IS NOT NULL AND rating IS NOT NULL
         AND weight >= 60 ORDER BY rating DESC, weight DESC LIMIT 400`,
      )
      .all<ShowRow>(),
  ]);
  const seen = new Set<number>();
  return [...byNet.results, ...pool.results.filter((s) => regionHas(s.providers_intl))]
    .filter((s) => !seen.has(s.id) && seen.add(s.id))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, limit);
}

async function topNetworkMovies(
  db: D1Database,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<MovieRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM movies WHERE providers_intl IS NOT NULL AND rating IS NOT NULL
       AND votes >= 1000 ORDER BY rating DESC, votes DESC LIMIT 400`,
    )
    .all<MovieRow>();
  return results.filter((m) => regionHas(m.providers_intl)).slice(0, limit);
}

app.get("/network/:slug", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const entry = await resolveNetwork(db, slug);
  if (!entry) return c.notFound();
  const regionHas = regionTester(visitorRegion(c), entry.name);

  // fetch a deep slice (same query cost — the 400-row pool runs regardless) so
  // the genre doors below can surface long-tail genres (Western, Romance, …),
  // then take the top 12 for the on-page grids.
  const [allShows, allMovies, airingRes] = await Promise.all([
    topNetworkShows(db, entry, regionHas, 150),
    topNetworkMovies(db, regionHas, 150),
    db
      .prepare(
        `SELECT * FROM shows WHERE (network = ? OR web_channel = ?) AND status = 'Running'
         ORDER BY weight DESC LIMIT 10`,
      )
      .bind(entry.name, entry.name)
      .all<ShowRow>(),
  ]);
  const best = allShows.slice(0, 12);
  const films = allMovies.slice(0, 12);
  const airing = airingRes.results;
  const { art, ambient } = await networkHeroArt(c.env.TMDB_API_KEY, best, films);

  const stats: { label: string; value: string }[] = [];
  if (best.length) {
    stats.push({ label: "Top shows", value: String(best.length) });
    if (best[0].rating != null) stats.push({ label: "Peak rating", value: `★ ${best[0].rating.toFixed(1)}` });
  }
  if (films.length) stats.push({ label: "Films", value: String(films.length) });
  if (airing.length) stats.push({ label: "On air", value: String(airing.length) });
  if (entry.count) stats.push({ label: "In catalog", value: String(entry.count) });

  // "Best {genre} on {network}" doors — every genre actually present in this
  // network's catalog (region-filtered), deduped by slug (TV "Science-Fiction"
  // + movie "Science Fiction" = one chip) and ordered by how many titles carry
  // it, so the strongest genres lead and the long tail still shows. These are
  // the internal links that get the genre×service pages crawled.
  const genreCount = new Map<string, { label: string; n: number }>();
  const collectGenres = (json: string | null) => {
    if (!json) return;
    try {
      for (const g of JSON.parse(json) as string[]) {
        const sl = slugifyName(g);
        const cur = genreCount.get(sl);
        if (cur) cur.n++;
        else genreCount.set(sl, { label: g, n: 1 });
      }
    } catch {
      /* skip malformed */
    }
  };
  allShows.forEach((s) => collectGenres(s.genres));
  allMovies.forEach((m) => collectGenres(m.genres));
  const genreLinks = [...genreCount.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 18)
    .map(([sl, v]) => [sl, v.label] as [string, string]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={
        films.length
          ? `The best ${entry.name} shows & movies — ranked | TV Nightly`
          : `The best ${entry.name} shows — ranked | TV Nightly`
      }
      description={`Every ${entry.name} ${films.length ? "show and movie" : "show"} worth watching, ranked by rating, plus what's currently airing.`}
      canonical={canonical(c)}
    >
      <NetworkHero
        name={entry.name}
        art={art}
        ambient={ambient}
        eyebrow={networkEyebrow(entry.name)}
        title={entry.name}
        intro={networkTagline(entry.name)}
        stats={stats.length ? stats : undefined}
      >
        {best.length ? (
          <a class="verdict-btn" href={`/network/${slug}/shows`}>
            Top {entry.name} shows
          </a>
        ) : null}
        {films.length ? (
          <a class={best.length ? "btn-ghost" : "verdict-btn"} href={`/network/${slug}/movies`}>
            Top {entry.name} movies
          </a>
        ) : null}
        <a class="btn-ghost" href="/top/networks">
          All networks ranked
        </a>
      </NetworkHero>
      {genreLinks.length ? (
        <nav class="net-genres" aria-label={`Best ${entry.name} by genre`}>
          <span class="net-genres-label">Best by genre</span>
          <div class="net-genres-rail">
            {genreLinks.map(([sl, g]) => (
              <a class="genre-chip" href={`/network/${slug}/${sl}`}>
                {g}
              </a>
            ))}
          </div>
        </nav>
      ) : null}
      {best.length ? (
        <section class="hub-sec">
          <h2>
            Top {entry.name} shows{" "}
            <a class="more" href={`/network/${slug}/shows`}>
              see all
            </a>
          </h2>
          <div class="grid">
            {best.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {films.length ? (
        <section class="hub-sec">
          <h2>
            Top {entry.name} movies{" "}
            <a class="more" href={`/network/${slug}/movies`}>
              see all
            </a>
          </h2>
          <div class="grid">
            {films.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
      {airing.length ? (
        <section class="hub-sec sched-day">
          <h2>
            Currently on air{" "}
            <span class="sched-count">
              {airing.length} running
            </span>
          </h2>
          <ol class="sched-list">
            {airing.map((s) => {
              const p = posterSrc(s);
              return (
                <li>
                  <a class="sched-row" href={`/show/${s.slug}`}>
                    <span class="sched-rail">Live</span>
                    {p ? (
                      <img
                        src={p.src}
                        srcset={p.srcset}
                        alt=""
                        width="46"
                        height="69"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span class="sched-thumb-blank" aria-hidden="true"></span>
                    )}
                    <span class="sched-main">
                      <span class="sched-show">{s.name}</span>
                      <span class="sched-ep">
                        {s.rating != null ? <><IconStar class="rating-star" /> {s.rating.toFixed(1)} · </> : null}
                        <span class="muted">next episode</span>
                      </span>
                    </span>
                    <span class="sched-net">Running</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <NetworkDoors />
    </Layout>,
  );
});

// The per-medium top pages the provider logos deep-link into: a show
// context lands on shows, a movie context on movies.
app.get("/network/:slug/shows", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const entry = await resolveNetwork(db, slug);
  if (!entry) return c.notFound();
  const regionHas = regionTester(visitorRegion(c), entry.name);
  const rows = await topNetworkShows(db, entry, regionHas, 48);
  const hasMovies = (await topNetworkMovies(db, regionHas, 1)).length > 0;
  const { art, ambient } = await networkHeroArt(c.env.TMDB_API_KEY, rows, []);

  const years = rows
    .map((s) => (s.premiered ? Number(s.premiered.slice(0, 4)) : null))
    .filter((y): y is number => y != null && y > 0);
  const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : null;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${entry.name} shows — ranked | TV Nightly`}
      description={`The best TV shows on ${entry.name}, ranked by viewer rating.`}
      canonical={canonical(c)}
    >
      <NetworkHero
        name={entry.name}
        art={art}
        ambient={ambient}
        eyebrow={`${networkEyebrow(entry.name)} chart`}
        title={`Top ${entry.name} shows`}
        intro={`Every ${entry.name} series we track with a real rating, ranked — originals and catalog titles in your region.`}
        stats={
          rows.length
            ? [
                { label: "Series", value: String(rows.length) },
                { label: "Top rating", value: `★ ${rows[0].rating!.toFixed(1)}` },
                ...(span ? [{ label: "Years", value: span }] : []),
              ]
            : undefined
        }
      >
        <a class="verdict-btn" href={`/network/${slug}`}>
          The best of {entry.name}
        </a>
        {hasMovies ? (
          <a class="btn-ghost" href={`/network/${slug}/movies`}>
            Top {entry.name} movies
          </a>
        ) : null}
        <a class="btn-ghost" href="/top/networks">
          All networks ranked
        </a>
      </NetworkHero>
      {rows.length ? (
        <div class="grid">
          {rows.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      ) : (
        <p class="muted">No {entry.name} shows in this region's catalog yet.</p>
      )}
      <NetworkDoors />
    </Layout>,
  );
});

app.get("/network/:slug/movies", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const entry = await resolveNetwork(db, slug);
  if (!entry) return c.notFound();
  const regionHas = regionTester(visitorRegion(c), entry.name);
  const rows = await topNetworkMovies(db, regionHas, 48);
  const hasShows = (await topNetworkShows(db, entry, regionHas, 1)).length > 0;
  const { art, ambient } = await networkHeroArt(c.env.TMDB_API_KEY, [], rows);

  const years = rows.map((m) => m.year).filter((y): y is number => y != null);
  const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : null;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${entry.name} movies — ranked | TV Nightly`}
      description={`The best movies on ${entry.name}, ranked by viewer rating.`}
      canonical={canonical(c)}
    >
      <NetworkHero
        name={entry.name}
        art={art}
        ambient={ambient}
        eyebrow={`${networkEyebrow(entry.name)} chart`}
        title={`Top ${entry.name} movies`}
        intro={`Every ${entry.name} film in your regional catalog with a real rating — ranked honestly, no sponsorships.`}
        stats={
          rows.length
            ? [
                { label: "Films", value: String(rows.length) },
                { label: "Top rating", value: `★ ${rows[0].rating!.toFixed(1)}` },
                ...(span ? [{ label: "Years", value: span }] : []),
              ]
            : undefined
        }
      >
        <a class="verdict-btn" href={`/network/${slug}`}>
          The best of {entry.name}
        </a>
        {hasShows ? (
          <a class="btn-ghost" href={`/network/${slug}/shows`}>
            Top {entry.name} shows
          </a>
        ) : null}
        <a class="btn-ghost" href="/top/networks">
          All networks ranked
        </a>
      </NetworkHero>
      {rows.length ? (
        <div class="grid">
          {rows.map((m) => (
            <MovieCard movie={m} />
          ))}
        </div>
      ) : (
        <p class="muted">No {entry.name} movies in this region's catalog yet.</p>
      )}
      <NetworkDoors />
    </Layout>,
  );
});

/** Does a title's genres array (JSON) contain this label? */
const inGenre = (json: string | null, label: string): boolean => {
  if (!json) return false;
  try {
    return (JSON.parse(json) as string[]).includes(label);
  } catch {
    return false;
  }
};

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

  const regionHas = regionTester(visitorRegion(c), entry.name);
  const [allShows, allMovies] = await Promise.all([
    tvGenre ? topNetworkShows(db, entry, regionHas, 300) : Promise.resolve([] as ShowRow[]),
    movieGenre ? topNetworkMovies(db, regionHas, 300) : Promise.resolve([] as MovieRow[]),
  ]);
  const shows = tvGenre ? allShows.filter((s) => inGenre(s.genres, tvGenre)).slice(0, 36) : [];
  const movies = movieGenre ? allMovies.filter((m) => inGenre(m.genres, movieGenre)).slice(0, 36) : [];
  if (!shows.length && !movies.length) return c.notFound();

  const { art, ambient } = await networkHeroArt(c.env.TMDB_API_KEY, shows, movies);
  const stats: { label: string; value: string }[] = [];
  if (shows.length) stats.push({ label: "Series", value: String(shows.length) });
  if (movies.length) stats.push({ label: "Films", value: String(movies.length) });
  const topRated = shows[0]?.rating ?? movies[0]?.rating ?? null;
  if (topRated != null) stats.push({ label: "Top rating", value: `★ ${topRated.toFixed(1)}` });

  const lc = label.toLowerCase();
  const kindWord = shows.length && movies.length ? "shows and movies" : movies.length && !shows.length ? "movies" : "shows";

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Best ${lc} on ${entry.name} — ranked | TV Nightly`}
      description={`The best ${lc} ${kindWord} on ${entry.name}, ranked by viewer rating — with where to watch in your region.`}
      canonical={canonical(c)}
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
      <NetworkDoors />
    </Layout>,
  );
});

// ------------------------------------------------------------ genre pages

async function topGenreShows(db: D1Database, genre: string, limit: number): Promise<ShowRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM shows WHERE genres LIKE ? AND rating IS NOT NULL AND weight >= 60
       ORDER BY rating DESC, weight DESC LIMIT ?`,
    )
    .bind(`%"${genre}"%`, limit)
    .all<ShowRow>();
  return results;
}

async function topGenreMovies(db: D1Database, genre: string, limit: number): Promise<MovieRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM movies WHERE genres LIKE ? AND rating IS NOT NULL AND votes >= 1000
       ORDER BY rating DESC, votes DESC LIMIT ?`,
    )
    .bind(`%"${genre}"%`, limit)
    .all<MovieRow>();
  return results;
}

app.get("/genre/:slug", async (c) => {
  const db = c.env.DB;
  const dir = await genreDirectory(db);
  const slug = c.req.param("slug");
  const tvGenre = dir.tv.find((g) => slugifyName(g) === slug);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === slug);
  if (!tvGenre && !movieGenre) return c.notFound();
  const label = tvGenre ?? movieGenre!;

  const shows = tvGenre ? await topGenreShows(db, tvGenre, 12) : [];
  const movies = movieGenre ? await topGenreMovies(db, movieGenre, 12) : [];

  // the genre opens on its own #1 — best-rated series first, films if
  // the genre only exists on the movie side
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (c.env.TMDB_API_KEY) {
    art = shows[0]?.tmdb_id
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, shows[0].tmdb_id)
      : !shows.length && movies[0]
        ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, movies[0].imdb_id)
        : null;
  }
  if (!art) {
    const p = shows[0] ? hiRes(shows[0].image_url) : (movies[0]?.poster_url ?? null);
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }

  // lateral doors: the rest of the genre map, then the hub that claims
  // this genre (if one does)
  const siblings = [...new Set([...dir.tv, ...dir.movie])]
    .filter((g) => g !== tvGenre && g !== movieGenre)
    .slice(0, 16);
  const hub = hubForGenres([label], null);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`The best ${label.toLowerCase()} shows & movies | TV Nightly`}
      description={`Top-rated ${label.toLowerCase()} TV series and films, with streaming availability.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Genre</p>
          <h1>The best of {label}</h1>
          <p class="wo-intro">
            Every {label.toLowerCase()} title we track, ranked by real ratings — with live
            streaming availability in your country.
          </p>
          <p class="hub-actions">
            {tvGenre ? (
              <a class="verdict-btn" href={`/what-to-watch?genre=${encodeURIComponent(tvGenre)}`}>
                Pick me {aOrAn(label)} {label.toLowerCase()} show
              </a>
            ) : null}
            {movieGenre ? (
              <a
                class={tvGenre ? "btn-ghost" : "verdict-btn"}
                href={`/what-to-watch?type=movie&genre=${encodeURIComponent(movieGenre)}`}
              >
                Pick me {aOrAn(label)} {label.toLowerCase()} movie
              </a>
            ) : null}
          </p>
        </div>
      </header>
      {shows.length ? (
        <section class="hub-sec">
          <h2>
            Top {label.toLowerCase()} series{" "}
            <a class="more" href={`/genre/${slug}/shows`}>
              see all
            </a>
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
            Top {label.toLowerCase()} films{" "}
            <a class="more" href={`/genre/${slug}/movies`}>
              see all
            </a>
          </h2>
          <div class="grid">
            {movies.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
      {siblings.length ? (
        <section class="hub-sec">
          <h2>
            More genres{" "}
            <a class="more" href="/lists">
              all of them
            </a>
          </h2>
          <div class="footer-picks">
            {siblings.map((g) => (
              <a class="footer-card" href={`/genre/${slugifyName(g)}`}>
                {g}
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          {hub ? (
            <ExploreCard
              icon="Fandom hub"
              title={`The ${hub.name} hub`}
              desc="News, premieres, and the best of the genre on one page."
              href={`/${hub.slug}`}
            />
          ) : (
            <ExploreCard
              icon="Tonight"
              title="What's actually on"
              desc="Tonight's schedule, in air-time order."
              href="/tonight"
            />
          )}
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
    </Layout>,
  );
});

// Per-medium genre top pages — the genre chyrons deep-link by context:
// a show page lands on shows, a movie page on movies.
app.get("/genre/:slug/shows", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const dir = await genreDirectory(db);
  const tvGenre = dir.tv.find((g) => slugifyName(g) === slug);
  if (!tvGenre) return c.notFound();
  const rows = await topGenreShows(db, tvGenre, 48);
  const hasMovies = dir.movie.some((g) => slugifyName(g) === slug);
  const lower = tvGenre.toLowerCase();

  // the chart opens on its own #1
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (c.env.TMDB_API_KEY && rows[0]?.tmdb_id) {
    art = await tmdbBackdrop(c.env.TMDB_API_KEY, rows[0].tmdb_id);
  }
  if (!art && rows[0]) {
    const p = hiRes(rows[0].image_url);
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }

  const hub = hubForGenres([tvGenre], null);
  const siblings = dir.tv.filter((g) => g !== tvGenre).slice(0, 16);
  const year = new Date().getFullYear();

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${lower} shows — ranked | TV Nightly`}
      description={`The best ${lower} TV shows, ranked by viewer rating, with streaming availability.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Genre chart</p>
          <h1>Top {lower} shows</h1>
          <p class="wo-intro">
            Every {lower} series we track with a real rating, ranked — no editors, no
            sponsorships, just the numbers.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href={`/what-to-watch?genre=${encodeURIComponent(tvGenre)}`}>
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
          </p>
        </div>
      </header>
      {rows.length ? (
        <div class="grid">
          {rows.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      ) : (
        <p class="muted">No rated {lower} shows yet.</p>
      )}
      <section class="hub-sec">
        <h2>More {lower} TV guides</h2>
        <div class="footer-picks">
          <a class="footer-card" href={`/tv/best/${year}/${slug}`}>
            Best {lower} shows to watch in {year}
          </a>
          <a class="footer-card" href={`/tv/underrated/${slug}`}>
            Underrated {lower} shows
          </a>
          <a class="footer-card" href={`/genre/${slug}`}>
            The best of {tvGenre}
          </a>
        </div>
      </section>
      {siblings.length ? (
        <section class="hub-sec">
          <h2>
            More show charts{" "}
            <a class="more" href="/lists">
              all of them
            </a>
          </h2>
          <div class="footer-picks">
            {siblings.map((g) => (
              <a class="footer-card" href={`/genre/${slugifyName(g)}/shows`}>
                {g}
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          {hub ? (
            <ExploreCard
              icon="Fandom hub"
              title={`The ${hub.name} hub`}
              desc="News, premieres, and the best of the genre on one page."
              href={`/${hub.slug}`}
            />
          ) : (
            <ExploreCard
              icon="Tonight"
              title="What's actually on"
              desc="Tonight's schedule, in air-time order."
              href="/tonight"
            />
          )}
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
    </Layout>,
  );
});

app.get("/genre/:slug/movies", async (c) => {
  const db = c.env.DB;
  const slug = c.req.param("slug");
  const dir = await genreDirectory(db);
  const movieGenre = dir.movie.find((g) => slugifyName(g) === slug);
  if (!movieGenre) return c.notFound();
  const rows = await topGenreMovies(db, movieGenre, 48);
  const hasShows = dir.tv.some((g) => slugifyName(g) === slug);
  const lower = movieGenre.toLowerCase();

  // the chart opens on its own #1
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (c.env.TMDB_API_KEY && rows[0]) {
    art = await tmdbMovieBackdrop(c.env.TMDB_API_KEY, rows[0].imdb_id);
  }
  if (!art && rows[0]?.poster_url) {
    art = { x1: rows[0].poster_url };
    ambient = true;
  }

  const hub = hubForGenres([movieGenre], null);
  const siblings = dir.movie.filter((g) => g !== movieGenre).slice(0, 16);
  const year = new Date().getFullYear();

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Top ${lower} movies — ranked | TV Nightly`}
      description={`The best ${lower} films, ranked by viewer rating, with streaming availability.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Genre chart</p>
          <h1>Top {lower} movies</h1>
          <p class="wo-intro">
            Every {lower} film we track with a real rating, ranked — no editors, no sponsorships,
            just the numbers.
          </p>
          <p class="hub-actions">
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
          </p>
        </div>
      </header>
      {rows.length ? (
        <div class="grid">
          {rows.map((m) => (
            <MovieCard movie={m} />
          ))}
        </div>
      ) : (
        <p class="muted">No rated {lower} films yet.</p>
      )}
      <section class="hub-sec">
        <h2>More {lower} movie guides</h2>
        <div class="footer-picks">
          <a class="footer-card" href={`/movies/best/${year}/${slug}`}>
            Best {lower} movies to watch in {year}
          </a>
          <a class="footer-card" href={`/movies/underrated/${slug}`}>
            Underrated {lower} movies
          </a>
          <a class="footer-card" href={`/movies/best?genre=${encodeURIComponent(movieGenre)}`}>
            Best {lower} movies of all time
          </a>
        </div>
      </section>
      {siblings.length ? (
        <section class="hub-sec">
          <h2>
            More film charts{" "}
            <a class="more" href="/lists">
              all of them
            </a>
          </h2>
          <div class="footer-picks">
            {siblings.map((g) => (
              <a class="footer-card" href={`/genre/${slugifyName(g)}/movies`}>
                {g}
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          {hub ? (
            <ExploreCard
              icon="Fandom hub"
              title={`The ${hub.name} hub`}
              desc="News, premieres, and the best of the genre on one page."
              href={`/${hub.slug}`}
            />
          ) : (
            <ExploreCard
              icon="The chart"
              title="The best films of all time"
              desc="Every movie ranked by rating, with where to stream."
              href="/movies/best"
            />
          )}
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
    </Layout>,
  );
});

export default app;
