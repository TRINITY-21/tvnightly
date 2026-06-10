import { Hono } from "hono";
import type { Context } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import { runSync, type SyncEnv } from "./sync";
import { sendEmails } from "./email";
import { signToken, verifyToken } from "./tokens";

type Bindings = SyncEnv;
type AppContext = Context<{ Bindings: Bindings }>;
const app = new Hono<{ Bindings: Bindings }>();

interface ShowRow {
  id: number;
  slug: string;
  name: string;
  status: string | null;
  premiered: string | null;
  ended: string | null;
  network: string | null;
  web_channel: string | null;
  rating: number | null;
  weight: number;
  image_url: string | null;
  summary: string | null;
  imdb_id: string | null;
  blurb: string | null;
}

interface EpisodeRow {
  id: number;
  show_id: number;
  season: number | null;
  number: number | null;
  name: string | null;
  airdate: string | null;
  airstamp: string | null;
  runtime: number | null;
  rating: number | null;
  image_url: string | null;
  summary: string | null;
}

type TonightRow = EpisodeRow & { show_name: string; show_slug: string; network: string | null };

const stripHtml = (s: string | null) => (s ?? "").replace(/<[^>]*>/g, "").trim();
const epCode = (e: EpisodeRow) =>
  `S${String(e.season ?? 0).padStart(2, "0")}E${String(e.number ?? 0).padStart(2, "0")}`;

const getShow = (db: D1Database, slug: string) =>
  db.prepare("SELECT * FROM shows WHERE slug = ?").bind(slug).first<ShowRow>();

const origin = (c: AppContext) => c.env.SITE_ORIGIN ?? new URL(c.req.url).origin;
const canonical = (c: AppContext) => origin(c) + new URL(c.req.url).pathname;

// </script> can't appear inside a JSON-LD block; escape < to be safe.
const jsonLd = (data: unknown) =>
  raw(
    `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
  );

const COUNTDOWN_JS = `<script>(function(){var el=document.getElementById('countdown');if(!el||!el.dataset.ts)return;var t=new Date(el.dataset.ts).getTime();function tick(){var d=t-Date.now();if(d<=0){el.textContent='Airing now';return}var s=Math.floor(d/1000);el.textContent=Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m '+(s%60)+'s';setTimeout(tick,1000)}tick()})();</script>`;

const Layout: FC<
  PropsWithChildren<{ title: string; description?: string; canonical?: string; ld?: unknown[] }>
> = (props) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{props.title}</title>
      {props.description ? <meta name="description" content={props.description} /> : null}
      {props.canonical ? <link rel="canonical" href={props.canonical} /> : null}
      <link rel="stylesheet" href="/styles.css" />
      {(props.ld ?? []).map((d) => jsonLd(d))}
    </head>
    <body>
      <header class="site-header">
        <a class="logo" href="/">
          TV Nightly
        </a>
        <form action="/search" method="get" class="search">
          <input type="search" name="q" placeholder="Search shows…" required />
        </form>
        <nav>
          <a href="/tonight">Tonight</a>
          <a href="/calendar">Calendar</a>
          <a href="/renewals">Renewals</a>
        </nav>
      </header>
      <main>{props.children}</main>
      <footer class="site-footer">
        <div class="footer-sub">
          <p>
            <strong>Stay updated</strong> — today's TV, renewals and premieres in your inbox.
          </p>
          <form action="/subscribe" method="post" class="sub-form">
            <input type="hidden" name="kind" value="daily" />
            <input type="email" name="email" placeholder="Enter your email" required />
            <button type="submit">Subscribe</button>
          </form>
        </div>
        <p class="disclaimer">
          <strong>Disclaimer:</strong> TV Nightly is independent and is not affiliated with any TV
          shows, networks, or data sources. While we aim to provide reliable information, the data
          presented on this site is not guaranteed to be accurate, complete, or current.
        </p>
        <p>
          TV information from{" "}
          <a href="https://www.tvmaze.com" rel="noopener">
            TVmaze.com
          </a>{" "}
          (CC BY-SA).
        </p>
        <p>
          <a href="/terms">Terms of Service</a> · <a href="/privacy">Privacy Policy</a> · © 2026 TV
          Nightly. All rights reserved.
        </p>
      </footer>
    </body>
  </html>
);

const StatusBadge: FC<{ status: string | null }> = ({ status }) => {
  const cls = status === "Running" ? "ok" : status === "Ended" ? "ended" : "tbd";
  return <span class={`badge ${cls}`}>{status ?? "Unknown"}</span>;
};

const ShowCard: FC<{ show: ShowRow }> = ({ show }) => (
  <a class="card" href={`/show/${show.slug}`}>
    {show.image_url ? (
      <img src={show.image_url} alt={show.name} loading="lazy" />
    ) : (
      <div class="card-fallback">{show.name}</div>
    )}
    <div class="card-body">
      <span class="card-title">{show.name}</span>
      {show.rating != null ? <span class="rating">★ {show.rating.toFixed(1)}</span> : null}
    </div>
  </a>
);

const SubscribeForm: FC<{ showId: number; label: string }> = ({ showId, label }) => (
  <form action="/subscribe" method="post" class="sub-form inline">
    <input type="hidden" name="kind" value="renewal" />
    <input type="hidden" name="show_id" value={String(showId)} />
    <label>{label}</label>
    <input type="email" name="email" placeholder="you@example.com" required />
    <button type="submit">Notify me</button>
  </form>
);

const breadcrumbLd = (site: string, show: ShowRow, page: string, path: string) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "TV Nightly", item: site },
    { "@type": "ListItem", position: 2, name: show.name, item: `${site}/show/${show.slug}` },
    { "@type": "ListItem", position: 3, name: page, item: `${site}${path}` },
  ],
});

