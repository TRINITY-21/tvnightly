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

export const breadcrumbLd = (site: string, show: ShowRow, page: string, path: string) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "TV Nightly", item: site },
    { "@type": "ListItem", position: 2, name: show.name, item: `${site}/show/${show.slug}` },
    { "@type": "ListItem", position: 3, name: page, item: `${site}${path}` },
  ],
});

export const xmlRes = (c: AppContext, xml: string) => {
  c.header("Content-Type", "application/xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};
