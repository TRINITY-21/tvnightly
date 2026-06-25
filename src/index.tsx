// TV Nightly — app assembly. Routes live in src/routes/, one file per
// page family; shared pieces in src/lib/ and src/components/.
import { Hono } from "hono";
import { setBeaconToken, setGaId, setSiteAnalytics } from "./components/Layout";
import { ErrorPage, NotFoundPage } from "./components/notfound";
import { setAffiliate } from "./lib/affiliate";
import { submitIndexNow } from "./lib/indexnow";
import { notifyOwnerSignups, providerPatrol, runSync, sendDailyDigest } from "./sync";
import type { Bindings } from "./types";

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
import go from "./routes/go";
import tvGuides from "./routes/tv-guides";
import tvWatchOrders from "./routes/tv-watch-orders";
import votes from "./routes/votes";
import watchOrders from "./routes/watch-orders";
import whatToWatch from "./routes/what-to-watch";

const app = new Hono<{ Bindings: Bindings }>();

// NOTE: HTML edge-caching is deliberately NOT done in the Worker. caches.default
// + Hono's post-handler response rewriting proved unreliable to verify, and it's
// a no-op win at low traffic. When traffic justifies it, add a Cloudflare Cache
// Rule (cache text/html on GET, honor Cache-Control, key incl. cf-ipcountry) —
// it's monitorable via CF cache analytics and carries no Worker-code risk.

// Baseline security headers on every response (set before the canonical redirect
// below so 301s and error pages carry them too). No CSP/script-src: the site uses
// inline JSON-LD + third-party poster CDNs, and an unsafe-inline CSP buys little.
// This also threads the public Web Analytics beacon token into the Layout module.
app.use("*", async (c, next) => {
  const admin = new URL(c.req.url).pathname.startsWith("/admin");
  setBeaconToken(c.env.CF_BEACON_TOKEN);
  setGaId(c.env.GA_ID);
  setSiteAnalytics(!admin);
  setAffiliate(c.env);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), browsing-topics=()");
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
  return c.html(<ErrorPage />, 500);
});

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    // :30 = provider patrol; 22:00 = daily digest; :00 (and manual) = sync, then
    // ping IndexNow with whatever changed so Bing/Yandex index it within minutes.
    ctx.waitUntil(
      event.cron === "30 * * * *"
        ? providerPatrol(env)
        : event.cron === "0 22 * * *"
          ? Promise.all([sendDailyDigest(env), notifyOwnerSignups(env)])
          : runSync(env).then(() => submitIndexNow(env)),
    );
  },
};
