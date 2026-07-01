// Branded short links for social posts: /r/<src>/<path> 302s to the real page
// with utm_source / utm_medium / utm_campaign reattached. The shared URL stays
// clean (no utm_ query soup) but GA4 still attributes the click on landing.
//   /r/fb/show/off-campus/similar
//     → /show/off-campus/similar?utm_source=facebook&utm_medium=social&utm_campaign=show-off-campus-similar
// <src> is fb|ig|tt|x|pin; ?c=<campaign> overrides the path-derived default when
// the studio used a custom campaign (e.g. ratings, showcase, promo themes).
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { Bindings, HonoEnv } from "../types";
import { SRC_FROM_CODE, UTM_MEDIUM, utmCampaignFromPath } from "../lib/utm";
import { classifyClient, edgeSignals } from "../lib/bots";

const app = new Hono<HonoEnv>();

// Humans get a clean 302 with the UTMs reattached. (OG-scraper crawlers are
// intercepted earlier in index.tsx and served the destination page directly, so
// they read its real OG card — FB won't reliably follow this redirect.)
app.get("/r/:src/:path{.+}", (c) => {
  // collapse any leading slashes so the redirect can never become protocol-
  // relative (//evil.com) — it's always a same-origin path.
  let path = `/${c.req.param("path").replace(/^\/+/, "")}`;
  // salvage legacy share links that baked the bare brand domain in as the path
  // (…/r/tt/tvnightly.com → /tvnightly.com 404): drop a leading host segment so
  // an already-posted caption lands on the homepage instead of a dead page.
  const host = (() => {
    try {
      return new URL(c.req.url).host.toLowerCase();
    } catch {
      return "";
    }
  })();
  const seg = path.slice(1).split("/", 1)[0].toLowerCase();
  if (seg && (seg === host || seg === "tvnightly.com" || seg === "www.tvnightly.com")) {
    path = `/${path.slice(1).split("/").slice(1).join("/")}`;
  }
  const source = SRC_FROM_CODE[c.req.param("src")];
  if (!source) return c.redirect(path, 302); // unknown source → page, untagged
  const campaign = c.req.query("c") || utmCampaignFromPath(path);

  // Fire-and-forget: record the click so /admin/studio/insights can show which
  // platform / campaign / page actually drives traffic — and, critically, split
  // real humans from the scanners/proxies a fresh link attracts. Logging must
  // never delay or fail the redirect — waitUntil lets the write finish after we
  // respond. (Self-identifying OG crawlers are already intercepted in index.tsx.)
  try {
    const db = c.env.DB;
    if (db) {
      const ua = c.req.header("user-agent") ?? null;
      const referer = c.req.header("referer") ?? null;
      const { country, asOrg } = edgeSignals(c.req.raw);
      const isBot = classifyClient(ua, asOrg).isBot ? 1 : 0;
      c.executionCtx.waitUntil(
        db
          .prepare(
            "INSERT INTO link_clicks (source, campaign, path, user_agent, referer, country, as_org, is_bot) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
          )
          .bind(source, campaign, path, ua?.slice(0, 400) ?? null, referer?.slice(0, 300) ?? null, country, asOrg, isBot)
          .run()
          .catch(() =>
            // pre-0027 schema (no new columns yet) → fall back to the base insert
            db.prepare("INSERT INTO link_clicks (source, campaign, path) VALUES (?1, ?2, ?3)").bind(source, campaign, path).run().catch(() => {}),
          ),
      );
    }
  } catch {
    /* no ExecutionContext (e.g. tests) — skip logging, still redirect */
  }

  // Remember the post that referred this visitor (30-day window) so a later
  // signup can be credited to this campaign in /admin/studio/insights. Lax + no
  // Secure so it also works on http://localhost during dev.
  setCookie(c, "tvn_ref", `${source}|${campaign}`, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "Lax",
    httpOnly: true,
  });

  const q = new URLSearchParams({
    utm_source: source,
    utm_medium: UTM_MEDIUM,
    utm_campaign: campaign,
  });
  c.header("Cache-Control", "private, no-store");
  return c.redirect(`${path}?${q.toString()}`, 302);
});

export default app;
