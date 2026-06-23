// IndexNow: instantly notify Bing / Yandex / Seznam / DuckDuckGo when content
// changes, instead of waiting for a crawl. The key is mirrored at /<key>.txt
// (public/) to prove domain ownership; we submit only genuinely-changed URLs.
import type { Bindings } from "../types";

// Public key, mirrored at public/<KEY>.txt — NOT a secret. IndexNow's ownership
// model is simply "whoever can host this file at the domain root owns it".
export const INDEXNOW_KEY = "a7f3e9d1c4b80256f1a9e3c7d5b20486";

async function ping(origin: string, urls: string[]): Promise<void> {
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: new URL(origin).host,
        key: INDEXNOW_KEY,
        keyLocation: `${origin}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
    });
    console.log(`[indexnow] ${urls.length} urls -> ${res.status}`);
  } catch (e) {
    console.error(`[indexnow] failed: ${e instanceof Error ? e.message : e}`);
  }
}

/** Submit the URLs that changed in the last sync window — show renewals /
 *  premieres + streaming-availability changes — plus the hub pages they feed.
 *  Called after the hourly sync; a no-op when nothing changed. */
export async function submitIndexNow(env: Bindings): Promise<void> {
  const origin = env.SITE_ORIGIN ?? "https://tvnightly.com";
  // ~65 min lookback (a touch over the hourly cadence) so a slightly-late run
  // never leaves a gap; re-submitting a URL is harmless (engines dedupe).
  const WINDOW = 3900;
  const [tv, prov] = await Promise.all([
    env.DB.prepare(
      `SELECT DISTINCT s.slug FROM show_events e JOIN shows s ON s.id = e.show_id
       WHERE e.detected_at > unixepoch() - ? LIMIT 300`,
    )
      .bind(WINDOW)
      .all<{ slug: string }>(),
    env.DB.prepare(
      `SELECT DISTINCT kind, slug FROM provider_events
       WHERE detected_at > unixepoch() - ? LIMIT 300`,
    )
      .bind(WINDOW)
      .all<{ kind: string; slug: string }>(),
  ]);
  const changed = new Set<string>();
  for (const r of tv.results) changed.add(`${origin}/show/${r.slug}`);
  for (const r of prov.results)
    changed.add(`${origin}/${r.kind === "movie" ? "movie" : "show"}/${r.slug}`);
  if (changed.size === 0) return; // nothing newsworthy this run
  // the hubs those changes feed are now stale too
  changed.add(`${origin}/`);
  changed.add(`${origin}/premieres`);
  changed.add(`${origin}/upcoming`);
  changed.add(`${origin}/whats-new`);
  await ping(origin, [...changed]);
}
