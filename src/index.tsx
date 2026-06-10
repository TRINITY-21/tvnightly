import { Hono } from "hono";
import type { Context } from "hono";
import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import { runSync } from "./sync";

type Bindings = { DB: D1Database };
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

const Layout: FC<PropsWithChildren<{ title: string; description?: string }>> = (props) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{props.title}</title>
      {props.description ? <meta name="description" content={props.description} /> : null}
      <link rel="stylesheet" href="/styles.css" />
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
          <a href="/renewals">Renewals</a>
        </nav>
      </header>
      <main>{props.children}</main>
      <footer class="site-footer">
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
  const cls =
    status === "Running" ? "ok" : status === "Ended" ? "ended" : status ? "tbd" : "tbd";
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
    >
      {tonight.length ? (
        <section>
          <h2>
            On tonight <a class="more" href="/tonight">all of tonight →</a>
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

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={`${show.name} — episodes, ratings & renewal status | TV Nightly`}
      description={stripHtml(show.summary).slice(0, 155)}
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
              {show.rating != null ? <span class="rating"> · ★ {show.rating.toFixed(1)}</span> : null}
            </p>
            <nav class="show-nav">
              <a href={`/show/${show.slug}/best-episodes`}>Best episodes</a>
              <a href={`/show/${show.slug}/next-episode`}>Next episode</a>
            </nav>
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
  const title = `The ${eps.length} ${kind} episodes of ${show.name}, ranked | TV Nightly`;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={title}
      description={`${show.name}'s ${kind} episodes ranked by viewer rating, from ${
        eps[0] ? `"${eps[0].name}"` : "the top"
      } down.`}
    >
      <h1>
        The {kind} episodes of <a href={`/show/${show.slug}`}>{show.name}</a>
      </h1>
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

app.get("/show/:slug/next-episode", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const next = await c.env.DB.prepare(
    `SELECT * FROM episodes WHERE show_id = ? AND airstamp > datetime('now')
     ORDER BY airstamp LIMIT 1`,
  )
    .bind(show.id)
    .first<EpisodeRow>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title={`When is the next episode of ${show.name}? | TV Nightly`}
      description={
        next
          ? `${show.name} ${epCode(next)} "${next.name ?? ""}" airs ${next.airdate ?? "soon"}.`
          : `${show.name} has no scheduled next episode. Status: ${show.status ?? "unknown"}.`
      }
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
          {raw(
            `<script>(function(){var el=document.getElementById('countdown');if(!el||!el.dataset.ts)return;var t=new Date(el.dataset.ts).getTime();function tick(){var d=t-Date.now();if(d<=0){el.textContent='Airing now';return}var s=Math.floor(d/1000);el.textContent=Math.floor(s/86400)+'d '+Math.floor(s%86400/3600)+'h '+Math.floor(s%3600/60)+'m '+(s%60)+'s';setTimeout(tick,1000)}tick()})();</script>`,
          )}
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
    </Layout>,
  );
});

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

app.get("/renewals", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT sc.old_status, sc.new_status, sc.detected_at, s.name, s.slug
     FROM status_changes sc JOIN shows s ON s.id = sc.show_id
     ORDER BY sc.detected_at DESC LIMIT 50`,
  ).all<{ old_status: string | null; new_status: string | null; detected_at: number; name: string; slug: string }>();

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="Recently renewed & cancelled TV shows | TV Nightly"
      description="A live feed of TV shows whose status just changed: renewals, cancellations, and endings."
    >
      <h1>Status changes</h1>
      {results.length === 0 ? (
        <p class="muted">No status changes detected yet — the sync job updates this hourly.</p>
      ) : null}
      <ul class="ep-list">
        {results.map((r) => (
          <li>
            <a href={`/show/${r.slug}`}>{r.name}</a>:{" "}
            <span class="muted">{r.old_status ?? "?"}</span> → <strong>{r.new_status ?? "?"}</strong>
            <span class="muted"> · {new Date(r.detected_at * 1000).toISOString().slice(0, 10)}</span>
          </li>
        ))}
      </ul>
    </Layout>,
  );
});

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

const legalStub = (title: string, body: string) => (
  <Layout title={`${title} | TV Nightly`}>
    <h1>{title}</h1>
    <p class="muted">{body}</p>
  </Layout>
);

app.get("/terms", (c) =>
  c.html(
    legalStub(
      "Terms of Service",
      "Draft — final terms will be published before launch. TV Nightly provides TV metadata for informational purposes only, with no warranty of accuracy.",
    ),
  ),
);

app.get("/privacy", (c) =>
  c.html(
    legalStub(
      "Privacy Policy",
      "Draft — final policy will be published before launch. We collect only the email addresses you submit for show alerts, and privacy-preserving aggregate analytics.",
    ),
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
    ctx.waitUntil(runSync(env.DB));
  },
};
