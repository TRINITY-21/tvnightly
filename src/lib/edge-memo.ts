// Per-colo JSON memo over the Cache API — for deterministic, catalog-derived
// values (door art, directory lookups) whose backing queries are unindexable
// LIKE/json_tree scans. Billing counts every scanned row, so repeat page
// renders (bot crawls especially) must not re-run them; worst case a value is
// `ttl` seconds stale after the nightly sync, which these callers tolerate.
export async function edgeMemoJson<T>(key: string, ttl: number, compute: () => Promise<T>): Promise<T> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/memo/v1/${key}`);
  const cache = caches.default;
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return (await hit.json()) as T;
  } catch {
    /* cache unavailable / parse error → recompute */
  }
  const val = await compute();
  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify(val), {
        headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${ttl}` },
      }),
    );
  } catch {
    /* caching is best-effort */
  }
  return val;
}
