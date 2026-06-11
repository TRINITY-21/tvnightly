import { Hono } from "hono";
import { raw } from "hono/html";
import { Bindings, AppContext, ShowRow, EpisodeRow } from "../types";
import { comparePathFor } from "../lib/format";
import { origin, canonical } from "../lib/seo";
import { similarShows } from "../lib/queries";
import { Layout } from "../components/Layout";

const app = new Hono<{ Bindings: Bindings }>();

function compareSvg(a: EpisodeRow[], b: EpisodeRow[]): string {
  const ra = a.filter((e) => e.rating != null);
  const rb = b.filter((e) => e.rating != null);
  if (!ra.length && !rb.length) return "";
  const n = Math.max(ra.length, rb.length);
  const PAD = 34;
  const STEP = Math.max(4, Math.min(9, Math.floor(800 / Math.max(n, 1))));
  const W = Math.max(420, n * STEP + PAD * 2);
  const H = 240;
  const yFor = (r: number) => PAD + (10 - Math.max(5, Math.min(10, r))) * ((H - PAD * 2) / 5);
  // Brand chart duotone: series A in phosphor cyan, series B in marquee pink.
  const line = (eps: EpisodeRow[], color: string) =>
    `<polyline fill="none" stroke="${color}" stroke-width="2" points="${eps
      .map((e, i) => `${PAD + i * STEP + STEP / 2},${yFor(e.rating!)}`)
      .join(" ")}"/>`;
  const parts = [
    `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Episode ratings comparison">`,
  ];
  for (const r of [5, 6, 7, 8, 9, 10]) {
    parts.push(
      `<line x1="${PAD}" y1="${yFor(r)}" x2="${W - PAD}" y2="${yFor(r)}" stroke="#26262c" stroke-width="0.5"/>`,
      `<text x="${PAD - 6}" y="${yFor(r) + 3}" fill="#a39e97" font-size="10" text-anchor="end">${r}</text>`,
    );
  }
  parts.push(line(ra, "#FFA94D"), line(rb, "#FF5C8A"), "</svg>");
  return parts.join("");
}

const showBySlug = (db: D1Database, slug: string) =>
  db.prepare("SELECT * FROM shows WHERE slug = ?").bind(slug).first<ShowRow>();

/** Canonical matchup path: slugs in alphabetical order. */

async function renderComparePage(c: AppContext, showA: ShowRow, showB: ShowRow) {
  const db = c.env.DB;
  const [epsA, epsB] = await Promise.all([
    db
      .prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number")
      .bind(showA.id)
      .all<EpisodeRow>()
      .then((r) => r.results),
    db
      .prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number")
      .bind(showB.id)
      .all<EpisodeRow>()
      .then((r) => r.results),
  ]);
  const svg = compareSvg(epsA, epsB);
  const best = (eps: EpisodeRow[]) =>
    eps.filter((e) => e.rating != null).sort((x, y) => y.rating! - x.rating!)[0];
  const bA = best(epsA);
  const bB = best(epsB);
  const stats = [
    { label: "Show rating", a: showA.rating?.toFixed(1) ?? "—", b: showB.rating?.toFixed(1) ?? "—" },
    { label: "Episodes", a: String(epsA.length), b: String(epsB.length) },
    {
      label: "Best episode",
      a: bA ? `${bA.name} (★${bA.rating!.toFixed(1)})` : "—",
      b: bB ? `${bB.name} (★${bB.rating!.toFixed(1)})` : "—",
    },
    { label: "Status", a: showA.status ?? "—", b: showB.status ?? "—" },
  ];

  // More matchups: each show's genre neighbors become suggested comparisons —
  // this link mesh is also what makes /compare/* pages crawlable.
  const [simA, simB] = await Promise.all([similarShows(db, showA), similarShows(db, showB)]);
  const seen = new Set([showA.slug, showB.slug]);
  const suggestions: { label: string; href: string }[] = [];
  for (const [base, sims] of [
    [showA, simA] as const,
    [showB, simB] as const,
  ]) {
    for (const s of sims.slice(0, 4)) {
      if (seen.has(s.slug)) continue;
      seen.add(s.slug);
      suggestions.push({ label: `${base.name} vs ${s.name}`, href: comparePathFor(base.slug, s.slug) });
    }
  }

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${showA.name} vs ${showB.name} — episode ratings compared | TV Nightly`}
      description={`${showA.name} or ${showB.name}? Both shows' full episode-rating histories on one chart, plus head-to-head stats.`}
      canonical={`${origin(c)}${comparePathFor(showA.slug, showB.slug)}`}
      ogImage={showA.image_url ?? showB.image_url ?? undefined}
    >
      <h1>
        <a href={`/show/${showA.slug}`}>{showA.name}</a> vs{" "}
        <a href={`/show/${showB.slug}`}>{showB.name}</a>
      </h1>
      <form method="get" action="/compare" class="picker-form">
        <label>
          Show A <input type="search" name="a" value={showA.name} required />
        </label>
        <label>
          Show B <input type="search" name="b" value={showB.name} required />
        </label>
        <button type="submit">Compare</button>
      </form>
      <p>
        <span class="prov" style="border-color:#FFA94D">{showA.name}</span>{" "}
        <span class="prov" style="border-color:#FF5C8A;background:rgba(255,92,138,0.12)">{showB.name}</span>
      </p>
      {svg ? (
        <div class="graph-wrap">{raw(svg)}</div>
      ) : (
        <p class="muted">
          We don't have rated episodes for one of these yet — episode data fills in as the mirror
          grows.
        </p>
      )}
      <ul class="ep-list">
        {stats.map((s) => (
          <li>
            <span class="muted">{s.label}:</span> {s.a} <span class="muted">vs</span> {s.b}
          </li>
        ))}
      </ul>
      {suggestions.length ? (
        <section>
          <h2>More comparisons</h2>
          <p class="quick-picks">
            {suggestions.map((s) => (
              <a class="chip" href={s.href}>
                {s.label}
              </a>
            ))}
          </p>
        </section>
      ) : null}
    </Layout>,
  );
}

