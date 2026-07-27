// TV Nightly — app assembly. Routes live in src/routes/, one file per
// page family; shared pieces in src/lib/ and src/components/.
import { Hono } from "hono";
import { setBeaconToken, setGaId } from "./components/Layout";
import { ErrorPage, NotFoundPage } from "./components/notfound";
import { setAffiliate } from "./lib/affiliate";
import { setDiscordInvite } from "./lib/discord";
import { submitIndexNow } from "./lib/indexnow";
import { drainOutbox, notifyOwnerSignups, providerPatrol, runSync, sendDailyDigest } from "./sync";
import { fetchSiteSidebar, shouldFetchSiteSidebar } from "./lib/site-sidebar";
import type { Bindings, HonoEnv } from "./types";

import admin from "./routes/admin";
import bestEpisodes from "./routes/best-episodes";
import brand from "./routes/brand";
import compare from "./routes/compare";
import directory from "./routes/directory";
import discovery from "./routes/discovery";
import episode from "./routes/episode";
import episodeGuides from "./routes/episode-guides";
import feedback from "./routes/feedback";
import guides from "./routes/guides";
import home from "./routes/home";
import hubs from "./routes/hubs";
import legal from "./routes/legal";
import movies from "./routes/movies";
import chartMore from "./routes/chart-more";
import news from "./routes/news";
import people from "./routes/people";
import recommend from "./routes/recommend";
import schedule from "./routes/schedule";
import search from "./routes/search";
import seasonal from "./routes/seasonal";
import show from "./routes/show";
import showSubpages from "./routes/show-subpages";
import sitemaps from "./routes/sitemaps";
import subscribe from "./routes/subscribe";
import trailerShorts from "./routes/trailer-shorts";
import go from "./routes/go";
import beacon from "./routes/beacon";
import tvGuides from "./routes/tv-guides";
import tvWatchOrders from "./routes/tv-watch-orders";
import votes from "./routes/votes";
import watchOrders from "./routes/watch-orders";
import whatToWatch from "./routes/what-to-watch";

const app = new Hono<HonoEnv>();

// HTML edge-caching is done at the OUTER fetch layer (see the wrapped export at
// the bottom) — not in Hono middleware, which is what proved fiddly before. On a
// cache HIT the Hono app never runs, so the page's D1 queries + render are
// skipped entirely; we only ever store responses the route itself marked
// cacheable (public, max-age>0, no Set-Cookie). Verify with the x-edge-cache
// response header (HIT/MISS).

// Baseline security headers on every response (set before the canonical redirect
// below so 301s and error pages carry them too). No CSP/script-src: the site uses
// inline JSON-LD + third-party poster CDNs, and an unsafe-inline CSP buys little.
// This also threads the public Web Analytics beacon token into the Layout module.
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  // Analytics only on the real production origin. CF_BEACON_TOKEN and GA_ID are
  // plain vars (so they're present in `wrangler dev` too) — without this guard,
  // local pageviews report into the production Cloudflare Web Analytics + GA
  // properties and inflate the real numbers. Gate on SITE_ORIGIN (set to the
  // localhost origin in .dev.vars, the apex in wrangler.jsonc) rather than the
  // request host: it's a direct env read, not subject to URL parsing. These
  // setters are env-derived (identical every request), so the module state is
  // race-free; the per-request /admin opt-out lives in Layout (adminPage).
  const prod = c.env.SITE_ORIGIN === "https://tvnightly.com";
  setBeaconToken(prod ? c.env.CF_BEACON_TOKEN : undefined);
  setGaId(prod ? c.env.GA_ID : undefined);
  setAffiliate(c.env);
  setDiscordInvite(c.env.DISCORD_INVITE_URL);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
  return next();
});

