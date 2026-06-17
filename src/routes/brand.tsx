// Brand image endpoints: the raster Organization logo and the default share
// card. Both rasterize on the edge via the same resvg pipeline as the per-page
// og.png cards (src/lib/render.ts), and are heavily edge-cached.
import { Hono } from "hono";
import { Bindings } from "../types";
import { servePng } from "../lib/render";
import { buildBrandOgCard, buildLogoSvg } from "../lib/social";

const app = new Hono<{ Bindings: Bindings }>();

// Square raster logo for schema.org Organization.logo (Google prefers a raster
// over the SVG favicon). 512×512, edge-cached like every other brand image.
app.get("/logo.png", (c) => servePng(c, "logo", async () => buildLogoSvg(512), 512));

// Sitewide default og:image — the branded fallback Layout points at when a page
// has no subject image of its own. 1200×630.
app.get("/og-default.png", (c) => servePng(c, "brand-default", async () => buildBrandOgCard(), 1200));

// PWA / home-screen icons (manifest + apple-touch-icon). Same app-icon mark as
// the Organization logo, rasterized at the sizes each consumer expects.
app.get("/icon-180.png", (c) => servePng(c, "icon-180", async () => buildLogoSvg(180), 180));
app.get("/icon-192.png", (c) => servePng(c, "icon-192", async () => buildLogoSvg(192), 192));
app.get("/icon-512.png", (c) => servePng(c, "icon-512", async () => buildLogoSvg(512), 512));
// full-bleed square variant for the manifest's maskable (Android adaptive) slot
app.get("/icon-maskable-512.png", (c) =>
  servePng(c, "icon-maskable-512", async () => buildLogoSvg(512, true), 512),
);

export default app;