// ---------------------------------------------------------------- home

app.get("/", async (c) => {
  const { results: top } = await c.env.DB.prepare(
    "SELECT * FROM shows ORDER BY weight DESC, rating DESC LIMIT 24",
  ).all<ShowRow>();
  const { results: tonight } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE date(e.airstamp) = date('now')
     ORDER BY e.airstamp LIMIT 12`,
  ).all<TonightRow>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="TV Nightly — best episodes, release dates & what's on TV tonight"
      description="Track the best episodes of every TV show, season release dates, renewal status, and what's airing tonight."
      canonical={canonical(c)}
    >
      {tonight.length ? (
        <section>
          <h2>
            On tonight{" "}
            <a class="more" href="/tonight">
              all of tonight →
            </a>
          </h2>
          <ul class="ep-list">
            {tonight.map((e) => (
              <li>
                <a href={`/show/${e.show_slug}`}>{e.show_name}</a> {epCode(e)}
                {e.name ? ` — ${e.name}` : ""}
                {e.network ? <span class="muted"> · {e.network}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h2>Popular shows</h2>
        <div class="grid">
          {top.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      </section>
    </Layout>,
  );
});

// ---------------------------------------------------------------- show hub

app.get("/show/:slug", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const { results: episodes } = await c.env.DB.prepare(
    "SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number",
  )
    .bind(show.id)
    .all<EpisodeRow>();

  const seasons = new Map<number, EpisodeRow[]>();
  for (const e of episodes) {
    const s = e.season ?? 0;
    if (!seasons.has(s)) seasons.set(s, []);
    seasons.get(s)!.push(e);
  }

  const site = origin(c);
  const ld: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "TVSeries",
      name: show.name,
      url: `${site}/show/${show.slug}`,
      ...(show.image_url ? { image: show.image_url } : {}),
      ...(show.premiered ? { startDate: show.premiered } : {}),
      ...(show.ended ? { endDate: show.ended } : {}),
      ...(seasons.size ? { numberOfSeasons: Math.max(...seasons.keys()) } : {}),
    },
  ];

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={`${show.name} — episodes, ratings & renewal status | TV Nightly`}
      description={stripHtml(show.summary).slice(0, 155)}
      canonical={canonical(c)}
      ld={ld}
    >
      <article class="show-hub">
        <div class="show-head">
          {show.image_url ? (
            <img class="poster" src={show.image_url} alt={show.name} />
          ) : (
            <div class="poster card-fallback">{show.name}</div>
          )}
          <div>
            <h1>{show.name}</h1>
            <p>
              <StatusBadge status={show.status} />
              {show.premiered ? <span class="muted"> · {show.premiered.slice(0, 4)}</span> : null}
              {show.network || show.web_channel ? (
                <span class="muted"> · {show.network ?? show.web_channel}</span>
              ) : null}
              {show.rating != null ? (
                <span class="rating"> · ★ {show.rating.toFixed(1)}</span>
              ) : null}
            </p>
            <nav class="show-nav">
              <a href={`/show/${show.slug}/best-episodes`}>Best episodes</a>
              <a href={`/show/${show.slug}/next-episode`}>Next episode</a>
              <a href={`/show/${show.slug}/release-date`}>Release date</a>
            </nav>
            {show.blurb ? <p class="blurb">{show.blurb}</p> : null}
            {show.summary ? <div class="summary">{raw(show.summary)}</div> : null}
          </div>
        </div>
        {[...seasons.entries()].map(([season, eps]) => (
          <section>
            <h2>Season {season}</h2>
            <ol class="ep-list">
              {eps.map((e) => (
                <li>
                  <span class="muted">{epCode(e)}</span> {e.name}
                  {e.rating != null ? <span class="rating"> ★ {e.rating.toFixed(1)}</span> : null}
                  {e.airdate ? <span class="muted"> · {e.airdate}</span> : null}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </article>
    </Layout>,
  );
});

// ------------------------------------------------- best / worst episodes

const rankedPage =
  (order: "DESC" | "ASC") => async (c: Context<{ Bindings: Bindings }, "/show/:slug">) => {
    const show = await getShow(c.env.DB, c.req.param("slug"));
    if (!show) return c.notFound();
    const { results: eps } = await c.env.DB.prepare(
      `SELECT * FROM episodes WHERE show_id = ? AND rating IS NOT NULL
       ORDER BY rating ${order}, season, number LIMIT 25`,
    )
      .bind(show.id)
      .all<EpisodeRow>();

    const kind = order === "DESC" ? "best" : "worst";
    const site = origin(c);
    const path = new URL(c.req.url).pathname;
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
        title={`The ${eps.length} ${kind} episodes of ${show.name}, ranked | TV Nightly`}
        description={`${show.name}'s ${kind} episodes ranked by viewer rating, from ${
          eps[0] ? `"${eps[0].name}"` : "the top"
        } down.`}
        canonical={canonical(c)}
        ld={ld}
      >
        <h1>
          The {kind} episodes of <a href={`/show/${show.slug}`}>{show.name}</a>
        </h1>
        {show.blurb && kind === "best" ? <p class="blurb">{show.blurb}</p> : null}
        {eps.length < 10 ? (
          <p class="muted">
            Not enough rated episodes yet for a reliable ranking — check back as ratings come in.
          </p>
        ) : null}
        <ol class="ranked">
          {eps.map((e) => (
            <li>
              <strong>{e.name}</strong> <span class="muted">{epCode(e)}</span>
              <span class="rating"> ★ {e.rating!.toFixed(1)}</span>
              {e.summary ? <p class="muted">{stripHtml(e.summary)}</p> : null}
            </li>
          ))}
        </ol>
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
      ld={[breadcrumbLd(site, show, "Next episode", path)]}
    >
      <h1>
        Next episode of <a href={`/show/${show.slug}`}>{show.name}</a>
      </h1>
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
      `SELECT old_status, new_status, detected_at FROM status_changes
       WHERE show_id = ? ORDER BY detected_at DESC LIMIT 10`,
    )
    .bind(show.id)
    .all<{ old_status: string | null; new_status: string | null; detected_at: number }>();

  const maxAired = lastAired?.season ?? 0;
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
      title={`${show.name} ${next?.season ? `Season ${next.season} ` : ""}release date & renewal status | TV Nightly`}
      description={answer.slice(0, 155)}
      canonical={canonical(c)}
      ld={[breadcrumbLd(site, show, "Release date", path)]}
    >
      <h1>
        <a href={`/show/${show.slug}`}>{show.name}</a>: release date & renewal status
      </h1>
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
      {history.length ? (
        <section>
          <h2>Status history</h2>
          <ul class="ep-list">
            {history.map((h) => (
              <li>
                <span class="muted">
                  {new Date(h.detected_at * 1000).toISOString().slice(0, 10)}
                </span>{" "}
                {h.old_status ?? "?"} → <strong>{h.new_status ?? "?"}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Layout>,
  );
});

// ------------------------------------------------------- tonight / calendar

app.get("/tonight", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE date(e.airstamp) = date('now')
     ORDER BY e.airstamp`,
  ).all<TonightRow>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="What's on TV tonight | TV Nightly"
      description="Every episode airing on TV and streaming tonight, in air-time order."
      canonical={canonical(c)}
    >
      <h1>On TV tonight</h1>
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

