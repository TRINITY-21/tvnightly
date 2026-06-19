import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { getShow, similarMovies, similarShows } from "../lib/queries";
import { archivoFontCss, posterDataUri } from "../lib/signal";
import {
  buildLikedCard,
  buildListCard,
  buildStatusCard,
  buildVsCard,
  toCardEntry,
  VsSide,
} from "../lib/social";
import { tmdbBackdrop, tmdbMovieBackdrop } from "../lib/tmdb";
import { AppContext, Bindings, MovieRow, ShowRow } from "../types";

const STUDIO_GENRES = [
  "Drama",
  "Comedy",
  "Crime",
  "Science-Fiction",
  "Fantasy",
  "Horror",
  "Thriller",
  "Action",
  "Mystery",
  "Romance",
];
const FORMATS = ["liked", "gems", "top", "tonight", "vs", "status"] as const;
const VERDICT_GREEN = "#5ec57d";
const VERDICT_RED = "#e0644a";
const VERDICT_BLUE = "#7aa6e0";
const longCardDate = (d: string | null) =>
  d
    ? new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "a date to be announced";
type CardShowRow = {
  name: string;
  poster_url: string | null;
  image_url: string | null;
  rating: number | null;
  genres: string | null;
  premiered: string | null;
};

const app = new Hono<{ Bindings: Bindings }>();

// Basic-auth gate for /admin/* (username "admin", password = ADMIN_KEY). Returns
// a Response to short-circuit, or null when the request is authorized. Unset
// ADMIN_KEY = admin surface disabled (the public /feedback form still works).
// Constant-time equality for the basic-auth header. Hashing both sides to a
// fixed-length digest first means timingSafeEqual never sees unequal lengths
// (which leaks on its own), and the compare can't short-circuit on the first
// differing byte the way `!==` does.
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ah, bh] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ah, bh);
}

async function requireAdmin(c: AppContext): Promise<Response | null> {
  // admin surfaces carry user data (the feedback inbox) — never let a browser or
  // intermediary cache any of them, including the 401/429 responses below.
  c.header("Cache-Control", "private, no-store");
  if (!c.env.ADMIN_KEY) {
    return c.text("Admin disabled — set the ADMIN_KEY secret to enable it.", 503);
  }
  const expected = "Basic " + btoa("admin:" + c.env.ADMIN_KEY);
  if (await safeEqual(c.req.header("Authorization") ?? "", expected)) return null;

  // Failed/missing credentials: throttle per-IP to blunt brute-force of ADMIN_KEY
  // (authorized requests skip this, so normal admin use never hits the limit).
  if (c.env.ADMIN_LIMIT) {
    const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
    const { success } = await c.env.ADMIN_LIMIT.limit({ key: ip });
    if (!success) return c.text("Too many attempts. Try again shortly.", 429);
  }
  return c.body("Authentication required.", 401, {
    "WWW-Authenticate": 'Basic realm="TV Nightly admin"',
  });
}

const fmtTs = (ts: number) => new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
const pagePath = (p: string | null) => {
  if (!p) return "";
  try {
    return new URL(p).pathname;
  } catch {
    return p;
  }
};

// ---- feedback inbox (read-only) ----
app.get("/admin/feedback", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const { results } = await c.env.DB.prepare(
    "SELECT id, message, email, page, created_at FROM feedback ORDER BY created_at DESC LIMIT 300",
  ).all<{
    id: number;
    message: string;
    email: string | null;
    page: string | null;
    created_at: number;
  }>();

  return c.html(
    <Layout title="Feedback — admin" noindex>
      <p class="adm-nav">
        <a href="/admin/studio">Social studio <span class="chev-icon chev-icon-sm" aria-hidden="true"></span></a>
      </p>
      <h1>
        Feedback <span class="adm-count">{results.length}</span>
      </h1>
      {results.length === 0 ? (
        <p class="muted">No feedback yet.</p>
      ) : (
        <ul class="adm-list">
          {results.map((r) => (
            <li class="adm-item">
              <div class="adm-meta">
                <span>{fmtTs(r.created_at)}</span>
                {r.email ? (
                  <a href={`mailto:${r.email}`}>{r.email}</a>
                ) : (
                  <span class="muted">no email</span>
                )}
                {r.page ? <span class="adm-page">{pagePath(r.page)}</span> : null}
              </div>
              <div class="adm-msg">{r.message}</div>
            </li>
          ))}
        </ul>
      )}
    </Layout>,
  );
});

