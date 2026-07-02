import { Hono } from "hono";
import { raw } from "hono/html";
import { AdminShell } from "../components/admin-shell";
import { Layout } from "../components/Layout";
import { slugifyName } from "../lib/format";
import {
  getPromoMoments,
  promoBase,
  promoCaptions,
  promoEngagementCaptions,
  promoRatingsCaptions,
  promoSimilarCaptions,
  type CaptionSet,
  type PromoMoment,
  type PromoTheme,
} from "../lib/promo";
import { getShow, similarShows } from "../lib/queries";
import { loadOgFonts, svgToPng } from "../lib/render";
import {
  buildAngles,
  resolveSubjects,
  runAngleQuery,
  shorts10Captions,
  shorts10Spec,
  shortsLandingPath,
  type AngleQuery,
  type AngleType,
  type SearchSubject,
  type ShortProject,
} from "../lib/shorts";
import { buildHeatmapCard, buildPromoCard, buildSeasonRatingsCard, buildSimilarCard, buildVersusCard } from "../lib/social";
import { posterDataUri } from "../lib/signal";
import { tmdbBackdrop, tmdbRecommendations, tmdbUpcomingBackdrop } from "../lib/tmdb";
import { buildTmdbShow } from "../lib/tmdb-show";
import { AppContext, HonoEnv } from "../types";

const app = new Hono<HonoEnv>();

