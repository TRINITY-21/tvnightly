import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { getShow, similarMovies, similarShows } from "../lib/queries";
import { archivoFontCss, posterDataUri } from "../lib/signal";
import {
  buildLikedCard,
  buildListCard,
  buildPromoCard,
  buildStatusCard,
  buildVsCard,
  toCardEntry,
  VsSide,
} from "../lib/social";
import { loadOgFonts, svgToPng } from "../lib/render";
import { getPromoMoments, promoCaptions, promoBase, type PromoMoment, type PromoTheme } from "../lib/promo";
import { tmdbBackdrop, tmdbMovieBackdrop, tmdbUpcomingBackdrop } from "../lib/tmdb";
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

// ---- social studio: a category-driven post generator ----
// Two engines feed one beautiful surface:
//   promo   → single-subject moment cards (buildPromoCard) in 1:1 / 9:16 / 16:9,
//             with platform captions and a direct-download PNG
//   classic → the composite cards (If you liked X, X vs Y, Top 5, gems) rendered
//             as 9:16 SVG and saved client-side (studio.js canvas)
//   ratings → a show's episode-ratings graph (the public ratings.svg)
type StudioCat = {
  id: string;
  label: string;
  group: "Moments" | "Composer" | "Graphs";
  engine: "promo" | "classic" | "ratings";
  themes?: PromoTheme[];
  needs?: "title" | "genre" | "vs";
  blurb?: string;
};
const STUDIO_CATS: StudioCat[] = [
  { id: "trending", label: "Trending now", group: "Moments", engine: "promo", themes: ["trending"], blurb: "This week's hottest titles — live." },
  { id: "tonight", label: "On tonight", group: "Moments", engine: "promo", themes: ["tonight"], blurb: "What's airing tonight — live." },
  { id: "renewed", label: "Renewed & premieres", group: "Moments", engine: "promo", themes: ["renewed", "premiere"], blurb: "Renewal & premiere news from the sync." },
  { id: "classic", label: "Instant classics", group: "Moments", engine: "promo", themes: ["classic"], blurb: "Episodes that just hit must-watch." },
  { id: "liked", label: "If you liked X", group: "Composer", engine: "classic", needs: "title" },
  { id: "vs", label: "X vs Y", group: "Composer", engine: "classic", needs: "vs" },
  { id: "top", label: "Top 5 by genre", group: "Composer", engine: "classic", needs: "genre" },
  { id: "gems", label: "Hidden gems", group: "Composer", engine: "classic", blurb: "Highly rated, under-watched — auto-picked." },
  { id: "status", label: "Renewed?", group: "Composer", engine: "classic", needs: "title" },
  { id: "ratings", label: "Episode ratings graph", group: "Graphs", engine: "ratings", needs: "title" },
];
const FMT_LABEL: Record<string, string> = { square: "1:1 Feed", story: "9:16 Story", wide: "16:9 Wide" };

