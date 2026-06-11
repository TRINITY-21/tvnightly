import { Hono, Context } from "hono";
import { raw } from "hono/html";
import { Bindings, EpisodeRow, EventRow } from "../types";
import { stripHtml, epCode, epHref } from "../lib/format";
import { origin, canonical, breadcrumbLd } from "../lib/seo";
import { getShow, similarShows } from "../lib/queries";
import { Layout, COUNTDOWN_JS } from "../components/Layout";
import { ShowTabs, SeasonTabs } from "../components/nav";
import { StatusBadge } from "../components/cards";
import { SubscribeForm } from "../components/forms";
import { ChevUp, ChevDown, IconCal } from "../components/icons";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------- essential episodes

interface EssentialPick {
  ep: EpisodeRow;
  why: string;
}

/**
 * Skip-guide algorithm: structural picks (pilot, series finale when ended,
 * each season's peak) plus top-rated fillers, capped at n, in watch order.
 */
function essentialPicks(eps: EpisodeRow[], n: number, ended: boolean): EssentialPick[] {
  const chrono = [...eps].sort(
    (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.number ?? 0) - (b.number ?? 0),
  );
  if (chrono.length === 0) return [];
  const picked = new Map<number, EssentialPick>();
  const add = (ep: EpisodeRow | undefined, why: string) => {
    if (ep && !picked.has(ep.id)) picked.set(ep.id, { ep, why });
  };

  add(chrono[0], "Pilot");
  if (ended) add(chrono[chrono.length - 1], "Series finale");

  const bySeason = new Map<number, EpisodeRow[]>();
  for (const e of chrono) {
    const s = e.season ?? 0;
    if (!bySeason.has(s)) bySeason.set(s, []);
    bySeason.get(s)!.push(e);
  }
  for (const [s, seasonEps] of bySeason) {
    const peak = seasonEps.filter((e) => e.rating != null).sort((a, b) => b.rating! - a.rating!)[0];
    add(peak, `Season ${s} peak`);
  }
  for (const e of [...eps].filter((e) => e.rating != null).sort((a, b) => b.rating! - a.rating!)) {
    if (picked.size >= n) break;
    add(e, "Top rated");
  }
  // More seasons than slots: drop the lowest-rated season peaks, keep structure.
  while (picked.size > n) {
    const droppable = [...picked.values()]
      .filter((p) => p.why.endsWith("peak"))
      .sort((a, b) => (a.ep.rating ?? 0) - (b.ep.rating ?? 0))[0];
    if (!droppable) break;
    picked.delete(droppable.ep.id);
  }
  return [...picked.values()].sort(
    (a, b) =>
      (a.ep.season ?? 0) - (b.ep.season ?? 0) || (a.ep.number ?? 0) - (b.ep.number ?? 0),
  );
}

