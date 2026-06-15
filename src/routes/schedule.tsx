import { Hono } from "hono";
import { FC } from "hono/jsx";
import { Layout } from "../components/Layout";
import { ExploreCard } from "../components/cards";
import { SCHEDULE_TABS, SubNav } from "../components/nav";
import { MONTHS, airTime, epCode, heroBg, hiRes, homeDateline, premiereDateParts, stripHtml } from "../lib/format";
import { canonical } from "../lib/seo";
import { tmdbBackdrop } from "../lib/tmdb";
import { Bindings, TonightRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------------- tonight / calendar

// One row grammar for the whole schedule section: time (or date) on the
// rail, poster, episode line, network chyron at the right edge.
const SchedRow: FC<{
  e: TonightRow;
  rail: string;
  href?: string;
  line?: string;
  /** When set, the rail is an air time: render it as a localized <time> (the
   *  `rail` string is the UTC fallback). Omit for date rails (premieres). */
  railTime?: string | null;
}> = ({ e, rail, href, line, railTime }) => (
  <li>
    <a class="sched-row" href={href ?? `/show/${e.show_slug}`}>
      <span class="sched-rail">
        {railTime ? (
          <time data-localtime="compact" datetime={new Date(railTime).toISOString()}>
            {rail}
          </time>
        ) : (
          rail
        )}
      </span>
      {(e.show_poster ?? e.show_image) ? (
        <img
          src={(e.show_poster ?? e.show_image)!}
          alt=""
          width="46"
          height="69"
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span class="sched-thumb-blank" aria-hidden="true"></span>
      )}
      <span class="sched-main">
        <span class="sched-show">{e.show_name}</span>
        <span class="sched-ep">{line ?? `${epCode(e)}${e.name ? ` — ${e.name}` : ""}`}</span>
      </span>
      {e.network ? <span class="sched-net">{e.network}</span> : null}
    </a>
  </li>
);

/** "2026-06-12" -> "Friday · June 12" (UTC; the schedule speaks UTC). */
const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = d.toLocaleString("en-US", { weekday: "long", timeZone: "UTC" });
  const monthDay = d.toLocaleString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  return `${weekday} · ${monthDay}`;
};

