import { Hono } from "hono";
import { Bindings, EventRow } from "../types";
import { REGIONS, visitorRegion } from "../lib/providers";
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
      <form method="get" action="/whats-new" class="sub-form">
        <label for="region-sel" class="muted" style="flex-basis:auto;font-weight:400">
          Wrong country?
        </label>
        <select
          id="region-sel"
          name="region"
          style="background:var(--bg);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:0.35rem 0.5rem"
        >
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
        <section>
          <h2>Just added</h2>
          {byService(added).map(([service, rows]) => (
            <section>
              <h3>New on {service}</h3>
              <ul class="ep-list">
                {rows.map((r) => (
                  <li>
                    <a href={href(r)}>{r.title}</a>{" "}
                    <span class="muted">
                      · {r.kind === "movie" ? "Movie" : "TV"} ·{" "}
                      {new Date(r.detected_at * 1000).toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      ) : null}
      {removed.length ? (
        <section>
          <h2>Just left</h2>
          {byService(removed).map(([service, rows]) => (
            <section>
              <h3>Left {service}</h3>
              <ul class="ep-list">
                {rows.map((r) => (
                  <li>
                    <a href={href(r)}>{r.title}</a>{" "}
                    <span class="muted">
                      · {r.kind === "movie" ? "Movie" : "TV"} ·{" "}
                      {new Date(r.detected_at * 1000).toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
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
