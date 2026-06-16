// Outbound, affiliate-tagged "watch" links — but ONLY for providers that
// actually run an affiliate program. Netflix, Disney+, Hulu, Max etc. don't pay
// for content links, so they stay as internal browse tiles; only Amazon (Prime
// Video, via Associates) and Apple TV (Performance Partners) become outbound
// links here. Tags are env-gated: the link works without them and starts
// earning the moment the IDs are set — nothing to change in the views.
import { providerBrand } from "./providers";

let amazonTag = ""; // Amazon Associates store id, e.g. "tvnightly-20"
let appleToken = ""; // Apple Services PP campaign token (the `at` value)

/** Wire affiliate ids from env once per request (see index.tsx middleware). */
export function setAffiliate(env: { AMAZON_ASSOC_TAG?: string; APPLE_AFFILIATE_TOKEN?: string }) {
  amazonTag = env.AMAZON_ASSOC_TAG ?? "";
  appleToken = env.APPLE_AFFILIATE_TOKEN ?? "";
}

// Amazon marketplace per region (where Prime Video actually sells); default .com.
const AMAZON_TLD: Record<string, string> = {
  US: "com",
  GB: "co.uk",
  CA: "ca",
  AU: "com.au",
  IN: "in",
  DE: "de",
  FR: "fr",
  ES: "es",
  IT: "it",
  BR: "com.br",
  MX: "com.mx",
  JP: "co.jp",
  NL: "nl",
};

export interface WatchLink {
  href: string;
  provider: string;
}

/**
 * An outbound, affiliate-tagged "watch" link for a provider — or null when the
 * provider has no usable affiliate program (the caller then keeps the internal
 * browse tile). Best-effort title search on the provider's own site.
 */
export function watchUrl(providerName: string, title: string, region: string): WatchLink | null {
  const brand = providerBrand(providerName);
  const q = encodeURIComponent(title);

  // Amazon Prime Video — Associates search link, tagged when configured
  if (/amazon|prime video/.test(brand)) {
    const tld = AMAZON_TLD[region] ?? "com";
    const tag = amazonTag ? `&tag=${encodeURIComponent(amazonTag)}` : "";
    return { href: `https://www.amazon.${tld}/s?k=${q}&i=instant-video${tag}`, provider: providerName };
  }

  // Apple TV — title search; the PP campaign token rides as `at` when set
  if (/apple tv/.test(brand)) {
    const base = `https://tv.apple.com/search?term=${q}`;
    return { href: appleToken ? `${base}&at=${encodeURIComponent(appleToken)}` : base, provider: providerName };
  }

  return null;
}
