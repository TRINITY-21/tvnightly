# TV Nightly — tvnightly.com

Fast, no-login TV site answering the questions people search every day:
best episodes, release dates, renewal status, what's on tonight.
See [PLAN.md](PLAN.md) for the full founding plan.

## Stack

Cloudflare Workers (Hono SSR) + D1 (SQLite) + TVmaze API mirror + hourly Cron sync.
$0/month on free tiers. Only cost: the domain.

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

## First deploy

1. `npx wrangler login`
2. `npx wrangler d1 create tvnightly` → paste `database_id` into `wrangler.jsonc`
3. `npm run db:schema:remote`
4. `PAGES=350 EPISODES_TOP=5000 npm run seed:fetch` (full mirror, takes ~1h, rate-limited)
5. `npm run seed:load:remote`
6. `npm run deploy`

## Attribution

TV information from [TVmaze.com](https://www.tvmaze.com) (CC BY-SA).
Keep the footer attribution intact — it is a license requirement.