app.get("/admin/studio", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const enc = encodeURIComponent;
  const catId = c.req.query("cat") ?? "trending";
  const cat = STUDIO_CATS.find((x) => x.id === catId) ?? STUDIO_CATS[0];
  const fmtQ = c.req.query("fmt") ?? "story";
  const fmt = fmtQ in PROMO_DIMS ? fmtQ : "story";
  const base = promoBase(c);

  // classic-engine inputs
  const slug = (c.req.query("slug") ?? "breaking-bad").trim();
  const kind = c.req.query("kind") === "movie" ? "movie" : "tv";
  const genre = (c.req.query("genre") ?? "Drama").trim();
  const vsA = (c.req.query("a") ?? "").trim();
  const vsKa = c.req.query("ka") === "movie" ? "movie" : "tv";
  const vsB = (c.req.query("b") ?? "").trim();
  const vsKb = c.req.query("kb") === "movie" ? "movie" : "tv";

  // promo-engine: the moments for this category
  let moments: PromoMoment[] = [];
  let active: PromoMoment | undefined;
  let caps: ReturnType<typeof promoCaptions> | null = null;
  if (cat.engine === "promo") {
    const all = await getPromoMoments(c);
    moments = all.filter((m) => cat.themes!.includes(m.theme));
    active = moments.find((m) => m.id === c.req.query("pick")) ?? moments[0];
    if (active) caps = promoCaptions(active, base);
  }

  // the preview source + aspect class
  let src = "";
  let aspect: "square" | "story" | "wide" = "story";
  let dlName = `tvnightly-${cat.id}.png`;
  if (cat.engine === "promo" && active) {
    src = promoCardUrl(active, fmt);
    aspect = fmt as "square" | "story" | "wide";
    dlName = `tvnightly-${active.id}-${fmt}.png`;
  } else if (cat.engine === "classic") {
    src = `/admin/studio/card.svg?format=${cat.id}`;
    if (cat.id === "liked" || cat.id === "status") src += `&slug=${enc(slug)}&kind=${kind}`;
    if (cat.id === "top") src += `&genre=${enc(genre)}`;
    if (cat.id === "vs") src += `&a=${enc(vsA)}&ka=${vsKa}&b=${enc(vsB)}&kb=${vsKb}`;
  } else if (cat.engine === "ratings") {
    src = `/show/${enc(slug)}/ratings.svg`;
  }

  const catHref = (id: string) => `/admin/studio?cat=${id}`;
  const groups: StudioCat["group"][] = ["Moments", "Composer", "Graphs"];

  return c.html(
    <Layout title="Studio — admin" noindex scripts={["/js/studio.js"]}>
      <div class="studio">
        <aside class="studio-rail">
          <a class="studio-back" href="/admin/feedback">← Feedback inbox</a>
          <h1 class="studio-h1">Studio</h1>
          {groups.map((g) => (
            <div class="studio-group">
              <h2 class="studio-group-h">{g}</h2>
              {STUDIO_CATS.filter((x) => x.group === g).map((x) => (
                <a class={`studio-cat${x.id === cat.id ? " on" : ""}`} href={catHref(x.id)}>
                  {x.label}
                </a>
              ))}
            </div>
          ))}
        </aside>

        <main class="studio-main">
          <header class="studio-bar">
            <div>
              <h2 class="studio-title">{cat.label}</h2>
              {cat.blurb ? <p class="muted studio-sub">{cat.blurb}</p> : null}
            </div>
            {cat.engine === "promo" && active ? (
              <div class="studio-fmts" role="group" aria-label="Format">
                {(["square", "story", "wide"] as const).map((f) => (
                  <a
                    class={`studio-fmt${f === fmt ? " on" : ""}`}
                    href={`/admin/studio?cat=${cat.id}&pick=${enc(active!.id)}&fmt=${f}`}
                  >
                    {FMT_LABEL[f]}
                  </a>
                ))}
              </div>
            ) : (
              <span class="studio-fmt-static">9:16 vertical</span>
            )}
          </header>

          {/* controls per category */}
          {cat.engine === "classic" && (cat.id === "liked" || cat.id === "status") ? (
            <div class="studio-search" data-format={cat.id}>
              <input id="studio-q" type="search" placeholder="Search a show or movie…" autocomplete="off" />
              <div id="studio-ta" class="studio-ta" hidden></div>
            </div>
          ) : null}
          {cat.engine === "ratings" ? (
            <div class="studio-search" data-format="ratings">
              <input id="studio-q" type="search" placeholder="Search a show for its ratings graph…" autocomplete="off" />
              <div id="studio-ta" class="studio-ta" hidden></div>
            </div>
          ) : null}
          {cat.id === "vs" ? (
            <div class="studio-vs">
              <div class="studio-search">
                <input id="studio-qa" type="search" placeholder="First title…" autocomplete="off" />
                <div id="studio-taa" class="studio-ta" hidden></div>
              </div>
              <div class="studio-search">
                <input id="studio-qb" type="search" placeholder="Second title…" autocomplete="off" />
                <div id="studio-tab" class="studio-ta" hidden></div>
              </div>
              <button type="button" id="studio-gen" class="studio-dl-btn">Generate</button>
            </div>
          ) : null}
          {cat.id === "top" ? (
            <form method="get" action="/admin/studio" class="studio-genre">
              <input type="hidden" name="cat" value="top" />
              <select name="genre">
                {STUDIO_GENRES.map((g) => (
                  <option value={g} selected={g === genre}>{g === "Science-Fiction" ? "Sci-Fi" : g}</option>
                ))}
              </select>
              <button type="submit">Preview</button>
            </form>
          ) : null}
          {cat.engine === "promo" && moments.length ? (
            <div class="studio-picker">
              {moments.map((m) => (
                <a
                  class={`studio-pick${m.id === active?.id ? " on" : ""}`}
                  href={`/admin/studio?cat=${cat.id}&pick=${enc(m.id)}&fmt=${fmt}`}
                >
                  {m.title}
                </a>
              ))}
            </div>
          ) : null}

          <div class="studio-stage">
            <div class={`studio-canvas is-${aspect}`}>
              {cat.engine === "promo" && !active ? (
                <p class="studio-empty muted">
                  Nothing here yet — this fills in from live data + the hourly sync. Try Trending or
                  On tonight, which are always live.
                </p>
              ) : (
                <div class="studio-frame">
                  <img id="studio-card" src={src} alt="Card preview" />
                  {aspect === "story" ? <div class="studio-safe" aria-hidden="true" title="TikTok / Shorts safe zone"></div> : null}
                </div>
              )}
            </div>

            <div class="studio-side">
              {src ? (
                <p class="studio-actions">
                  {cat.engine === "promo" ? (
                    <a id="studio-dl-link" class="studio-dl-btn" href={src} download={dlName}>↓ Download PNG</a>
                  ) : (
                    <button type="button" id="studio-dl" class="studio-dl-btn">↓ Download PNG</button>
                  )}
                  <a href={src} target="_blank" rel="noopener" class="studio-open">Open ↗</a>
                </p>
              ) : null}
              {caps ? (
                <div class="studio-caps">
                  <h3 class="studio-caps-h">Captions</h3>
                  {[
                    { label: "X / Twitter", text: caps.x },
                    { label: "Instagram", text: caps.instagram },
                    { label: "TikTok", text: caps.tiktok },
                  ].map((pl) => (
                    <div class="studio-cap">
                      <div class="studio-cap-head">
                        <span>{pl.label}</span>
                        <button type="button" class="studio-copy">Copy</button>
                      </div>
                      <textarea class="studio-cap-text" readonly rows={5}>{pl.text}</textarea>
                    </div>
                  ))}
                </div>
              ) : cat.engine !== "promo" ? (
                <p class="muted studio-note">
                  Composer & graph cards are vertical (9:16) — ideal for Stories, Shorts & TikTok.
                </p>
              ) : null}
            </div>
          </div>
        </main>
      </div>
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

// ---- Promo Studio: ready-to-post marketing cards for social ----

const PROMO_DIMS = {
  square: [1080, 1080],
  story: [1080, 1920],
  wide: [1920, 1080],
} as const;

// The multi-format moment card PNG (resvg). Stateless — every field comes from
// the query string, so the studio builds a URL per moment × format (1:1/9:16/16:9).
app.get("/admin/studio/promo.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const q = c.req.query();
  const [W, H] = PROMO_DIMS[(q.fmt as keyof typeof PROMO_DIMS) in PROMO_DIMS ? (q.fmt as keyof typeof PROMO_DIMS) : "square"];
  const key = c.env.TMDB_API_KEY;
  const tmdbId = q.tmdbId ? Number(q.tmdbId) : null;
  let backdropUrl: string | null = null;
  if (key && tmdbId) {
    const bd = q.kind === "movie" ? await tmdbUpcomingBackdrop(key, tmdbId) : await tmdbBackdrop(key, tmdbId);
    backdropUrl = bd?.x1 ?? null;
  }
  const [posterUri, backdropUri] = await Promise.all([
    posterDataUri(q.poster || null),
    posterDataUri(backdropUrl),
  ]);
  const svg = buildPromoCard(
    {
      kicker: q.kicker ?? "",
      title: q.title ?? "",
      rating: q.rating ? Number(q.rating) : null,
      note: q.note || null,
      meta: q.meta || null,
      posterUri,
      backdropUri,
    },
    W,
    H,
  );
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, W);
  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
});

const promoCardUrl = (m: PromoMoment, fmt: string) => {
  const p = new URLSearchParams({
    fmt,
    kicker: m.kicker,
    title: m.title,
    kind: m.kind,
  });
  if (m.rating != null) p.set("rating", String(m.rating));
  if (m.note) p.set("note", m.note);
  if (m.meta) p.set("meta", m.meta);
  if (m.posterUrl) p.set("poster", m.posterUrl);
  if (m.tmdbId != null) p.set("tmdbId", String(m.tmdbId));
  return `/admin/studio/promo.png?${p.toString()}`;
};


export default app;