// ---- social studio: short-form post generator ----
app.get("/admin/studio", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const fq = c.req.query("format") ?? "liked";
  const format = (FORMATS as readonly string[]).includes(fq) ? fq : "liked";
  const slug = (c.req.query("slug") ?? "breaking-bad").trim();
  const kind = c.req.query("kind") === "movie" ? "movie" : "tv";
  const genre = (c.req.query("genre") ?? "Drama").trim();
  const vsA = (c.req.query("a") ?? "").trim();
  const vsKa = c.req.query("ka") === "movie" ? "movie" : "tv";
  const vsB = (c.req.query("b") ?? "").trim();
  const vsKb = c.req.query("kb") === "movie" ? "movie" : "tv";

  const enc = encodeURIComponent;
  let src = `/admin/studio/card.svg?format=${format}`;
  if (format === "liked" || format === "status") src += `&slug=${enc(slug)}&kind=${kind}`;
  if (format === "top") src += `&genre=${enc(genre)}`;
  if (format === "vs") src += `&a=${enc(vsA)}&ka=${vsKa}&b=${enc(vsB)}&kb=${vsKb}`;

  const tab = (f: string, label: string) => (
    <a class={`studio-tab${f === format ? " on" : ""}`} href={`/admin/studio?format=${f}`}>
      {label}
    </a>
  );

  return c.html(
    <Layout title="Social studio — admin" noindex scripts={["/js/studio.js"]}>
      <p class="adm-nav">
        <a href="/admin/feedback"><span class="chev-icon chev-icon-sm chev-icon-prev" aria-hidden="true"></span> Feedback</a>
      </p>
      <h1>Social studio</h1>
      <div class="studio-tabs">
        {tab("liked", "If you liked X")}
        {tab("tonight", "On tonight")}
        {tab("gems", "Hidden gems")}
        {tab("top", "Top 5 by genre")}
        {tab("vs", "X vs Y")}
        {tab("status", "Renewed?")}
      </div>

      {format === "liked" || format === "status" ? (
        <div class="studio-search" data-format={format}>
          <input id="studio-q" type="search" placeholder="Search a show or movie…" autocomplete="off" />
          <div id="studio-ta" class="studio-ta" hidden></div>
        </div>
      ) : null}
      {format === "vs" ? (
        <div class="studio-vs">
          <div class="studio-search">
            <input id="studio-qa" type="search" placeholder="First title…" autocomplete="off" />
            <div id="studio-taa" class="studio-ta" hidden></div>
          </div>
          <div class="studio-search">
            <input id="studio-qb" type="search" placeholder="Second title…" autocomplete="off" />
            <div id="studio-tab" class="studio-ta" hidden></div>
          </div>
          <button type="button" id="studio-gen" class="studio-dl-btn">
            Generate
          </button>
        </div>
      ) : null}
      {format === "top" ? (
        <form method="get" action="/admin/studio" class="studio-genre">
          <input type="hidden" name="format" value="top" />
          <select name="genre">
            {STUDIO_GENRES.map((g) => (
              <option value={g} selected={g === genre}>
                {g === "Science-Fiction" ? "Sci-Fi" : g}
              </option>
            ))}
          </select>
          <button type="submit">Preview</button>
        </form>
      ) : null}
      {format === "gems" ? (
        <p class="muted">Highly rated, under-watched shows — auto-picked from the catalogue.</p>
      ) : null}
      {format === "tonight" ? (
        <p class="muted">Tonight's airings, ranked by rating — auto-pulled from the schedule.</p>
      ) : null}

      <div class="studio-preview">
        <div class="studio-preview-frame">
          <img id="studio-card" src={src} alt="Social card preview" width="1080" height="1920" />
          <div class="studio-safe" aria-hidden="true" title="TikTok / Shorts UI safe zone"></div>
        </div>
        <p class="studio-safe-note muted">Content stays left of the shaded rail — clears like, comment &amp; share buttons.</p>
      </div>
      <p class="studio-actions">
        <button type="button" id="studio-dl" class="studio-dl-btn">
          Download PNG
        </button>
        <button type="button" id="studio-vid" class="studio-dl-btn studio-vid-btn">
          Record video
        </button>
        <a href={src} target="_blank" rel="noopener">
          Open the SVG ↗
        </a>
      </p>
    </Layout>,
  );
});