app.get("/tonight", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network,
            s.poster_url AS show_poster, s.image_url AS show_image
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE e.airstamp >= datetime('now','start of day')
       AND e.airstamp < datetime('now','start of day','+1 day')
     ORDER BY e.airstamp`,
  ).all<TonightRow>();

  // the night's biggest title leads in the house frame
  const head = results.length
    ? await c.env.DB.prepare(
        `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network,
                s.poster_url AS show_poster, s.image_url AS show_image,
                s.tmdb_id AS tmdb_id, s.summary AS show_summary
         FROM episodes e JOIN shows s ON s.id = e.show_id
         WHERE e.airstamp >= datetime('now','start of day')
           AND e.airstamp < datetime('now','start of day','+1 day')
         ORDER BY s.weight DESC LIMIT 1`,
      ).first<TonightRow & { tmdb_id: number | null; show_summary: string | null }>()
    : null;
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (head) {
    if (head.tmdb_id && c.env.TMDB_API_KEY) {
      art = await tmdbBackdrop(c.env.TMDB_API_KEY, head.tmdb_id);
    }
    if (!art) {
      const p = hiRes(head.show_image);
      if (p) {
        art = { x1: p };
        ambient = true;
      }
    }
  }
  const rest = head ? results.filter((e) => e.id !== head.id) : results;

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="What's on TV tonight | TV Nightly"
      description="Every episode airing on TV and streaming tonight, in air-time order."
      canonical={canonical(c)}
    >
      <SubNav items={SCHEDULE_TABS} current="/tonight" />
      <p class="section-eyebrow">{homeDateline()}</p>
      <h1>
        <span class="live-dot"></span>On TV tonight
      </h1>
      {results.length ? (
        <p class="sched-sum">
          <strong>{results.length}</strong> episode{results.length === 1 ? "" : "s"} on the
          schedule · your local time
        </p>
      ) : (
        <p class="muted">Nothing in the schedule for today yet — check back after the next sync.</p>
      )}

      {head ? (
        <article class={`sched-hero${ambient ? " sched-ambient" : ""}`}>
          {art ? <div class="sched-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
          <div class="sched-hero-body">
            <p class="sched-kicker">
              Tonight's headliner
              {head.airstamp ? (
                <>
                  {" · "}
                  <time data-localtime datetime={new Date(head.airstamp).toISOString()}>
                    {airTime(head.airstamp)} UTC
                  </time>
                </>
              ) : null}
            </p>
            <h2 class="sched-hero-title">
              <a href={`/show/${head.show_slug}`}>{head.show_name}</a>
            </h2>
            <p class="sched-hero-ep">
              {epCode(head)}
              {head.name ? ` — ${head.name}` : ""}
              {head.network ? <span class="muted"> · {head.network}</span> : null}
            </p>
            {head.show_summary ? <p class="sched-dek">{stripHtml(head.show_summary)}</p> : null}
          </div>
        </article>
      ) : null}

      {rest.length ? (
        <ol class="sched-list">
          {rest.map((e) => (
            <SchedRow e={e} rail={airTime(e.airstamp) ?? "--:--"} railTime={e.airstamp} />
          ))}
        </ol>
      ) : null}

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Calendar"
            title="This week's calendar"
            desc="Every episode airing in the next seven days, grouped by day."
            href="/calendar"
          />
          <ExploreCard
            icon="Premieres"
            title="Upcoming premieres"
            desc="Season premieres on the books for the next ninety days."
            href="/premieres"
          />
          <ExploreCard
            icon="Charts"
            title="Top TV shows"
            desc="The highest-rated series we track — weight and popularity gate the board."
            href="/top/tv"
          />
        </div>
      </section>
    </Layout>,
  );
});

app.get("/calendar", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network,
            s.poster_url AS show_poster, s.image_url AS show_image
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
      <p class="section-eyebrow">The week ahead</p>
      <h1>This week's TV calendar</h1>
      {byDay.size === 0 ? (
        <p class="muted">No scheduled episodes in the next 7 days.</p>
      ) : (
        <p class="sched-sum">
          <strong>{results.length}</strong> episode{results.length === 1 ? "" : "s"} across{" "}
          {byDay.size} day{byDay.size === 1 ? "" : "s"} · your local time
        </p>
      )}
      {[...byDay.entries()].map(([day, eps]) => (
        <section class="sched-day">
          <h2>
            {dayLabel(day)}{" "}
            <span class="sched-count">
              {eps.length} episode{eps.length === 1 ? "" : "s"}
            </span>
          </h2>
          <ol class="sched-list">
            {eps.map((e) => (
              <SchedRow e={e} rail={airTime(e.airstamp) ?? "--:--"} railTime={e.airstamp} />
            ))}
          </ol>
        </section>
      ))}

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Tonight"
            title="On TV tonight"
            desc="Every episode airing today, in air-time order."
            href="/tonight"
          />
          <ExploreCard
            icon="Premieres"
            title="Upcoming premieres"
            desc="Season premieres on the books for the next ninety days."
            href="/premieres"
          />
          <ExploreCard
            icon="Shortcut"
            title="All-time best episodes"
            desc="The single greatest hours of television, across every show."
            href="/best-episodes"
          />
        </div>
      </section>
    </Layout>,
  );
});

// ------------------------------------------------------------- premieres

app.get("/premieres", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network,
            s.poster_url AS show_poster, s.image_url AS show_image
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
  const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Upcoming TV premieres — the next 90 days | TV Nightly"
      description="Every season premiere coming in the next three months, with dates and countdowns."
      canonical={canonical(c)}
    >
      <SubNav items={SCHEDULE_TABS} current="/premieres" />
      <p class="section-eyebrow">The next 90 days</p>
      <h1>Upcoming TV premieres</h1>
      {results.length === 0 ? (
        <p class="muted">No premieres scheduled in the next 90 days (yet).</p>
      ) : (
        <p class="sched-sum">
          <strong>{results.length}</strong> premiere{results.length === 1 ? "" : "s"} on the books
        </p>
      )}
      {[...byMonth.entries()].map(([month, eps]) => (
        <section class="sched-day">
          <h2>
            {monthLabel(month)}{" "}
            <span class="sched-count">
              {eps.length} premiere{eps.length === 1 ? "" : "s"}
            </span>
          </h2>
          <ol class="sched-list">
            {eps.map((e) => {
              const { day, month: mon } = premiereDateParts(e.airdate);
              return (
                <SchedRow
                  e={e}
                  rail={`${mon} ${day}`}
                  href={`/show/${e.show_slug}/release-date`}
                  line={`Season ${e.season ?? "?"} premiere`}
                />
              );
            })}
          </ol>
        </section>
      ))}

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Tonight"
            title="On TV tonight"
            desc="Every episode airing today, in air-time order."
            href="/tonight"
          />
          <ExploreCard
            icon="Calendar"
            title="This week's calendar"
            desc="Every episode airing in the next seven days, grouped by day."
            href="/calendar"
          />
          <ExploreCard
            icon="Live"
            title="Renewals & cancellations"
            desc="Which shows got picked up, which got the axe."
            href="/renewals"
          />
        </div>
      </section>
    </Layout>,
  );
});

export default app;
