// Page chrome: header/nav/footer, logo mark, message page.
import { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import { jsonLd } from "../lib/seo";
import { VERTICALS } from "../lib/verticals";
import { networkLogo } from "../lib/providers";
import { slugifyName } from "../lib/format";
import { IconTikTok, IconInstagram, IconX } from "./icons";

// Social handles — one place to update. Same @handle across platforms keeps the
// brand findable and matches the tvnightly.com domain.
const SOCIAL_HANDLE = "tvnightly";
const SOCIALS: { label: string; url: string; Icon: FC<{ size?: number }> }[] = [
  { label: "TikTok", url: `https://www.tiktok.com/@${SOCIAL_HANDLE}`, Icon: IconTikTok },
  { label: "Instagram", url: `https://www.instagram.com/${SOCIAL_HANDLE}`, Icon: IconInstagram },
  { label: "X", url: `https://x.com/${SOCIAL_HANDLE}`, Icon: IconX },
];

// Cloudflare Web Analytics beacon token. Request-invariant config: the token is
// the same for every request, so a middleware setting it once per request (see
// src/index.tsx) is race-free even across concurrent requests on one isolate.
// Kept module-level because Layout is rendered with plain props, not request context.
let cfBeaconToken: string | undefined;
export const setBeaconToken = (token?: string) => {
  cfBeaconToken = token;
};

// Google Tag Manager container id (public). Set from env in the request middleware
// (src/index.tsx); unset = GTM not injected (e.g. local dev).
let gtmId: string | undefined;
export const setGtmId = (id?: string) => {
  gtmId = id;
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
      ["Upcoming TV", "/premieres"],
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
  const BROWSE_SECTIONS = browseSections(new Date().getFullYear());
  return (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {/* Google Tag Manager — as high in <head> as possible */}
      {gtmId
        ? raw(
            `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${gtmId}');</script>`,
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
      {/* Cloudflare Web Analytics — deferred, privacy-first, renders only when configured. */}
      {cfBeaconToken
        ? raw(
            `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${cfBeaconToken}"}'></script>`,
          )
        : null}
    </head>
    <body>
      {/* Google Tag Manager (noscript) — immediately after <body> */}
      {gtmId
        ? raw(
            `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
          )
        : null}
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
              <div id="browse-panel" class="nav-mega-panel" hidden>
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
              </div>
            </div>
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
            <a class="mm-all chev-after" href="/lists">
              Browse everything
            </a>
          </div>
        </div>
      </header>
      )}
      <main>{props.children}</main>
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
      {["/js/loading.js", "/js/typeahead.js", "/js/nav-mega.js", "/js/mobile-nav.js", "/js/shelf-scroll.js", "/js/rate.js", "/js/localtime.js", ...(props.scripts ?? [])].map((s) => (
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
