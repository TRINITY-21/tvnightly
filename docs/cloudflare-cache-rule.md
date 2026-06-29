# Cloudflare Cache Rule for HTML (draft)

**Status:** optional. The Worker already edge-caches HTML in `caches.default`
(see `cachedFetch` in `src/index.tsx`), which is what actually cuts the D1 bill.
This Cache Rule is the **dashboard-managed equivalent** the old code note pointed
at. Its extra value is (1) caching at the CDN edge so the Worker isn't even
invoked on a hit, and (2) visibility in Cloudflare's Cache Analytics. If you
apply this rule, we can delete the Worker's `cachedFetch` layer to avoid
double-caching — ping me and I'll do it.

It also fixes the **`Browser Cache TTL: 4h`** override you currently have (that's
why cached pages report `max-age=14400` instead of each route's real value).

---

## Apply via the dashboard (≈60s)

Cloudflare → **tvnightly.com** zone → **Caching → Cache Rules → Create rule**

1. **Rule name:** `Cache HTML pages`

2. **When incoming requests match** → *Edit expression* → paste:

   ```
   (http.request.method eq "GET")
   and (not starts_with(http.request.uri.path, "/admin"))
   and (not starts_with(http.request.uri.path, "/api"))
   and (not starts_with(http.request.uri.path, "/r/"))
   ```

3. **Then** (Cache settings):
   - **Cache eligibility:** *Eligible for cache*
   - **Edge TTL:** *Use cache-control header if present, bypass cache if not* —
     honors each route's `max-age` and auto-bypasses `no-store` pages
     (`/recommend/taste`, etc.), so nothing dynamic gets cached.
   - **Browser TTL:** *Respect origin* — so the route's real `max-age` reaches
     browsers (replaces the 4h override).
   - **Cache key → Custom:**
     - **Query string:** *Ignore* `utm_source`, `utm_medium`, `utm_campaign`,
       `fbclid`, `gclid` (so social links don't fragment the cache).
     - **Headers / Geo:** add **Country (cf-ipcountry)** to the key — pages vary
       by streaming region, so this prevents serving one country's "watch on…"
       providers to another. (If your plan doesn't expose Geo in the cache key,
       it's a minor cosmetic risk: CF cache is per-colo and colos are regional.)

4. *(optional)* If you want the homepage always fresh like the Worker keeps it,
   add `and (http.request.uri.path ne "/")` to the expression.

5. **Deploy.**

---

## Or apply via API

Needs an API token with **Zone → Cache Rules → Edit** (create at
*My Profile → API Tokens*), plus the **Zone ID** (zone Overview page, right rail).

```bash
ZONE_ID=<your-zone-id>
CF_TOKEN=<token-with-cache-rules-edit>

curl -sS -X PUT \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_cache_settings/entrypoint" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "rules": [{
      "description": "Cache HTML pages",
      "expression": "(http.request.method eq \"GET\") and (not starts_with(http.request.uri.path, \"/admin\")) and (not starts_with(http.request.uri.path, \"/api\")) and (not starts_with(http.request.uri.path, \"/r/\"))",
      "action": "set_cache_settings",
      "action_parameters": {
        "cache": true,
        "edge_ttl":    { "mode": "respect_origin" },
        "browser_ttl": { "mode": "respect_origin" },
        "cache_key": {
          "ignore_query_strings_order": true,
          "custom_key": {
            "query_string": { "exclude": ["utm_source","utm_medium","utm_campaign","fbclid","gclid"] },
            "user": { "geo": true }
          }
        }
      }
    }]
  }'
```

---

## Verify

```bash
# first hit warms it, second should report a cache HIT
curl -sI https://tvnightly.com/show/the-bear | grep -i cf-cache-status   # → MISS
curl -sI https://tvnightly.com/show/the-bear | grep -i cf-cache-status   # → HIT

# dynamic pages must stay dynamic
curl -sI https://tvnightly.com/recommend/taste | grep -i cf-cache-status # → DYNAMIC/BYPASS
```

Then watch **Caching → Cache Analytics** — cached % should climb and the
origin/Worker requests for HTML should drop.
