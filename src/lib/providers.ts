// Streaming-provider data: regions we mirror, visitor geo, brand dedupe.
import networkLogosData from "../../data/network-logos.json";
import providerLogosData from "../../data/provider-logos.json";
import tmdbNetworkLogosData from "../../data/tmdb-network-logos.json";
import { AppContext } from "../types";

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

function networkLogoExact(name: string): string | null {
  const trimmed = name.trim();
  if (PROVIDER_LOGOS[trimmed]) return PROVIDER_LOGOS[trimmed];

  const brand = providerBrand(trimmed);
  let brandMatch: string | null = null;
  let brandKeyLen = Infinity;
  let prefixMatch: string | null = null;
  let prefixKeyLen = Infinity;
  const lower = trimmed.toLowerCase();

  for (const key of Object.keys(PROVIDER_LOGOS)) {
    const url = PROVIDER_LOGOS[key];
    if (providerBrand(key) === brand) {
      if (key.length < brandKeyLen) {
        brandKeyLen = key.length;
        brandMatch = url;
      }
    }
    const kl = key.toLowerCase();
    if (kl.startsWith(lower)) {
      if (key.length < prefixKeyLen) {
        prefixKeyLen = key.length;
        prefixMatch = url;
      }
    }
  }
  return brandMatch ?? prefixMatch;
}

/** Names to try when a TV network label doesn't match a provider key exactly. */
function networkLogoCandidates(name: string): string[] {
  const tries = [name.trim()];
  const add = (s: string) => {
    if (!tries.includes(s)) tries.push(s);
  };
  if (/paramount/i.test(name)) add("Paramount Plus");
  if (/prime|amazon/i.test(name)) add("Amazon Prime Video");
  if (/disney/i.test(name)) add("Disney Plus");
  if (/apple/i.test(name)) add("Apple TV");
  if (/bbc/i.test(name)) add("BBC iPlayer");
  if (/showtime/i.test(name)) add("Showtime");
  if (/peacock/i.test(name)) add("Peacock Premium");
  if (/\bhbo\b|hbo max|\bmax\b/i.test(name)) add("HBO Max");
  if (/netflix/i.test(name)) add("Netflix");
  if (/hulu/i.test(name)) add("Hulu");
  if (/\bfx\b/i.test(name)) add("FXNow");
  if (/\bamc\b/i.test(name)) add("AMC+");
  if (/starz/i.test(name)) add("Starz");
  if (/\bnbc\b/i.test(name)) add("NBC");
  if (/itv/i.test(name)) add("ITVX");
  if (/adult swim/i.test(name)) add("Adult Swim");
  return tries;
}

/** Curated picks — TMDB watch-provider wordmarks or /network/{id} logos. */
const NETWORK_LOGO_OVERRIDES: {
  match: string;
  provider?: string;
  tmdb_network?: number;
}[] = networkLogosData.patterns;

const TMDB_NETWORK_LOGOS: Record<string, string> = tmdbNetworkLogosData;

const logoHiRes = (url: string) => url.replace("/w92/", "/w185/");

function networkLogoOverride(name: string): string | null {
  for (const { match, provider, tmdb_network } of NETWORK_LOGO_OVERRIDES) {
    if (!new RegExp(match, "i").test(name)) continue;
    if (tmdb_network != null) {
      const url = TMDB_NETWORK_LOGOS[String(tmdb_network)];
      if (url) return url;
    }
    if (provider) {
      const url = networkLogoExact(provider);
      if (url) return logoHiRes(url);
    }
  }
  return null;
}

/** Provider logo for a TV network or streamer name, when we have one in the seed. */
export function networkLogo(name: string): string | null {
  const override = networkLogoOverride(name);
  if (override) return override;
  for (const tryName of networkLogoCandidates(name)) {
    const url = networkLogoExact(tryName);
    if (url) return url;
  }
  return null;
}

/** TMDB provider wordmark at readable size — for network brand tiles. */
export function networkLogoForBrand(name: string): string | null {
  const override = networkLogoOverride(name);
  if (override) return override;
  const url = networkLogo(name);
  return url ? logoHiRes(url) : null;
}