// Platform caption fields on the shorts export step — data-cap = the CaptionSet
// key the client fills in from /admin/shorts/captions.
const CAPTION_PLATFORMS: { key: keyof import("../lib/promo").CaptionSet; label: string }[] = [
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube Shorts" },
  { key: "instagram", label: "Instagram" },
  { key: "x", label: "X" },
  { key: "pinterest", label: "Pinterest" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "facebook", label: "Facebook" },
];

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
app.get("/admin", (c) => c.redirect("/admin/social", 302));

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
    <Layout c={c} title="Feedback — admin" noindex>
      <AdminShell page="feedback" lead="Site feedback from visitors.">
        <header class="admin-page-head">
          <h1 class="admin-page-title">
            Feedback <span class="admin-count">{results.length}</span>
          </h1>
          <p class="admin-page-lead muted">Latest messages from the feedback form — newest first.</p>
        </header>
        {results.length === 0 ? (
          <div class="admin-empty">
            <p class="admin-empty-title">No feedback yet</p>
            <p class="admin-empty-lead muted">When someone sends a message, it will show up here.</p>
          </div>
        ) : (
          <ul class="admin-feed">
            {results.map((r) => (
              <li class="admin-card">
                <div class="admin-card-body">
                  <div class="admin-card-meta">
                    <span>{fmtTs(r.created_at)}</span>
                    {r.email ? (
                      <a href={`mailto:${r.email}`}>{r.email}</a>
                    ) : (
                      <span class="muted">No email</span>
                    )}
                    {r.page ? <span class="admin-card-path">{pagePath(r.page)}</span> : null}
                  </div>
                  <div class="admin-card-msg">{r.message}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminShell>
    </Layout>,
  );
});

// ---- subscribers (read-only) ----
app.get("/admin/subscribers", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  const totals = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(confirmed), 0) AS confirmed,
            COALESCE(SUM(CASE WHEN confirmed = 1 AND show_id IS NULL AND kind = 'daily' THEN 1 ELSE 0 END), 0) AS daily,
            COALESCE(SUM(CASE WHEN confirmed = 1 AND show_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS pershow,
            COALESCE(SUM(CASE WHEN created_at > unixepoch() - 86400 THEN 1 ELSE 0 END), 0) AS today
     FROM subscriptions`,
  ).first<{ total: number; confirmed: number; daily: number; pershow: number; today: number }>();

  const { results } = await c.env.DB.prepare(
    `SELECT su.id, su.email, su.kind, su.confirmed, su.created_at, s.name AS show_name
     FROM subscriptions su LEFT JOIN shows s ON s.id = su.show_id
     ORDER BY su.created_at DESC LIMIT 300`,
  ).all<{ id: number; email: string; kind: string; confirmed: number; created_at: number; show_name: string | null }>();

  const pending = (totals?.total ?? 0) - (totals?.confirmed ?? 0);

  return c.html(
    <Layout c={c} title="Subscribers — admin" noindex>
      <AdminShell page="subscribers" lead="Email list from subscribe forms.">
        <header class="admin-page-head">
          <h1 class="admin-page-title">
            Subscribers <span class="admin-count">{totals?.confirmed ?? 0}</span>
          </h1>
          <p class="admin-page-lead muted">Confirmed sign-ups and pending confirmations.</p>
        </header>
        <div class="admin-stats">
          <div class="admin-stat is-accent">
            <span class="admin-stat-n">{totals?.confirmed ?? 0}</span>
            <span class="admin-stat-l">Confirmed</span>
          </div>
          <div class="admin-stat">
            <span class="admin-stat-n">{pending}</span>
            <span class="admin-stat-l">Pending</span>
          </div>
          <div class="admin-stat">
            <span class="admin-stat-n">{totals?.daily ?? 0}</span>
            <span class="admin-stat-l">Daily list</span>
          </div>
          <div class="admin-stat">
            <span class="admin-stat-n">{totals?.pershow ?? 0}</span>
            <span class="admin-stat-l">Per-show</span>
          </div>
          <div class="admin-stat">
            <span class="admin-stat-n">{totals?.today ?? 0}</span>
            <span class="admin-stat-l">Last 24h</span>
          </div>
        </div>
        {results.length === 0 ? (
          <div class="admin-empty">
            <p class="admin-empty-title">No subscribers yet</p>
            <p class="admin-empty-lead muted">New sign-ups will appear here after someone confirms their email.</p>
          </div>
        ) : (
          <ul class="admin-feed">
            {results.map((r) => (
              <li class="admin-card">
                <div class="admin-card-body">
                  <div class="admin-card-meta">
                    <span>{fmtTs(r.created_at)}</span>
                    <a href={`mailto:${r.email}`}>{r.email}</a>
                    <span>{r.show_name ? `${r.kind} · ${r.show_name}` : r.kind}</span>
                    <span class={`admin-badge${r.confirmed ? " is-ok" : " is-pending"}`}>
                      {r.confirmed ? "Confirmed" : "Pending"}
                    </span>
                  </div>
                </div>
                <form
                  class="admin-remove"
                  method="post"
                  action="/admin/subscribers/delete"
                  onsubmit="return confirm('Remove this subscriber from the list? This cannot be undone.')"
                >
                  <input type="hidden" name="id" value={String(r.id)} />
                  <button type="submit" class="admin-remove-btn" aria-label={`Remove ${r.email}`}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </AdminShell>
    </Layout>,
  );
});

// Remove a subscriber (admin tooling). Basic-auth protected like every /admin
// surface; the browser carries credentials on the POST automatically.
app.post("/admin/subscribers/delete", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const body = await c.req.parseBody();
  const id = Number(body.id);
  if (Number.isInteger(id) && id > 0) {
    await c.env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
  }
  return c.redirect("/admin/subscribers", 303);
});

// ===========================================================================
// Shorts generator — /admin/shorts
// Search any title/person/genre/year → MANY "Top 10" angles → curate the ranked
// 10 → per-platform captions → one-button export of a render_short.sh that drives
// the local countdown pipeline (tools/countdown). The Worker never renders video.
// ===========================================================================
const shortsNoStore = (c: AppContext) => {
  c.header("Cache-Control", "private, no-store");
};

// ===========================================================================
// Social hub — /admin/social
// One surface for every post: a branded card (image) in 4 aspect ratios, the
// per-platform captions (value + poll A/B) carrying UTM short links, a jump to
// the Top-10 video builder, and this week's live moments folded in as the feed.
// ===========================================================================
const SOCIAL_DIMS = {
  story: [1080, 1920], // 9:16 — Reels / TikTok / Shorts cover
  feed: [1080, 1080], //  1:1 — IG / FB feed
  pin: [1000, 1500], //   2:3 — Pinterest
  wide: [1920, 1080], //  16:9 — X / link preview
} as const;
type SocialFmt = keyof typeof SOCIAL_DIMS;

// Web images are size-bounded for LCP (w780/w1280). A downloadable share card is
// NOT the LCP — a landscape backdrop sliced into a 1080×1920 frame upscales ~2.7×
// and looks soft. Re-point TMDB URLs at a sharper rendition so nothing is upscaled
// (regex only matches TMDB's /t/p/w<NNN>/ path; non-TMDB URLs pass through unchanged).
const hiRes = (url: string | null | undefined, size = "original"): string | null =>
  url ? url.replace(/\/t\/p\/w\d+\//, `/t/p/${size}/`) : (url ?? null);

const SOCIAL_FORMATS: { id: SocialFmt; label: string; hint: string }[] = [
  { id: "story", label: "Story 9:16", hint: "Reels · TikTok · Shorts cover" },
  { id: "feed", label: "Feed 1:1", hint: "Instagram / Facebook feed" },
  { id: "pin", label: "Pin 2:3", hint: "Pinterest" },
  { id: "wide", label: "Wide 16:9", hint: "X · link preview" },
];

const SOCIAL_PLATFORMS: { key: keyof CaptionSet; label: string; note: string }[] = [
  { key: "tiktok", label: "TikTok", note: "No clickable links — put the link in bio and pin it as a comment." },
  { key: "instagram", label: "Instagram", note: "Link in bio or a story link-sticker; the caption drives the click." },
  { key: "x", label: "X", note: "The link is clickable inline — post as-is." },
  { key: "youtube", label: "YouTube", note: "Shorts: link in the description + a pinned comment." },
  { key: "pinterest", label: "Pinterest", note: "Paste the link as the Pin's destination URL." },
  { key: "facebook", label: "Facebook", note: "The link is clickable inline — post as-is." },
  { key: "whatsapp", label: "WhatsApp", note: "Best for group-chat drops — the preview unfurls the OG card." },
];

const SOCIAL_GROUPS: { theme: PromoTheme; label: string }[] = [
  { theme: "trending", label: "Trending now" },
  { theme: "tonight", label: "On tonight" },
  { theme: "premiere", label: "Premieres" },
  { theme: "renewed", label: "Renewals" },
  { theme: "classic", label: "Instant classics" },
  { theme: "streaming", label: "New on streaming" },
  { theme: "top", label: "Featured" },
];

interface SocialPost {
  id: string;
  tmdbId: number | null;
  theme: string;
  kicker: string;
  title: string;
  note: string | null;
  meta: string | null;
  rating: number | null;
  kind: "tv" | "movie";
  poster: string | null;
  path: string;
  cardQuery: string; // query for /admin/social/promo.png (minus fmt)
  slug: string | null; // show slug (TV only) → the episode-ratings card
  hasRatings: boolean; // offer the ratings card style?
  a: CaptionSet; // value captions
  b: CaptionSet; // poll / comment-bait captions
  r: CaptionSet | null; // episode-ratings captions (ratings + heatmap styles)
  sim: CaptionSet | null; // "shows like X" captions (pin style)
}

function socialCardQuery(m: {
  kicker: string;
  title: string;
  kind: string;
  rating: number | null;
  note: string | null;
  meta: string | null;
  poster: string | null;
  tmdbId: number | null;
}): string {
  const p = new URLSearchParams({ kicker: m.kicker, title: m.title, kind: m.kind });
  if (m.rating != null) p.set("rating", String(m.rating));
  if (m.note) p.set("note", m.note);
  if (m.meta) p.set("meta", m.meta);
  if (m.poster) p.set("poster", m.poster);
  if (m.tmdbId != null) p.set("tmdbId", String(m.tmdbId));
  return p.toString();
}

// A show resolved for the card routes: D1 first (with its episodes), else live from
// TMDB (buildTmdbShow) so ratings / heatmap / shows-like cards work for trending
// titles that aren't in D1 yet.
interface CardShow {
  name: string;
  tmdbId: number | null;
  posterUrl: string | null;
  imageUrl: string | null;
  rating: number | null;
  episodes: { season: number; number: number; rating: number | null }[];
}
async function resolveCardShow(c: AppContext, slug: string, tmdbId: number | null): Promise<CardShow | null> {
  const show = slug ? await getShow(c.env.DB, slug) : null;
  if (show) {
    const { results } = await c.env.DB.prepare(
      "SELECT season, number, rating FROM episodes WHERE show_id=? AND number IS NOT NULL ORDER BY season, number",
    )
      .bind(show.id)
      .all<{ season: number; number: number; rating: number | null }>();
    return { name: show.name, tmdbId: show.tmdb_id, posterUrl: show.poster_url, imageUrl: show.image_url, rating: show.rating, episodes: results };
  }
  if (tmdbId != null) {
    const data = await buildTmdbShow(c, tmdbId);
    if (data)
      return {
        name: data.show.name,
        tmdbId,
        posterUrl: data.show.poster_url,
        imageUrl: data.show.image_url,
        rating: data.show.rating,
        episodes: data.episodes
          .filter((e) => e.number != null)
          .map((e) => ({ season: e.season ?? 0, number: e.number as number, rating: e.rating ?? null })),
      };
  }
  return null;
}

function momentToPost(m: PromoMoment, base: string, hasRatings: boolean): SocialPost {
  const slug = m.path.match(/^\/show\/([^/]+)/)?.[1] ?? null;
  return {
    id: m.id,
    tmdbId: m.tmdbId,
    theme: m.theme,
    kicker: m.kicker,
    title: m.title,
    note: m.note,
    meta: m.meta,
    rating: m.rating,
    kind: m.kind,
    poster: m.posterUrl,
    path: m.path,
    cardQuery: socialCardQuery({
      kicker: m.kicker,
      title: m.title,
      kind: m.kind,
      rating: m.rating,
      note: m.note,
      meta: m.meta,
      poster: m.posterUrl,
      tmdbId: m.tmdbId,
    }),
    slug,
    hasRatings,
    a: promoCaptions(m, base),
    b: promoEngagementCaptions(m, base),
    r: hasRatings ? promoRatingsCaptions(m, base) : null,
    sim: hasRatings ? promoSimilarCaptions(m, base) : null,
  };
}

// A searched title/person/genre → a post package (synthetic "Featured" moment).
function subjectToPost(s: SearchSubject, base: string, hasRatings: boolean): SocialPost {
  const slug = slugifyName(s.label);
  const kind: "tv" | "movie" = s.kind === "movie" ? "movie" : "tv";
  let path = `/show/${slug}`;
  let kicker = "FEATURED";
  let note: string | null = "The one everyone should be watching";
  if (s.kind === "movie") {
    path = `/movie/${slug}`;
    note = "The movie everyone's talking about";
  } else if (s.kind === "person") {
    path = s.tmdbId ? `/person/${slug}-${s.tmdbId}` : "/";
    kicker = "SPOTLIGHT";
    note = "Every role, ranked by rating";
  } else if (s.kind === "genre") {
    path = `/genre/${s.genreSlug ?? slug}/shows`;
    kicker = `BEST ${s.label.toUpperCase()}`;
    note = "The best of the genre, by real ratings";
  } else if (s.kind === "year") {
    path = "/best-episodes";
    kicker = `BEST OF ${s.label}`;
    note = "The year's best, ranked";
  }
  const m: PromoMoment = {
    id: `search-${s.kind}-${s.tmdbId ?? slug}`,
    theme: "top",
    kicker,
    tag: "Featured",
    title: s.label,
    rating: null,
    note,
    meta: s.sublabel,
    kind,
    tmdbId: s.tmdbId,
    posterUrl: s.posterUrl,
    path,
  };
  return momentToPost(m, base, hasRatings);
}

// The branded moment card (resvg → PNG) in 4 aspect ratios. Stateless — every
// field rides the query string, so a card URL is one string per moment × format.
app.get("/admin/social/promo.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const q = c.req.query();
  const fmt: SocialFmt = (q.fmt as SocialFmt) in SOCIAL_DIMS ? (q.fmt as SocialFmt) : "feed";
  const [W, H] = SOCIAL_DIMS[fmt];
  const key = c.env.TMDB_API_KEY;
  const tmdbId = q.tmdbId ? Number(q.tmdbId) : null;
  let backdropUrl: string | null = null;
  if (key && tmdbId) {
    const bd = q.kind === "movie" ? await tmdbUpcomingBackdrop(key, tmdbId) : await tmdbBackdrop(key, tmdbId);
    backdropUrl = bd?.x1 ?? null;
  }
  const [posterUri, backdropUri] = await Promise.all([
    posterDataUri(hiRes(q.poster || null, "w780")),
    posterDataUri(hiRes(backdropUrl)),
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
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
});

// A season's episode-ratings card (FROM-style chips over a hero). ?slug=&season=&fmt=
app.get("/admin/social/ratings.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const slug = (c.req.query("slug") ?? "").trim();
  const tmdbId = c.req.query("tmdbId") ? Number(c.req.query("tmdbId")) : null;
  const fmtQ = c.req.query("fmt") as SocialFmt;
  const fmt: SocialFmt = fmtQ in SOCIAL_DIMS ? fmtQ : "wide";
  const [W, H] = SOCIAL_DIMS[fmt];
  const show = await resolveCardShow(c, slug, tmdbId);
  if (!show) return c.text("Show not found.", 404);
  const seasons = [...new Set(show.episodes.map((e) => e.season).filter((s) => s > 0))].sort((a, b) => a - b);
  const seasonQ = c.req.query("season");
  const season = seasonQ ? Number(seasonQ) : seasons.length ? seasons[seasons.length - 1] : 1;
  const eps = show.episodes
    .filter((e) => e.season === season)
    .sort((a, b) => a.number - b.number)
    .map((e) => ({ number: e.number, rating: e.rating }));
  if (!eps.length) return c.text(`No episodes for ${show.name} season ${season}.`, 404);
  const key = c.env.TMDB_API_KEY;
  const bd = key && show.tmdbId ? await tmdbBackdrop(key, show.tmdbId) : null;
  const [backdropUri, posterUri] = await Promise.all([
    posterDataUri(hiRes(bd?.x2 ?? bd?.x1 ?? show.imageUrl ?? null)),
    posterDataUri(hiRes(show.posterUrl ?? null, "w780")),
  ]);
  const svg = buildSeasonRatingsCard({ name: show.name, season, episodes: eps, backdropUri, posterUri }, W, H);
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, W);
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
});

// Which seasons a show has (for the ratings-card season picker).
app.get("/admin/social/seasons", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const slug = (c.req.query("slug") ?? "").trim();
  const tmdbId = c.req.query("tmdbId") ? Number(c.req.query("tmdbId")) : null;
  const show = await resolveCardShow(c, slug, tmdbId);
  if (!show) return c.json({ seasons: [], latest: null });
  const seasons = [...new Set(show.episodes.map((e) => e.season).filter((s) => s > 0))].sort((a, b) => a - b);
  return c.json({ seasons, latest: seasons.length ? seasons[seasons.length - 1] : null });
});

// "Shows like X" pin — source backdrop + a grid of the closest matches.
app.get("/admin/social/similar.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const slug = (c.req.query("slug") ?? "").trim();
  const tmdbId = c.req.query("tmdbId") ? Number(c.req.query("tmdbId")) : null;
  const fmtQ = c.req.query("fmt") as SocialFmt;
  const fmt: SocialFmt = fmtQ in SOCIAL_DIMS ? fmtQ : "pin";
  const [W, H] = SOCIAL_DIMS[fmt];
  const key = c.env.TMDB_API_KEY;
  const show = slug ? await getShow(c.env.DB, slug) : null;
  let sourceName: string;
  let srcTmdbId: number | null;
  let srcPosterSrc: string | null;
  let picks: { name: string; rating: number | null; posterSrc: string | null }[];
  if (show) {
    const sims = await similarShows(c.env.DB, show, 6);
    if (!sims.length) return c.text(`No similar shows for ${show.name}.`, 404);
    sourceName = show.name;
    srcTmdbId = show.tmdb_id;
    srcPosterSrc = (show.poster_url ?? show.image_url)?.replace("/w342/", "/w500/") ?? null;
    picks = sims.map((s) => ({ name: s.name, rating: s.rating, posterSrc: (s.poster_url ?? s.image_url)?.replace("/w342/", "/w500/") ?? null }));
  } else if (tmdbId != null && key) {
    const data = await buildTmdbShow(c, tmdbId);
    if (!data) return c.text("Show not found.", 404);
    const recs = (await tmdbRecommendations(key, "tv", tmdbId)).filter((h) => h.posterPath).slice(0, 6);
    if (!recs.length) return c.text(`No similar shows for ${data.show.name}.`, 404);
    sourceName = data.show.name;
    srcTmdbId = tmdbId;
    srcPosterSrc = (data.show.poster_url ?? data.show.image_url)?.replace("/w342/", "/w500/") ?? null;
    picks = recs.map((h) => ({ name: h.name, rating: h.rating, posterSrc: `https://image.tmdb.org/t/p/w500${h.posterPath}` }));
  } else return c.text("Show not found.", 404);
  const bd = key && srcTmdbId ? await tmdbBackdrop(key, srcTmdbId) : null;
  const [backdropUri, sourcePosterUri, ...posterUris] = await Promise.all([
    posterDataUri(bd?.x2 ?? bd?.x1 ?? null),
    posterDataUri(hiRes(srcPosterSrc, "w780")),
    ...picks.map((it) => posterDataUri(it.posterSrc)),
  ]);
  const svg = buildSimilarCard(
    { sourceTitle: sourceName, backdropUri, sourcePosterUri, items: picks.map((it, i) => ({ name: it.name, rating: it.rating, posterUri: posterUris[i] })) },
    W,
    H,
  );
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, W);
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
});