// ------------------------------------------------------------- renewals

app.get("/renewals", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT sc.old_status, sc.new_status, sc.detected_at, s.name, s.slug
     FROM status_changes sc JOIN shows s ON s.id = sc.show_id
     ORDER BY sc.detected_at DESC LIMIT 50`,
  ).all<{
    old_status: string | null;
    new_status: string | null;
    detected_at: number;
    name: string;
    slug: string;
  }>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="Recently renewed & cancelled TV shows | TV Nightly"
      description="A live feed of TV shows whose status just changed: renewals, cancellations, and endings."
      canonical={canonical(c)}
    >
      <h1>Status changes</h1>
      {results.length === 0 ? (
        <p class="muted">No status changes detected yet — the sync job updates this hourly.</p>
      ) : null}
      <ul class="ep-list">
        {results.map((r) => (
          <li>
            <a href={`/show/${r.slug}/release-date`}>{r.name}</a>:{" "}
            <span class="muted">{r.old_status ?? "?"}</span> → <strong>{r.new_status ?? "?"}</strong>
            <span class="muted">
              {" "}
              · {new Date(r.detected_at * 1000).toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

// --------------------------------------------------------------- search

app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const { results } = q
    ? await c.env.DB.prepare(
        `SELECT * FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 20`,
      )
        .bind(q)
        .all<ShowRow>()
    : { results: [] as ShowRow[] };

  return c.html(
    <Layout title={`Search: ${q} | TV Nightly`}>
      <h1>Search{q ? `: ${q}` : ""}</h1>
      {q && results.length === 0 ? <p class="muted">No shows found.</p> : null}
      <div class="grid">
        {results.map((s) => (
          <ShowCard show={s} />
        ))}
      </div>
    </Layout>,
  );
});

// ------------------------------------------------- subscribe / confirm

const VALID_KINDS = new Set(["renewal", "premiere", "daily"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MessagePage: FC<{ title: string; body: string }> = ({ title, body }) => (
  <Layout title={`${title} | TV Nightly`}>
    <h1>{title}</h1>
    <p>{body}</p>
    <p>
      <a href="/">← Back to TV Nightly</a>
    </p>
  </Layout>
);

app.post("/subscribe", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim().toLowerCase();
  const kind = String(body.kind ?? "");
  const showId = body.show_id ? Number(body.show_id) : null;

  if (!EMAIL_RE.test(email) || !VALID_KINDS.has(kind) || (kind !== "daily" && !showId)) {
    return c.html(
      <MessagePage title="Something's off" body="Please check the email address and try again." />,
      400,
    );
  }
  const show = showId
    ? await c.env.DB.prepare("SELECT id, name FROM shows WHERE id = ?")
        .bind(showId)
        .first<{ id: number; name: string }>()
    : null;
  if (showId && !show) return c.notFound();

  // Without a SECRET (fresh local dev) skip double opt-in so the flow still works.
  const confirmed = c.env.SECRET ? 0 : 1;
  await c.env.DB.prepare(
    `INSERT INTO subscriptions (email, show_id, kind, confirmed, created_at)
     VALUES (?,?,?,?,unixepoch())
     ON CONFLICT(email, show_id, kind) DO NOTHING`,
  )
    .bind(email, showId, kind, confirmed)
    .run();

  if (c.env.SECRET) {
    const token = await signToken({ email, showId, kind, action: "confirm" }, c.env.SECRET);
    const what =
      kind === "daily" ? "the TV Nightly daily email" : `${show!.name} renewal & schedule alerts`;
    await sendEmails(c.env, [
      {
        to: email,
        subject: `Confirm: ${what}`,
        html:
          `<p>Confirm your subscription to <strong>${what}</strong>:</p>` +
          `<p><a href="${origin(c)}/confirm?token=${token}">Yes, sign me up</a></p>` +
          `<p style="color:#888;font-size:12px">If you didn't request this, ignore this email.</p>`,
      },
    ]);
  }

  return c.html(
    <MessagePage
      title="Almost there"
      body={
        c.env.SECRET
          ? "Check your inbox and click the confirmation link to activate your alerts."
          : "Subscribed (dev mode: auto-confirmed)."
      }
    />,
  );
});

