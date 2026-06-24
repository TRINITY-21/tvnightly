// Branded short links for social posts: /r/<src>/<path> 302s to the real page
// with utm_source / utm_medium / utm_campaign reattached. The shared URL stays
// clean (no utm_ query soup) but GA4 still attributes the click on landing.
//   /r/fb/show/off-campus/similar
//     → /show/off-campus/similar?utm_source=facebook&utm_medium=social&utm_campaign=show-off-campus-similar
// <src> is fb|ig|tt|x|pin; ?c=<campaign> overrides the path-derived default when
// the studio used a custom campaign (e.g. ratings, showcase, promo themes).
import { Hono } from "hono";
import { Bindings } from "../types";
import { SRC_FROM_CODE, UTM_MEDIUM, utmCampaignFromPath } from "../lib/utm";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/r/:src/:path{.+}", (c) => {
  // collapse any leading slashes so the redirect can never become protocol-
  // relative (//evil.com) — it's always a same-origin path.
  const path = `/${c.req.param("path").replace(/^\/+/, "")}`;
  const source = SRC_FROM_CODE[c.req.param("src")];
  if (!source) return c.redirect(path, 302); // unknown source → page, untagged
  const campaign = c.req.query("c") || utmCampaignFromPath(path);
  const q = new URLSearchParams({
    utm_source: source,
    utm_medium: UTM_MEDIUM,
    utm_campaign: campaign,
  });
  c.header("Cache-Control", "private, no-store");
  return c.redirect(`${path}?${q.toString()}`, 302);
});

export default app;
