// Page chrome: header/nav/footer, logo mark, message page.
import { raw } from "hono/html";
import { FC, PropsWithChildren } from "hono/jsx";
import { slugifyName } from "../lib/format";
import { networkLogo } from "../lib/providers";
import { jsonLd } from "../lib/seo";
import type { SiteSidebarData } from "../lib/site-sidebar";
import { VERTICALS } from "../lib/verticals";
import type { AppContext } from "../types";
import { DiscordWelcomeModal } from "./discord";
import { getDiscordInvite } from "../lib/discord";
import { HomeSidebarRail } from "./home-sidebar";
import { IconDiscord, IconFacebook, IconInstagram, IconTikTok, IconX, IconYouTube } from "./icons";

// Social handles — one place to update. Same @handle across platforms keeps the
// brand findable and matches the tvnightly.com domain.
const SOCIAL_HANDLE = "tvnightly";
const SOCIALS: { label: string; url: string; Icon: FC<{ size?: number }> }[] = [
  { label: "YouTube", url: `https://www.youtube.com/@${SOCIAL_HANDLE}`, Icon: IconYouTube },
  { label: "TikTok", url: `https://www.tiktok.com/@${SOCIAL_HANDLE}`, Icon: IconTikTok },
  { label: "Instagram", url: `https://www.instagram.com/${SOCIAL_HANDLE}`, Icon: IconInstagram },
  { label: "X", url: `https://x.com/${SOCIAL_HANDLE}`, Icon: IconX },
  // Facebook page uses a numeric profile id, not the @handle, so it's set explicitly
  { label: "Facebook", url: "https://www.facebook.com/profile.php?id=61591022677323", Icon: IconFacebook },
];
// Discord invite is env-driven — appended in Layout when DISCORD_INVITE_URL is set.

// Cloudflare Web Analytics beacon token. Request-invariant config: the token is
// the same for every request, so a middleware setting it once per request (see
// src/index.tsx) is race-free even across concurrent requests on one isolate.
// Kept module-level because Layout is rendered with plain props, not request context.
let cfBeaconToken: string | undefined;
export const setBeaconToken = (token?: string) => {
  cfBeaconToken = token;
};

// Google Analytics 4 measurement id (public, gtag.js). Set from env in the request
// middleware (src/index.tsx); unset = GA not injected (e.g. local dev).
let gaId: string | undefined;
export const setGaId = (id?: string) => {
  gaId = id;
};

// When false, skip GA + Cloudflare Web Analytics (e.g. /admin/* tooling pages).
let siteAnalytics = true;
export const setSiteAnalytics = (enabled: boolean) => {
  siteAnalytics = enabled;
};

// Off-screen decoy field for the subscribe forms. Real visitors never see or fill
// it; bots auto-fill every input, so a non-empty value on POST /subscribe is a
// reliable bot tell. Zero UI, zero friction — and the double opt-in confirmation
// email is the real guard on list quality (nothing subscribes until the link is
// clicked). Reuses the .fb-hp off-screen style already shipped for feedback.
export const Honeypot: FC = () => (
  <input class="fb-hp" type="text" name="website" tabindex={-1} autocomplete="off" aria-hidden="true" />
);

// Live countdown band: four stat blocks ticking once a second. Renders "—"
// placeholders until JS lands; flips to "Airing now" past zero.
export const COUNTDOWN_JS = `<script>(function(){var b=document.querySelector('.count-band');if(!b||!b.dataset.ts)return;var t=new Date(b.dataset.ts).getTime();function q(u){return b.querySelector('[data-u="'+u+'"]')}function pad(v){return ('0'+v).slice(-2)}function tick(){var d=Math.floor((t-Date.now())/1000);if(d<=0){b.classList.add('count-live');b.innerHTML='<span class="count-now">Airing now</span>';return}q('d').textContent=Math.floor(d/86400);q('h').textContent=pad(Math.floor(d%86400/3600));q('m').textContent=pad(Math.floor(d%3600/60));q('s').textContent=pad(d%60);setTimeout(tick,1000)}tick()})();</script>`;