app.get("/confirm", async (c) => {
  const token = c.req.query("token") ?? "";
  const payload = c.env.SECRET ? await verifyToken(token, c.env.SECRET) : null;
  if (!payload || payload.action !== "confirm") {
    return c.html(
      <MessagePage title="Invalid link" body="This confirmation link is invalid or expired." />,
      400,
    );
  }
  await c.env.DB.prepare(
    "UPDATE subscriptions SET confirmed = 1 WHERE email = ? AND kind = ? AND show_id IS ?",
  )
    .bind(payload.email, payload.kind, payload.showId)
    .run();
  return c.html(
    <MessagePage title="You're in" body="Subscription confirmed — we'll email you when there's news." />,
  );
});

app.get("/unsubscribe", async (c) => {
  const token = c.req.query("token") ?? "";
  const payload = c.env.SECRET ? await verifyToken(token, c.env.SECRET) : null;
  if (!payload || payload.action !== "unsub") {
    return c.html(
      <MessagePage title="Invalid link" body="This unsubscribe link is invalid or expired." />,
      400,
    );
  }
  await c.env.DB.prepare(
    "DELETE FROM subscriptions WHERE email = ? AND kind = ? AND show_id IS ?",
  )
    .bind(payload.email, payload.kind, payload.showId)
    .run();
  return c.html(<MessagePage title="Unsubscribed" body="You won't hear from us about this again." />);
});

