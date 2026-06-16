// Server-side SVG → PNG for Open Graph cards. Link-unfurl crawlers (Facebook,
// iMessage, X, Slack, Discord) don't run JS and won't render SVG, so og:image
// has to be real raster bytes. We reuse the same SVG cards the page can render
// and rasterize them in the Worker with resvg-wasm.
//
// resvg is NOT a browser: it ignores @font-face/data-URI fonts and renders
// `font-variation-settings` unreliably (axes collapse to the default instance).
// So the brand face is supplied as static TTF buffers and addressed by family
// NAME per weight — the four files baked into public/fonts/archivo-*.ttf:
//   Archivo (400) · Archivo SemiBold (600) · Archivo Bold (700) · Archivo Black (900)
// The OG card builders (src/lib/social.ts) speak that dialect via txtR().
import { Resvg } from "@cf-wasm/resvg";
import type { AppContext } from "../types";

// family-name → file, in the order resvg should see them
const FONT_FILES = [
  "archivo-regular.ttf",
  "archivo-semibold.ttf",
  "archivo-bold.ttf",
  "archivo-black.ttf",
];

// Loaded once per isolate. Transient failures are NOT memoized — the next
// render retries (same contract as archivoFontCss in signal.ts).
let fontBuffers: Uint8Array[] | undefined;

/** Fetch + memoize the brand TTFs from the ASSETS binding. Returns [] when the
 *  binding is missing or a file 404s — the card still rasterizes (resvg falls
 *  back to its bundled metrics), it just won't be on-brand. */
export async function loadOgFonts(assets: Fetcher | undefined): Promise<Uint8Array[]> {
  if (fontBuffers) return fontBuffers;
  if (!assets) return [];
  try {
    const bufs = await Promise.all(
      FONT_FILES.map(async (f) => {
        const res = await assets.fetch(new Request(`https://assets.invalid/fonts/${f}`));
        if (!res.ok) throw new Error(`font ${f}: ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      }),
    );
    return (fontBuffers = bufs);
  } catch {
    return [];
  }
}

/** Rasterize an SVG string to PNG bytes at a fixed output width; the height
 *  rides the SVG's own viewBox ratio. `fonts` comes from loadOgFonts(). */
export async function svgToPng(svg: string, fonts: Uint8Array[], width = 1200): Promise<Uint8Array> {
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: "width", value: width },
    font: { fontBuffers: fonts, defaultFontFamily: "Archivo" },
    shapeRendering: 2, // geometricPrecision — crisp rounded rects/strokes
    textRendering: 1, // optimizeLegibility
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  rendered.free();
  resvg.free();
  return png;
}

/** Edge-cached OG PNG endpoint. Returns the cached bytes on a hit (the
 *  crawler-fast path, no rasterize); on a miss it builds the SVG, rasterizes,
 *  caches, and returns. Mirrors the caches.default idiom in src/lib/tmdb.ts.
 *  `key` must fully determine the image — bump the version prefix below to
 *  invalidate on a design change. `buildSvg` returns null when the subject
 *  doesn't exist (404). */
export async function servePng(
  c: AppContext,
  key: string,
  buildSvg: () => Promise<string | null>,
  width = 1200,
): Promise<Response> {
  const cacheKey = new Request(`https://og-cache.tvnightly.com/v5/${key}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const svg = await buildSvg();
  if (svg == null) return c.notFound();
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, width);
  const res = new Response(png, {
    headers: {
      "Content-Type": "image/png",
      // long edge cache; short browser cache so a design bump propagates fast
      "Cache-Control": "public, max-age=3600, s-maxage=604800",
    },
  });
  const put = cache.put(cacheKey, res.clone());
  try {
    c.executionCtx.waitUntil(put);
  } catch {
    /* no execution context (e.g. unit tests) — the put still runs */
  }
  return res;
}