// Right-rail sidebar (trailers + top charts) for public content pages — one fetch
// per eligible GET/HEAD. Legal, admin, subscribe flows, and asset endpoints skip.
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (shouldFetchSiteSidebar(path, c.req.method)) {
    c.set(
      "siteSidebar",
      await fetchSiteSidebar(c.env.DB, c.env.TMDB_API_KEY),
    );
  }
  return next();
});

// SEO URL canonicalization: one address per page. Collapse www → apex (canonical
// host is SITE_ORIGIN, the bare domain), merge consecutive slashes in the path,
// lowercase it, and drop trailing slashes — 301ing variants to the canonical
// form so "www.tvnightly.com", "//about", "/Show/The-Wire/" and "/show/the-wire"
// never split into duplicate URLs (and typos resolve instead of 404ing). GET/HEAD
// only — never redirect a form POST; skips %-encoded paths so escape sequences
// aren't mangled. Host + path collapse in a single redirect to avoid a double 301.
app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    const url = new URL(c.req.url);
    const apex = url.hostname.startsWith("www.") ? url.hostname.slice(4) : url.hostname;
    const p = url.pathname;
    let norm = p;
    if (!p.includes("%")) {
      norm = p.replace(/\/{2,}/g, "/");
      norm = norm.toLowerCase();
      if (norm.length > 1) norm = norm.replace(/\/+$/, "");
    }
    if (apex !== url.hostname || norm !== p) {
      url.hostname = apex;
      url.pathname = norm;
      return c.redirect(url.toString(), 301);
    }
  }
  return next();
});

// OG-scraper interceptor for the /r/<src>/<path> short links. Link-preview
// crawlers (Facebook especially) don't reliably follow the 302 when scraping
// Open Graph tags, so they'd land on no card. For crawlers we dispatch the
// destination page INTERNALLY (same app, no network — a public self-fetch loops
// to a 522 at the edge) so they read its real OG; humans fall through to the
// clean 302 in routes/go. The dest path is never "/r/…", so this can't recurse.
const OG_CRAWLER =
  /facebookexternalhit|facebookcatalog|Facebot|Twitterbot|LinkedInBot|Slackbot|Slack-ImgProxy|WhatsApp|Discordbot|TelegramBot|Pinterest|redditbot|Embedly|SkypeUriPreview|Applebot|Googlebot|bingbot|vkShare|W3C_Validator/i;
app.use("/r/*", async (c, next) => {
  if (!OG_CRAWLER.test(c.req.header("user-agent") ?? "")) return next();
  const m = new URL(c.req.url).pathname.match(/^\/r\/[^/]+\/(.+)$/);
  if (!m) return next();
  const url = new URL(c.req.url);
  url.pathname = "/" + m[1].replace(/^\/+/, "");
  url.search = "";
  return app.fetch(new Request(url.toString(), { headers: c.req.raw.headers }), c.env, c.executionCtx);
});

app.route("/", home);
app.route("/", bestEpisodes);
app.route("/", chartMore);
app.route("/", show);
app.route("/", showSubpages);
app.route("/", episode);
app.route("/", people);
app.route("/", schedule);
app.route("/", recommend);
app.route("/", directory);
app.route("/", compare);
app.route("/", hubs);
app.route("/", watchOrders);
app.route("/", tvWatchOrders);
app.route("/", episodeGuides);
app.route("/", guides);
app.route("/", tvGuides);
app.route("/", discovery);
app.route("/", seasonal);
app.route("/", movies);
app.route("/", whatToWatch);
app.route("/", news);
app.route("/", search);
app.route("/", votes);
app.route("/", subscribe);
app.route("/", go);
app.route("/", trailerShorts);
app.route("/", beacon);
app.route("/", feedback);
app.route("/", admin);
app.route("/", sitemaps);
app.route("/", brand);
app.route("/", legal);

app.notFound((c) => c.html(<NotFoundPage />, 404));