// --------------------------------------------------------------- sitemaps

const SHOWS_PER_SITEMAP = 1000;
const xmlRes = (c: AppContext, xml: string) => {
  c.header("Content-Type", "application/xml");
  c.header("Cache-Control", "public, max-age=86400");
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`);
};

app.get("/sitemap.xml", async (c) => {
  const site = origin(c);
  const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM shows").first<{ n: number }>();
  const shards = Math.max(1, Math.ceil((row?.n ?? 0) / SHOWS_PER_SITEMAP));
  const entries = ["static.xml", ...Array.from({ length: shards }, (_, i) => `shows-${i}.xml`)]
    .map((f) => `<sitemap><loc>${site}/sitemaps/${f}</loc></sitemap>`)
    .join("");
  return xmlRes(c, `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</sitemapindex>`);
});

app.get("/sitemaps/:file", async (c) => {
  const site = origin(c);
  const file = c.req.param("file");

  if (file === "static.xml") {
    const urls = ["/", "/tonight", "/calendar", "/renewals"]
      .map((p) => `<url><loc>${site}${p}</loc></url>`)
      .join("");
    return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  }

  const m = /^shows-(\d+)\.xml$/.exec(file);
  if (!m) return c.notFound();
  const { results } = await c.env.DB.prepare(
    "SELECT slug FROM shows ORDER BY weight DESC, id LIMIT ? OFFSET ?",
  )
    .bind(SHOWS_PER_SITEMAP, Number(m[1]) * SHOWS_PER_SITEMAP)
    .all<{ slug: string }>();
  if (results.length === 0) return c.notFound();

  const urls = results
    .map((r) =>
      ["", "/best-episodes", "/next-episode", "/release-date"]
        .map((suffix) => `<url><loc>${site}/show/${r.slug}${suffix}</loc></url>`)
        .join(""),
    )
    .join("");
  return xmlRes(c, `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
});

