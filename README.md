# TV Nightly — tvnightly.com

Fast, no-login TV site answering the questions people search every day:
best episodes, release dates, renewal status, what's on tonight.
See [PLAN.md](PLAN.md) for the full founding plan.

## Stack

Cloudflare Workers (Hono SSR) + D1 (SQLite) + TVmaze API mirror + hourly Cron sync.
$0/month on free tiers. Only cost: the domain.

## Code layout

```
src/
  index.tsx        app assembly: mounts routes, exports fetch/scheduled
  types.ts         shared row shapes (ShowRow, EpisodeRow, MovieRow, …)
  sync.ts          hourly cron: mirror refresh, events, digest, patrol
  email.ts         provider-swappable sender (console/gmail/resend)
  tokens.ts        HMAC tokens for confirm/unsubscribe links
  tvmaze.ts        TVmaze fetch + cast helpers
  lib/             pure helpers: format, seo, queries, ratings, providers,
                   franchises, verticals, crypto
  components/      JSX building blocks: Layout, nav, cards, providers, forms
  routes/          one Hono sub-app per page family (home, show, people,
                   movies, what-to-watch, news, sitemaps, …)
  styles/          numbered CSS partials -> public/styles.css
public/            static assets; styles.css is GENERATED (npm run css)
scripts/           seed/backfill tooling (node, run on demand)
migrations/        D1 schema, applied in order
```

CSS: edit `src/styles/*.css`, then `npm run css` (or `npm run css:watch`
during styling work). `npm run dev`/`deploy` rebuild it automatically.

## Local development

```sh
npm install
npm run db:schema:local        # create tables in local D1
npm run seed:fetch             # pull shows from TVmaze -> seed/seed.sql (rate-limited)
npm run seed:load:local        # load into local D1
npm run dev                    # http://localhost:8787
```

Seed size is tunable: `PAGES=4 EPISODES_TOP=100 npm run seed:fetch`
(each page = 250 shows; episodes are fetched for the top-N shows by popularity).

Test the cron sync locally:

```sh
npx wrangler dev --test-scheduled
curl 'http://localhost:8787/__scheduled?cron=0+*+*+*+*'
```

## Email alerts

Backend is selected by `EMAIL_PROVIDER` (`console` | `gmail` | `resend`), see
`src/email.ts` and `.dev.vars.example`. For Gmail you need an **app password**
(your normal password will NOT work — Google removed password SMTP in 2024):

1. Google Account → Security → enable **2-Step Verification**
2. Security → **App passwords** → create one for "Mail"
3. Set secrets: `npx wrangler secret put GMAIL_USER`,
   `npx wrangler secret put GMAIL_APP_PASSWORD`, and set
   `EMAIL_PROVIDER` to `gmail` in `wrangler.jsonc` vars.

Gmail limits: ~500 emails/day; the From address is always your Gmail. To switch
to Resend later (custom From domain): set `RESEND_API_KEY` + `EMAIL_PROVIDER=resend`.
Nothing else changes.

Subscriptions are double opt-in (HMAC-signed confirm/unsubscribe links). Set the
signing key in prod: `npx wrangler secret put SECRET` (long random string).

## Movies (phase 4)

Movie data comes from TMDB (key in `.dev.vars` as `TMDB_API_KEY`):

```sh
npm run movies:fetch          # top 500 by vote count -> seed/movies.sql (~40s)
npm run movies:load:local     # snapshot load (DELETE + INSERT, idempotent)
```

Refresh monthly-ish for new releases and rating drift. For more movies:
`PAGES=100 npm run movies:fetch` (100 pages = top 2,000).

## First deploy

1. `npx wrangler login`
2. `npx wrangler d1 create tvnightly` → paste `database_id` into `wrangler.jsonc`
3. `npm run db:schema:remote` and
   `npx wrangler d1 execute tvnightly --remote --file=migrations/0002_email_blurbs.sql`
4. `PAGES=350 EPISODES_TOP=5000 npm run seed:fetch` (full mirror, takes ~1h, rate-limited)
5. `npm run seed:load:remote`
6. Secrets: `npx wrangler secret put SECRET` (+ Gmail secrets, see above)
7. `npm run deploy`

## After deploy: Google Search Console

1. https://search.google.com/search-console → Add property → Domain → tvnightly.com
2. Verify via the DNS TXT record (Cloudflare dashboard → DNS → add record)
3. Submit the sitemap: `https://tvnightly.com/sitemap.xml`
4. Watch Performance → Queries to see what's ranking; that data drives which
   shows get editorial blurbs (`UPDATE shows SET blurb = '...' WHERE slug = '...'`).

## Attribution

TV information from [TVmaze.com](https://www.tvmaze.com) (CC BY-SA).
Keep the footer attribution intact — it is a license requirement.