// Full-series episode heatmap.
app.get("/admin/social/heatmap.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const slug = (c.req.query("slug") ?? "").trim();
  const tmdbId = c.req.query("tmdbId") ? Number(c.req.query("tmdbId")) : null;
  const fmtQ = c.req.query("fmt") as SocialFmt;
  const fmt: SocialFmt = fmtQ in SOCIAL_DIMS ? fmtQ : "wide";
  const [W, H] = SOCIAL_DIMS[fmt];
  const show = await resolveCardShow(c, slug, tmdbId);
  if (!show) return c.text("Show not found.", 404);
  const eps = show.episodes.filter((e) => e.season > 0);
  if (!eps.length) return c.text(`No episodes for ${show.name}.`, 404);
  const key = c.env.TMDB_API_KEY;
  const bd = key && show.tmdbId ? await tmdbBackdrop(key, show.tmdbId) : null;
  const backdropUri = await posterDataUri(hiRes(bd?.x2 ?? bd?.x1 ?? show.imageUrl ?? null));
  const svg = buildHeatmapCard({ name: show.name, backdropUri, episodes: eps }, W, H);
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, W);
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
});

// Head-to-head VS card. ?slug=A&vs=B&fmt=
app.get("/admin/social/vs.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const fmtQ = c.req.query("fmt") as SocialFmt;
  const fmt: SocialFmt = fmtQ in SOCIAL_DIMS ? fmtQ : "feed";
  const [W, H] = SOCIAL_DIMS[fmt];
  const key = c.env.TMDB_API_KEY;
  const side = async (slug: string, tid: number | null) => {
    const s = await resolveCardShow(c, slug, tid);
    if (!s) return null;
    const bd = key && s.tmdbId ? await tmdbBackdrop(key, s.tmdbId) : null;
    const [backdropUri, posterUri] = await Promise.all([
      posterDataUri(hiRes(bd?.x2 ?? bd?.x1 ?? s.imageUrl ?? null)),
      posterDataUri(hiRes(s.posterUrl ?? s.imageUrl ?? null, "w780")),
    ]);
    return { name: s.name, rating: s.rating, backdropUri, posterUri };
  };
  const [A, B] = await Promise.all([
    side((c.req.query("slug") ?? "").trim(), c.req.query("tmdbId") ? Number(c.req.query("tmdbId")) : null),
    side((c.req.query("vs") ?? "").trim(), c.req.query("vsTmdbId") ? Number(c.req.query("vsTmdbId")) : null),
  ]);
  if (!A || !B) return c.text("Need two shows.", 404);
  const svg = buildVersusCard(A, B, W, H);
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, W);
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" } });
});