app.get("/compare/:pair", async (c) => {
  const db = c.env.DB;
  const pair = c.req.param("pair");
  // Slugs may themselves contain "-vs-": try each split until both resolve.
  const parts = pair.split("-vs-");
  let showA: ShowRow | null = null;
  let showB: ShowRow | null = null;
  for (let i = 1; i < parts.length && !showB; i++) {
    const [ra, rb] = await Promise.all([
      showBySlug(db, parts.slice(0, i).join("-vs-")),
      showBySlug(db, parts.slice(i).join("-vs-")),
    ]);
    if (ra && rb) {
      showA = ra;
      showB = rb;
    }
  }
  if (!showA || !showB) return c.notFound();
  const canonicalPath = comparePathFor(showA.slug, showB.slug);
  if (`/compare/${pair}` !== canonicalPath) return c.redirect(canonicalPath, 301);
  return renderComparePage(c, showA, showB);
});

app.get("/compare", async (c) => {
  const db = c.env.DB;
  const resolve = async (q: string): Promise<ShowRow | null> => {
    if (!q) return null;
    return (
      (await showBySlug(db, q)) ??
      (await db
        .prepare("SELECT * FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 1")
        .bind(q)
        .first<ShowRow>())
    );
  };
  const qa = (c.req.query("a") ?? "").trim();
  const qb = (c.req.query("b") ?? "").trim();
  const [showA, showB] = await Promise.all([resolve(qa), resolve(qb)]);
  // The form is the doorway; the matchup lives at its own canonical URL.
  if (showA && showB) return c.redirect(comparePathFor(showA.slug, showB.slug), 301);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Compare two TV shows — episode ratings head-to-head | TV Nightly"
      description="Put two shows' full episode-rating histories on one chart and settle the argument."
      canonical={`${origin(c)}/compare`}
    >
      <h1>Compare two shows</h1>
      <form method="get" action="/compare" class="picker-form">
        <label>
          Show A{" "}
          <input
            type="search"
            name="a"
            value={showA?.name ?? qa}
            placeholder="Breaking Bad"
            required
          />
        </label>
        <label>
          Show B <input type="search" name="b" value={qb} placeholder="The Wire" required />
        </label>
        <button type="submit">Compare</button>
      </form>
      {(qa || qb) && (!showA || !showB) ? (
        <p class="muted">Couldn't find one of those shows — try different names.</p>
      ) : null}
      {showA && !showB ? (
        <section>
          <h2>Compare {showA.name} with…</h2>
          <p class="quick-picks">
            {(await similarShows(db, showA)).slice(0, 6).map((s) => (
              <a class="chip" href={comparePathFor(showA.slug, s.slug)}>
                {showA.name} vs {s.name}
              </a>
            ))}
          </p>
        </section>
      ) : null}
      {!showA && !showB ? (
        <section>
          <h2>Popular matchups</h2>
          <p class="quick-picks">
            {await (async () => {
              const { results: tops } = await db
                .prepare("SELECT slug, name, genres FROM shows ORDER BY weight DESC LIMIT 8")
                .all<{ slug: string; name: string; genres: string | null }>();
              // adjacent pairs by popularity — cheap, always-valid suggestions
              return tops.slice(0, 6).map((s, i) => {
                const other = tops[(i + 1) % tops.length];
                return (
                  <a class="chip" href={comparePathFor(s.slug, other.slug)}>
                    {s.name} vs {other.name}
                  </a>
                );
              });
            })()}
          </p>
        </section>
      ) : null}
    </Layout>,
  );
});

// ------------------------------------------------- network & genre pages

export default app;