// "Standby Glow" mark: a TV on standby — thin 16:9 frame, one crisp LED.
// No blur filters: at header sizes they render as smear; a real standby
// light reads as a sharp point with a faint halo.
export const LogoMark: FC<{ size?: number }> = ({ size = 26 }) => (
  <svg
    class="logo-mark"
    viewBox="0 0 36 24"
    width={size}
    height={Math.round((size * 24) / 36)}
    aria-hidden="true"
  >
    <rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5" />
    <circle cx="26.5" cy="16.5" r="3.4" fill="#FFA94D" opacity="0.22" />
    <circle cx="26.5" cy="16.5" r="2.2" fill="#FFA94D" />
  </svg>
);

// Every /show/:slug/* page renders these so searchers landing on a subpage

const BROWSE_PATHS = [
  "/lists",
  "/top",
  "/movies",
  "/tv",
  "/best-episodes",
  "/upcoming",
  "/awards",
  "/loved",
  "/watch-orders",
  "/watch-order",
  "/compare",
  "/network",
  "/genre",
  "/search",
  "/classics",
];

// Browse is a tall, scrollable drawer: grouped link sections, then network
// logo tiles and genre chips drawn from the same data as the /lists directory.
const browseSections = (year: number): { kicker: string; links: [string, string][] }[] => [
  {
    kicker: "Top charts",
    links: [
      ["Top TV shows", "/top/tv"],
      ["Top movies", "/movies/best"],
      ["Best episodes", "/best-episodes"],
      ["Top seasons", "/top/seasons"],
      ["Most loved", "/loved"],
    ],
  },
  {
    kicker: "Watch guides",
    links: [
      [`Best shows of ${year}`, `/tv/best/${year}`],
      [`Best movies of ${year}`, `/movies/best/${year}`],
      ["Best TV of the 2010s", "/tv/best/2010s"],
      ["Best episodes ever", "/best-episodes"],
      ["Underrated shows", "/tv/underrated"],
      ["Underrated movies", "/movies/underrated"],
    ],
  },
  {
    kicker: "Compare",
    links: [
      ["Compare shows", "/compare"],
      ["Compare movies", "/movies/compare"],
    ],
  },
  {
    kicker: "Upcoming & new",
    links: [
      ["Upcoming TV", "/upcoming"],
      ["TV premieres", "/premieres"],
      ["Upcoming movies", "/movies/upcoming"],
      ["New on streaming", "/whats-new"],
      ["Renewals & dates", "/renewals"],
    ],
  },
  {
    kicker: "Find your next watch",
    links: [
      ["What to watch", "/what-to-watch"],
      ["Get a recommendation", "/recommend"],
      ["Watch orders", "/watch-orders"],
      ["TV watch orders", "/tv-watch-orders"],
      ["Episode rankings", "/guides"],
    ],
  },
];

// [display label, logo lookup name, /network slug] — all three verified to
// resolve to a real logo and a live network page.
const BROWSE_NETWORKS: [string, string, string][] = [
  ["Netflix", "Netflix", "netflix"],
  ["Max", "HBO Max", "hbo-max"],
  ["Prime Video", "Amazon Prime Video", "prime-video"],
  ["Disney+", "Disney+", "disney-plus"],
  ["Hulu", "Hulu", "hulu"],
  ["Apple TV+", "Apple TV", "apple-tv"],
  ["Peacock", "Peacock Premium", "peacock"],
  ["Paramount+", "Paramount Plus", "paramount-plus"],
];