// ----------------------------------------------------------------- legal

app.get("/terms", (c) =>
  c.html(
    <Layout title="Terms of Service | TV Nightly" canonical={canonical(c)}>
      <h1>Terms of Service</h1>
      <p class="muted">Last updated: June 10, 2026</p>
      <p>
        By using TV Nightly ("the site") you agree to these terms. If you do not agree, please do
        not use the site.
      </p>
      <h2>What we provide</h2>
      <p>
        TV Nightly provides TV schedule, episode, and renewal information for personal,
        informational purposes only. Data is sourced from third parties (primarily{" "}
        <a href="https://www.tvmaze.com">TVmaze.com</a>, CC BY-SA) and is provided "as is" without
        warranty of accuracy, completeness, or timeliness. Air dates and statuses change without
        notice.
      </p>
      <h2>Acceptable use</h2>
      <p>
        You may not scrape the site at abusive rates, attempt to disrupt the service, or use it for
        unlawful purposes. Rankings and data derived from TVmaze are reusable under CC BY-SA with
        attribution.
      </p>
      <h2>Email alerts</h2>
      <p>
        Alert subscriptions are double opt-in and you can unsubscribe at any time via the link in
        every email. We may discontinue alerts at any time.
      </p>
      <h2>Liability</h2>
      <p>
        To the maximum extent permitted by law, TV Nightly is not liable for any damages arising
        from use of the site or reliance on its data.
      </p>
      <h2>Changes</h2>
      <p>We may update these terms; continued use after changes constitutes acceptance.</p>
    </Layout>,
  ),
);

app.get("/privacy", (c) =>
  c.html(
    <Layout title="Privacy Policy | TV Nightly" canonical={canonical(c)}>
      <h1>Privacy Policy</h1>
      <p class="muted">Last updated: June 10, 2026</p>
      <h2>What we collect</h2>
      <p>
        <strong>Email addresses</strong> you submit for show alerts or the daily email — used only
        to send what you signed up for. Subscriptions are double opt-in; every email includes an
        unsubscribe link that deletes your address for that list.
      </p>
      <p>
        <strong>Aggregate analytics</strong> via Cloudflare Web Analytics — privacy-first,
        cookie-less, and not tied to your identity. We do not use tracking cookies and we do not
        sell or share personal data.
      </p>
      <h2>Watch progress</h2>
      <p>
        Any "watched" marks are stored only in your browser's local storage — they never leave your
        device.
      </p>
      <h2>Advertising</h2>
      <p>
        If we introduce advertising, this policy will be updated first, and any ad partner's
        cookie/consent requirements will be disclosed here.
      </p>
      <h2>Contact</h2>
      <p>Questions or deletion requests: contact@tvnightly.com.</p>
    </Layout>,
  ),
);

app.notFound((c) =>
  c.html(
    <Layout title="Not found | TV Nightly">
      <h1>Page not found</h1>
      <p class="muted">
        Try <a href="/search">searching for a show</a> or head <a href="/">home</a>.
      </p>
    </Layout>,
    404,
  ),
);

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env));
  },
};
