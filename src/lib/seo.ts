// Canonical URLs, JSON-LD, sitemap response helpers.
import { raw } from "hono/html";
import { AppContext, ShowRow } from "../types";

export const origin = (c: AppContext) => c.env.SITE_ORIGIN ?? new URL(c.req.url).origin;
export const canonical = (c: AppContext) => origin(c) + new URL(c.req.url).pathname;

// </script> can't appear inside a JSON-LD block; escape < to be safe.
export const jsonLd = (data: unknown) =>
  raw(
    `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
  );

// FAQPage: each answer's text MUST also be visible in the page body (Google's
// rule), so callers pass the same sentence they render. Rich-result accordions
// are gov/health-only since 2023, but this still feeds Bing + AI overviews.
export const faqLd = (items: { q: string; a: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});

// Site-wide brand identity, rendered once on the homepage per Google's guidance:
// an Organization node (logo + knowledge-panel entity) and a WebSite node whose
// SearchAction declares the Google sitelinks search box. The shared @id lets the
// two cross-reference, and gives AI search engines a stable entity to ground on.
export const siteIdentityLd = (site: string) => [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${site}/#organization`,
    name: "TV Nightly",
    url: site,
    // ImageObject (with dims) is the form Google prefers for a knowledge-panel
    // logo; /logo.png is the 512² brand mark rendered by src/routes/brand.tsx.
    logo: {
      "@type": "ImageObject",
      url: `${site}/logo.png`,
      width: 512,
      height: 512,
    },
    // NOTE: no `sameAs` — TV Nightly has no official social profiles yet. Adding
    // fabricated/guessed handles would be worse than omitting; wire real ones here.
    description:
      "Independent TV and movie guide: episode rankings, season release dates, renewal status, and where to stream — checked around the clock and localized to your country.",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${site}/#website`,
    name: "TV Nightly",
    url: site,
    description:
      "Find what to watch tonight: TV episode rankings, season release dates, renewal status, and where to stream — across every show and movie.",
    publisher: { "@id": `${site}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${site}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  },
];

export const breadcrumbLd = (site: string, show: ShowRow, page: string, path: string) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "TV Nightly", item: site },
    { "@type": "ListItem", position: 2, name: show.name, item: `${site}/show/${show.slug}` },
    { "@type": "ListItem", position: 3, name: page, item: `${site}${path}` },
  ],
});

// Generic breadcrumb trail for the many list/hub/directory pages that aren't
// hung off a single show. Pass crumbs in order ({name, absolute url}); positions
// are assigned 1..n. (breadcrumbLd above is the show-specific shorthand.)
export const breadcrumbTrail = (crumbs: { name: string; url: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: crumbs.map((crumb, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: crumb.name,
    item: crumb.url,
  })),
});

// A ranked ItemList — the shape Google reads for list/carousel rich results.
// Callers pass the list's name and its rows already in display order; we number
// them 1..n. A ListItem with no target is invalid, so url-less items are dropped.
export const itemListLd = (
  name: string,
  items: { name: string; url: string; image?: string }[],
) => ({
  "@context": "https://schema.org",
  "@type": "ItemList",
  name,
  itemListElement: items
    .filter((it) => it.url)
    .map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: it.url,
      ...(it.image ? { image: it.image } : {}),
    })),
});

// AboutPage for /about, back-referencing the site's Organization entity (whose
// full node is emitted once on the homepage via siteIdentityLd). The shared @id
// lets crawlers ground the E-E-A-T "about" page on the same brand entity.
export const aboutPageLd = (site: string) => ({
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About TV Nightly",
  url: `${site}/about`,
  mainEntity: { "@id": `${site}/#organization` },
});

// One <url> sitemap entry, with an optional <lastmod> (ISO 8601 date). Search
// engines use lastmod to prioritise re-crawls, so we emit it wherever we have a
// real signal (a row's updated_at, an episode airdate, or the deploy date for
// evergreen pages) and omit it otherwise rather than fake a date.
export const sitemapUrl = (loc: string, lastmod?: string) =>
  `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;

// TVmaze/TMDB store "updated" as an epoch in *seconds*; sitemaps want a bare
// YYYY-MM-DD. Returns undefined for the 0 default so thin rows emit no lastmod.
export const epochDay = (epochSeconds?: number | null): string | undefined =>
  epochSeconds && epochSeconds > 0
    ? new Date(epochSeconds * 1000).toISOString().slice(0, 10)
    : undefined;

export const xmlRes = (c: AppContext, xml: string) => {
  c.header("Content-Type", "application/xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};