// [display label, genre name as stored] — Sci-Fi shown short, slug from full.
const BROWSE_TV_GENRES: [string, string][] = [
  ["Drama", "Drama"], ["Comedy", "Comedy"], ["Crime", "Crime"], ["Sci-Fi", "Science-Fiction"],
  ["Fantasy", "Fantasy"], ["Horror", "Horror"], ["Mystery", "Mystery"], ["Thriller", "Thriller"],
  ["Action", "Action"], ["Romance", "Romance"], ["Supernatural", "Supernatural"], ["Anime", "Anime"],
];
const BROWSE_MOVIE_GENRES: [string, string][] = [
  ["Action", "Action"], ["Adventure", "Adventure"], ["Animation", "Animation"], ["Comedy", "Comedy"],
  ["Crime", "Crime"], ["Drama", "Drama"], ["Fantasy", "Fantasy"], ["Horror", "Horror"],
  ["Mystery", "Mystery"], ["Romance", "Romance"], ["Sci-Fi", "Science Fiction"], ["Thriller", "Thriller"],
];

export const Layout: FC<
  PropsWithChildren<{
    title: string;
    description?: string;
    canonical?: string;
    ld?: unknown[];
    ogImage?: string;
    /** og:type override (default "website"); e.g. "video.movie" / "video.tv_show"
     *  so rich-media unfurls and entity parsers classify the page correctly. */
    ogType?: string;
    /** og:title / twitter:title override, when the share title should differ from
     *  the SERP <title> (e.g. "Inception (2010)" vs "Inception (2010) - … | TV Nightly"). */
    ogTitle?: string;
    /** Set when ogImage is a 1200×630 branded card (an /og.png endpoint) rather
     *  than a portrait poster: renders the large Twitter card + declares dims. */
    ogImageLarge?: boolean;
    /** Alt text for the share image (entity name where meaningful); falls back
     *  to the page title so the card is never announced as unlabelled. */
    ogImageAlt?: string;
    scripts?: string[];
    noindex?: boolean;
    /** Drop the public site header + marketing footer — for admin tooling
     *  (the studio, inbox) that should read as a focused app, not a page. */
    bare?: boolean;
    /** Request context — when set, Layout reads pre-fetched sidebar data from
     *  middleware and wraps main content in the home two-column grid. */
    c?: AppContext;
    /** Page manages its own home-main-grid + rail (homepage, show/movie overview). */
    sidebarInline?: boolean;
    /** Never wrap in the global right rail (404/500 and other full-bleed pages). */
    noSidebar?: boolean;
    /** Override middleware sidebar data (rare; inline pages use sidebarInline). */
    sidebar?: SiteSidebarData | null;
    /** Meta-refresh auto-forward (no-JS path for the synth interstitial). */
    refresh?: { delay: number; url: string };
    /** LCP insurance for full-bleed CSS-background heroes, which browsers
     *  discover late: preload the backdrop with a density srcset. */
    preloadImage?: { x1: string; x2: string };
  }>
