# PLAN.md — TV Nightly (tvnightly.com)

Founding plan, concluded 2026-06-10. Built from verified deep research (all API terms,
free tiers, and traffic claims checked against live sources on 2026-06-10).

## 1. What we're building

A fast, ad-light, no-login website answering the TV questions people search every day:

- "best episodes of [show]"
- "[show] season N release date" / "is [show] renewed or cancelled"
- "when is the next episode of [show]"
- "what's on TV tonight"

One data model (shows + episodes + air dates + ratings from TVmaze) powers all pages.
Win by being faster, cleaner, and fresher than incumbents (Episode Ninja, IMDb pages,
stale SEO blogs). Model proof: Television Stats does 69K+ visits/mo with no accounts;
Episode Ninja did 200K+ uniques and ~$1K/mo solo with this exact playbook.

Strategy note (verified risk): Google AI Overviews cut #1-result CTR ~58% on
informational queries. We therefore favor pages an AI paragraph can't replace:
live countdowns, rankings, schedules, notify-me alerts — utility over prose.

## 2. Product phases

- **Phase 1 (MVP, building now):** episode rankings + release/renewal tracker +
  schedule. No accounts. Email capture only.
- **Phase 2 (only if traffic demands):** lightweight accounts syncing the localStorage
  watch-state. Likely never needed — Television Stats proves traffic without auth.
- **Phase 3:** "what should I watch tonight" interactive picker (link magnet).
- **Phase 4 (needs movie data):** movies via Wikidata (CC0, free) or TMDB commercial
  license at $149/mo once ad revenue covers it.

## 3. MVP feature list (phase 1, complete scope)

### Pages (SEO surface)
| Page | URL | Target query |
|---|---|---|
| Show hub | `/show/{slug}` | "[show]", "[show] episodes" |
| Best episodes | `/show/{slug}/best-episodes` | "best episodes of [show]" |
| Worst episodes | `/show/{slug}/worst-episodes` | "worst episodes of [show]" |
| Next episode + countdown | `/show/{slug}/next-episode` | "when is the next episode of [show]" |
| Release/renewal status | `/show/{slug}/release-date` | "[show] season N release date", "is [show] cancelled" |
| Season pages | `/show/{slug}/season-{n}` | "[show] season N episodes" |
| Tonight's schedule | `/tonight` | "what's on TV tonight" |
| Weekly calendar | `/calendar` | "TV schedule this week" |
| Renewal news feed | `/renewals` | "renewed and cancelled shows 2026" |
| Homepage | `/` | popular/trending shows, today's episodes |

### Features
1. **Episode rankings** computed from TVmaze episode ratings (mainstream shows have
   solid coverage; hide ranking section when ratings are too sparse).
2. **Live countdowns** to next episode / season premiere (client-side JS, no backend).
3. **Renewal status badges** (Running / Ended / To Be Determined / In Development)
   with last-checked date — freshness is the moat vs stale blog posts.
4. **"Notify me" email capture per show** (renewal + premiere alerts) + one global
   "daily TV email" list. This is the retention engine and Google-independence hedge.
5. **Mark-watched checkboxes** stored in localStorage (zero backend, instant stickiness).
6. **Search** — simple typeahead endpoint against our own mirror.
7. **SEO plumbing:** XML sitemaps (sharded), JSON-LD (`TVSeries`, `TVEpisode`,
   `BreadcrumbList`), canonical URLs, OG images (generated text cards).
