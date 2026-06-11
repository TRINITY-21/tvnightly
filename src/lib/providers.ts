// Streaming-provider data: regions we mirror, visitor geo, brand dedupe.
import { AppContext } from "../types";
import providerLogosData from "../../data/provider-logos.json";

// provider_name -> TMDB logo URL; regenerate with scripts/fetch-provider-logos.mjs
export const PROVIDER_LOGOS: Record<string, string> = providerLogosData;

// Regions we mirror providers for (must match scripts/seed-movies.mjs).
export const REGIONS = ["US", "GB", "CA", "AU", "IN", "DE", "FR", "ES", "IT", "BR", "MX", "NG", "NL", "SE", "JP", "KR"];

/** Visitor region: explicit ?region= override, else Cloudflare geo, else US. */
export function visitorRegion(c: AppContext): string {
  const param = (c.req.query("region") ?? "").toUpperCase();
  if (REGIONS.includes(param)) return param;
  const geo = (c.req.header("cf-ipcountry") ?? "").toUpperCase();
  return REGIONS.includes(geo) ? geo : "US";
}

/** Provider names for a title in the given region (US fallback marked). */
export function providersFor(
  row: { providers_intl: string | null },
  region: string,
): { names: string[]; region: string } {
  const intl: Record<string, string[]> = row.providers_intl ? JSON.parse(row.providers_intl) : {};
  if (intl[region]?.length) return { names: intl[region], region };
  if (region !== "US" && intl.US?.length) return { names: intl.US, region: "US" };
  return { names: [], region };
}

/**
 * Collapse provider tier/channel variants to one brand key, so "Paramount+",
 * "Paramount Plus Premium", and "Paramount+ Roku Premium Channel" render as
 * a single tile. First occurrence (TMDB display priority) wins.
 */
export const providerBrand = (name: string) =>
  name
    .trim() // TMDB data has stray trailing spaces ("Paramount Plus Apple TV Channel ")
    .toLowerCase()
    .replace(/\+/g, " plus")
    .replace(/\s+(?:free\s+)?with ads$/i, "")
    .replace(/\s+(apple tv|amazon|roku premium|roku)\s+channel$/i, "")
    .replace(/\s+(premium|essential|standard|basic)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