> = (props) => {
  // active nav section + og origin, derived from the canonical URL every page sets
  const canonicalUrl = (() => {
    try {
      return props.canonical ? new URL(props.canonical) : null;
    } catch {
      return null;
    }
  })();
  const path = canonicalUrl?.pathname ?? "";
  // Pages without a subject image of their own fall back to the branded default
  // card (large), so every share/Discover unfurl carries an on-brand preview.
  const ogImage =
    props.ogImage ?? (canonicalUrl ? `${canonicalUrl.origin}/og-default.png` : undefined);
  const ogImageLarge = props.ogImage ? !!props.ogImageLarge : true;
  const ogImageAlt = props.ogImageAlt ?? props.title;
  const navClass = (prefixes: string[]) =>
    prefixes.some((p) => path === p || path.startsWith(p + "/")) ? "active" : "";
  const browseActive = BROWSE_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  const discordUrl = getDiscordInvite();
  const BROWSE_SECTIONS = browseSections(new Date().getFullYear());
  const sidebarData: SiteSidebarData | undefined =
    !props.bare && !props.sidebarInline && !props.noSidebar
      ? (props.sidebar ?? props.c?.get("siteSidebar") ?? undefined)
      : undefined;
  const browseTrendingMovies =
    props.c?.get("siteSidebar")?.browseTrendingMovies ?? props.sidebar?.browseTrendingMovies ?? [];
  const mainBody = sidebarData ? (
    <div class="home-main-grid">
      <div class="home-col">{props.children}</div>
      <HomeSidebarRail
        trailers={sidebarData.trailers}
        topSeries={sidebarData.topSeries}
        topMovies={sidebarData.topMovies}
      />
    </div>
  ) : (
    props.children
  );
  return (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {/* Google Analytics 4 (gtag.js) — skipped on /admin/* (see setSiteAnalytics). */}
      {gaId && siteAnalytics
        ? raw(
            `<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>` +
              `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');</script>`,
          )
        : null}
      {/* mark JS early so the poster-skeleton shimmer is scoped on before first paint */}
      {raw('<script>document.documentElement.classList.add("js")</script>')}
      <title>{props.title}</title>
      {props.description ? <meta name="description" content={props.description} /> : null}
      {props.canonical ? <link rel="canonical" href={props.canonical} /> : null}
      {/* Explicit on indexable pages too — leaves no ambiguity for crawlers that
          treat a missing directive differently from an affirmative one. */}
      <meta name="robots" content={props.noindex ? "noindex, follow" : "index, follow"} />
      <meta name="googlebot" content={props.noindex ? "noindex, follow" : "index, follow"} />
      {props.refresh ? <meta http-equiv="refresh" content={`${props.refresh.delay};url=${props.refresh.url}`} /> : null}
      <meta name="theme-color" content="#121214" />
      {/* Warm the connection to the image CDN that serves every hero backdrop and
          poster — these are the LCP on content pages, so the saved DNS+TLS round
          trip is on the critical path. No crossorigin: <img>/CSS bg are no-cors,
          so a CORS preconnect would open a separate, unused connection. */}
      <link rel="preconnect" href="https://image.tmdb.org" />
      {props.preloadImage ? (
        <link
          rel="preload"
          as="image"
          href={props.preloadImage.x1}
          imagesrcset={`${props.preloadImage.x1} 1x, ${props.preloadImage.x2} 2x`}
          fetchpriority="high"
        />
      ) : null}
      <link rel="preload" as="font" type="font/woff2" href="/fonts/archivo-var.woff2" crossOrigin="anonymous" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <link rel="apple-touch-icon" href="/icon-180.png" />
      <link rel="manifest" href="/manifest.json" />
      <meta property="og:site_name" content="TV Nightly" />
      <meta property="og:type" content={props.ogType ?? "website"} />
      <meta property="og:locale" content="en_US" />
      <meta property="og:title" content={props.ogTitle ?? props.title} />
      {props.description ? <meta property="og:description" content={props.description} /> : null}
      {props.canonical ? <meta property="og:url" content={props.canonical} /> : null}
      {ogImage ? <meta property="og:image" content={ogImage} /> : null}
      {ogImage ? <meta property="og:image:alt" content={ogImageAlt} /> : null}
      {ogImage && ogImageLarge ? (
        <>
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
        </>
      ) : null}
      {/* A branded 1200×630 card unfurls large; a bare portrait poster crops far
          better in the small summary card. Twitter reads og:* as a fallback, but
          declaring the twitter:* set explicitly stops it guessing the wrong image. */}
      <meta name="twitter:card" content={ogImage && ogImageLarge ? "summary_large_image" : "summary"} />
      <meta name="twitter:title" content={props.ogTitle ?? props.title} />
      {props.description ? <meta name="twitter:description" content={props.description} /> : null}
      {ogImage ? <meta name="twitter:image" content={ogImage} /> : null}
      {ogImage ? <meta name="twitter:image:alt" content={ogImageAlt} /> : null}
      <link rel="stylesheet" href="/styles.css" />
      {(props.ld ?? []).map((d) => jsonLd(d))}
      {/* Cloudflare Web Analytics — skipped on /admin/* alongside GA. */}
      {cfBeaconToken && siteAnalytics
        ? raw(
            `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${cfBeaconToken}"}'></script>`,
          )
        : null}
    </head>
    <body>
      <div class="nprogress" aria-hidden="true"><span class="nprogress-bar"></span><span class="nprogress-spin"></span></div>
      {props.bare ? null : (
      <header class="site-header">
        {/* inner rail centers on the same 948px column as main content */}
        <div class="header-inner">
          <a class="logo" href="/">
            <LogoMark />
            <span class="logo-word">
              TV NIGHTLY<span class="logo-dot"></span>
            </span>
          </a>
          <nav>
            <a href="/tonight" class={navClass(["/tonight", "/calendar", "/premieres"])}>
              Tonight
            </a>
            <a href="/what-to-watch" class={navClass(["/what-to-watch", "/recommend"])}>
              What to watch
            </a>
            <a href="/whats-new" class={navClass(["/whats-new", "/renewals"])}>
              What&apos;s new
            </a>
            <a href="/shorts" class={navClass(["/shorts"])}>
              Shorts
            </a>
            <div class={`nav-mega${browseActive ? " active" : ""}`}>
              <button
                type="button"
                class="nav-mega-btn"
                aria-expanded="false"
                aria-controls="browse-panel"
              >
                Browse
                <span class="nav-mega-chev" aria-hidden="true"></span>
              </button>
            </div>
            {discordUrl ? (
              <a
                class="nav-discord"
                href={discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join our Discord"
                title="Join our Discord"
              >
                <IconDiscord size={20} />
              </a>
            ) : null}
          </nav>
          <form action="/search" method="get" class="search" role="search">
            <input
              type="search"
              name="q"
              placeholder="Shows, movies, people"
              aria-label="Search shows, movies and people"
              autocomplete="off"
              spellcheck={false}
              required
            />
            <kbd class="search-key" aria-hidden="true">/</kbd>
          </form>
        </div>
        <button
          type="button"
          class="nav-toggle"
          aria-label="Open menu"
          aria-controls="mobile-menu"
          aria-expanded="false"
        >
          <span class="nav-toggle-bars" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      </header>
      )}
      {/* Browse: a full-width slide-down overlay (the "Browse everything" page as
          a panel). Rendered outside the header on purpose — the header's
          backdrop-filter would otherwise become the containing block for this
          position:fixed panel and collapse it to the header box. */}
      {props.bare ? null : (
        <div id="browse-panel" class="nav-mega-panel" hidden>
          <div class="nav-mega-bar">
            <a class="nav-mega-heading" href="/lists">
              Browse everything
            </a>
            <button type="button" class="nav-mega-close" aria-label="Close browse menu">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
          <div class="nav-mega-scroll">
            {BROWSE_SECTIONS.map((sec) => (
              <div class="nm-sec">
                <p class="nav-mega-kicker">{sec.kicker}</p>
                <div class="nm-rows">
                  {sec.links.map(([label, href]) => (
                    <a class="nm-row" href={href}>
                      {label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <div class="nm-sec">
              <p class="nav-mega-kicker">Networks</p>
              <div class="nm-nets">
                {BROWSE_NETWORKS.map(([label, logoName, slug]) => {
                  const logo = networkLogo(logoName);
                  return (
                    <a class="nm-net" href={`/network/${slug}`} title={label} aria-label={label}>
                      {logo ? (
                        <img
                          src={logo}
                          alt={label}
                          width="28"
                          height="28"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span class="nm-net-fallback" aria-hidden="true">
                          {label.slice(0, 2)}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
              <a class="nm-all chev-after" href="/top/networks">
                All networks
              </a>
            </div>
            <div class="nm-sec">
              <p class="nav-mega-kicker">TV genres</p>
              <div class="nm-chips">
                {BROWSE_TV_GENRES.map(([label, g]) => (
                  <a class="nm-chip" href={`/genre/${slugifyName(g)}`}>
                    {label}
                  </a>
                ))}
              </div>
            </div>
            <div class="nm-sec">
              <p class="nav-mega-kicker">Movie genres</p>
              <div class="nm-chips">
                {BROWSE_MOVIE_GENRES.map(([label, g]) => (
                  <a class="nm-chip" href={`/genre/${slugifyName(g)}/movies`}>
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </div>
          <a class="nav-mega-all chev-after" href="/lists">
            Browse everything
          </a>
          {browseTrendingMovies.length ? (
            <div class="nav-mega-trending">
              <p class="nav-mega-kicker">Trending movies</p>
              <div class="nav-mega-trending-row">
                {browseTrendingMovies.map((m) => (
                  <a class="nm-trend-tile" href={m.href} title={m.title}>
                    {m.poster ? (
                      <img
                        class="nm-trend-poster"
                        src={m.poster}
                        alt=""
                        width="120"
                        height="180"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span class="nm-trend-fallback" aria-hidden="true">
                        {m.title}
                      </span>
                    )}
                    <span class="nm-trend-label">{m.title}</span>
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
      <main>{mainBody}</main>
      {props.bare ? null : (
      <footer class="site-footer">
        <div class="footer-inner">
        <div class="footer-cols">
          <div class="footer-brand">
            <a class="footer-logo" href="/">
              <LogoMark size={24} />
              <span class="logo-word">
                TV NIGHTLY<span class="logo-dot"></span>
              </span>
            </a>
            <p class="footer-tagline">
              Tonight, decided<span class="logo-dot"></span>
            </p>
            <p class="footer-blurb">
              Episode rankings, release dates, and where to stream — checked around the clock,
              localized to your country.
            </p>
            <div class="footer-socials" aria-label="Follow TV Nightly">
              {SOCIALS.map(({ label, url, Icon }) => (
                <a
                  class="footer-social"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`TV Nightly on ${label}`}
                >
                  <Icon size={18} />
                </a>
              ))}
              {discordUrl ? (
                <a
                  class="footer-social"
                  href={discordUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="TV Nightly on Discord"
                >
                  <IconDiscord size={18} />
                </a>
              ) : null}
            </div>
          </div>
          <div>
            <h3>Explore</h3>
            <a href="/what-to-watch">What to watch</a>
            <a href="/recommend">Get a recommendation</a>
            <a href="/tonight">Tonight's schedule</a>
            <a href="/whats-new">What&apos;s new</a>
            <a href="/watch-orders">Watch orders</a>
            <a href="/lists">Browse everything</a>
            <a href="/about">About TV Nightly</a>
          </div>
          <div>
            <h3>Hubs</h3>
            {VERTICALS.map((v) => (
              <a href={`/${v.slug}`}>{v.name}</a>
            ))}
            <a href="/loved">Community loved</a>
          </div>
          <div class="footer-stay">
            <h3>Stay updated</h3>
            <p>Today's TV, renewals and premieres in your inbox every evening.</p>
            <form action="/subscribe" method="post" class="footer-sub">
              <input type="hidden" name="kind" value="daily" />
              <input
                type="email"
                name="email"
                placeholder="you@email.com"
                aria-label="Email address"
                required
              />
              <Honeypot />
              <button type="submit">Subscribe</button>
            </form>
            <p class="footer-sub-note">One evening email. No spam — unsubscribe anytime.</p>
          </div>
        </div>
        <div class="footer-fine">
          <p class="disclaimer">
            <strong>Disclaimer:</strong> TV Nightly is independent and is not affiliated with any TV
            shows, movies, networks, or data sources. While we aim to provide reliable information,
            the data presented on this site is not guaranteed to be accurate, complete, or current.
          </p>
          <p class="footer-attribution">
            TV and film information from{" "}
            <a href="https://www.tvmaze.com" rel="noopener">
              TVmaze
            </a>{" "}
            and{" "}
            <a href="https://www.themoviedb.org" rel="noopener">
              TMDB
            </a>{" "}
            APIs.
          </p>
        </div>
        <div class="footer-base">
          <span class="footer-base-links">
            <a href="/feedback">Feedback</a>
            <span class="footer-sep" aria-hidden="true">·</span>
            <a href="/how-we-pick">How we pick</a>
            <span class="footer-sep" aria-hidden="true">·</span>
            <a href="/editorial-policy">Editorial policy</a>
            <span class="footer-sep" aria-hidden="true">·</span>
            <a href="/terms">Terms of Service</a>
            <span class="footer-sep" aria-hidden="true">·</span>
            <a href="/privacy">Privacy Policy</a>
          </span>
          <span class="footer-copy">© 2026 TV Nightly. All rights reserved.</span>
        </div>
        </div>
      </footer>
      )}
      {props.bare ? null : (
        <button type="button" class="back-to-top" aria-label="Back to top" tabIndex={-1}>
          <span class="back-to-top-chevs" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 15.5l7-7 7 7" />
            </svg>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 15.5l7-7 7 7" />
            </svg>
          </span>
          <span class="back-to-top-label">Back to top</span>
        </button>
      )}
      {/* Mobile nav drawer — last in <body> so no ancestor transform/backdrop-filter
          traps position:fixed; must not live inside .site-header. */}
      {props.bare ? null : (
        <div id="mobile-menu" class="mobile-menu" hidden>
          <div class="mobile-menu-inner" role="navigation" aria-label="Browse">
            <a class={`mm-link ${navClass(["/tonight", "/calendar", "/premieres"])}`} href="/tonight">
              Tonight
            </a>
            <a class={`mm-link ${navClass(["/what-to-watch", "/recommend"])}`} href="/what-to-watch">
              What to watch
            </a>
            <a class={`mm-link ${navClass(["/whats-new", "/renewals"])}`} href="/whats-new">
              What&apos;s new
            </a>
            <a class={`mm-link ${navClass(["/shorts"])}`} href="/shorts">
              Shorts
            </a>
            {discordUrl ? (
              <a class="mm-link mm-discord" href={discordUrl} target="_blank" rel="noopener noreferrer">
                <IconDiscord size={18} />
                Discord
              </a>
            ) : null}
            {BROWSE_SECTIONS.map((sec) => (
              <div class="mm-sec">
                <p class="mm-kicker">{sec.kicker}</p>
                {sec.links.map(([label, href]) => (
                  <a class="mm-row" href={href}>
                    {label}
                  </a>
                ))}
              </div>
            ))}
            <div class="mm-sec">
              <p class="mm-kicker">Networks</p>
              <div class="mm-nets">
                {BROWSE_NETWORKS.map(([label, logoName, slug]) => {
                  const logo = networkLogo(logoName);
                  return (
                    <a class="mm-net" href={`/network/${slug}`} title={label} aria-label={label}>
                      {logo ? (
                        <img src={logo} alt="" width="28" height="28" loading="lazy" decoding="async" />
                      ) : (
                        <span class="mm-net-fallback" aria-hidden="true">
                          {label.slice(0, 2)}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
              <a class="mm-row chev-after" href="/top/networks">
                All networks
              </a>
            </div>
            <a class="mm-all chev-after" href="/lists">
              Browse everything
            </a>
          </div>
        </div>
      )}
      {props.bare ? null : <DiscordWelcomeModal />}
      {["/js/loading.js", "/js/typeahead.js", "/js/nav-mega.js", "/js/mobile-nav.js", "/js/shelf-scroll.js", "/js/rate.js", "/js/localtime.js", "/js/media-video.js", "/js/hero-trailer-fallback.js", "/js/hero-pip.js", "/js/photo-gallery.js", "/js/back-to-top.js", "/js/beacon.js", "/js/discord-modal.js", ...(props.scripts ?? [])].map((s) => (
        <script src={s} defer></script>
      ))}
    </body>
  </html>
  );
};

// Transient confirmations and error states (subscribe/confirm/unsubscribe,
// "Thank you", "Invalid link"): never indexable — they're one-shot pages with
// no standalone search value, often behind a single-use token.
export const MessagePage: FC<{ title: string; body: string }> = ({ title, body }) => (
  <Layout title={`${title} | TV Nightly`} noindex>
    <h1>{title}</h1>
    <p>{body}</p>
    <p>
      <a class="msg-back" href="/">
        <span class="chev-icon chev-icon-prev" aria-hidden="true"></span>
        Back to TV Nightly
      </a>
    </p>
  </Layout>
);
