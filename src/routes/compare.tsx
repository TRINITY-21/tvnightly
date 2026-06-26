import { Hono } from "hono";
import { raw } from "hono/html";
import { Bindings, HonoEnv, AppContext, ShowRow, EpisodeRow } from "../types";
import { comparePathFor, hiRes } from "../lib/format";
import { origin, canonical, breadcrumbTrail } from "../lib/seo";
import { similarShows } from "../lib/queries";
import { servePng } from "../lib/render";
import { foldSql, foldText } from "../lib/search";
import { posterDataUri } from "../lib/signal";
import { buildCompareOgCard, type OgSide } from "../lib/social";
import { tmdbBackdrop } from "../lib/tmdb";
import { IconStar } from "../components/icons";
import { Layout } from "../components/Layout";
import { ShareBar } from "../components/share";
import { ExploreCard } from "../components/cards";
import { VsCard, VsSide } from "../components/compare";

const app = new Hono<HonoEnv>();

// The head-to-head episode chart: two rating lines with gradient fills on a
// 900x300 stage that scales to its container. We emit the per-episode points
// as JSON too, so compare-chart.js can draw a crosshair + still-image tooltip.
const VSX = { W: 900, H: 300, L: 40, R: 16, T: 18, B: 24 };
type ChartPt = { x: number; y: number; r: number; name: string; code: string; img: string | null };
const vsxY = (r: number) =>
  Math.round((VSX.T + (10 - Math.max(5, Math.min(10, r))) * ((VSX.H - VSX.T - VSX.B) / 5)) * 10) / 10;
const attrEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function vsxSeries(eps: EpisodeRow[], step: number): ChartPt[] {
  return eps
    .filter((e) => e.rating != null)
    .map((e, i) => ({
      x: Math.round((VSX.L + i * step) * 10) / 10,
      y: vsxY(e.rating!),
      r: e.rating!,
      name: e.name ?? "",
      code: e.season != null && e.number != null ? `S${e.season}E${e.number}` : "",
      img: e.image_url,
    }));
}