// Typeahead for the composer search box.
app.post("/admin/social/search", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  c.header("Cache-Control", "private, no-store");
  const b = (await c.req.json().catch(() => null)) as { q?: string } | null;
  const q = (b?.q ?? "").trim();
  if (q.length < 2) return c.json({ subjects: [] });
  return c.json({ subjects: await resolveSubjects(c, q) });
});

// Build the full post package for a searched subject.
app.post("/admin/social/package", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  c.header("Cache-Control", "private, no-store");
  const s = (await c.req.json().catch(() => null)) as SearchSubject | null;
  if (!s?.label) return c.json({ post: null }, 400);
  return c.json({ post: subjectToPost(s, promoBase(c), s.kind === "tv" && s.tmdbId != null) });
});

app.get("/admin/social", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const base = promoBase(c);
  const posts = (await getPromoMoments(c)).map((m) => momentToPost(m, base, m.kind === "tv" && m.tmdbId != null));
  const first = posts[0] ?? null;
  const firstImg = first ? `/admin/social/promo.png?${first.cardQuery}&fmt=story` : "";
  const byId: Record<string, SocialPost> = {};
  for (const p of posts) byId[p.id] = p;
  const jsonData = JSON.stringify(byId).replace(/</g, "\\u003c");

  return c.html(
    <Layout c={c} title="Social — admin" noindex bare scripts={["/js/social.js"]}>
      <AdminShell page="social" wide lead="One place to post — images, video &amp; links, tuned for every platform.">
        <div class="soc" data-first={first?.id ?? ""}>
          <aside class="soc-rail">
            <div class="soc-search">
              <input
                id="soc-q"
                class="soc-q"
                type="search"
                placeholder="Search a show, movie or person…"
                autocomplete="off"
              />
              <div id="soc-results" class="soc-results" hidden></div>
            </div>
            <div class="soc-feed">
              {SOCIAL_GROUPS.map((g) => {
                const items = posts.filter((p) => p.theme === g.theme);
                if (!items.length) return null;
                return (
                  <div class="soc-group">
                    <p class="soc-group-h">{g.label}</p>
                    {items.map((p) => (
                      <button type="button" class={`soc-item${p.id === first?.id ? " on" : ""}`} data-id={p.id}>
                        {p.poster ? (
                          <img class="soc-item-th" src={p.poster} alt="" loading="lazy" />
                        ) : (
                          <span class="soc-item-th soc-item-blank" aria-hidden="true"></span>
                        )}
                        <span class="soc-item-main">
                          <span class="soc-item-title">{p.title}</span>
                          <span class="soc-item-kick">{p.kicker}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
              {posts.length === 0 ? (
                <p class="soc-empty muted">
                  No live moments yet — the crons fill this (trending, tonight, renewals…). Search above to post any
                  title.
                </p>
              ) : null}
            </div>
          </aside>

          <section class="soc-stage">
            <div class="soc-style" role="tablist" aria-label="Card style">
              <button type="button" class="soc-style-b on" data-style="poster">🖼 Poster</button>
              <button type="button" class="soc-style-b" data-style="ratings" hidden>📊 Season ratings</button>
              <button type="button" class="soc-style-b" data-style="heatmap" hidden>🗓️ Series heatmap</button>
              <button type="button" class="soc-style-b" data-style="pin" hidden>🍿 Shows like</button>
              <button type="button" class="soc-style-b" data-style="vs" hidden>⚔️ Head-to-head</button>
            </div>
            <div class="soc-vs" id="soc-vs" hidden>
              <span class="soc-vs-lbl">vs</span>
              <input
                id="soc-vs-q"
                class="soc-vs-q"
                type="search"
                placeholder="pick an opponent show…"
                autocomplete="off"
              />
              <div id="soc-vs-results" class="soc-results soc-vs-results" hidden></div>
            </div>
            <div class="soc-season" id="soc-season-wrap" hidden>
              <label class="soc-season-lbl" for="soc-season">Season</label>
              <select id="soc-season" class="soc-season-sel"></select>
            </div>
            <div class="soc-fmt" role="tablist" aria-label="Card format">
              {SOCIAL_FORMATS.map((f, i) => (
                <button type="button" class={`soc-fmt-b${i === 0 ? " on" : ""}`} data-fmt={f.id} title={f.hint}>
                  {f.label}
                </button>
              ))}
            </div>
            <div class="soc-canvas" data-fmt="story">
              <img id="soc-img" class="soc-img" src={firstImg} alt="Post preview" />
              <video id="soc-vid" class="soc-vid" playsinline loop controls hidden></video>
            </div>
            <div class="soc-stage-foot">
              <a id="soc-dl" class="admin-btn" href={firstImg} download="tvnightly-post.png">
                ↓ Download PNG
              </a>
              <button type="button" id="soc-mp4" class="admin-btn soc-mp4">
                🎬 Make a video
              </button>
              <a id="soc-vid-dl" class="admin-btn soc-ghost" hidden download="tvnightly-post.mp4">
                ↓ Save video
              </a>
              <a id="soc-open" class="soc-open" href={first?.path ?? "/"} target="_blank" rel="noopener">
                Open page ↗
              </a>
            </div>
            <p class="soc-vid-note muted">
              <span id="soc-vid-status">
                Turns the card above into a ~10s beat-synced clip (audio + motion) — the video TikTok &amp; YouTube
                Shorts need.
              </span>{" "}
              <a href="/admin/shorts">Top-10 countdown video ↗</a>
            </p>
          </section>

          <section class="soc-caps">
            <div class="soc-plat" role="tablist" aria-label="Platform">
              {SOCIAL_PLATFORMS.map((pl, i) => (
                <button type="button" class={`soc-plat-b${i === 0 ? " on" : ""}`} data-plat={pl.key} data-note={pl.note}>
                  {pl.label}
                </button>
              ))}
            </div>
            <p id="soc-plat-note" class="soc-plat-note muted">{SOCIAL_PLATFORMS[0].note}</p>

            <div class="soc-cap">
              <div class="soc-cap-h">
                <span class="soc-cap-tag">A · value</span>
                <button type="button" class="admin-btn soc-copy" data-copy="a">
                  Copy
                </button>
              </div>
              <textarea id="soc-cap-a" class="soc-cap-t" readonly rows={5}></textarea>
            </div>
            <div class="soc-cap">
              <div class="soc-cap-h">
                <span class="soc-cap-tag">B · poll / comment-bait</span>
                <button type="button" class="admin-btn soc-copy" data-copy="b">
                  Copy
                </button>
              </div>
              <textarea id="soc-cap-b" class="soc-cap-t" readonly rows={5}></textarea>
            </div>

            <div class="soc-linkrow">
              <input id="soc-link" class="soc-link-i" readonly aria-label="Share link" />
              <button type="button" class="admin-btn soc-copy" data-copy="link">
                Copy link
              </button>
            </div>

            <div class="soc-batch">
              <p class="soc-batch-h muted">This week — all {posts.length} moments, this platform</p>
              <div class="soc-batch-row">
                <button type="button" class="admin-btn soc-ghost" data-batch="a">
                  Copy all · value
                </button>
                <button type="button" class="admin-btn soc-ghost" data-batch="b">
                  Copy all · poll
                </button>
              </div>
            </div>
          </section>
        </div>
        <script id="soc-data" type="application/json">
          {raw(jsonData)}
        </script>
      </AdminShell>
    </Layout>,
  );
});

// ---- insights: which short links actually drive clicks (last 30 days) ----
app.get("/admin/studio/insights", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;

  // The link_clicks table arrives with migration 0025; until it's applied the
  // queries throw — swallow that into an empty state rather than a 500.
  const rows = async <T,>(sql: string): Promise<T[]> => {
    try {
      return (await c.env.DB.prepare(sql).all<T>()).results;
    } catch {
      return [];
    }
  };

  const one = async <T,>(sql: string, fb: T): Promise<T> => (await rows<T>(sql))[0] ?? fb;

  // base totals work on any schema; the human/bot split needs migration 0027.
  // The WHERE is a no-op on the result (every window is <=30d) but lets the
  // idx_link_clicks_created index bound the scan to the last 30 days instead of
  // full-scanning link_clicks, so Insights stays cheap as the table grows.
  const base = await one<{ d30: number; d7: number; d1: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-2592000 THEN 1 ELSE 0 END),0) AS d30,
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-604800  THEN 1 ELSE 0 END),0) AS d7,
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-86400   THEN 1 ELSE 0 END),0) AS d1
     FROM link_clicks WHERE created_at > unixepoch()-2592000`,
    { d30: 0, d7: 0, d1: 0 },
  );
  const split = await one<{ h30: number; h7: number; h1: number; b30: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-2592000 AND is_bot=0 THEN 1 ELSE 0 END),0) AS h30,
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-604800  AND is_bot=0 THEN 1 ELSE 0 END),0) AS h7,
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-86400   AND is_bot=0 THEN 1 ELSE 0 END),0) AS h1,
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-2592000 AND is_bot=1 THEN 1 ELSE 0 END),0) AS b30
     FROM link_clicks WHERE created_at > unixepoch()-2592000`,
    { h30: 0, h7: 0, h1: 0, b30: 0 },
  );
  // "graded" = migration 0027 is live and accounts for every logged click.
  const graded = base.d30 > 0 && split.h30 + split.b30 === base.d30;
  const totals = graded ? { d30: split.h30, d7: split.h7, d1: split.h1 } : base;
  const botHits = split.b30;
  const humanFilter = graded ? "is_bot=0 AND " : "";

  // browser-confirmed renders (migration 0027) — the real-human funnel step.
  const renders = await one<{ r30: number; r7: number; r1: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-2592000 THEN 1 ELSE 0 END),0) AS r30,
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-604800  THEN 1 ELSE 0 END),0) AS r7,
       COALESCE(SUM(CASE WHEN created_at > unixepoch()-86400   THEN 1 ELSE 0 END),0) AS r1
     FROM render_events WHERE is_bot=0 AND created_at > unixepoch()-2592000`,
    { r30: 0, r7: 0, r1: 0 },
  );
  const rendersBySource = await rows<{ source: string; n: number }>(
    `SELECT source, COUNT(*) AS n FROM render_events
     WHERE is_bot=0 AND created_at > unixepoch()-2592000 GROUP BY source ORDER BY n DESC`,
  );

  const bySource = await rows<{ source: string; n: number }>(
    `SELECT source, COUNT(*) AS n FROM link_clicks
     WHERE ${humanFilter}created_at > unixepoch()-2592000 GROUP BY source ORDER BY n DESC`,
  );
  const byCampaign = await rows<{ campaign: string; n: number }>(
    `SELECT campaign, COUNT(*) AS n FROM link_clicks
     WHERE ${humanFilter}created_at > unixepoch()-2592000 GROUP BY campaign ORDER BY n DESC LIMIT 25`,
  );
  const byPath = await rows<{ path: string; n: number }>(
    `SELECT path, COUNT(*) AS n FROM link_clicks
     WHERE ${humanFilter}created_at > unixepoch()-2592000 GROUP BY path ORDER BY n DESC LIMIT 25`,
  );
  const byCountry = await rows<{ country: string; n: number }>(
    `SELECT country, COUNT(*) AS n FROM link_clicks
     WHERE is_bot=0 AND country IS NOT NULL AND country != '' AND created_at > unixepoch()-2592000
     GROUP BY country ORDER BY n DESC LIMIT 12`,
  );
  const byReferer = await rows<{ referer: string; n: number }>(
    `SELECT referer, COUNT(*) AS n FROM link_clicks
     WHERE is_bot=0 AND referer IS NOT NULL AND referer != '' AND created_at > unixepoch()-2592000
     GROUP BY referer ORDER BY n DESC LIMIT 12`,
  );

  // Attributed sign-ups — the money metric: the tvn_ref cookie set on a /r/ click
  // is stamped onto the subscription. Arrives with migration 0026 (ref_* columns).
  const subsTotal =
    (
      await rows<{ n: number }>(
        `SELECT COUNT(*) AS n FROM subscriptions
         WHERE ref_campaign IS NOT NULL AND created_at > unixepoch()-2592000`,
      )
    )[0]?.n ?? 0;
  const subsBySource = await rows<{ source: string; n: number }>(
    `SELECT ref_source AS source, COUNT(*) AS n FROM subscriptions
     WHERE ref_source IS NOT NULL AND created_at > unixepoch()-2592000
     GROUP BY ref_source ORDER BY n DESC`,
  );
  const subsByCampaign = await rows<{ campaign: string; n: number }>(
    `SELECT ref_campaign AS campaign, COUNT(*) AS n FROM subscriptions
     WHERE ref_campaign IS NOT NULL AND created_at > unixepoch()-2592000
     GROUP BY ref_campaign ORDER BY n DESC LIMIT 25`,
  );

  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) + "%" : "—");
  const host = (r: string) => {
    try {
      return new URL(r).hostname.replace(/^www\./, "");
    } catch {
      return r;
    }
  };

  return c.html(
    <Layout c={c} title="Insights — admin" noindex>
      <AdminShell page="insights" lead="Real humans vs bots — which posts actually drive people.">
        <header class="admin-page-head">
          <h1 class="admin-page-title">
            Real clicks <span class="admin-count">{totals.d30}</span>
          </h1>
          <p class="admin-page-lead muted">
            {graded ? (
              <>
                Clicks on your <code>/r/</code> short links with the automated traffic (URL-safety scanners,
                proxies, headless agents) filtered out — last 30 days. <strong>{botHits}</strong> bot{" "}
                {botHits === 1 ? "hit was" : "hits were"} excluded. A <em>render</em> means a real browser
                actually painted the page ~1s after landing — the strongest human signal there is.
              </>
            ) : (
              <>
                Clicks on your <code>/r/</code> short links, last 30 days. Apply migration 0027
                (<code>npm run db:migrate:remote</code>) to split real humans from bots and confirm renders.
              </>
            )}
          </p>
        </header>

        <div class="admin-stats">
          <div class="admin-stat">
            <span class="admin-stat-n">{totals.d30}</span>
            <span class="admin-stat-l">{graded ? "Real clicks · 30d" : "Clicks · 30d"}</span>
          </div>
          <div class="admin-stat">
            <span class="admin-stat-n">{renders.r30}</span>
            <span class="admin-stat-l">Rendered · 30d</span>
          </div>
          <div class="admin-stat is-accent">
            <span class="admin-stat-n">{subsTotal}</span>
            <span class="admin-stat-l">Sign-ups · 30d</span>
          </div>
          <div class="admin-stat is-muted">
            <span class="admin-stat-n">{graded ? botHits : "—"}</span>
            <span class="admin-stat-l">Bot hits · 30d</span>
          </div>
        </div>

        {totals.d30 === 0 && subsTotal === 0 && renders.r30 === 0 ? (
          <div class="admin-empty">
            <p class="admin-empty-title">No clicks logged yet</p>
            <p class="admin-empty-lead muted">
              Apply the migrations (<code>npm run db:migrate:remote</code>) if you haven't, then post a
              short link. Clicks on <code>/r/&lt;platform&gt;/…</code> show up here within seconds.
            </p>
          </div>
        ) : (
          <>
            <header class="admin-page-head">
              <h2 class="admin-page-title">The funnel</h2>
              <p class="admin-page-lead muted">
                Click → render → sign-up. Renders and sign-ups are near-impossible to fake, so the drop-off
                from clicks tells you how many "clicks" were actually people.
              </p>
            </header>
            <div class="admin-stats">
              <div class="admin-stat">
                <span class="admin-stat-n">{totals.d30}</span>
                <span class="admin-stat-l">{graded ? "Real clicks" : "Clicks"} · 30d</span>
              </div>
              <div class="admin-stat">
                <span class="admin-stat-n">{renders.r30}</span>
                <span class="admin-stat-l">Rendered · {pct(renders.r30, totals.d30)} of clicks</span>
              </div>
              <div class="admin-stat is-accent">
                <span class="admin-stat-n">{subsTotal}</span>
                <span class="admin-stat-l">
                  Signed up · {pct(subsTotal, renders.r30 || totals.d30)} of {renders.r30 ? "renders" : "clicks"}
                </span>
              </div>
            </div>
            <div class="admin-stats">
              <div class="admin-stat is-muted">
                <span class="admin-stat-n">{totals.d7}</span>
                <span class="admin-stat-l">{graded ? "Real clicks" : "Clicks"} · 7d</span>
              </div>
              <div class="admin-stat is-muted">
                <span class="admin-stat-n">{totals.d1}</span>
                <span class="admin-stat-l">{graded ? "Real clicks" : "Clicks"} · 24h</span>
              </div>
              <div class="admin-stat is-muted">
                <span class="admin-stat-n">{renders.r1}</span>
                <span class="admin-stat-l">Rendered · 24h</span>
              </div>
            </div>

            <header class="admin-page-head">
              <h2 class="admin-page-title">By platform</h2>
              <p class="admin-page-lead muted">{graded ? "Real clicks" : "Clicks"} per platform, and the renders each confirmed.</p>
            </header>
            <div class="admin-stats">
              {bySource.map((s) => {
                const rr = rendersBySource.find((r) => r.source === s.source);
                return (
                  <div class="admin-stat">
                    <span class="admin-stat-n">{s.n}</span>
                    <span class="admin-stat-l">
                      {cap(s.source)}
                      {rr ? ` · ${rr.n} rendered` : ""}
                    </span>
                  </div>
                );
              })}
            </div>

            {byCountry.length ? (
              <>
                <header class="admin-page-head">
                  <h2 class="admin-page-title">By country</h2>
                  <p class="admin-page-lead muted">Where your real visitors are — a spread of countries is a good human signal.</p>
                </header>
                <div class="admin-stats">
                  {byCountry.map((r) => (
                    <div class="admin-stat">
                      <span class="admin-stat-n">{r.n}</span>
                      <span class="admin-stat-l">{r.country.toUpperCase()}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {byReferer.length ? (
              <>
                <header class="admin-page-head">
                  <h2 class="admin-page-title">Top referrers</h2>
                  <p class="admin-page-lead muted">The site each real click came from — proof the platform actually forwarded a person.</p>
                </header>
                <ul class="admin-feed">
                  {byReferer.map((r) => (
                    <li class="admin-card">
                      <div class="admin-card-body">
                        <div class="admin-card-meta">
                          <span class="admin-card-path">{host(r.referer)}</span>
                          <span class="admin-count">{r.n}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {subsTotal > 0 ? (
              <>
                <header class="admin-page-head">
                  <h2 class="admin-page-title">⭐ Sign-ups by post</h2>
                  <p class="admin-page-lead muted">
                    Emails attributed to the short link that referred them — your true conversion metric, worth
                    more than any click count.
                  </p>
                </header>
                <div class="admin-stats">
                  {subsBySource.map((s) => (
                    <div class="admin-stat">
                      <span class="admin-stat-n">{s.n}</span>
                      <span class="admin-stat-l">{cap(s.source)}</span>
                    </div>
                  ))}
                </div>
                <ul class="admin-feed">
                  {subsByCampaign.map((r) => (
                    <li class="admin-card">
                      <div class="admin-card-body">
                        <div class="admin-card-meta">
                          <span class="admin-card-path">{r.campaign}</span>
                          <span class="admin-count">{r.n}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <header class="admin-page-head">
              <h2 class="admin-page-title">Top campaigns</h2>
              <p class="admin-page-lead muted">The moment/page each post promoted — your best-performing angles.</p>
            </header>
            <ul class="admin-feed">
              {byCampaign.map((r) => (
                <li class="admin-card">
                  <div class="admin-card-body">
                    <div class="admin-card-meta">
                      <span class="admin-card-path">{r.campaign}</span>
                      <span class="admin-count">{r.n}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <header class="admin-page-head">
              <h2 class="admin-page-title">Top pages</h2>
              <p class="admin-page-lead muted">Where the clicks landed — the page each link sent people to.</p>
            </header>
            <ul class="admin-feed">
              {byPath.map((r) => (
                <li class="admin-card">
                  <div class="admin-card-body">
                    <div class="admin-card-meta">
                      <a class="admin-card-path" href={r.path}>
                        {r.path}
                      </a>
                      <span class="admin-count">{r.n}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </AdminShell>
    </Layout>,
  );
});

app.get("/admin/shorts/search", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  shortsNoStore(c);
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json({ subjects: [] });
  return c.json({ subjects: await resolveSubjects(c, q) });
});

app.post("/admin/shorts/angles", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  shortsNoStore(c);
  const subject = (await c.req.json().catch(() => null)) as SearchSubject | null;
  if (!subject) return c.json({ angles: [] }, 400);
  return c.json({ angles: buildAngles(subject) });
});

app.post("/admin/shorts/rank", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  shortsNoStore(c);
  const body = (await c.req.json().catch(() => null)) as { query?: AngleQuery } | null;
  if (!body?.query) return c.json({ entries: [] }, 400);
  return c.json({ entries: await runAngleQuery(c, body.query) });
});

app.post("/admin/shorts/captions", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  shortsNoStore(c);
  const b = (await c.req.json().catch(() => null)) as
    | { title?: string; query?: string; kind?: "tv" | "movie"; ctaUrl?: string; angleType?: AngleType; subjectLabel?: string }
    | null;
  if (!b?.query) return c.json({ captions: null }, 400);
  const kind = b.kind ?? "movie";
  return c.json({
    captions: shorts10Captions({
      c,
      title: b.title ?? b.query,
      query: b.query,
      kind,
      ctaUrl: b.ctaUrl ?? "",
      landingPath: b.angleType ? shortsLandingPath({ angleType: b.angleType, kind, subjectLabel: b.subjectLabel ?? null }) : null,
    }),
  });
});

app.post("/admin/shorts/export", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  shortsNoStore(c);
  const project = (await c.req.json().catch(() => null)) as ShortProject | null;
  if (!project?.entries?.length) return c.json({ error: "empty project" }, 400);
  return c.json(shorts10Spec(c, project));
});

app.get("/admin/shorts", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  shortsNoStore(c);
  return c.html(
    <Layout c={c} title="Shorts — admin" noindex bare scripts={["/js/shorts.js"]}>
      <AdminShell page="social" wide lead="Make a Top-10 video — part of your Social hub">
        <div class="shorts-app">
          <div class="admin-page-head">
            <h1 class="admin-page-title">Shorts generator</h1>
            <p class="admin-page-lead">
              Search any title, person, genre or year, pick a Top&nbsp;10 angle, curate the ranked list, then export a
              ready-to-render Short with copy-paste captions for every platform.
            </p>
          </div>

          <ol class="shorts-steps" id="shorts-steps" aria-label="Progress">
            <li class="shorts-step on" data-step="search"><span class="shorts-step-n">1</span> Search</li>
            <li class="shorts-step" data-step="angles"><span class="shorts-step-n">2</span> Angle</li>
            <li class="shorts-step" data-step="curate"><span class="shorts-step-n">3</span> Curate</li>
            <li class="shorts-step" data-step="export"><span class="shorts-step-n">4</span> Export</li>
          </ol>

          <button type="button" class="shorts-chip" id="shorts-chip" hidden></button>

          {/* Stage 1 — search */}
          <section class="shorts-stage" data-stage="search">
            <input
              class="shorts-search"
              id="shorts-q"
              type="search"
              autocomplete="off"
              spellcheck={false}
              placeholder="Try: Matt Damon · Breaking Bad · Horror · 2021 · Inception…"
            />
            <div class="shorts-subjects" id="shorts-subjects">
              <p class="shorts-empty">Start typing to find a subject to rank.</p>
            </div>
          </section>

          {/* Stage 2 — angles */}
          <section class="shorts-stage" data-stage="angles" hidden>
            <div class="shorts-head">
              <h2 class="shorts-h2">Pick an angle</h2>
              <span class="shorts-count" id="shorts-angle-count"></span>
            </div>
            <div class="shorts-angles" id="shorts-angles"></div>
          </section>

          {/* Stage 3 — curate */}
          <section class="shorts-stage" data-stage="curate" hidden>
            <div class="shorts-curate">
              <div class="shorts-col-main">
                <div class="shorts-head">
                  <h2 class="shorts-h2" id="shorts-curate-title">Curate the ranked 10</h2>
                  <span class="shorts-count">Drag to reorder · #1 reveals last</span>
                </div>
                <ol class="shorts-grid" id="shorts-grid"></ol>
              </div>
              <aside class="shorts-col-side">
                <div class="shorts-panel">
                  <h3 class="shorts-h3">Hook &amp; copy</h3>
                  <label class="shorts-field"><span>Intro line 1</span><input id="sf-l1" class="shorts-input" /></label>
                  <label class="shorts-field"><span>Intro line 2</span><input id="sf-l2" class="shorts-input" /></label>
                  <label class="shorts-field"><span>Intro line 3 (hook)</span><input id="sf-l3" class="shorts-input" /></label>
                  <label class="shorts-field"><span>CTA reason</span><input id="sf-reason" class="shorts-input" /></label>
                  <label class="shorts-field"><span>CTA link</span><input id="sf-url" class="shorts-input" value="tvnightly.com" /></label>
                  <label class="shorts-field"><span>CTA comment</span><input id="sf-comment" class="shorts-input" value="COMMENT YOUR #1 BELOW" /></label>
                  <label class="shorts-field"><span>Accent (default = auto per category)</span><input id="sf-accent" class="shorts-input" value="0x39d98a" /></label>
                </div>
                <div class="shorts-panel">
                  <h3 class="shorts-h3">Preview</h3>
                  <div class="shorts-preview" id="shorts-preview"></div>
                </div>
                <button type="button" class="shorts-btn shorts-btn--primary" id="shorts-to-export">Captions &amp; export →</button>
              </aside>
            </div>
          </section>

          {/* Stage 4 — export */}
          <section class="shorts-stage" data-stage="export" hidden>
            <div class="shorts-export">
              <div class="shorts-col-main">
                <div class="shorts-head">
                  <h2 class="shorts-h2">Captions, hooks &amp; tags</h2>
                  <button type="button" class="shorts-btn" id="shorts-copy-all">Copy all</button>
                </div>
                <p class="shorts-note">
                  Shorts/TikTok can’t carry clickable links — paste these in the description, and drop the link as a
                  <strong> pinned comment</strong>.
                </p>
                <div class="shorts-caps" id="shorts-caps">
                  {CAPTION_PLATFORMS.map((pl) => (
                    <div class="shorts-cap" data-key={pl.key}>
                      <div class="shorts-cap-head">
                        <span class="shorts-cap-label">{pl.label}</span>
                        <button type="button" class="shorts-copy" data-copy={pl.key}>Copy</button>
                      </div>
                      <textarea class="shorts-cap-text" data-cap={pl.key} readonly rows={4}></textarea>
                    </div>
                  ))}
                </div>
              </div>
              <aside class="shorts-col-side">
                <div class="shorts-panel">
                  <h3 class="shorts-h3">Render</h3>
                  <p class="shorts-summary" id="shorts-summary"></p>
                  <label class="shorts-field"><span>Music (blank = auto per category)</span><input id="sf-music" class="shorts-input" placeholder="blank = mood track · or paste a .mp3 URL" /></label>
                  <div class="shorts-toggles">
                    <label class="shorts-toggle"><input type="checkbox" id="sf-depth" checked /> DepthFlow 2.5D</label>
                    <label class="shorts-toggle"><input type="checkbox" id="sf-grade" checked /> Film grade</label>
                    <label class="shorts-toggle"><input type="checkbox" id="sf-ramp" checked /> Speed-ramp #1</label>
                  </div>
                  <button type="button" class="shorts-btn shorts-btn--primary shorts-export-btn" id="shorts-export">⬇ Export &amp; render video</button>
                  <div class="shorts-runbox" id="shorts-runbox" hidden>
                    <span class="shorts-runbox-label">Status</span>
                    <code id="shorts-runcmd"></code>
                    <button type="button" class="shorts-copy" id="shorts-copy-run">Copy</button>
                  </div>
                  <p class="shorts-seam">
                    Renders the full-quality video on your Mac and saves it to <code>tools/countdown/exports/</code> — no
                    terminal, no copy-paste. The auto-render helper starts with <code>npm run dev:all</code> (or once via{" "}
                    <code>npm run render</code>).
                  </p>
                </div>
              </aside>
            </div>
          </section>
        </div>
      </AdminShell>
    </Layout>,
  );
});

export default app;
