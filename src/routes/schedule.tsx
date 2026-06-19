import { Hono } from "hono";
import { FC } from "hono/jsx";
import { Layout } from "../components/Layout";
import { ExploreCard } from "../components/cards";
import { SCHEDULE_TABS, SubNav } from "../components/nav";
import { MONTHS, airTime, epCode, heroBg, hiRes, homeDateline, longDate, premiereDateParts, slugifyName, stripHtml } from "../lib/format";
import { breadcrumbTrail, canonical, itemListLd, origin } from "../lib/seo";
import { tmdbBackdrop, tmdbUpcomingMovies } from "../lib/tmdb";
import { liveTonight } from "../lib/schedule-live";
import { Bindings, TonightRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// Even the full guide keeps to real programming — no news, talk, reality, game,
// variety, sport or award filler. type is TVmaze's own classification. (The
// homepage rails curate harder still, adding a rating gate that also drops soaps.)
const SCRIPTED_TYPES = "'Scripted', 'Animation', 'Documentary'";

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
          alt={`${e.show_name} poster`}
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
  // live from TVmaze's schedule API — accurate, current, scripted-only — instead
  // of our stale D1 snapshot (see src/lib/schedule-live.ts).
  const results = await liveTonight(c);

  // the night's biggest title leads in the house frame — the highest-rated airing,
  // enriched with a backdrop + summary from our mirror when the title is known
  const top = results[0] ?? null; // results are popularity-ordered (TVmaze weight)
  const extra = top
    ? await c.env.DB.prepare("SELECT tmdb_id, summary FROM shows WHERE id = ?")
        .bind(top.show_id)
        .first<{ tmdb_id: number | null; summary: string | null }>()
    : null;
  const head: (TonightRow & { tmdb_id: number | null; show_summary: string | null }) | null = top
    ? { ...top, tmdb_id: extra?.tmdb_id ?? null, show_summary: extra?.summary ?? null }
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
  // the guide itself reads in air-time order ("your local time")
  const rest = (head ? results.filter((e) => e.id !== head.id) : results)
    .slice()
    .sort((a, b) => (a.airstamp ?? "").localeCompare(b.airstamp ?? ""));

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="What's on TV tonight | TV Nightly"
      description="Every episode airing on TV and streaming tonight, in air-time order."
      canonical={canonical(c)}
      ogImage={art && !ambient ? art.x1 : undefined}
      ogImageLarge={!!(art && !ambient)}
      ld={[
        itemListLd(
          "On TV tonight",
          results.map((e) => ({
            name: `${e.show_name} ${epCode(e)}`,
            url: `${site}/show/${e.show_slug}`,
          })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "On tonight", url: canonical(c) },
        ]),
      ]}
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
  // live from TVmaze (same source + scripted/no-strip filtering as /tonight),
  // a day at a time across the week, each day in air-time order
  const dates = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10),
  );
  const perDay = await Promise.all(dates.map((d) => liveTonight(c, d)));
  const byDay = new Map<string, TonightRow[]>();
  const results: TonightRow[] = [];
  dates.forEach((d, i) => {
    const eps = perDay[i]
      .slice()
      .sort((a, b) => (a.airstamp ?? "").localeCompare(b.airstamp ?? ""));
    if (eps.length) {
      byDay.set(d, eps);
      results.push(...eps);
    }
  });

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=900");
  return c.html(
    <Layout
      title="TV schedule this week | TV Nightly"
      description="The 7-day TV calendar: every episode airing this week, by day."
      canonical={canonical(c)}
      ld={[
        itemListLd(
          "This week's TV calendar",
          results.map((e) => ({
            name: `${e.show_name} ${epCode(e)}`,
            url: `${site}/show/${e.show_slug}`,
          })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "This week", url: canonical(c) },
        ]),
      ]}
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

type UpcomingFilm = {
  tmdb_id: number;
  title: string;
  release_date: string;
  poster_url: string | null;
  slug: string | null;
};
const filmHref = (m: UpcomingFilm) =>
  m.slug ? `/movie/${m.slug}` : `/movie/${slugifyName(m.title)}?t=${m.tmdb_id}`;

