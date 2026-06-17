import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ExploreCard } from "../components/cards";
import { FilterSelect } from "../components/forms";
import { NEWS_TABS, SubNav } from "../components/nav";
import { heroBg, hiRes, longDate, shortDate, stripHtml } from "../lib/format";
import { PROVIDER_LOGOS, REGIONS, visitorRegion } from "../lib/providers";
import { breadcrumbTrail, canonical, itemListLd, origin } from "../lib/seo";
import { tmdbBackdrop } from "../lib/tmdb";
import { Bindings, EventRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------------------- renewals

type WireRow = EventRow & {
  id: number;
  poster: string | null;
  image_url: string | null;
  weight: number;
  tmdb_id: number | null;
  network: string | null;
};

// a status outcome carries the system's good/bad/uncertain colour — the same
// language as the show-status badge — so a greenlight and a cancellation on
// the same wire never look alike
const statusTone = (v: string | null) =>
  v === "Running" ? "ok" : v === "Ended" || v === "Canceled" || v === "Cancelled" ? "bad" : "warn";

// what each event means, in one quiet line under the show's name; the
// old→new glyph gets a spoken "to" so the direction survives a screen reader
const wireLine = (ev: WireRow) => {
  switch (ev.type) {
    case "season_announced":
      return <>Season {ev.season} confirmed</>;
    case "premiere_set":
      return (
        <>
          Season {ev.season} premieres {ev.new_value ? longDate(ev.new_value) : "soon"}
        </>
      );
    case "premiere_moved":
      return (
        <>
          {ev.old_value ? longDate(ev.old_value) : "?"}{" "}
          <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
          <span class="sr-only"> to </span>{" "}
          {ev.new_value ? longDate(ev.new_value) : "?"}
        </>
      );
    default:
      return (
        <>
          {ev.old_value ?? "?"}{" "}
          <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
          <span class="sr-only"> to </span>{" "}
          <span class={`wire-to t-${statusTone(ev.new_value)}`}>{ev.new_value ?? "?"}</span>
        </>
      );
  }
};

app.get("/renewals", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ev.id, ev.type, ev.season, ev.old_value, ev.new_value, ev.detected_at, s.name, s.slug,
            COALESCE(s.poster_url, s.image_url) AS poster, s.image_url,
            s.weight, s.tmdb_id, COALESCE(s.network, s.web_channel) AS network
     FROM show_events ev JOIN shows s ON s.id = ev.show_id
     ORDER BY ev.detected_at DESC LIMIT 100`,
  ).all<WireRow>();

  const dates = results.filter((r) => r.type === "premiere_set" || r.type === "premiere_moved");
  const status = results.filter((r) => r.type === "status");

  // the wire's headline: the biggest show with a new season confirmed —
  // promoted out of the board so the same fact never prints twice
  const allRenewed = results.filter((r) => r.type === "season_announced");
  const head = allRenewed.length
    ? allRenewed.reduce((a, b) => (b.weight > a.weight ? b : a))
    : null;
  const renewed = head ? allRenewed.filter((r) => r.id !== head.id) : allRenewed;
  // the dek is one show's summary; keep the 100-row list query lean
  const headSummary = head
    ? ((
        await c.env.DB.prepare("SELECT summary FROM shows WHERE slug = ?")
          .bind(head.slug)
          .first<{ summary: string | null }>()
      )?.summary ?? null)
    : null;
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (head) {
    if (head.tmdb_id && c.env.TMDB_API_KEY) {
      art = await tmdbBackdrop(c.env.TMDB_API_KEY, head.tmdb_id);
    }
    if (!art) {
      const p = hiRes(head.image_url);
      if (p) {
        art = { x1: p };
        ambient = true;
      }
    }
  }

  const Row = ({ r }: { r: WireRow }) => (
    <li>
      <a class="sched-row" href={`/show/${r.slug}/release-date`}>
        <span class="sched-rail">{shortDate(r.detected_at)}</span>
        {r.poster ? (
          <img src={r.poster} alt="" width="46" height="69" loading="lazy" decoding="async" />
        ) : (
          <span class="sched-thumb-blank" aria-hidden="true"></span>
        )}
        <span class="sched-main">
          <span class="sched-show">{r.name}</span>
          <span class="sched-ep">{wireLine(r)}</span>
        </span>
        {r.network ? <span class="sched-net">{r.network}</span> : null}
      </a>
    </li>
  );
  const Board = ({ title, rows }: { title: string; rows: WireRow[] }) =>
    rows.length ? (
      <section class="sched-day">
        <h2>
          {title}{" "}
          <span class="sched-count">
            {rows.length} {rows.length === 1 ? "event" : "events"}
          </span>
        </h2>
        <ol class="sched-list">
          {rows.map((r) => (
            <Row r={r} />
          ))}
        </ol>
      </section>
    ) : null;

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="Renewed & cancelled TV shows — live tracker | TV Nightly"
      description="A live feed of TV renewals, cancellations, and premiere-date announcements, detected hourly from schedule data."
      canonical={canonical(c)}
      ogImage={art && !ambient ? art.x1 : undefined}
      ogImageLarge={!!(art && !ambient)}
      ld={[
        itemListLd(
          "Renewals, cancellations & premiere dates",
          results.map((r) => ({
            name: `${r.name}${r.season ? ` Season ${r.season}` : ""}`,
            url: `${site}/show/${r.slug}/release-date`,
          })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Renewals", url: canonical(c) },
        ]),
      ]}
    >
      <SubNav items={NEWS_TABS} current="/renewals" />
      <h1>Renewals, cancellations & premiere dates</h1>
      {results.length ? (
        <p class="sched-sum">
          <strong>{results.length}</strong> event{results.length === 1 ? "" : "s"} · detected hourly
          from schedule data
        </p>
      ) : (
        <p class="muted">No events detected yet — the sync job updates this hourly.</p>
      )}

      {head ? (
        <article class={`sched-hero${ambient ? " sched-ambient" : ""}`}>
          {art ? <div class="sched-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
          <div class="sched-hero-body">
            <p class="sched-kicker">Headline renewal · {shortDate(head.detected_at)}</p>
            <h2 class="sched-hero-title">
              <a href={`/show/${head.slug}/release-date`}>{head.name}</a>
            </h2>
            <p class="sched-hero-ep">
              <strong>Season {head.season} confirmed</strong>
              {head.network ? <span class="muted"> · {head.network}</span> : null}
            </p>
            {headSummary ? <p class="sched-dek">{stripHtml(headSummary)}</p> : null}
          </div>
        </article>
      ) : null}

      <Board title="Renewed — new seasons confirmed" rows={renewed} />
      <Board title="Premiere dates — set & moved" rows={dates} />
      <Board title="Status changes" rows={status} />

      <p class="wire-foot muted">
        Track a show's fate from its page — we'll email you the moment its status moves.{" "}
        <a class="chev-after" href="/premieres">
          See upcoming premieres
        </a>
      </p>
      <div class="sub-form inline">
        <form method="post" action="/subscribe" class="sub-form">
          <input type="hidden" name="kind" value="daily" />
          <label for="wire-email">Renewals and premieres in your inbox every evening:</label>
          <input id="wire-email" type="email" name="email" placeholder="you@example.com" required />
          <button type="submit">Sign me up</button>
        </form>
      </div>
    </Layout>,
  );
});

// -------------------------------------------------- what's new on streaming

app.get("/whats-new", async (c) => {
  const region = visitorRegion(c);
  const { results } = await c.env.DB.prepare(
    `SELECT kind, slug, title, service, change, detected_at FROM provider_events
     WHERE region = ? ORDER BY detected_at DESC LIMIT 150`,
  )
    .bind(region)
    .all<{ kind: string; slug: string; title: string; service: string; change: string; detected_at: number }>();

  const href = (r: { kind: string; slug: string }) =>
    r.kind === "movie" ? `/movie/${r.slug}` : `/show/${r.slug}`;
  const added = results.filter((r) => r.change === "added");
  const removed = results.filter((r) => r.change === "removed");
  const byService = (rows: typeof results) => {
    const m = new Map<string, typeof results>();
    for (const r of rows) {
      if (!m.has(r.service)) m.set(r.service, [] as typeof results);
      m.get(r.service)!.push(r);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };

  // the shelves wear the titles' real one-sheets: one lookup per medium,
  // chunked at 90 slugs — 150 events can overrun D1's 100-bind cap
  const posters = new Map<string, string>();
  const tvSlugs = [...new Set(results.filter((r) => r.kind !== "movie").map((r) => r.slug))];
  const mvSlugs = [...new Set(results.filter((r) => r.kind === "movie").map((r) => r.slug))];
  const chunk = <T,>(xs: T[]): T[][] =>
    Array.from({ length: Math.ceil(xs.length / 90) }, (_, i) => xs.slice(i * 90, i * 90 + 90));
  const lookups = await Promise.all([
    ...chunk(tvSlugs).map((slugs) =>
      c.env.DB.prepare(
        `SELECT 'tv' AS k, slug, COALESCE(poster_url, image_url) AS p FROM shows
         WHERE slug IN (${slugs.map(() => "?").join(",")})`,
      )
        .bind(...slugs)
        .all<{ k: string; slug: string; p: string | null }>(),
    ),
    ...chunk(mvSlugs).map((slugs) =>
      c.env.DB.prepare(
        `SELECT 'movie' AS k, slug, poster_url AS p FROM movies
         WHERE slug IN (${slugs.map(() => "?").join(",")})`,
      )
        .bind(...slugs)
        .all<{ k: string; slug: string; p: string | null }>(),
    ),
  ]);
  for (const { results: rs } of lookups) for (const r of rs) if (r.p) posters.set(`${r.k}:${r.slug}`, r.p);
  const posterOf = (r: { kind: string; slug: string }) =>
    posters.get(`${r.kind === "movie" ? "movie" : "tv"}:${r.slug}`) ?? null;

  // one service's slice of the shuffle: logo, chyron, the shelf
  const Board = ({
    verb,
    service,
    rows,
  }: {
    verb: string;
    service: string;
    rows: typeof results;
  }) => (
    <section class="shuffle-board">
      <header class="shuffle-head">
        <div class="shuffle-head-id">
          {PROVIDER_LOGOS[service] ? (
            <img src={PROVIDER_LOGOS[service]} alt="" width="30" height="30" loading="lazy" />
          ) : null}
          <h3 class="shuffle-title">
            {verb} <strong>{service}</strong>
          </h3>
        </div>
        <span class="shuffle-count">
          {rows.length === 1 ? "1 title" : `${rows.length} titles`}
        </span>
      </header>
      <ul class="poster-shelf">
        {rows.map((r) => (
          <li>
            <a
              class="shelf-tile"
              href={href(r)}
              title={`${r.title} · ${r.kind === "movie" ? "Movie" : "TV show"}`}
              aria-label={`${r.title} — ${r.kind === "movie" ? "movie" : "TV show"}`}
            >
              {posterOf(r) ? (
                <img src={posterOf(r)!} alt="" width="92" height="138" loading="lazy" decoding="async" />
              ) : (
                <span class="shelf-fallback">{r.title}</span>
              )}
              <span class="shelf-chip">{shortDate(r.detected_at)}</span>
            </a>
            <span class="shelf-name">{r.title}</span>
          </li>
        ))}
      </ul>
    </section>
  );

  const site = origin(c);
  c.header("Cache-Control", "private, max-age=300");
  return c.html(
    <Layout
      title={`What's new on streaming (${region}) — and what just left | TV Nightly`}
      description="Titles that just arrived on or left Netflix, Prime Video, Disney+ and more — tracked by our availability patrol, localized to your country."
      canonical={`${site}/whats-new`}
      scripts={["/js/dropdown.js"]}
      ld={[
        itemListLd(
          "New on streaming",
          added.map((r) => ({ name: r.title, url: `${site}${href(r)}` })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "What's new", url: `${site}/whats-new` },
        ]),
      ]}
    >
      <SubNav items={NEWS_TABS} current="/whats-new" />
      <h1>What's new on streaming ({region})</h1>
      <p class="muted">
        Our patrol re-checks availability around the clock and logs every change. Yesterday's
        catalog shuffle, today's news.
      </p>
      {/* data-submit-on-change: dropdown.js submits on pick (no Go button) */}
      <form method="get" action="/whats-new" class="region-line watch-region" data-submit-on-change>
        <FilterSelect
          label="Region"
          name="region"
          current={region}
          options={REGIONS.map((r) => ({ value: r, text: r }))}
        />
      </form>
      {results.length === 0 ? (
        <p class="muted">
          No changes logged for {region} yet — the patrol cycles the whole catalog every couple of
          days. Check back soon.
        </p>
      ) : null}
      {added.length ? (
        <section class="shuffle shuffle-in">
          <h2>
            Just added <span class="shuffle-sum">{added.length} arrivals</span>
          </h2>
          {byService(added).map(([service, rows]) => (
            <Board verb="New on" service={service} rows={rows} />
          ))}
        </section>
      ) : null}
      {removed.length ? (
        <section class="shuffle shuffle-out">
          <h2>
            Just left <span class="shuffle-sum">{removed.length} departures</span>
          </h2>
          <p class="muted shuffle-note">
            Gone from the catalog — they wait in gray. Most circle back; we log it when they do.
          </p>
          {byService(removed).map(([service, rows]) => (
            <Board verb="Left" service={service} rows={rows} />
          ))}
        </section>
      ) : null}
      <section class="shuffle-doors" aria-label="More on the schedule wire">
        <div class="explore-grid shuffle-door-grid">
          <ExploreCard
            icon="Live"
            title="Renewals & cancellations"
            desc="New seasons confirmed, ended runs, and status moves — detected hourly."
            href="/renewals"
          />
          <ExploreCard
            icon="Premieres"
            title="Upcoming premiere dates"
            desc="Season launches in the next few weeks, in calendar order."
            href="/premieres"
          />
        </div>
      </section>
      <div class="sub-form inline">
        <form method="post" action="/subscribe" class="sub-form">
          <input type="hidden" name="kind" value="daily" />
          <label for="shuffle-email">Get the streaming shuffle in your inbox every evening:</label>
          <input id="shuffle-email" type="email" name="email" placeholder="you@example.com" required />
          <button type="submit">Sign me up</button>
        </form>
      </div>
    </Layout>,
  );
});

export default app;
