// UTM helpers for social distribution — every outbound link gets
// source / medium / campaign so GA4 can attribute traffic to the post.
import { slugifyName } from "./format";

export type UtmSource = "tiktok" | "instagram" | "facebook" | "x" | "pinterest" | "whatsapp";

export const UTM_MEDIUM = "social";

/** Slugify a public path into a GA campaign (e.g. /show/hotd/ratings → show-hotd-ratings).
 *  Reuses the canonical slugifier — identical output for URL paths, one source of truth. */
export function utmCampaignFromPath(path: string, prefix?: string): string {
  const base = slugifyName(path).slice(0, 80) || "home";
  return prefix ? `${prefix}-${base}`.slice(0, 100) : base;
}

// Short source codes for the shareable /r/<src>/<path> links (no utm_ soup).
const SRC_CODE: Record<UtmSource, string> = {
  facebook: "fb",
  instagram: "ig",
  tiktok: "tt",
  x: "x",
  pinterest: "pin",
  whatsapp: "wa",
};
export const SRC_FROM_CODE: Record<string, UtmSource> = {
  fb: "facebook",
  ig: "instagram",
  tt: "tiktok",
  x: "x",
  pin: "pinterest",
  wa: "whatsapp",
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