// a movie maps onto the same CardEntry shape (title->name, year->premiered)
const movieToCard = (m: MovieRow) => ({
  name: m.title,
  poster_url: m.poster_url,
  image_url: null,
  rating: m.rating,
  genres: m.genres,
  premiered: m.year ? String(m.year) : null,
});

app.get("/admin/studio/card.svg", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const format = c.req.query("format") ?? "liked";
  const key = c.env.TMDB_API_KEY;
  const fontCss = await archivoFontCss(c.env.ASSETS);
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "no-store");

  // ---- ranked-list formats ----
  if (format === "gems") {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM shows WHERE rating >= 8.0 AND weight BETWEEN 28 AND 60
       AND genres IS NOT NULL ORDER BY rating DESC, weight ASC LIMIT 5`,
    ).all<ShowRow>();
    const entries = await Promise.all(results.map((s) => toCardEntry(s)));
    return c.body(
      buildListCard({
        eyebrow: "HIDDEN GEMS",
        title: "9/10. Barely watched.",
        entries,
        footerLine: "Find your next obsession at",
        fontCss,
      }),
    );
  }
  if (format === "top") {
    const genre = (c.req.query("genre") ?? "Drama").trim();
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM shows WHERE genres LIKE ? AND weight >= 60 ORDER BY rating DESC LIMIT 5",
    )
      .bind(`%"${genre}"%`)
      .all<ShowRow>();
    const entries = await Promise.all(results.map((s) => toCardEntry(s)));
    return c.body(
      buildListCard({
        eyebrow: "TOP 5",
        title: `${genre === "Science-Fiction" ? "Sci-Fi" : genre} shows`,
        entries,
        footerLine: "The full ranking at",
        fontCss,
      }),
    );
  }

  if (format === "tonight") {
    const sql = (lower: string, upper: string) =>
      `SELECT DISTINCT s.name, s.poster_url, s.image_url, s.rating, s.genres, s.premiered
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.airstamp >= ${lower} AND e.airstamp < ${upper} AND s.weight >= 40
       ORDER BY s.rating DESC LIMIT 5`;
    let rows = (
      await c.env.DB.prepare(
        sql("datetime('now','start of day')", "datetime('now','start of day','+1 day')"),
      ).all<CardShowRow>()
    ).results;
    let eyebrow = "ON TV TONIGHT";
    let title = "Worth watching tonight";
    if (rows.length < 3) {
      rows = (
        await c.env.DB.prepare(sql("datetime('now')", "datetime('now','+7 day')")).all<CardShowRow>()
      ).results;
      eyebrow = "ON TV THIS WEEK";
      title = "The week's best";
    }
    const entries = await Promise.all(rows.map((s) => toCardEntry(s)));
    return c.body(buildListCard({ eyebrow, title, entries, footerLine: "Tonight's full schedule at", fontCss }));
  }

  if (format === "status") {
    const slug = (c.req.query("slug") ?? "").trim();
    const show = await getShow(c.env.DB, slug);
    if (!show) return c.text(`No show with slug “${slug}”.`, 404);
    const next = await c.env.DB.prepare(
      "SELECT season, airdate FROM episodes WHERE show_id = ? AND airstamp > datetime('now') ORDER BY airstamp LIMIT 1",
    )
      .bind(show.id)
      .first<{ season: number | null; airdate: string | null }>();
    const maxRow = await c.env.DB.prepare(
      "SELECT MAX(season) AS m FROM episodes WHERE show_id = ? AND airstamp <= datetime('now')",
    )
      .bind(show.id)
      .first<{ m: number | null }>();
    const maxAired = maxRow?.m ?? 0;
    let verdict: string;
    let verdictColor: string;
    let subLine: string;
    if (next && (next.season ?? 0) > maxAired) {
      verdict = "Renewed";
      verdictColor = VERDICT_GREEN;
      subLine = `Season ${next.season} premieres ${longCardDate(next.airdate)}.`;
    } else if (next) {
      verdict = "Airing now";
      verdictColor = VERDICT_GREEN;
      subLine = `Season ${next.season} is airing — next episode ${longCardDate(next.airdate)}.`;
    } else if (show.status === "Ended") {
      verdict = "Ended";
      verdictColor = VERDICT_RED;
      subLine = show.ended
        ? `It wrapped ${longCardDate(show.ended)} — no new season is coming.`
        : "No new season is coming.";
    } else if (show.status === "To Be Determined") {
      verdict = "Awaiting renewal";
      verdictColor = "#FFA94D";
      subLine = `Not yet renewed for Season ${maxAired + 1}.`;
    } else if (show.status === "In Development") {
      verdict = "In development";
      verdictColor = VERDICT_BLUE;
      subLine = "No premiere date announced yet.";
    } else {
      verdict = show.status ?? "Unknown";
      verdictColor = "#FFA94D";
      subLine = "The next air date hasn't been announced.";
    }
    const bd = show.tmdb_id && key ? await tmdbBackdrop(key, show.tmdb_id) : null;
    const backdropUri = bd ? await posterDataUri(bd.x2 ?? bd.x1) : null;
    const posterUri = backdropUri
      ? null
      : await posterDataUri((show.poster_url ?? show.image_url)?.replace("/w342/", "/w500/") ?? null);
    const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
    const meta = [genres.slice(0, 2).join(" · "), show.premiered?.slice(0, 4)].filter(Boolean).join(" · ");
    return c.body(
      buildStatusCard({ name: show.name, meta, verdict, verdictColor, subLine, backdropUri, posterUri, fontCss }),
    );
  }

  if (format === "vs") {
    const side = async (sl: string, kd: string): Promise<VsSide | null> => {
      if (!sl) return null;
      if (kd === "movie") {
        const m = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?").bind(sl).first<MovieRow>();
        if (!m) return null;
        const bd = key ? await tmdbMovieBackdrop(key, m.imdb_id) : null;
        return {
          name: m.title,
          rating: m.rating,
          backdropUri: bd ? await posterDataUri(bd.x2 ?? bd.x1) : null,
          posterUri: await posterDataUri(m.poster_url),
        };
      }
      const sh = await getShow(c.env.DB, sl);
      if (!sh) return null;
      const bd = sh.tmdb_id && key ? await tmdbBackdrop(key, sh.tmdb_id) : null;
      return {
        name: sh.name,
        rating: sh.rating,
        backdropUri: bd ? await posterDataUri(bd.x2 ?? bd.x1) : null,
        posterUri: await posterDataUri((sh.poster_url ?? sh.image_url)?.replace("/w342/", "/w500/") ?? null),
      };
    };
    const [A, B] = await Promise.all([
      side((c.req.query("a") ?? "").trim(), c.req.query("ka") === "movie" ? "movie" : "tv"),
      side((c.req.query("b") ?? "").trim(), c.req.query("kb") === "movie" ? "movie" : "tv"),
    ]);
    if (!A || !B) return c.text("Pick two titles for the head-to-head.", 400);
    let verdict = "tvnightly.com";
    if (A.rating != null && B.rating != null) {
      verdict =
        A.rating === B.rating
          ? `Dead heat — ${A.rating.toFixed(1)} each`
          : `${(A.rating > B.rating ? A : B).name} wins · ${A.rating.toFixed(1)} vs ${B.rating.toFixed(1)}`;
    }
    return c.body(buildVsCard(A, B, verdict, fontCss));
  }

  // ---- default: "If you liked X" ----
  const slug = (c.req.query("slug") ?? "").trim();
  const kind = c.req.query("kind") === "movie" ? "movie" : "tv";

  let hero, pickEntries;
  let backdropUri: string | null = null;
  if (kind === "movie") {
    const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?")
      .bind(slug)
      .first<MovieRow>();
    if (!movie) return c.text(`No movie with slug “${slug}”.`, 404);
    const bd = key ? await tmdbMovieBackdrop(key, movie.imdb_id) : null;
    backdropUri = bd ? await posterDataUri(bd.x2 ?? bd.x1) : null;
    const picks = await similarMovies(c.env.DB, movie, 3);
    [hero, pickEntries] = await Promise.all([
      toCardEntry(movieToCard(movie)),
      Promise.all(picks.map((m) => toCardEntry(movieToCard(m)))),
    ]);
  } else {
    const show = await getShow(c.env.DB, slug);
    if (!show) return c.text(`No show with slug “${slug}”.`, 404);
    const bd = show.tmdb_id && key ? await tmdbBackdrop(key, show.tmdb_id) : null;
    backdropUri = bd ? await posterDataUri(bd.x2 ?? bd.x1) : null;
    const picks = await similarShows(c.env.DB, show, 3);
    [hero, pickEntries] = await Promise.all([
      toCardEntry(show),
      Promise.all(picks.map((s) => toCardEntry(s))),
    ]);
  }

  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.body(buildLikedCard(hero, pickEntries, fontCss, backdropUri));
});

export default app;