function episodeChart(epsA: EpisodeRow[], epsB: EpisodeRow[], nameA: string, nameB: string) {
  const nA = epsA.filter((e) => e.rating != null).length;
  const nB = epsB.filter((e) => e.rating != null).length;
  const n = Math.max(nA, nB);
  if (!n) return null;
  // Give every episode ~7px of room. When that's wider than the screen the card
  // scrolls the plot horizontally (see .vsx-scroll); short runs that already fit
  // keep width:100% and never scroll. Capped so a 700-episode run stays sane.
  const minPx = Math.min(2000, Math.round(n * 7));
  const step = (VSX.W - VSX.L - VSX.R) / Math.max(n - 1, 1);
  const a = vsxSeries(epsA, step);
  const b = vsxSeries(epsB, step);
  const poly = (pts: ChartPt[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = (pts: ChartPt[], id: string) =>
    pts.length
      ? `<polygon fill="url(#${id})" points="${pts[0].x},${VSX.H - VSX.B} ${poly(pts)} ${pts[pts.length - 1].x},${VSX.H - VSX.B}"/>`
      : "";
  const line = (pts: ChartPt[], color: string) =>
    pts.length
      ? `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${poly(pts)}"/>`
      : "";
  let grid = "";
  for (const r of [6, 7, 8, 9, 10]) {
    const y = vsxY(r);
    grid +=
      `<line x1="${VSX.L}" y1="${y}" x2="${VSX.W - VSX.R}" y2="${y}" stroke="rgba(255,255,255,0.06)"/>` +
      `<text x="${VSX.L - 8}" y="${y + 3.5}" fill="#7d7a74" font-size="11" text-anchor="end">${r}</text>`;
  }
  const svg =
    `<svg class="vsx-svg" style="min-width:${minPx}px" viewBox="0 0 ${VSX.W} ${VSX.H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Episode ratings: ${attrEsc(nameA)} versus ${attrEsc(nameB)}">` +
    `<defs>` +
    `<linearGradient id="vsxA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,169,77,0.30)"/><stop offset="1" stop-color="rgba(255,169,77,0)"/></linearGradient>` +
    `<linearGradient id="vsxB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(255,92,138,0.28)"/><stop offset="1" stop-color="rgba(255,92,138,0)"/></linearGradient>` +
    `</defs>` +
    grid +
    area(a, "vsxA") +
    area(b, "vsxB") +
    line(a, "#FFA94D") +
    line(b, "#FF5C8A") +
    `<g class="vsx-cursor" style="display:none"><line class="vsx-cross" y1="${VSX.T}" y2="${VSX.H - VSX.B}"/><circle class="vsx-dot vsx-dot-a" r="4.5"/><circle class="vsx-dot vsx-dot-b" r="4.5"/></g>` +
    `</svg>`;
  const payload = { w: VSX.W, l: VSX.L, step, sa: a, sb: b, names: [nameA, nameB] };
  return { svg, payload };
}

const showBySlug = (db: D1Database, slug: string) =>
  db.prepare("SELECT * FROM shows WHERE slug = ?").bind(slug).first<ShowRow>();

/** Build a VsCard side per show — real backdrop (down-sized), poster, name —
 *  fetching every backdrop on one round trip (each is 7-day edge-cached). */
async function showSides(key: string | undefined, shows: ShowRow[]): Promise<Map<string, VsSide>> {
  const bds = await Promise.all(
    shows.map((s) => (key && s.tmdb_id ? tmdbBackdrop(key, s.tmdb_id) : Promise.resolve(null))),
  );
  const small = (u: string) => u.replace("/w1280/", "/w780/");
  return new Map(
    shows.map((s, i): [string, VsSide] => [
      s.slug,
      {
        name: s.name,
        poster: s.poster_url ?? hiRes(s.image_url),
        backdrop: bds[i] ? small(bds[i]!.x1) : hiRes(s.image_url),
      },
    ]),
  );
}

/** Canonical matchup path: slugs in alphabetical order. */

async function renderComparePage(c: AppContext, showA: ShowRow, showB: ShowRow) {
  const db = c.env.DB;
  const key = c.env.TMDB_API_KEY;
  const epsQuery = (id: number) =>
    db
      .prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number")
      .bind(id)
      .all<EpisodeRow>()
      .then((r) => r.results);
  const [epsA, epsB, bdA, bdB] = await Promise.all([
    epsQuery(showA.id),
    epsQuery(showB.id),
    key && showA.tmdb_id ? tmdbBackdrop(key, showA.tmdb_id) : Promise.resolve(null),
    key && showB.tmdb_id ? tmdbBackdrop(key, showB.tmdb_id) : Promise.resolve(null),
  ]);
  // each side's hero art: real backdrop, then hi-res still, then poster
  const artA = bdA?.x1 ?? hiRes(showA.image_url) ?? showA.poster_url ?? null;
  const artB = bdB?.x1 ?? hiRes(showB.image_url) ?? showB.poster_url ?? null;
  const bgUrl = (u: string) => u.replace(/'/g, "%27");

  const chart = episodeChart(epsA, epsB, showA.name, showB.name);
  const best = (eps: EpisodeRow[]) =>
    eps.filter((e) => e.rating != null).sort((x, y) => y.rating! - x.rating!)[0];
  const bA = best(epsA);
  const bB = best(epsB);
  const ratedA = epsA.filter((e) => e.rating != null).length;
  const ratedB = epsB.filter((e) => e.rating != null).length;
  const year = (s: ShowRow) => (s.premiered ? s.premiered.slice(0, 4) : "—");
  const seasonCount = (eps: EpisodeRow[]) =>
    new Set(eps.filter((e) => e.season != null && e.season > 0).map((e) => e.season)).size;
  const seasonsA = seasonCount(epsA);
  const seasonsB = seasonCount(epsB);
  const genreLine = (s: ShowRow) => {
    const g: string[] = s.genres ? JSON.parse(s.genres) : [];
    return g.length ? g.slice(0, 2).join(", ") : "—";
  };
  const netLine = (s: ShowRow) => s.network ?? s.web_channel ?? "—";

  // the tale of the tape: win is +1 for A, -1 for B, 0 = neutral (no winner)
  const cmp = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null ? 0 : a > b ? 1 : a < b ? -1 : 0;
  const star = (r: number) => (
    <>
      <IconStar class="rating-star" /> {r.toFixed(1)}
    </>
  );
  const tape = [
    {
      label: "Overall rating",
      a: showA.rating != null ? star(showA.rating) : "—",
      b: showB.rating != null ? star(showB.rating) : "—",
      win: cmp(showA.rating, showB.rating),
    },
    { label: "Episodes rated", a: String(ratedA), b: String(ratedB), win: 0 },
    {
      label: "Best episode",
      a: bA ? (
        <>
          {star(bA.rating!)}
          <span class="tape-sub">{bA.name}</span>
        </>
      ) : (
        "—"
      ),
      b: bB ? (
        <>
          {star(bB.rating!)}
          <span class="tape-sub">{bB.name}</span>
        </>
      ) : (
        "—"
      ),
      win: cmp(bA?.rating, bB?.rating),
    },
    { label: "Seasons", a: String(seasonsA), b: String(seasonsB), win: 0 },
    { label: "Premiered", a: year(showA), b: year(showB), win: 0 },
    { label: "Network", a: netLine(showA), b: netLine(showB), win: 0, minor: true },
    { label: "Genre", a: genreLine(showA), b: genreLine(showB), win: 0, minor: true },
    { label: "Status", a: showA.status ?? "—", b: showB.status ?? "—", win: 0 },
  ];
  const cls = (win: number, side: "a" | "b", minor?: boolean) =>
    (minor ? "tape-minor " : "") +
    (win === 0 ? "tape-val" : (side === "a" ? win > 0 : win < 0) ? "tape-val tape-win" : "tape-val tape-lose");

  // More matchups: each show's neighbours become a versus card — the link
  // mesh that also keeps /compare/* crawlable.
  const [simA, simB] = await Promise.all([similarShows(db, showA), similarShows(db, showB)]);
  const seenMore = new Set([showA.slug, showB.slug]);
  const morePairs: [ShowRow, ShowRow][] = [];
  for (const [base, sims] of [
    [showA, simA] as const,
    [showB, simB] as const,
  ]) {
    for (const s of sims.slice(0, 4)) {
      if (seenMore.has(s.slug)) continue;
      seenMore.add(s.slug);
      morePairs.push([base, s]);
    }
  }
  const moreInvolved = new Map<string, ShowRow>([
    [showA.slug, showA],
    [showB.slug, showB],
  ]);
  for (const [, s] of morePairs) moreInvolved.set(s.slug, s);
  const moreSides = await showSides(c.env.TMDB_API_KEY, [...moreInvolved.values()]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      title={`${showA.name} vs ${showB.name} — episode ratings compared | TV Nightly`}
      description={`${showA.name} or ${showB.name}? Both shows' full episode-rating histories on one chart, plus head-to-head stats.`}
      canonical={`${origin(c)}${comparePathFor(showA.slug, showB.slug)}`}
      ogImage={`${origin(c)}${comparePathFor(showA.slug, showB.slug)}/og.png`}
      ogImageLarge
      ld={[
        breadcrumbTrail([
          { name: "TV Nightly", url: origin(c) },
          { name: "Compare shows", url: `${origin(c)}/compare` },
          {
            name: `${showA.name} vs ${showB.name}`,
            url: `${origin(c)}${comparePathFor(showA.slug, showB.slug)}`,
          },
        ]),
      ]}
      scripts={["/js/compare-chart.js", "/js/share.js"]}
    >
      <header class="vsx-hero">
        <div class="vsx-art" aria-hidden="true">
          {artA ? <span class="vsx-art-a" style={`background-image:url('${bgUrl(artA)}')`}></span> : null}
          {artB ? <span class="vsx-art-b" style={`background-image:url('${bgUrl(artB)}')`}></span> : null}
          <span class="vsx-seam"></span>
        </div>
        <h1 class="sr-only">
          {showA.name} versus {showB.name}
        </h1>
        <span class="vsx-badge" aria-hidden="true">VS</span>
        <a class="vsx-name vsx-name-a" href={`/show/${showA.slug}`}>{showA.name}</a>
        <a class="vsx-name vsx-name-b" href={`/show/${showB.slug}`}>{showB.name}</a>
      </header>

      <section class="vsx-sec">
        <div class="vsx-sec-head">
          <h2 class="vsx-h2">By the numbers</h2>
          <ShareBar
            url={`${origin(c)}${comparePathFor(showA.slug, showB.slug)}`}
            title={`${showA.name} vs ${showB.name} — episode ratings compared`}
          />
        </div>
        <table class="tape">
          <caption class="sr-only">
            {showA.name} versus {showB.name}, head-to-head stats
          </caption>
          <thead>
            <tr>
              <th scope="col" class="tape-team">
                <span class="tape-dot tape-dot-a" aria-hidden="true"></span>
                {showA.name}
              </th>
              <th scope="col" class="tape-vs" aria-hidden="true"></th>
              <th scope="col" class="tape-team tape-team-b">
                <span class="tape-dot tape-dot-b" aria-hidden="true"></span>
                {showB.name}
              </th>
            </tr>
          </thead>
          <tbody>
            {tape.map((r) => (
              <tr>
                <td class={cls(r.win, "a", r.minor)}>{r.a}</td>
                <th scope="row" class="tape-metric">
                  {r.label}
                </th>
                <td class={cls(r.win, "b", r.minor)}>{r.b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section class="vsx-chart">
        <div class="vsx-chart-head">
          <h2 class="vsx-h2">Episode ratings, side by side</h2>
          <p class="vsx-legend">
            <span class="vsx-key">
              <span class="tape-dot tape-dot-a" aria-hidden="true"></span>
              {showA.name}
            </span>
            <span class="vsx-key">
              <span class="tape-dot tape-dot-b" aria-hidden="true"></span>
              {showB.name}
            </span>
          </p>
        </div>
        {chart ? (
          <div class="vsx-graph">
            <div class="vsx-scroll">{raw(chart.svg)}</div>
            <div class="vsx-tip" aria-hidden="true"></div>
            <script
              type="application/json"
              class="vsx-graph-data"
              // episode points for the hover crosshair + still-image tooltip
            >
              {raw(JSON.stringify(chart.payload).replace(/</g, "\\u003c"))}
            </script>
          </div>
        ) : (
          <p class="muted">
            We don't have rated episodes for one of these yet — episode data fills in as the mirror
            grows.
          </p>
        )}
      </section>

      {morePairs.length ? (
        <section class="vsx-sec">
          <h2 class="vsx-h2">More comparisons</h2>
          <div class="vs-grid">
            {morePairs.map(([base, s]) => (
              <VsCard
                href={comparePathFor(base.slug, s.slug)}
                a={moreSides.get(base.slug)!}
                b={moreSides.get(s.slug)!}
                cta="Full episode chart"
              />
            ))}
          </div>
        </section>
      ) : null}
      <div class="vsx-actions">
        <a class="btn-ghost" href="/compare">
          Compare a different pair
        </a>
        <a class="btn-ghost" href="/movies/compare">
          Compare movies instead
        </a>
      </div>
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

// one OG side: real backdrop → hi-res still → poster, all inlined for resvg
async function compareOgSide(c: AppContext, show: ShowRow): Promise<OgSide> {
  const bd = c.env.TMDB_API_KEY && show.tmdb_id ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id) : null;
  const art = bd?.x1 ?? hiRes(show.image_url) ?? show.poster_url ?? null;
  const [backdropUri, posterUri] = await Promise.all([
    posterDataUri(art),
    posterDataUri(show.poster_url ?? hiRes(show.image_url)),
  ]);
  return { name: show.name, posterUri, backdropUri, rating: show.rating };
}

// 1200×630 head-to-head card for link unfurls.
app.get("/compare/:pair/og.png", async (c) => {
  const db = c.env.DB;
  const pair = c.req.param("pair");
  return servePng(c, `compare/${pair}`, async () => {
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
    if (!showA || !showB) return null;
    const [a, b] = await Promise.all([compareOgSide(c, showA), compareOgSide(c, showB)]);
    return buildCompareOgCard(a, b);
  });
});

app.get("/compare", async (c) => {
  const db = c.env.DB;
  const resolve = async (q: string): Promise<ShowRow | null> => {
    if (!q) return null;
    return (
      (await showBySlug(db, q)) ??
      (await db
        .prepare(`SELECT * FROM shows WHERE ${foldSql("name")} LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 1`)
        .bind(foldText(q))
        .first<ShowRow>())
    );
  };
  const qa = (c.req.query("a") ?? "").trim();
  const qb = (c.req.query("b") ?? "").trim();
  const [showA, showB] = await Promise.all([resolve(qa), resolve(qb)]);
  // The form is the doorway; the matchup lives at its own canonical URL.
  if (showA && showB) return c.redirect(comparePathFor(showA.slug, showB.slug), 301);

  // Feature matchups as versus cards: a picked show's closest neighbours, or
  // the most-popular shows paired off when the board is empty.
  const anchor = showA ?? showB ?? null;
  let pairs: [ShowRow, ShowRow][] = [];
  if (anchor) {
    const sims = await similarShows(db, anchor);
    pairs = sims.slice(0, 6).map((s) => [anchor, s]);
  } else {
    const { results: tops } = await db
      .prepare("SELECT * FROM shows ORDER BY weight DESC LIMIT 7")
      .all<ShowRow>();
    pairs = tops.slice(0, 6).map((s, i) => [s, tops[(i + 1) % tops.length]]);
  }
  const involved = new Map<string, ShowRow>();
  for (const [a, b] of pairs) {
    involved.set(a.slug, a);
    involved.set(b.slug, b);
  }
  const sides = await showSides(c.env.TMDB_API_KEY, [...involved.values()]);
  const matchHeading = anchor ? `${anchor.name} vs…` : "Popular matchups";

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      title="Compare TV shows by episode rating | TV Nightly"
      description="Put two shows' full episode-rating histories on one chart and settle the argument."
      canonical={`${origin(c)}/compare`}
      scripts={["/js/compare-typeahead.js"]}
    >
      <header class="chart-head cmp-head">
        <p class="chart-kicker">Head to head</p>
        <h1>Compare TV shows</h1>
        <p class="chart-intro">
          Put two shows' full episode-rating histories on one chart — every episode both of them
          ran, side by side.
        </p>
        <p class="cmp-xlink">
          <a class="chev-after" href="/movies/compare">
            Comparing movies instead?
          </a>
        </p>
      </header>
      <form method="get" action="/compare" class="picker-form compare-form" data-cmp-kind="tv">
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
        <span class="cmp-or" aria-hidden="true">vs</span>
        <label>
          Show B <input type="search" name="b" value={qb} placeholder="The Wire" required />
        </label>
        <button type="submit">Compare</button>
      </form>
      {(qa || qb) && (!showA || !showB) ? (
        <p class="muted">Couldn't find one of those shows — try different names.</p>
      ) : null}
      {pairs.length ? (
        <section class="vsx-sec">
          <h2 class="vsx-h2">{matchHeading}</h2>
          <div class="vs-grid">
            {pairs.map(([a, b]) => (
              <VsCard
                href={comparePathFor(a.slug, b.slug)}
                a={sides.get(a.slug)!}
                b={sides.get(b.slug)!}
                cta="Side by side"
              />
            ))}
          </div>
        </section>
      ) : null}
      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Charts"
            title="Top TV shows"
            desc="The highest-rated series we track, ranked honestly."
            href="/top/tv"
          />
          <ExploreCard
            icon="Community"
            title="Loved by this community"
            desc="The chart built from real one-tap reader verdicts."
            href="/loved"
          />
          <ExploreCard
            icon="Tonight"
            title="What's actually on"
            desc="Tonight's schedule, in air-time order."
            href="/tonight"
          />
        </div>
      </section>
    </Layout>,
  );
});

// ------------------------------------------------- network & genre pages

export default app;
