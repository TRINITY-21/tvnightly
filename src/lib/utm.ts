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

/** Per-platform links for the studio “Tracking links” panel and bio/link tools. */
export function socialTrackingLinks(
  base: string,
  path: string,
  opts?: { campaign?: string; prefix?: string },
): { label: string; source: UtmSource; url: string }[] {
  const campaign = opts?.campaign ?? utmCampaignFromPath(path, opts?.prefix);
  const origin = base.replace(/\/+$/, "");
  const bare = origin + (path.startsWith("/") ? path : `/${path}`);
  return [
    { label: "TikTok", source: "tiktok", url: withUtm(bare, "tiktok", campaign) },
    { label: "Instagram (bio)", source: "instagram", url: withUtm(bare, "instagram", campaign) },
    { label: "X / Twitter", source: "x", url: withUtm(bare, "x", campaign) },
    { label: "Facebook", source: "facebook", url: withUtm(bare, "facebook", campaign) },
    { label: "Pinterest", source: "pinterest", url: withUtm(bare, "pinterest", campaign) },
  ];
}
