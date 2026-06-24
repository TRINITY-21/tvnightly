// UTM helpers for social distribution — every outbound link gets
// source / medium / campaign so GA4 can attribute traffic to the post.
import { slugifyName } from "./format";

export type UtmSource = "tiktok" | "instagram" | "facebook" | "x" | "pinterest";

const UTM_MEDIUM = "social";

/** Slugify a public path into a GA campaign (e.g. /show/hotd/ratings → show-hotd-ratings).
 *  Reuses the canonical slugifier — identical output for URL paths, one source of truth. */
export function utmCampaignFromPath(path: string, prefix?: string): string {
  const base = slugifyName(path).slice(0, 80) || "home";
  return prefix ? `${prefix}-${base}`.slice(0, 100) : base;
}

export function withUtm(url: string, source: UtmSource, campaign: string): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", source);
  u.searchParams.set("utm_medium", UTM_MEDIUM);
  u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

// Short source codes for the shareable /r/<src>/<path> links (no utm_ soup).
const SRC_CODE: Record<UtmSource, string> = {
  facebook: "fb",
  instagram: "ig",
  tiktok: "tt",
  x: "x",
  pinterest: "pin",
};
export const SRC_FROM_CODE: Record<string, UtmSource> = {
  fb: "facebook",
  ig: "instagram",
  tt: "tiktok",
  x: "x",
  pin: "pinterest",
};

/** A clean, shareable redirect link — /r/<src>/<path> — that re-attaches the
 *  utm_* params at click time (see routes/go). The shared URL stays tidy and
 *  GA4 attribution is identical. The campaign rides along only when it differs
 *  from the path-derived default, so most links carry no query at all. */
export function shortLink(base: string, path: string, source: UtmSource, campaign: string): string {
  const origin = base.replace(/\/+$/, "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  const c = campaign === utmCampaignFromPath(clean) ? "" : `?c=${encodeURIComponent(campaign)}`;
  return `${origin}/r/${SRC_CODE[source]}${clean}${c}`;
}

/** Per-platform links for the studio “Tracking links” panel and bio/link tools. */
export function socialTrackingLinks(
  base: string,
  path: string,
  opts?: { campaign?: string; prefix?: string },
): { label: string; source: UtmSource; url: string }[] {
  const campaign = opts?.campaign ?? utmCampaignFromPath(path, opts?.prefix);
  const origin = base.replace(/\/+$/, "");
  return [
    { label: "TikTok", source: "tiktok", url: shortLink(origin, path, "tiktok", campaign) },
    { label: "Instagram (bio)", source: "instagram", url: shortLink(origin, path, "instagram", campaign) },
    { label: "X / Twitter", source: "x", url: shortLink(origin, path, "x", campaign) },
    { label: "Facebook", source: "facebook", url: shortLink(origin, path, "facebook", campaign) },
    { label: "Pinterest", source: "pinterest", url: shortLink(origin, path, "pinterest", campaign) },
  ];
}