// Last line of defense: any unhandled exception (e.g. a D1 hiccup) gets a styled,
// on-brand 500 instead of a bare stack trace — and the error is logged, not leaked.
app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
  c.set("siteSidebar", undefined);
  return c.html(<ErrorPage />, 500);
});

// ---- HTML edge cache (Cache API) ---------------------------------------------
// Tracking params don't change the page, so strip them from the cache key; pages
// vary by streaming region, so key by cf-ipcountry. /admin /api /r are never
// cached (dynamic / redirects); everything else is gated by the route's own
// Cache-Control so no-store pages (recommend results etc.) bypass automatically.
const HTML_CACHE_TRACKING = /^(utm_|fbclid$|gclid$|mc_|_ga$|ref$|__cc$)/i;
const HTML_CACHE_SKIP = /^\/(admin|api|r)(\/|$)/;
// Rasterized images (og.png/pin.png) + assets are NOT HTML — they carry their own
// content-keyed edge cache (servePng's caches.default, versioned by cache key), so
// they must bypass this HTML cache entirely. Otherwise a design change is masked:
// the content key bumps but this path-keyed layer keeps serving the stale PNG.
const HTML_CACHE_ASSET = /\.(png|jpe?g|gif|svg|webp|avif|ico|xml|txt|json|ics|woff2?|css|js|map)$/i;

function htmlCacheKey(req: Request): Request {
  const url = new URL(req.url);
  const params = [...url.searchParams.entries()]
    .filter(([k]) => !HTML_CACHE_TRACKING.test(k))
    .sort((a, b) => a[0].localeCompare(b[0]));
  const cc = (req.headers.get("cf-ipcountry") || "XX").toUpperCase();
  const qs = params.map(([k, v]) => `${k}=${v}`);
  qs.push(`__cc=${cc}`);
  return new Request(`${url.origin}${url.pathname}?${qs.join("&")}`, { method: "GET" });
}

function htmlStoreable(res: Response): boolean {
  if (res.status !== 200 || res.headers.has("set-cookie")) return false;
  const cc = res.headers.get("cache-control") || "";
  return /max-age=\d/.test(cc) && !/no-store|private/i.test(cc);
}

async function cachedFetch(req: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
  const path = new URL(req.url).pathname;
  // The homepage opts into a short 120s cache (see its Cache-Control) — it's the
  // highest-traffic page and was hitting D1 on every request. It's country-keyed
  // like every other page, so region-specific content stays correct. Only the
  // dynamic prefixes below (admin/api/redirects) bypass the edge cache outright.
  if (req.method !== "GET" || HTML_CACHE_SKIP.test(path) || HTML_CACHE_ASSET.test(path)) {
    return app.fetch(req, env, ctx);
  }
  try {
    const cache = caches.default;
    const key = htmlCacheKey(req);
    const hit = await cache.match(key);
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set("x-edge-cache", "HIT");
      return r;
    }
    const res = await app.fetch(req, env, ctx);
    if (htmlStoreable(res)) {
      ctx.waitUntil(cache.put(key, res.clone()));
      const r = new Response(res.body, res);
      r.headers.set("x-edge-cache", "MISS");
      return r;
    }
    return res;
  } catch {
    return app.fetch(req, env, ctx); // cache layer must never break a request
  }
}

export default {
  fetch: cachedFetch,
  scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    // Hourly :00 = drain the outbox (send queued emails — cheap, keeps delivery
    // within the hour). Daily 21:00 = heavy catalog sync + IndexNow ping. Daily
    // 21:30 = provider patrol. Daily 22:00 = digest. Manual triggers → full sync.
    ctx.waitUntil(
      event.cron === "0 * * * *"
        ? drainOutbox(env)
        : event.cron === "30 21 * * *"
          ? providerPatrol(env)
          : event.cron === "0 22 * * *"
            ? Promise.all([sendDailyDigest(env), notifyOwnerSignups(env)])
            : runSync(env).then(() => submitIndexNow(env)),
    );
  },
};
