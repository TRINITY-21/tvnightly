// Best-effort bot heuristic for first-party click analytics.
//
// We already strip the *self-identifying* OG preview crawlers upstream
// (index.tsx OG_CRAWLER) — those never reach the click log. This catches the
// rest, which is what actually inflates the numbers when you post a link:
//   1. generic crawlers / SEO bots / AI scrapers by user-agent
//   2. headless + CLI agents (curl, python, puppeteer, …)
//   3. the big one — "clicks" from DATACENTER networks: platform URL-safety
//      scanners, corporate/AV proxies, monitors. Real humans come from
//      residential/mobile ISPs, never from AWS/Azure/GCP, so a datacenter ASN
//      on a plain browser UA is a near-certain non-human.
//
// It's a heuristic, not truth — but it's enough to split "real clicks" from
// "everything the internet fires at a fresh link", which is the whole question.

const BOT_UA =
  /bot|crawl|spider|slurp|scan|monitor|preview|fetch\b|curl|wget|python|http[-_ ]?client|headless|phantom|puppeteer|playwright|selenium|axios|go-http|java\/|okhttp|libwww|apache-htt|facebookexternalhit|whatsapp|telegram|discord|slack|embedly|proxy|validator|lighthouse|pagespeed|gtmetrix|uptime|pingdom|datadog|newrelic|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|amazonbot|gptbot|ccbot|claudebot|perplexity|google-?(read|other|inspection)|bingpreview/i;

// datacenter / scanner networks (matched against Cloudflare's cf.asOrganization)
const DC_ORG =
  /amazon|\baws\b|google|goog|microsoft|azure|digitalocean|hetzner|\bovh\b|linode|akamai|fastly|oracle|cloudflare|alibaba|\bbaidu\b|tencent|leaseweb|contabo|vultr|scaleway|choopa|datacamp|\bm247\b|census|censys|shodan|palo ?alto|zscaler|forcepoint|barracuda|proofpoint|mimecast|gcore|constant|colocation|hosting|datacenter|data ?center|servers?\b/i;

export interface BotVerdict {
  isBot: boolean;
  reason: string; // "" when human; else no-ua | ua | datacenter
}

/** Classify a raw request signal as bot-ish or human-ish. `asOrg` is
 *  Cloudflare's `cf.asOrganization` (undefined in local dev → skipped). */
export function classifyClient(ua: string | null | undefined, asOrg?: string | null): BotVerdict {
  const u = (ua || "").trim();
  if (!u) return { isBot: true, reason: "no-ua" };
  if (BOT_UA.test(u)) return { isBot: true, reason: "ua" };
  if (asOrg && DC_ORG.test(asOrg)) return { isBot: true, reason: "datacenter" };
  return { isBot: false, reason: "" };
}

/** Pull the Cloudflare edge geo/network signals off a Request (safe in dev,
 *  where `cf` is often absent). */
export function edgeSignals(req: Request): { country: string | null; asOrg: string | null } {
  const cf = (req as unknown as { cf?: { country?: string; asOrganization?: string } }).cf;
  return { country: cf?.country ?? null, asOrg: cf?.asOrganization ?? null };
}