app.get("/show/:slug/essential", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const { results: allEps } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();

  // Optional per-season scope: the skip guide for one season.
  const path = `/show/${show.slug}/essential`;
  const seasonsAll = [
    ...new Set(allEps.map((e) => e.season).filter((s): s is number => s != null)),
  ];
  const rawSeason = (c.req.query("season") ?? "").trim();
  let season: number | null = null;
  if (rawSeason !== "") {
    const sn = Number(rawSeason);
    if (!Number.isInteger(sn) || !seasonsAll.includes(sn)) return c.redirect(path, 301);
    season = sn;
  }
  const eps = season != null ? allEps.filter((e) => e.season === season) : allEps;

  const lengthParam = Number(c.req.query("length") ?? 15);
  const n = season != null ? 8 : [10, 15, 25].includes(lengthParam) ? lengthParam : 15;
  const ratedCount = eps.filter((e) => e.rating != null).length;
  // A season is "complete" for finale purposes once a later season exists.
  const closed =
    show.status === "Ended" || (season != null && season < Math.max(...seasonsAll));
  let picks = ratedCount >= (season != null ? 6 : 10) ? essentialPicks(eps, n, closed) : [];
  if (season != null) {
    picks = picks.map((p) => ({
      ...p,
      why:
        p.why === "Pilot"
          ? season === 1
            ? "Pilot"
            : "Season premiere"
          : p.why === "Series finale"
            ? "Season finale"
            : p.why.endsWith("peak")
              ? "Season peak"
              : p.why,
    }));
  }
  const seasonLabel = season != null ? ` Season ${season}` : "";

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`The ${picks.length || "essential"} episodes of ${show.name}${seasonLabel} you must watch | TV Nightly`}
      description={
        season != null
          ? `Short on time? The essential ${show.name} Season ${season} watch list — the premiere, the peak, the finale, skip the rest.`
          : `Short on time? The essential ${show.name} watch list: pilot, every season's peak, and the all-time greats — skip the rest.`
      }
      canonical={
        season != null
          ? `${site}${path}?season=${season}`
          : n === 15
            ? `${site}${path}`
            : `${site}${path}?length=${n}`
      }
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, `Essential${seasonLabel} episodes`, path)]}
    >
      <article>
        <h1>
          The essential episodes of <a href={`/show/${show.slug}`}>{show.name}</a>
          {seasonLabel}
        </h1>
        {season != null ? (
          <SeasonTabs slug={show.slug} season={season} current="essential" />
        ) : (
          <ShowTabs slug={show.slug} current="essential" />
        )}
        {picks.length === 0 ? (
          <p class="muted">
            Not enough rated episodes yet to build a reliable essential list — check back soon.
          </p>
        ) : (
          <>
            {season != null ? (
              <p class="muted">
                Watch these {picks.length} in order and you've got {show.name} Season {season}.
              </p>
            ) : (
              <p class="muted">
                Watch these {picks.length} in order and you've got {show.name}. How much time do
                you have? <a href={`${path}?length=10`}>10 episodes</a> ·{" "}
                <a href={`${path}?length=15`}>15</a> · <a href={`${path}?length=25`}>25</a>
              </p>
            )}
            <ol class="ep-list">
              {picks.map(({ ep, why }) => (
                <li>
                  <span class="muted">{epCode(ep)}</span>{" "}
                  <strong>
                    <a href={epHref(show.slug, ep)}>{ep.name ?? epCode(ep)}</a>
                  </strong>{" "}
                  <span class="why-tag">{why}</span>
                  {ep.rating != null ? <span class="rating"> ★ {ep.rating.toFixed(1)}</span> : null}
                  {ep.summary ? <p class="muted">{stripHtml(ep.summary)}</p> : null}
                </li>
              ))}
            </ol>
            <p>
              Want the full picture? <a href={`/show/${show.slug}/best-episodes`}>Best episodes</a>{" "}
              · <a href={`/show/${show.slug}/ratings`}>Ratings graph</a>
            </p>
          </>
        )}
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
      </article>
    </Layout>,
  );
});

// ------------------------------------------------- episode ratings graph

function ratingsSvg(eps: EpisodeRow[]): string {
  const rated = eps.filter((e) => e.rating != null);
  if (rated.length === 0) return "";
  const PAD = 34;
  const STEP = 9;
  const W = Math.max(420, rated.length * STEP + PAD * 2);
  const H = 240;
  const yFor = (r: number) => {
    const clamped = Math.max(5, Math.min(10, r));
    return PAD + (10 - clamped) * ((H - PAD * 2) / 5);
  };
  const colorFor = (r: number) => {
    const t = Math.max(0, Math.min(1, (r - 6) / 3.5)); // 6 -> red, 9.5+ -> green
    return `hsl(${Math.round(t * 120)},70%,50%)`;
  };
  const parts: string[] = [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Episode ratings by season">`,
  ];
  // season bands
  let x = PAD;
  let season = rated[0].season ?? 0;
  let bandStart = x;
  let bandIdx = 0;
  const flushBand = (endX: number) => {
    parts.push(
      `<rect x="${bandStart}" y="${PAD}" width="${endX - bandStart}" height="${H - PAD * 2}" fill="${bandIdx % 2 ? "#19191d" : "#111113"}"/>`,
      `<text x="${(bandStart + endX) / 2}" y="${H - 10}" fill="#a39e97" font-size="10" text-anchor="middle">S${season}</text>`,
    );
    bandIdx++;
  };
  for (const e of rated) {
    if ((e.season ?? 0) !== season) {
      flushBand(x);
      season = e.season ?? 0;
      bandStart = x;
    }
    x += STEP;
  }
  flushBand(x);
  // gridlines
  for (const r of [5, 6, 7, 8, 9, 10]) {
    parts.push(
      `<line x1="${PAD}" y1="${yFor(r)}" x2="${x}" y2="${yFor(r)}" stroke="#26262c" stroke-width="0.5"/>`,
      `<text x="${PAD - 6}" y="${yFor(r) + 3}" fill="#a39e97" font-size="10" text-anchor="end">${r}</text>`,
    );
  }
  // points
  let px = PAD;
  for (const e of rated) {
    const title = `${epCode(e)} ${e.name ?? ""} — ${e.rating!.toFixed(1)}`.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
    parts.push(
      `<circle cx="${px + STEP / 2}" cy="${yFor(e.rating!)}" r="3" fill="${colorFor(e.rating!)}"><title>${title}</title></circle>`,
    );
    px += STEP;
  }
  parts.push("</svg>");
  return parts.join("");
}

