# TV Nightly — Growth Features Backlog

> Parked from the growth audit (2026-06-20). These are **build-later** items.
> Current focus is social distribution (TikTok / Reels / Shorts) + the social-card
> studio, NOT these. Revisit when distribution is rolling.
> Everything here is $0 to build (no new paid services).

---

## A. Viral / share loops (highest growth leverage)

- [x] **"My TV Taste Profile" shareable card** — after `/recommend`, generate a
      personalized, beautiful card ("My taste: 78% prestige drama, 22% sci-fi →
      next watch: Severance") with one-tap share + "make your own" CTA. Reuses the
      resvg card pipeline (`src/lib/social.ts`, `src/lib/render.ts`). This is the
      single highest-leverage viral mechanic — micro "Spotify Wrapped."
- [ ] **Prominent "Share this matchup" button** on `/compare/:pair` with
      pre-filled text ("[A] vs [B] — who wins? The episode ratings say…").
- [ ] **Watch-order share cards** — "the correct order to watch [franchise]" as a
      one-tap shareable (group-chat fuel).
- [ ] **Newsletter forward loop** — "forward to a friend who's behind on TV" line.

## B. Missing SEO / discovery pages (programmatic-ish, data already exists)

- [x] `/tv/best/:decade` (e.g. `/tv/best/2010s`) — "best tv shows of the 2010s"
- [x] All-time TV chart positioned for "best tv shows of all time" (extend `/top/tv`)
- [x] `/best-episodes` cross-show index → "best tv episodes of all time"
- [x] `/awards/emmys/:year`, `/awards/golden-globes/:year` — seasonal + evergreen
- [x] `/actors`, `/directors` hubs + **add Person schema to `/person/:slug`**
- [x] Seasonal: `/halloween`, `/christmas-tv`, `/best-thanksgiving-episodes`
      (build once, rank every year)
- [x] `/upcoming` — in-development shows ("upcoming tv shows 2026")
- [x] Confirm/ship `/llms.txt` for AI-crawler citations (ChatGPT/Perplexity/AI Overviews)

## C. Trust / conversion (new-domain credibility)

- [ ] Surface social proof: vote counts, "X people rated this," "updated today"
      freshness badges — prominently on show pages.
- [ ] Contextual per-show email capture ("🔔 Email me when [show] returns") next to
      the title + exit-intent on show pages (much higher convert than footer form).
- [ ] Post-recommender + post-vote email CTAs.

## D. SEO technical polish (minor gaps found in audit)

- [ ] Event schema on premiere/release-date pages
- [ ] **Indexation throttling**: prioritize best ~3–5k pages in the sitemap first;
      `noindex` genuinely thin pages (no-episode shows, 3-credit people, empty
      genre×network intersections). Release the long tail in waves as authority grows.
      *(Critical for a new domain — avoid the thin-content filter.)*

## E. Retention / product-led

- [ ] Onboarding email sequence (welcome → taste profile → pick renewal alerts)
- [ ] Re-engagement sequence ("your shows are back") keyed to subscribed shows
- [ ] Lightweight community later (subreddit r/TVNightly > Discord for an SEO site)

---

### Notes
- Source: full growth audit conversation, 2026-06-20.
- Card/share features depend on `src/lib/social.ts` + `src/lib/render.ts` (resvg).
- Email infra already exists (double opt-in, HMAC, per-show alerts, RFC 8058).
- Section B completed 2026-06-23 (Golden Globes, actor/director hubs, seasonal pages, `/top/tv` SEO copy).
