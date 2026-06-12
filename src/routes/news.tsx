import { Hono } from "hono";
import { Bindings, EventRow } from "../types";
import { REGIONS, visitorRegion, PROVIDER_LOGOS } from "../lib/providers";
import { origin, canonical } from "../lib/seo";
import { Layout } from "../components/Layout";
import { SubNav, NEWS_TABS } from "../components/nav";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------------------- renewals

const eventLine = (ev: EventRow) => {
  const date = new Date(ev.detected_at * 1000).toISOString().slice(0, 10);
  switch (ev.type) {
    case "season_announced":
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a> renewed —{" "}
          <strong>Season {ev.season} confirmed</strong> <span class="muted">· {date}</span>
        </>
      );
    case "premiere_set":
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a> Season {ev.season} premieres{" "}
          <strong>{ev.new_value}</strong> <span class="muted">· {date}</span>
        </>
      );
    case "premiere_moved":
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a> premiere moved{" "}
          <span class="muted">{ev.old_value}</span>{" "}
          <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
          <strong>{ev.new_value}</strong>{" "}
          <span class="muted">· {date}</span>
        </>
      );
    default:
      return (
        <>
          <a href={`/show/${ev.slug}/release-date`}>{ev.name}</a>:{" "}
          <span class="muted">{ev.old_value ?? "?"}</span>{" "}
          <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
          <strong>{ev.new_value ?? "?"}</strong>{" "}
          <span class="muted">· {date}</span>
        </>
      );
  }
};

app.get("/renewals", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ev.type, ev.season, ev.old_value, ev.new_value, ev.detected_at, s.name, s.slug
     FROM show_events ev JOIN shows s ON s.id = ev.show_id
     ORDER BY ev.detected_at DESC LIMIT 100`,
  ).all<EventRow>();

  const renewed = results.filter((r) => r.type === "season_announced");
  const dates = results.filter((r) => r.type === "premiere_set" || r.type === "premiere_moved");
  const status = results.filter((r) => r.type === "status");

  const Section = ({ title, rows }: { title: string; rows: EventRow[] }) =>
    rows.length ? (
      <section>
        <h2>{title}</h2>
        <ul class="ep-list">
          {rows.map((r) => (
            <li>{eventLine(r)}</li>
          ))}
        </ul>
      </section>
    ) : null;

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="Renewed & cancelled TV shows — live tracker | TV Nightly"
      description="A live feed of TV renewals, cancellations, and premiere-date announcements, detected hourly from schedule data."
      canonical={canonical(c)}
    >
      <SubNav items={NEWS_TABS} current="/renewals" />
      <h1>Renewals, cancellations & premiere dates</h1>
      <p class="muted">
        Detected hourly from schedule data. <a class="chev-after" href="/premieres">See upcoming premieres</a>
      </p>
      {results.length === 0 ? (
        <p class="muted">No events detected yet — the sync job updates this hourly.</p>
      ) : null}
      <Section title="Renewed — new seasons confirmed" rows={renewed} />
      <Section title="Premiere dates set & moved" rows={dates} />
      <Section title="Status changes" rows={status} />
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

  // the shelves wear the titles' real one-sheets: one lookup per medium
  const posters = new Map<string, string>();
  const tvSlugs = [...new Set(results.filter((r) => r.kind !== "movie").map((r) => r.slug))];
  const mvSlugs = [...new Set(results.filter((r) => r.kind === "movie").map((r) => r.slug))];
  if (tvSlugs.length) {
    const { results: rs } = await c.env.DB.prepare(
      `SELECT slug, COALESCE(poster_url, image_url) AS p FROM shows
       WHERE slug IN (${tvSlugs.map(() => "?").join(",")})`,
    )
      .bind(...tvSlugs)
      .all<{ slug: string; p: string | null }>();
    for (const r of rs) if (r.p) posters.set(`tv:${r.slug}`, r.p);
  }
  if (mvSlugs.length) {
    const { results: rs } = await c.env.DB.prepare(
      `SELECT slug, poster_url AS p FROM movies
       WHERE slug IN (${mvSlugs.map(() => "?").join(",")})`,
    )
      .bind(...mvSlugs)
      .all<{ slug: string; p: string | null }>();
    for (const r of rs) if (r.p) posters.set(`movie:${r.slug}`, r.p);
  }
  const posterOf = (r: { kind: string; slug: string }) =>
    posters.get(`${r.kind === "movie" ? "movie" : "tv"}:${r.slug}`) ?? null;
  const shortDate = (ts: number) =>
    new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric" });

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
        {PROVIDER_LOGOS[service] ? (
          <img src={PROVIDER_LOGOS[service]} alt="" width="30" height="30" loading="lazy" />
        ) : null}
        <h3 class="shuffle-title">
          {verb} <strong>{service}</strong>
        </h3>
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

  c.header("Cache-Control", "private, max-age=300");
  return c.html(
    <Layout
      title={`What's new on streaming (${region}) — and what just left | TV Nightly`}
      description="Titles that just arrived on or left Netflix, Prime Video, Disney+ and more — tracked by our availability patrol, localized to your country."
      canonical={`${origin(c)}/whats-new`}
    >
      <SubNav items={NEWS_TABS} current="/whats-new" />
      <h1>What's new on streaming ({region})</h1>
      <p class="muted">
        Our patrol re-checks availability around the clock and logs every change. Yesterday's
        catalog shuffle, today's news.
      </p>
      {/* explicit submit, no onchange: arrow-keying through a closed select
          must not navigate (WCAG 3.2.2), and it must work without JS */}
      <form method="get" action="/whats-new" class="region-line">
        <label for="region-sel" class="region-k">
          Region
        </label>
        <select id="region-sel" name="region">
          {REGIONS.map((r) => (
            <option value={r} selected={r === region}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit">Go</button>
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
      <div class="sub-form inline">
        <form method="post" action="/subscribe" class="sub-form">
          <input type="hidden" name="kind" value="daily" />
          <label>Get the streaming shuffle in your inbox:</label>
          <input type="email" name="email" placeholder="you@example.com" required />
          <button type="submit">Sign me up</button>
        </form>
      </div>
    </Layout>,
  );
});

export default app;