8. **Footer (modeled on Television Stats):** attribution ("TV information from
   TVmaze.com" + TMDB logo line when TMDB assets are used), non-affiliation +
   accuracy disclaimer, ToS, Privacy Policy, email box, socials.

### Explicitly OUT of MVP
No auth/accounts. No comments. No movies. No native apps. No CMS. No admin panel
(re-run sync instead).

## 4. Stack (all $0/month, terms verified live 2026-06-10)

| Layer | Choice | Notes |
|---|---|---|
| Data | TVmaze API | Free, keyless, commercial OK (CC BY-SA, link-back attribution). Full local mirroring staff-endorsed. Rate limit 20 calls/10s. |
| Hosting | Cloudflare Workers (free) | 100K req/day, static assets unlimited. NOT Vercel (Hobby bans ad sites). |
| Database | Cloudflare D1 (free) | 5 GB, 5M row reads/day. Index every query path (reads = rows SCANNED). |
| Framework | Hono on Workers, SSR + edge cache | Avoids the 20K static-file cap entirely. |
| Email | Resend (free) | 3K/mo, 100/day. Brevo (300/day) as overflow fallback. |
| Analytics | Cloudflare Web Analytics + Google Search Console | Both free. |
| Cron | Cloudflare Cron Triggers | Hourly sync job (50-subrequest budget per run). |
| Images | Swappable module: TVmaze/TMDB artwork now → styled text-cards fallback | See §7 risk register. |

Only real cost: domain ~$10/yr (tvnightly.com — register at Cloudflare Registrar).

## 5. Data architecture

Schema lives in `migrations/0001_init.sql` (tables: shows, episodes, subscriptions,
status_changes, sync_log).

### Sync design
- **One-time seed (local script, not a Worker):** paginate
  `https://api.tvmaze.com/shows?page=N` (250 shows/page, stop at HTTP 404), then
  `/shows/{id}/episodes` for top shows by weight. Throttled to ~1 call/550ms
  (TVmaze allows 20 calls/10s). `scripts/seed.mjs` → `seed/seed.sql` →
  `wrangler d1 execute`.
- **Hourly cron Worker:** `GET /updates/shows?since=day` → intersect with our mirror
  → refetch stale shows by weight (capped per run: free Workers allow 50
  subrequests/invocation) → upsert → status diffs into `status_changes` →
  (M5) Resend alerts to confirmed subscribers → `sync_log` row.
- **New shows** (not yet in mirror) are picked up by re-running the seed's tail pages
  periodically — TODO: small weekly job for index pages beyond the last seeded ID.
- **Serving:** pages query D1 only. Never call TVmaze per visitor. Edge-cache HTML.

## 6. SEO plan

- Sitemap sharded by show weight; submit to Google Search Console day one.
- Every page answers its query in the first viewport (answer-first, then depth).
- JSON-LD on all show/episode pages.
- Internal linking: show hub ↔ best-episodes ↔ next-episode ↔ season pages;
  /renewals feed links to every status page.
- Start indexing with top ~5K shows by weight (quality over bulk; AdSense review
  punishes thin pages), expand as ratings coverage allows.
- Original-content layer on top pages (1–2 sentence editorial blurbs on top-100
  shows' ranking pages) — AdSense "low value content" insurance.

## 7. Risk register (decisions made — do not re-litigate)

| Risk | Stance | Mitigation |
|---|---|---|
| Artwork copyright (TVmaze/TMDB images are studio-owned) | ACCEPTED — use with footer attribution "until they reach out" | Swappable image module; text-card fallback ready; all images proxied/cached our side |
| TMDB free key + ads = ToS violation ($149/mo commercial plan exists) | ACCEPTED for phase 4 | Mirror everything; budget $149/mo as first paid upgrade once revenue covers |
| IMDb bulk datasets commercially | REJECTED — do not use, Amazon enforces | TVmaze ratings only |
| AI Overviews eating informational queries | Designed around | Utility pages (countdowns, alerts, rankings) + email list |
| TVmaze ShareAlike infects computed rankings | Accepted | Moat = product speed/freshness/list, not the numbers |
| AdSense rejects copyright-infringing/thin content | Mitigated | Editorial layer on top pages; be ready to swap to text-cards before applying |
| Single data source (TVmaze) | Accepted for MVP | Full local mirror means site survives outages; imdb_id/tvdb_id columns keep future sources joinable |

## 8. Build order (weekend-sized milestones)

1. **M1 — Mirror:** D1 schema + seed script + hourly sync Worker. ✅ DONE
2. **M2 — Core pages:** show hub, best/worst episodes (season pages folded into hub). ✅ DONE
3. **M3 — Freshness pages:** next-episode countdown, release-date/renewal page, /renewals feed, /calendar. ✅ DONE
4. **M4 — SEO plumbing:** sitemaps, JSON-LD, canonical URLs. ✅ DONE (GSC verification = post-deploy, see README)
5. **M5 — Email:** capture forms, double opt-in (HMAC links), outbox-drained alerts in sync job, ToS + Privacy copy. ✅ DONE — provider swappable: console/gmail/resend (user chose Gmail app password to start)
6. **M6 — Polish:** search typeahead (/api/search + dropdown), localStorage watched-marks
   with progress counter, OG/twitter meta (poster as og:image; generated text-card PNGs
   deferred — poster artwork is the image while the §7 risk stance holds), season pages. ✅ DONE
7. **Launch:** register domain, deploy, GSC submit, blurbs on top 25 shows ✅ written
   (scripts/blurbs.sql — review/edit, then expand to top 100), then AdSense application.

## 9. Monetization sequence (verified thresholds)

1. Launch with zero ads (speed = ranking advantage while growing).
2. **AdSense** once site has real content + ToS/Privacy live (free, no traffic minimum;
   review rejects thin/infringing content).
3. **Amazon Associates** only when traffic can produce 3 qualifying sales in 180 days
   (else application is withdrawn).
4. **Journey by Mediavine** at 1K sessions/mo → **Raptive** at 25K pageviews/mo.
   Skip Monumetric ($99 fee, WordPress-only).
5. Form **LLC before first ad goes live** (also the entity AdSense/Amazon pay).
6. First paid upgrades when revenue allows: Workers $5/mo → TMDB commercial $149/mo
   (unlocks legal posters + movie data for phase 4).

## 10. Open items (founder)

- [x] Name + domain: **TV Nightly / tvnightly.com** (chosen 2026-06-10; REGISTER NOW)
- [ ] LLC state/timing (before monetization at the latest)
- [ ] Top-N shows for editorial blurbs at launch (suggest 100)
