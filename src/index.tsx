// TV Nightly — app assembly. Routes live in src/routes/, one file per
// page family; shared pieces in src/lib/ and src/components/.
import { Hono } from "hono";
import { NotFoundPage } from "./components/notfound";
import { providerPatrol, runSync, sendDailyDigest } from "./sync";
import type { Bindings } from "./types";

import bestEpisodes from "./routes/best-episodes";
import compare from "./routes/compare";
import episode from "./routes/episode";
import directory from "./routes/directory";
import home from "./routes/home";
import hubs from "./routes/hubs";
import legal from "./routes/legal";
import movies from "./routes/movies";
import news from "./routes/news";
import people from "./routes/people";
import recommend from "./routes/recommend";
import schedule from "./routes/schedule";
import search from "./routes/search";
import show from "./routes/show";
import showSubpages from "./routes/show-subpages";
import sitemaps from "./routes/sitemaps";
import subscribe from "./routes/subscribe";
import votes from "./routes/votes";
import watchOrders from "./routes/watch-orders";
import whatToWatch from "./routes/what-to-watch";

const app = new Hono<{ Bindings: Bindings }>();

// SEO URL canonicalization: one address per page. Lowercase the path and drop
// trailing slashes, 301ing variants to the canonical form so "/Show/The-Wire/"
// and "/show/the-wire" never split into duplicate URLs (and uppercase typos
// resolve instead of 404ing). GET/HEAD only — never redirect a form POST; skips
// %-encoded paths so escape sequences aren't mangled.
app.use("*", async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    const url = new URL(c.req.url);
    const p = url.pathname;
    if (!p.includes("%")) {
      let norm = p.toLowerCase();
      if (norm.length > 1) norm = norm.replace(/\/+$/, "");
      if (norm !== p) return c.redirect(norm + url.search, 301);
    }
  }
  return next();
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
app.route("/", movies);
app.route("/", whatToWatch);
app.route("/", news);
app.route("/", search);
app.route("/", votes);
app.route("/", subscribe);
app.route("/", sitemaps);
app.route("/", legal);

app.notFound((c) => c.html(<NotFoundPage />, 404));

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    // :30 = provider patrol; 22:00 = daily digest; :00 (and manual) = sync.
    ctx.waitUntil(
      event.cron === "30 * * * *"
        ? providerPatrol(env)
        : event.cron === "0 22 * * *"
          ? sendDailyDigest(env)
          : runSync(env),
    );
  },
};