app.get("/show/:slug/ratings", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const { results: allEps } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();

  // Optional per-season scope, validated against the show's real seasons.
  const base = `/show/${show.slug}/ratings`;
  const seasons = [...new Set(allEps.map((e) => e.season).filter((s): s is number => s != null))];
  const rawSeason = (c.req.query("season") ?? "").trim();
  let season: number | null = null;
  if (rawSeason !== "") {
    const n = Number(rawSeason);
    if (!Number.isInteger(n) || !seasons.includes(n)) return c.redirect(base, 301);
    season = n;
  }
  const eps = season != null ? allEps.filter((e) => e.season === season) : allEps;
  const svg = ratingsSvg(eps);
  const rated = eps.filter((e) => e.rating != null);
  const seasonLabel = season != null ? ` Season ${season}` : "";

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name}${seasonLabel} episode ratings graph — every episode charted | TV Nightly`}
      description={
        season != null
          ? `Every rated episode of ${show.name} Season ${season} on one chart: the peaks, the dips, the finale.`
          : `Every rated ${show.name} episode on one chart: see the peaks, the dips, and how each season compares.`
      }
      canonical={season != null ? `${site}${base}?season=${season}` : `${site}${base}`}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, `${seasonLabel || "Episode"} ratings graph`.trim(), path)]}
    >
      <h1>
        <a href={`/show/${show.slug}`}>{show.name}</a>
        {seasonLabel}: episode ratings graph
      </h1>
      {season != null ? (
        <SeasonTabs slug={show.slug} season={season} current="ratings" />
      ) : (
        <ShowTabs slug={show.slug} current="ratings" />
      )}
      {seasons.length > 1 && seasons.length <= 30 ? (
        <p class="muted">
          Filter: <a href={base}>{season == null ? <strong>All</strong> : "All"}</a>
          {seasons.map((s) => (
            <>
              {" · "}
              <a href={`${base}?season=${s}`}>{season === s ? <strong>S{s}</strong> : `S${s}`}</a>
            </>
          ))}
        </p>
      ) : null}
      {svg ? (
        <>
          <p class="muted">
            {rated.length} rated episodes, hover any dot for details. Higher and greener is better.
          </p>
          <div class="graph-wrap">{raw(svg)}</div>
          <p>
            <a href={`/show/${show.slug}/best-episodes${season != null ? `?season=${season}` : ""}`}>
              Best episodes
            </a>{" "}
            ·{" "}
            <a href={`/show/${show.slug}/worst-episodes${season != null ? `?season=${season}` : ""}`}>
              Worst episodes
            </a>{" "}
            ·{" "}
            <a href={`/show/${show.slug}/essential${season != null ? `?season=${season}` : ""}`}>
              Essential watch list
            </a>
          </p>
        </>
      ) : (
        <p class="muted">No rated episodes yet for {show.name}.</p>
      )}
    </Layout>,
  );
});

// ------------------------------------------------- best / worst episodes

const rankedPage =
  (order: "DESC" | "ASC") => async (c: Context<{ Bindings: Bindings }, "/show/:slug">) => {
    const show = await getShow(c.env.DB, c.req.param("slug"));
    if (!show) return c.notFound();
    const kind = order === "DESC" ? "best" : "worst";
    const base = `/show/${show.slug}/${kind}-episodes`;

    // Optional per-season filter, validated against the show's real seasons.
    const { results: seasonRows } = await c.env.DB.prepare(
      "SELECT DISTINCT season AS s FROM episodes WHERE show_id = ? AND season IS NOT NULL ORDER BY season",
    )
      .bind(show.id)
      .all<{ s: number }>();
    const seasons = seasonRows.map((r) => r.s);
    const rawSeason = (c.req.query("season") ?? "").trim();
    let season: number | null = null;
    if (rawSeason) {
      const n = Number(rawSeason);
      if (!seasons.includes(n)) return c.redirect(base, 301);
      season = n;
    }

    const { results: eps } = await c.env.DB.prepare(
      `SELECT e.*, v.up, v.down FROM episodes e
       LEFT JOIN episode_votes v ON v.episode_id = e.id
       WHERE e.show_id = ? AND e.rating IS NOT NULL${season != null ? " AND e.season = ?" : ""}
       ORDER BY e.rating ${order}, e.season, e.number LIMIT 25`,
    )
      .bind(...(season != null ? [show.id, season] : [show.id]))
      .all<EpisodeRow & { up: number | null; down: number | null }>();

    const similar = kind === "best" ? await similarShows(c.env.DB, show) : [];
    const site = origin(c);
    const path = new URL(c.req.url).pathname;
    const seasonLabel = season != null ? ` Season ${season}` : "";
    const ld: unknown[] = [
      breadcrumbLd(site, show, `${kind} episodes`, path),
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: `The ${kind} episodes of ${show.name}`,
        itemListElement: eps.map((e, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `${e.name ?? epCode(e)} (${epCode(e)})`,
        })),
      },
    ];

    c.header("Cache-Control", "public, max-age=3600");
    return c.html(
      <Layout
        title={`The ${eps.length} ${kind} episodes of ${show.name}${seasonLabel}, ranked | TV Nightly`}
        description={`${show.name}${seasonLabel}'s ${kind} episodes ranked by viewer rating, from ${
          eps[0] ? `"${eps[0].name}"` : "the top"
        } down.`}
        canonical={season != null ? `${site}${base}?season=${season}` : `${site}${base}`}
        ogImage={show.image_url ?? undefined}
        scripts={["/js/votes.js"]}
        ld={ld}
      >
        <article data-show-id={String(show.id)}>
          <h1>
            The {kind} episodes of <a href={`/show/${show.slug}`}>{show.name}</a>
            {seasonLabel}
          </h1>
          {season != null ? (
            <SeasonTabs slug={show.slug} season={season} current={kind === "best" ? "best" : "worst"} />
          ) : (
            <ShowTabs slug={show.slug} current={kind === "best" ? "best" : "worst"} />
          )}
          {show.blurb && kind === "best" ? <p class="blurb">{show.blurb}</p> : null}
          {seasons.length > 1 && seasons.length <= 30 ? (
            <p class="muted">
              Filter: <a href={base}>{season == null ? <strong>All</strong> : "All"}</a>
              {seasons.map((s) => (
                <>
                  {" · "}
                  <a href={`${base}?season=${s}`}>
                    {season === s ? <strong>S{s}</strong> : `S${s}`}
                  </a>
                </>
              ))}
            </p>
          ) : null}
          {eps.length < 10 ? (
            <p class="muted">
              Not enough rated episodes yet for a reliable ranking — check back as ratings come in.
            </p>
          ) : null}
          <ol class="ranked">
            {eps.map((e) => (
              <li>
                <strong>
                  <a href={epHref(show.slug, e)}>{e.name}</a>
                </strong>{" "}
                <span class="muted">{epCode(e)}</span>
                <span class="rating"> ★ {e.rating!.toFixed(1)}</span>
                <span class="vote" data-ep-id={String(e.id)}>
                  <button class="vote-btn" data-dir="up" aria-label="Agree with this ranking">
                    <ChevUp /> <span class="vote-count">{e.up ?? 0}</span>
                  </button>
                  <button class="vote-btn" data-dir="down" aria-label="Disagree with this ranking">
                    <ChevDown /> <span class="vote-count">{e.down ?? 0}</span>
                  </button>
                </span>
                {e.summary ? <p class="muted">{stripHtml(e.summary)}</p> : null}
              </li>
            ))}
          </ol>
          {kind === "best" ? (
            <p>
              Short on time? <a href={`/show/${show.slug}/essential`}>The essential watch list</a>{" "}
              · <a href={`/show/${show.slug}/ratings`}>Ratings graph</a> ·{" "}
              <a href="/best-episodes">All-time top 100</a>
            </p>
          ) : null}
          {similar.length ? (
            <section>
              <h2>More like {show.name}</h2>
              <ul class="ep-list">
                {similar.map((s) => (
                  <li>
                    <a href={`/show/${s.slug}/best-episodes`}>The best episodes of {s.name}</a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
        </article>
      </Layout>,
    );
  };

app.get("/show/:slug/best-episodes", rankedPage("DESC"));
app.get("/show/:slug/worst-episodes", rankedPage("ASC"));

// ---------------------------------------------------------- next episode

app.get("/show/:slug/next-episode", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const next = await c.env.DB.prepare(
    `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now')
     ORDER BY airstamp LIMIT 1`,
  )
    .bind(show.id)
    .first<EpisodeRow>();

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={`When is the next episode of ${show.name}? | TV Nightly`}
      description={
        next
          ? `${show.name} ${epCode(next)} "${next.name ?? ""}" airs ${next.airdate ?? "soon"}.`
          : `${show.name} has no scheduled next episode. Status: ${show.status ?? "unknown"}.`
      }
      canonical={canonical(c)}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Next episode", path)]}
    >
      <h1>
        Next episode of <a href={`/show/${show.slug}`}>{show.name}</a>
      </h1>
      <ShowTabs slug={show.slug} current="next" />
      {next ? (
        <div class="answer">
          <p>
            <strong>{next.name ?? epCode(next)}</strong> <span class="muted">{epCode(next)}</span>{" "}
            airs <strong>{next.airdate}</strong>
            {show.network ? <span class="muted"> on {show.network}</span> : null}.
          </p>
          <p class="countdown" id="countdown" data-ts={next.airstamp ?? ""}></p>
          {raw(COUNTDOWN_JS)}
        </div>
      ) : (
        <div class="answer">
          <p>
            No next episode is scheduled. <StatusBadge status={show.status} />
            {show.status === "Ended" && show.ended ? (
              <span class="muted"> The show ended on {show.ended}.</span>
            ) : show.status === "To Be Determined" ? (
              <span class="muted"> Awaiting renewal news — check back soon.</span>
            ) : null}
          </p>
        </div>
      )}
      <p>
        <a href={`/show/${show.slug}/calendar.ics`}><IconCal /> Add {show.name} to your calendar</a>
      </p>
      <SubscribeForm showId={show.id} label={`Email me when ${show.name} gets schedule news:`} />
    </Layout>,
  );
});

// ---------------------------------------------------------- release date

app.get("/show/:slug/release-date", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const db = c.env.DB;

  const next = await db
    .prepare(
      `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now')
       ORDER BY airstamp LIMIT 1`,
    )
    .bind(show.id)
    .first<EpisodeRow>();
  const lastAired = await db
    .prepare(
      `SELECT * FROM episodes WHERE show_id = ? AND airstamp <= datetime('now')
       ORDER BY airstamp DESC LIMIT 1`,
    )
    .bind(show.id)
    .first<EpisodeRow>();
  const { results: history } = await db
    .prepare(
      `SELECT type, season, old_value, new_value, detected_at FROM show_events
       WHERE show_id = ? ORDER BY detected_at DESC LIMIT 10`,
    )
    .bind(show.id)
    .all<Omit<EventRow, "name" | "slug">>();

  const maxAired = lastAired?.season ?? 0;
  // People search for the NEXT season ("X season 3 release date") — name it,
  // announced or not.
  const targetSeason =
    next && (next.season ?? 0) > maxAired
      ? (next.season ?? null)
      : show.status !== "Ended"
        ? maxAired + 1
        : null;
  let answer: string;
  let showCountdown = false;
  if (next && (next.season ?? 0) > maxAired) {
    answer = `Season ${next.season} of ${show.name} premieres on ${next.airdate}.`;
    showCountdown = true;
  } else if (next) {
    answer = `Season ${next.season} of ${show.name} is currently airing — the next episode (${epCode(
      next,
    )}) airs ${next.airdate}.`;
    showCountdown = true;
  } else if (show.status === "Ended") {
    answer = `${show.name} has ended${show.ended ? ` (final episode: ${show.ended})` : ""} — no new season is coming.`;
  } else if (show.status === "To Be Determined") {
    answer = `${show.name} has not yet been renewed for Season ${maxAired + 1}. Its status is officially "To Be Determined."`;
  } else if (show.status === "In Development") {
    answer = `${show.name} is in development — no premiere date has been announced yet.`;
  } else {
    answer = `${show.name} is ${show.status ?? "of unknown status"}, but no next air date has been announced yet.`;
  }

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={
        targetSeason
          ? `${show.name} Season ${targetSeason} release date${
              next && (next.season ?? 0) === targetSeason && next.airdate
                ? `: ${next.airdate}`
                : " — not announced yet"
            } | TV Nightly`
          : `${show.name} release date & renewal status | TV Nightly`
      }
      description={answer.slice(0, 155)}
      canonical={canonical(c)}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Release date", path)]}
    >
      <h1>
        {targetSeason ? (
          <>
            When is <a href={`/show/${show.slug}`}>{show.name}</a> Season {targetSeason}?
          </>
        ) : (
          <>
            <a href={`/show/${show.slug}`}>{show.name}</a>: release date & renewal status
          </>
        )}
      </h1>
      <ShowTabs slug={show.slug} current="release" />
      <div class="answer">
        <p>
          <StatusBadge status={show.status} /> {answer}
        </p>
        {showCountdown ? (
          <>
            <p class="countdown" id="countdown" data-ts={next?.airstamp ?? ""}></p>
            {raw(COUNTDOWN_JS)}
          </>
        ) : null}
        {lastAired ? (
          <p class="muted">
            Last aired episode: {lastAired.name} ({epCode(lastAired)}) on {lastAired.airdate}.
          </p>
        ) : null}
      </div>
      <SubscribeForm
        showId={show.id}
        label={`Email me when ${show.name} renewal or premiere news lands:`}
      />
      <p>
        <a href={`/show/${show.slug}/calendar.ics`}><IconCal /> Add {show.name} to your calendar</a>{" "}
        <span class="muted">— subscribe in Google/Apple Calendar and never miss an episode</span>
      </p>
      {history.length ? (
        <section>
          <h2>News history</h2>
          <ul class="ep-list">
            {history.map((h) => (
              <li>
                <span class="muted">
                  {new Date(h.detected_at * 1000).toISOString().slice(0, 10)}
                </span>{" "}
                {h.type === "season_announced" ? (
                  <>
                    Renewed — <strong>Season {h.season} confirmed</strong>
                  </>
                ) : h.type === "premiere_set" ? (
                  <>
                    Season {h.season} premiere date set: <strong>{h.new_value}</strong>
                  </>
                ) : h.type === "premiere_moved" ? (
                  <>
                    Premiere moved <span class="muted">{h.old_value}</span>{" "}
                    <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
                    <strong>{h.new_value}</strong>
                  </>
                ) : (
                  <>
                    {h.old_value ?? "?"}{" "}
                    <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
                    <strong>{h.new_value ?? "?"}</strong>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Layout>,
  );
});

export default app;
