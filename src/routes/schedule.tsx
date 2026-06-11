import { Hono } from "hono";
import { Bindings, TonightRow } from "../types";
import { epCode } from "../lib/format";
import { canonical } from "../lib/seo";
import { Layout } from "../components/Layout";
import { SubNav, SCHEDULE_TABS } from "../components/nav";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------------- tonight / calendar

app.get("/tonight", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.airstamp >= datetime('now','start of day')
       AND e.airstamp < datetime('now','start of day','+1 day')
     ORDER BY e.airstamp`,
  ).all<TonightRow>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="What's on TV tonight | TV Nightly"
      description="Every episode airing on TV and streaming tonight, in air-time order."
      canonical={canonical(c)}
    >
      <SubNav items={SCHEDULE_TABS} current="/tonight" />
      <h1>
        <span class="live-dot"></span>On TV tonight
      </h1>
      {results.length === 0 ? <p class="muted">Nothing in the schedule for today yet.</p> : null}
      <ul class="ep-list">
        {results.map((e) => (
          <li>
            <span class="muted">
              {e.airstamp ? new Date(e.airstamp).toISOString().slice(11, 16) : "--:--"}
            </span>{" "}
            <a href={`/show/${e.show_slug}`}>{e.show_name}</a> {epCode(e)}
            {e.name ? ` — ${e.name}` : ""}
            {e.network ? <span class="muted"> · {e.network}</span> : null}
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

app.get("/calendar", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.airstamp >= datetime('now', 'start of day')
       AND e.airstamp < datetime('now', '+7 days')
     ORDER BY e.airstamp`,
  ).all<TonightRow>();

  const byDay = new Map<string, TonightRow[]>();
  for (const e of results) {
    const day = e.airdate ?? (e.airstamp ?? "").slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(e);
  }

  c.header("Cache-Control", "public, max-age=900");
  return c.html(
    <Layout
      title="TV schedule this week | TV Nightly"
      description="The 7-day TV calendar: every episode airing this week, by day."
      canonical={canonical(c)}
    >
      <SubNav items={SCHEDULE_TABS} current="/calendar" />
      <h1>This week's TV calendar</h1>
      {byDay.size === 0 ? <p class="muted">No scheduled episodes in the next 7 days.</p> : null}
      {[...byDay.entries()].map(([day, eps]) => (
        <section>
          <h2>{day}</h2>
          <ul class="ep-list">
            {eps.map((e) => (
              <li>
                <a href={`/show/${e.show_slug}`}>{e.show_name}</a> {epCode(e)}
                {e.name ? ` — ${e.name}` : ""}
                {e.network ? <span class="muted"> · {e.network}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Layout>,
  );
});

// ------------------------------------------------------------- premieres

app.get("/premieres", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.number = 1 AND e.airstamp > datetime('now')
       AND e.airstamp < datetime('now', '+90 days')
     ORDER BY e.airstamp`,
  ).all<TonightRow & { season: number | null }>();

  const byMonth = new Map<string, typeof results>();
  for (const e of results) {
    const month = (e.airdate ?? e.airstamp ?? "").slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, [] as typeof results);
    byMonth.get(month)!.push(e);
  }

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Upcoming TV premieres — the next 90 days | TV Nightly"
      description="Every season premiere coming in the next three months, with dates and countdowns."
      canonical={canonical(c)}
    >
      <SubNav items={SCHEDULE_TABS} current="/premieres" />
      <h1>Upcoming TV premieres</h1>
      {results.length === 0 ? (
        <p class="muted">No premieres scheduled in the next 90 days (yet).</p>
      ) : null}
      {[...byMonth.entries()].map(([month, eps]) => (
        <section>
          <h2>{month}</h2>
          <ul class="ep-list">
            {eps.map((e) => (
              <li>
                <span class="muted">{e.airdate}</span>{" "}
                <a href={`/show/${e.show_slug}/release-date`}>{e.show_name}</a>{" "}
                <strong>Season {e.season} premiere</strong>
                {e.network ? <span class="muted"> · {e.network}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Layout>,
  );
});

export default app;