app.get("/premieres", async (c) => {
  // ?tab=movies opens the Movies tab server-side (the "New movies" card deep-links here)
  const movieTab = c.req.query("tab") === "movies";
  // one hub for both — season premieres from our TVmaze schedule, movie releases
  // live from TMDB /movie/upcoming (founder: fold upcoming movies in here, not a
  // separate page). Both scripted/real; reality TV is already filtered out.
  const [tv, upcoming] = await Promise.all([
    c.env.DB.prepare(
      `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network,
              s.poster_url AS show_poster, s.image_url AS show_image
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.number = 1 AND e.airstamp > datetime('now')
         AND e.airstamp < datetime('now', '+90 days')
         AND s.type IN (${SCRIPTED_TYPES})
       ORDER BY e.airstamp`,
    ).all<TonightRow & { season: number | null }>(),
    c.env.TMDB_API_KEY ? tmdbUpcomingMovies(c.env.TMDB_API_KEY) : Promise.resolve([]),
  ]);
  const results = tv.results;

  // rank movies by popularity, keep the most anticipated, then show them in date
  // order — so the big releases lead and obscure long-tail titles drop off
  const today = new Date().toISOString().slice(0, 10);
  const topFilms = upcoming
    .filter((m) => m.releaseDate >= today)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 30);
  const slugByTmdb = new Map<number, string>();
  if (topFilms.length) {
    const ids = topFilms.map((m) => m.tmdbId);
    const { results: mrows } = await c.env.DB.prepare(
      `SELECT tmdb_id, slug FROM movies WHERE tmdb_id IN (${ids.map(() => "?").join(",")})`,
    )
      .bind(...ids)
      .all<{ tmdb_id: number; slug: string }>();
    for (const r of mrows) slugByTmdb.set(r.tmdb_id, r.slug);
  }
  const movies: UpcomingFilm[] = topFilms
    .map((m) => ({
      tmdb_id: m.tmdbId,
      title: m.title,
      release_date: m.releaseDate,
      poster_url: m.posterPath ? `https://image.tmdb.org/t/p/w342${m.posterPath}` : null,
      slug: slugByTmdb.get(m.tmdbId) ?? null,
    }))
    .sort((a, b) => a.release_date.localeCompare(b.release_date));

  const tvByMonth = new Map<string, typeof results>();
  for (const e of results) {
    const month = (e.airdate ?? e.airstamp ?? "").slice(0, 7);
    if (!tvByMonth.has(month)) tvByMonth.set(month, [] as typeof results);
    tvByMonth.get(month)!.push(e);
  }
  const filmByMonth = new Map<string, UpcomingFilm[]>();
  for (const m of movies) {
    const month = m.release_date.slice(0, 7);
    if (!filmByMonth.has(month)) filmByMonth.set(month, []);
    filmByMonth.get(month)!.push(m);
  }
  const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym} ${ym.slice(0, 4)}`;

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Upcoming premieres — new TV seasons & movies | TV Nightly"
      description="Every season premiere and movie release coming soon — TV and film in one place, with dates and countdowns."
      canonical={canonical(c)}
      ld={[
        itemListLd("Upcoming premieres", [
          ...results.map((e) => ({
            name: `${e.show_name}${e.season ? ` Season ${e.season}` : ""} premiere`,
            url: `${site}/show/${e.show_slug}/release-date`,
          })),
          ...movies.map((m) => ({ name: `${m.title} release`, url: `${site}${filmHref(m)}` })),
        ]),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Premieres", url: canonical(c) },
        ]),
      ]}
    >
      <SubNav items={SCHEDULE_TABS} current="/premieres" />
      <p class="section-eyebrow">The next 90 days</p>
      <h1>Upcoming premieres</h1>
      <p class="sched-sum">
        <strong>{results.length}</strong> TV premiere{results.length === 1 ? "" : "s"}
        {" · "}
        <strong>{movies.length}</strong> movie{movies.length === 1 ? "" : "s"} on the books
      </p>

      {/* TV / Movies on tabs (CSS-only radios, same grammar as the home rails) */}
      <div class="discover-tabs prem-tabs">
        <input type="radio" name="prem" id="prem-tv" class="discover-input" checked={!movieTab} />
        <input type="radio" name="prem" id="prem-movies" class="discover-input" checked={movieTab} />
        <div class="discover-tablist">
          <div class="discover-tabrow">
            <label for="prem-tv">TV premieres</label>
            <label for="prem-movies">Movie premieres</label>
          </div>
        </div>

        <div class="discover-panel panel-tv">
          {results.length === 0 ? (
            <p class="muted">No TV premieres scheduled in the next 90 days (yet).</p>
          ) : (
            [...tvByMonth.entries()].map(([month, eps]) => (
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
            ))
          )}
        </div>

        <div class="discover-panel panel-movies">
          {movies.length === 0 ? (
            <p class="muted">No movie releases on the calendar right now.</p>
          ) : (
            [...filmByMonth.entries()].map(([month, list]) => (
              <section class="sched-day">
                <h2>
                  {monthLabel(month)}{" "}
                  <span class="sched-count">
                    {list.length} release{list.length === 1 ? "" : "s"}
                  </span>
                </h2>
                <ol class="sched-list">
                  {list.map((m) => {
                    const { day, month: mon } = premiereDateParts(m.release_date);
                    return (
                      <li>
                        <a class="sched-row" href={filmHref(m)}>
                          <span class="sched-rail">{mon ? `${mon} ${day}` : "TBA"}</span>
                          {m.poster_url ? (
                            <img
                              src={m.poster_url}
                              alt={`${m.title} poster`}
                              width="46"
                              height="69"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span class="sched-thumb-blank" aria-hidden="true"></span>
                          )}
                          <span class="sched-main">
                            <span class="sched-show">{m.title}</span>
                            <span class="sched-when">
                              <span class="sched-ep">{longDate(m.release_date)}</span>
                            </span>
                          </span>
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))
          )}
        </div>
      </div>

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
