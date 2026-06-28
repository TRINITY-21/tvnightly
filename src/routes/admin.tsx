import { Hono } from "hono";
import { AdminShell } from "../components/admin-shell";
import { Layout } from "../components/Layout";
import { EPISODE_GUIDE_BY_SHOW } from "../lib/episode-guides";
import { pad2 } from "../lib/format";
import { buildCaptions, getPromoMoments, promoBase, promoCaptions, type PromoMoment, type PromoTheme } from "../lib/promo";
import { getShow, similarMovies, similarShows } from "../lib/queries";
import { loadOgFonts, svgToPng } from "../lib/render";
import { archivoFontCss, posterDataUri } from "../lib/signal";
import {
    buildLikedCard,
    buildListCard,
    buildPromoCard,
    buildRatingsCard,
    buildShowcaseCard,
    buildSimilarPin,
    buildStatusCard,
    buildVsCard,
    toCardEntry,
    VsSide,
    type CardEntry,
    type RatingsEp,
} from "../lib/social";
import {
    bestEpisodesHook,
    episodeGuideHook,
    gemsHook,
    likedHook,
    peakCode,
    ratingsHook,
    showcaseHook,
    similarHook,
    statusHook,
    topHook,
    vsHook,
} from "../lib/studio-hooks";
import {
  buildAngles,
  resolveSubjects,
  runAngleQuery,
  shorts10Captions,
  shorts10Spec,
  type AngleQuery,
  type SearchSubject,
  type ShortProject,
} from "../lib/shorts";
import { tmdbBackdrop, tmdbLogo, tmdbMovieBackdrop, tmdbUpcomingBackdrop } from "../lib/tmdb";
import { resolveShow } from "../lib/tmdb-show";
import { AppContext, HonoEnv, MovieRow, ShowRow } from "../types";

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

const app = new Hono<HonoEnv>();

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
app.get("/admin", (c) => c.redirect("/admin/studio", 302));

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
  group: "Daily moments" | "Show posts" | "Viral formats" | "Feed & pins";
  engine: "promo" | "classic" | "ratings" | "pin" | "showcase";
  themes?: PromoTheme[];
  needs?: "title" | "genre" | "vs";
  platforms: string[];
  blurb?: string;
};
const STUDIO_LEGACY_CAT: Record<string, string> = {
  taste: "trending",
  "watch-order": "top",
  classic: "classic",
};
const STUDIO_CATS: StudioCat[] = [
  {
    id: "trending",
    label: "Trending now",
    group: "Daily moments",
    engine: "promo",
    themes: ["trending"],
    platforms: ["Shorts", "TikTok", "Reels"],
    blurb: "Hot titles this week — filled automatically from TMDB.",
  },
  {
    id: "tonight",
    label: "On tonight",
    group: "Daily moments",
    engine: "promo",
    themes: ["tonight"],
    platforms: ["Shorts", "TikTok", "WhatsApp"],
    blurb: "What's airing tonight — live schedule data.",
  },
  {
    id: "streaming",
    label: "Now streaming",
    group: "Daily moments",
    engine: "promo",
    themes: ["streaming"],
    platforms: ["Reels", "X", "WhatsApp"],
    blurb: "New arrivals on Netflix, Max, Disney+, and more.",
  },
  {
    id: "renewed",
    label: "Renewals & premieres",
    group: "Daily moments",
    engine: "promo",
    themes: ["renewed", "premiere"],
    platforms: ["X", "Reels", "WhatsApp"],
    blurb: "Renewal wins and premiere dates from the hourly sync.",
  },
  {
    id: "classic",
    label: "Must-watch episode",
    group: "Daily moments",
    engine: "promo",
    themes: ["classic"],
    platforms: ["Shorts", "TikTok"],
    blurb: "Episodes that just crossed must-watch.",
  },
  {
    id: "liked",
    label: "If you liked X",
    group: "Show posts",
    engine: "classic",
    needs: "title",
    platforms: ["Shorts", "TikTok", "Reels"],
    blurb: "3 similar picks — links to the show's similar page.",
  },
  {
    id: "best-eps",
    label: "Episode rankings",
    group: "Show posts",
    engine: "classic",
    needs: "title",
    platforms: ["Shorts", "TikTok", "X"],
    blurb: "Top 5 episodes — the viral ranking hook.",
  },
  {
    id: "ratings",
    label: "Ratings graph",
    group: "Show posts",
    engine: "ratings",
    needs: "title",
    platforms: ["Shorts", "TikTok", "X"],
    blurb: "Season heatmap — great for controversy posts.",
  },
  {
    id: "status",
    label: "Renewed?",
    group: "Show posts",
    engine: "classic",
    needs: "title",
    platforms: ["X", "Reels", "WhatsApp"],
    blurb: "Renewal status — links to the release-date page.",
  },
  {
    id: "vs",
    label: "X vs Y",
    group: "Viral formats",
    engine: "classic",
    needs: "vs",
    platforms: ["Shorts", "TikTok", "X"],
    blurb: "Head-to-head — two titles, episode ratings decide.",
  },
  {
    id: "top",
    label: "Top 5 by genre",
    group: "Viral formats",
    engine: "classic",
    needs: "genre",
    platforms: ["Shorts", "Pinterest"],
    blurb: "Genre leaderboard ranked by real viewer ratings.",
  },
  {
    id: "gems",
    label: "Hidden gems",
    group: "Viral formats",
    engine: "classic",
    platforms: ["Shorts", "TikTok"],
    blurb: "Highly rated, under-watched — auto-picked from the catalog.",
  },
  {
    id: "showcase",
    label: "Dual showcase",
    group: "Feed & pins",
    engine: "showcase",
    needs: "vs",
    platforms: ["Instagram feed"],
    blurb: "4:5 dual-poster card — pick two shows and optional headline.",
  },
  {
    id: "pin",
    label: "Pinterest pin",
    group: "Feed & pins",
    engine: "pin",
    needs: "title",
    platforms: ["Pinterest"],
    blurb: "2:3 pin with ranked shows like your pick.",
  },
];
// the cinematic control surface for the in-browser video renderer. Each id maps
// 1:1 to a branch in public/js/studio.js (camera()/lightingFilter()/fx set).
type CamMove = { id: string; label: string; glyph: string; hint: string };
const CAMERA_MOVES: CamMove[] = [
  { id: "zoom-in", label: "Zoom In", glyph: "⊕", hint: "Slow push toward the subject" },
  { id: "zoom-out", label: "Zoom Out", glyph: "⊖", hint: "Pull back to reveal the scene" },
  { id: "pan-left", label: "Pan Left", glyph: "←", hint: "Sweep across to the left" },
  { id: "pan-right", label: "Pan Right", glyph: "→", hint: "Sweep across to the right" },
  { id: "tilt-up", label: "Tilt Up", glyph: "↑", hint: "Rise upward" },
  { id: "tilt-down", label: "Tilt Down", glyph: "↓", hint: "Descend downward" },
  { id: "orbit", label: "Orbit", glyph: "⟳", hint: "Arc around the subject" },
  { id: "crane", label: "Crane", glyph: "↥", hint: "Lift and reveal" },
  { id: "drone", label: "Drone", glyph: "✈", hint: "Aerial fly-over" },
  { id: "fpv", label: "FPV", glyph: "🚀", hint: "Fast first-person rush" },
  { id: "dolly-fwd", label: "Dolly In", glyph: "⇥", hint: "Track inward" },
  { id: "dolly-back", label: "Dolly Out", glyph: "⇤", hint: "Track outward" },
  { id: "handheld", label: "Handheld", glyph: "✋", hint: "Organic micro-shake" },
  { id: "steadicam", label: "Steadicam", glyph: "✥", hint: "Smooth floating glide" },
  { id: "static", label: "Static", glyph: "▢", hint: "Locked-off frame" },
];
type Choice = { id: string; label: string; glyph: string };
const LIGHTING: Choice[] = [
  { id: "golden-hour", label: "Golden Hour", glyph: "☀️" },
  { id: "sunset", label: "Sunset", glyph: "🌇" },
  { id: "sunrise", label: "Sunrise", glyph: "🌅" },
  { id: "studio", label: "Studio", glyph: "💡" },
  { id: "soft", label: "Soft Light", glyph: "🌤️" },
  { id: "blue-hour", label: "Blue Hour", glyph: "🌆" },
  { id: "neon", label: "Neon", glyph: "⚡" },
  { id: "moonlight", label: "Moonlight", glyph: "🌙" },
  { id: "dramatic", label: "Dramatic", glyph: "🎭" },
];
const MOODS: Choice[] = [
  { id: "emotional", label: "Emotional", glyph: "❤️" },
  { id: "inspirational", label: "Inspirational", glyph: "✨" },
  { id: "peaceful", label: "Peaceful", glyph: "🍃" },
  { id: "spiritual", label: "Spiritual", glyph: "🕯️" },
  { id: "epic", label: "Epic", glyph: "⛰️" },
  { id: "romantic", label: "Romantic", glyph: "💞" },
  { id: "hopeful", label: "Hopeful", glyph: "⭐" },
  { id: "dark", label: "Dark", glyph: "🌑" },
  { id: "joyful", label: "Joyful", glyph: "😊" },
];
type FxItem = { id: string; label: string; glyph: string; group: string };
const ATMOS_FX: FxItem[] = [
  { id: "fog", label: "Cinematic Fog", glyph: "🌫️", group: "Atmosphere" },
  { id: "mist", label: "Mist", glyph: "💨", group: "Atmosphere" },
  { id: "clouds", label: "Moving Clouds", glyph: "☁️", group: "Atmosphere" },
  { id: "smoke", label: "Smoke", glyph: "🌪️", group: "Atmosphere" },
  { id: "wind", label: "Wind", glyph: "🍃", group: "Atmosphere" },
  { id: "dust", label: "Dust", glyph: "✨", group: "Particles" },
  { id: "embers", label: "Embers", glyph: "🔥", group: "Particles" },
  { id: "snow", label: "Snow", glyph: "❄️", group: "Particles" },
  { id: "rain", label: "Rain", glyph: "🌧️", group: "Particles" },
  { id: "leaves", label: "Falling Leaves", glyph: "🍂", group: "Particles" },
  { id: "floating", label: "Floating Particles", glyph: "🫧", group: "Particles" },
  { id: "godrays", label: "Volumetric Rays", glyph: "🌅", group: "Light" },
  { id: "lensflare", label: "Lens Flare", glyph: "🔆", group: "Light" },
  { id: "lightleak", label: "Light Leaks", glyph: "💡", group: "Light" },
  { id: "bloom", label: "Bloom", glyph: "🌟", group: "Light" },
  { id: "glow", label: "Ambient Glow", glyph: "⭐", group: "Light" },
  { id: "parallax", label: "Depth Parallax", glyph: "🪟", group: "Camera FX" },
  { id: "dof", label: "Depth of Field", glyph: "🔘", group: "Camera FX" },
  { id: "rackfocus", label: "Rack Focus", glyph: "🎯", group: "Camera FX" },
  { id: "motionblur", label: "Motion Blur", glyph: "〰️", group: "Camera FX" },
  { id: "grain", label: "Film Grain", glyph: "🎞️", group: "Grade" },
  { id: "grade", label: "Color Grade", glyph: "🎨", group: "Grade" },
  { id: "vignette", label: "Vignette", glyph: "⭕", group: "Grade" },
  { id: "water", label: "Water Ripples", glyph: "💧", group: "Grade" },
];
const FX_GROUPS = ["Atmosphere", "Particles", "Light", "Camera FX", "Grade"];
const DEFAULT_FX = ["godrays", "grain", "grade"];
const DEFAULT_CAMERA = "dolly-fwd";
const DEFAULT_LIGHTING = "golden-hour";
const DEFAULT_MOOD = "emotional";
// still-image exports for platforms that prefer/require an image (WhatsApp, Pinterest)
// or look best as a feed still (Instagram, Facebook). Composed client-side from the card.
type ImgTarget = { id: string; label: string; w: number; h: number; dim: string; icon: string };
const IMAGE_TARGETS: ImgTarget[] = [
  { id: "whatsapp", label: "WhatsApp", w: 1080, h: 1920, dim: "9:16", icon: "💬" },
  { id: "pinterest", label: "Pinterest", w: 1000, h: 1500, dim: "2:3", icon: "📌" },
  { id: "instagram", label: "Instagram", w: 1080, h: 1350, dim: "4:5", icon: "📷" },
  { id: "facebook", label: "Facebook", w: 1080, h: 1080, dim: "1:1", icon: "👍" },
];
// pixel size of the MP4 per on-screen aspect — lets every card type render video.
const VIDEO_DIMS: Record<string, [number, number]> = {
  story: [1080, 1920],
  square: [1080, 1080],
  wide: [1920, 1080],
  pin: [1000, 1500],
  showcase: [1080, 1350],
};
const FMT_LABEL: Record<string, string> = { square: "1:1 Feed", story: "9:16 Vertical", wide: "16:9 Wide" };
const STUDIO_CAPTIONS: { key: keyof import("../lib/promo").CaptionSet; label: string }[] = [
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube Shorts" },
  { key: "instagram", label: "Instagram" },
  { key: "x", label: "X" },
  { key: "pinterest", label: "Pinterest" },
  { key: "facebook", label: "Facebook" },
  { key: "whatsapp", label: "WhatsApp" },
];
type StudioFmt = "square" | "story" | "wide";
const PLATFORM_CAPTION: Record<string, keyof import("../lib/promo").CaptionSet> = {
  Shorts: "youtube",
  TikTok: "tiktok",
  Reels: "instagram",
  "Instagram feed": "instagram",
  X: "x",
  Pinterest: "pinterest",
  WhatsApp: "whatsapp",
};
function studioDefaultFmt(cat: StudioCat): StudioFmt {
  return "story";
}
function studioFmtOptions(cat: StudioCat): StudioFmt[] | null {
  if (cat.engine === "pin" || cat.engine === "showcase") return null;
  if (cat.engine === "promo" && (cat.id === "streaming" || cat.id === "renewed")) return ["story", "square", "wide"];
  return ["story", "square"];
}
function studioFmtHint(cat: StudioCat): string {
  if (cat.engine === "pin") return "2:3";
  if (cat.engine === "showcase") return "4:5";
  return "9:16";
}
function studioFixedFmtLabel(cat: StudioCat): string | null {
  if (cat.engine === "pin") return "1000 × 1500 · 2:3 Pinterest";
  if (cat.engine === "showcase") return "1080 × 1350 · 4:5 Instagram";
  return null;
}
function primaryCaptionKey(cat: StudioCat): keyof import("../lib/promo").CaptionSet {
  return PLATFORM_CAPTION[cat.platforms[0] ?? ""] ?? "tiktok";
}
function studioChecklist(
  cat: StudioCat,
  state: { hasPreview: boolean; hasMoment: boolean; hasTitle: boolean; hasVs: boolean },
): { id: string; label: string; done: boolean }[] {
  const steps: { id: string; label: string; done: boolean }[] = [];
  if (cat.engine === "promo") {
    steps.push({ id: "pick", label: "Pick a moment from live data", done: state.hasMoment });
  } else if (cat.needs === "title") {
    steps.push({ id: "search", label: "Search and select a title", done: state.hasTitle });
  } else if (cat.needs === "vs") {
    steps.push({ id: "vs", label: "Enter two titles, then Generate", done: state.hasVs });
  } else if (cat.needs === "genre") {
    steps.push({ id: "genre", label: "Choose a genre", done: true });
  } else if (cat.id === "gems") {
    steps.push({ id: "auto", label: "Titles auto-picked from catalog", done: true });
  }
  steps.push({ id: "preview", label: "Review the preview", done: state.hasPreview });
  steps.push({
    id: "download",
    label: cat.id === "liked" ? "Export animated Short (MP4)" : "Download PNG or MP4",
    done: false,
  });
  const capLabel = STUDIO_CAPTIONS.find((x) => x.key === primaryCaptionKey(cat))?.label ?? "platform";
  steps.push({ id: "caption", label: `Copy the ${capLabel} caption`, done: false });
  steps.push({ id: "post", label: "Publish to your channels", done: false });
  return steps;
}

type EpStat = { season: number | null; number: number | null; name: string | null; rating: number | null };

async function loadShowEpisodeStats(db: D1Database, slug: string) {
  const show = await getShow(db, slug);
  if (!show) return null;
  const { results } = await db
    .prepare(
      "SELECT season, number, name, rating FROM episodes WHERE show_id = ? AND rating IS NOT NULL ORDER BY rating DESC",
    )
    .bind(show.id)
    .all<EpStat>();
  const ratedN = results.length;
  const avg = ratedN ? results.reduce((s, e) => s + (e.rating as number), 0) / ratedN : null;
  const peak = results[0] ?? null;
  const worst = ratedN ? results[results.length - 1] : null;
  const seasons = new Set(results.map((e) => e.season ?? 0)).size;
  const peakStr = peak?.rating != null ? peakCode(peak.season, peak.number, peak.rating) : null;
  return { show, results, ratedN, avg, peak, worst, worstRating: worst?.rating ?? null, seasons, peakStr };
}

app.get("/admin/studio", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const enc = encodeURIComponent;
  const catId = STUDIO_LEGACY_CAT[c.req.query("cat") ?? ""] ?? c.req.query("cat") ?? "trending";
  const cat = STUDIO_CATS.find((x) => x.id === catId) ?? STUDIO_CATS[0];
  const fmtOpts = studioFmtOptions(cat);
  const fmtDefault = studioDefaultFmt(cat);
  const fmtQ = c.req.query("fmt");
  let fmt: string;
  if (!fmtOpts) {
    fmt = "story";
  } else if (cat.engine === "promo") {
    fmt = fmtQ && fmtOpts.includes(fmtQ as StudioFmt) && fmtQ in PROMO_DIMS ? fmtQ : fmtDefault;
  } else {
    fmt = fmtQ && fmtOpts.includes(fmtQ as StudioFmt) ? fmtQ : fmtDefault;
  }
  const base = promoBase(c);

  // classic-engine inputs
  const slug = (c.req.query("slug") ?? "breaking-bad").trim();
  const kind = c.req.query("kind") === "movie" ? "movie" : "tv";
  const genre = (c.req.query("genre") ?? "Drama").trim();
  const vsA = (c.req.query("a") ?? "").trim();
  const vsKa = c.req.query("ka") === "movie" ? "movie" : "tv";
  const vsB = (c.req.query("b") ?? "").trim();
  const vsKb = c.req.query("kb") === "movie" ? "movie" : "tv";
  // showcase (dual-poster 4:5) inputs — reuses the vs a/b slugs, plus copy overrides
  const scHeadline = (c.req.query("headline") ?? "").trim();
  const scKicker = (c.req.query("kicker") ?? "").trim();
  const scArt = c.req.query("art") === "backdrop" ? "backdrop" : "poster";

  // promo-engine: the moments for this category
  let moments: PromoMoment[] = [];
  let active: PromoMoment | undefined;
  let caps: ReturnType<typeof promoCaptions> | null = null;
  if (cat.engine === "promo") {
    const all = await getPromoMoments(c);
    moments = all.filter((m) => cat.themes!.includes(m.theme));
    active = moments.find((m) => m.id === c.req.query("pick")) ?? moments[0];
    if (active) caps = promoCaptions(active, base);
  } else {
    // captions + tags for composer + graph cards (same panel as the moment cards)
    const nameOf = async (sl: string, kd: string): Promise<string | null> => {
      if (!sl) return null;
      if (kd === "movie") {
        const m = await c.env.DB.prepare("SELECT title FROM movies WHERE slug = ?").bind(sl).first<{ title: string }>();
        return m?.title ?? null;
      }
      return (await getShow(c.env.DB, sl))?.name ?? null;
    };
    if (cat.engine === "ratings") {
      const stats = await loadShowEpisodeStats(c.env.DB, slug);
      if (stats) {
        const { show, ratedN, avg, seasons, peak, peakStr, worstRating } = stats;
        caps = buildCaptions({
          emoji: "📺",
          title: show.name,
          hook: ratingsHook(avg, peakStr, worstRating),
          sub: peak
            ? `${seasons} seasons, ${ratedN} episodes — peaks at ${peakStr}.`
            : `${seasons} seasons, ${ratedN} episodes.`,
          link: `${base}/show/${slug}/ratings`,
          campaign: `${slug}-ratings`,
          tags: ["EpisodeRatings", show.name, "TVShow"],
        });
      }
    } else if (cat.id === "best-eps") {
      const stats = await loadShowEpisodeStats(c.env.DB, slug);
      if (stats) {
        const guide = EPISODE_GUIDE_BY_SHOW.get(slug);
        const { show, peakStr } = stats;
        const link = guide ? `${base}/guide/${guide.slug}` : `${base}/show/${slug}/best-episodes`;
        caps = buildCaptions({
          emoji: "📊",
          title: guide?.h1 ?? `Every ${show.name} episode ranked`,
          hook: guide ? episodeGuideHook(show.name, peakStr) : bestEpisodesHook(peakStr),
          sub: peakStr ? `Peak is ${peakStr} — full list on the site.` : "Best to worst — every episode scored.",
          link,
          campaign: guide ? `${guide.slug}-guide` : `${slug}-best-eps`,
          tags: ["EpisodeRankings", show.name, "TVShow"],
        });
      }
    } else if (cat.id === "showcase") {
      const [an, bn] = await Promise.all([nameOf(vsA, "tv"), nameOf(vsB, "tv")]);
      if (an && bn) {
        caps = buildCaptions({
          emoji: "🍿",
          title: scHeadline || `${an} or ${bn}?`,
          hook: showcaseHook(),
          sub: "Episode rankings · where to stream · what's on tonight.",
          link: `${base}/what-to-watch`,
          campaign: "showcase",
          tags: ["WhatToWatch", an, bn, "TVShow"],
        });
      }
    } else if (cat.id === "liked") {
      const name = await nameOf(slug, kind);
      if (name)
        caps = buildCaptions({
          emoji: "🍿",
          title: `If you liked ${name}`,
          hook: likedHook(),
          sub: "The closest matches, ranked — with ratings & where to stream.",
          // land on THIS title's similar page (not the generic recommender) so
          // the click goes straight to "more like X"
          link: `${base}/${kind === "movie" ? "movie" : "show"}/${slug}/similar`,
          tags: ["IfYouLiked", name, kind === "movie" ? "Movies" : "TVShow"],
        });
    } else if (cat.id === "status") {
      const name = await nameOf(slug, kind);
      if (name)
        caps = buildCaptions({
          emoji: "🔔",
          title: name,
          hook: statusHook(),
          sub: "Track every renewal, cancellation & premiere date.",
          link: `${base}/show/${slug}/release-date`,
          tags: ["Renewed", name, "TVShow"],
        });
    } else if (cat.id === "vs") {
      const [a, b] = await Promise.all([nameOf(vsA, vsKa), nameOf(vsB, vsKb)]);
      if (a && b) {
        const pair = `${vsA}-vs-${vsB}`;
        const path = vsKa === "movie" && vsKb === "movie" ? `compare/movie/${pair}` : `compare/${pair}`;
        caps = buildCaptions({
          emoji: "⚔️",
          title: `${a} vs ${b}`,
          hook: vsHook(),
          sub: "Head-to-head, season by season.",
          link: `${base}/${path}`,
          tags: ["Versus", a, b],
        });
      }
    } else if (cat.id === "top") {
      const g = genre === "Science-Fiction" ? "Sci-Fi" : genre;
      const top1 = await c.env.DB.prepare(
        "SELECT name FROM shows WHERE genres LIKE ? AND weight >= 60 ORDER BY rating DESC LIMIT 1",
      )
        .bind(`%"${genre}"%`)
        .first<{ name: string }>();
      caps = buildCaptions({
        emoji: "🏆",
        title: `The best ${g} shows`,
        hook: topHook(),
        sub: top1 ? `Led by ${top1.name}.` : "The full ranking is on the site.",
        link: `${base}/genre/${genre.toLowerCase()}`,
        tags: ["Top5", `${g}Shows`, ...(top1 ? [top1.name] : []), "TVShow"],
      });
    } else if (cat.id === "pin") {
      const name = await nameOf(slug, "tv");
      if (name)
        caps = buildCaptions({
          emoji: "📌",
          title: `Shows like ${name}`,
          hook: similarHook(),
          sub: "Ratings + where to stream for every pick — no account needed.",
          link: `${base}/show/${slug}/similar`,
          tags: ["ShowsLike", name, "WhatToWatch", "TVShows"],
        });
    } else if (cat.id === "gems") {
      const gem1 = await c.env.DB.prepare(
        "SELECT name FROM shows WHERE rating >= 8.0 AND weight BETWEEN 28 AND 60 AND genres IS NOT NULL ORDER BY rating DESC, weight ASC LIMIT 1",
      ).first<{ name: string }>();
      caps = buildCaptions({
        emoji: "💎",
        title: "Hidden gems",
        hook: gemsHook(),
        sub: gem1 ? `Starting with ${gem1.name}.` : "Highly rated shows flying under the radar.",
        link: `${base}/lists`,
        tags: ["HiddenGems", ...(gem1 ? [gem1.name] : []), "TVShow"],
      });
    }
  }

  // liked-card metadata for kinetic overlays (hero + pick names from admin)
  let likedShortMeta: { hero: string; picks: string[] } | null = null;
  if (cat.id === "liked") {
    if (kind === "movie") {
      const movie = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?").bind(slug).first<MovieRow>();
      if (movie) {
        const picks = await similarMovies(c.env.DB, movie, 3);
        likedShortMeta = { hero: movie.title, picks: picks.map((m) => m.title) };
      }
    } else {
      const show = await getShow(c.env.DB, slug);
      if (show) {
        const picks = await similarShows(c.env.DB, show, 3);
        likedShortMeta = { hero: show.name, picks: picks.map((s) => s.name) };
      }
    }
  }

  // composer + ratings cards offer 1:1 and 9:16 (square|story); promo also has wide
  const sq = fmt === "square";
  // the preview source + aspect class
  let src = "";
  let aspect: "square" | "story" | "wide" | "pin" | "showcase" = "story";
  let dlName = `tvnightly-${cat.id}.png`;
  if (cat.engine === "promo" && active) {
    src = promoCardUrl(active, fmt);
    aspect = fmt as "square" | "story" | "wide";
    dlName = `tvnightly-${active.id}-${fmt}.png`;
  } else if (cat.engine === "pin") {
    src = `/admin/studio/pin.png?slug=${enc(slug)}`;
    aspect = "pin";
    dlName = `tvnightly-shows-like-${slug}.png`;
  } else if (cat.engine === "showcase") {
    src =
      `/admin/studio/showcase.png?a=${enc(vsA)}&b=${enc(vsB)}&art=${scArt}` +
      (scHeadline ? `&headline=${enc(scHeadline)}` : "") +
      (scKicker ? `&kicker=${enc(scKicker)}` : "");
    aspect = "showcase";
    dlName = `tvnightly-showcase-${vsA || "a"}-${vsB || "b"}.png`;
  } else if (cat.engine === "classic") {
    src = `/admin/studio/card.svg?format=${cat.id}&fmt=${sq ? "square" : "story"}`;
    if (cat.id === "liked" || cat.id === "status" || cat.id === "best-eps") src += `&slug=${enc(slug)}&kind=${kind}`;
    if (cat.id === "top") src += `&genre=${enc(genre)}`;
    if (cat.id === "vs") src += `&a=${enc(vsA)}&ka=${vsKa}&b=${enc(vsB)}&kb=${vsKb}`;
    aspect = sq ? "square" : "story";
  } else if (cat.engine === "ratings") {
    src = `/admin/studio/card.svg?format=ratings&slug=${enc(slug)}&fmt=${sq ? "square" : "story"}`;
    aspect = sq ? "square" : "story";
  }

  const catHref = (id: string) => `/admin/studio?cat=${id}`;
  const groups: StudioCat["group"][] = ["Daily moments", "Show posts", "Viral formats", "Feed & pins"];
  const FMT_DIMS: Record<string, string> = {
    square: "1080 × 1080 · 1:1",
    story: "1080 × 1920 · 9:16",
    wide: "1920 × 1080 · 16:9",
  };
  const dims =
    cat.engine === "pin"
      ? "1000 × 1500 · 2:3"
      : cat.engine === "showcase"
        ? "1080 × 1350 · 4:5"
      : cat.engine === "promo"
        ? FMT_DIMS[fmt] ?? FMT_DIMS.story
        : sq
          ? FMT_DIMS.square
          : FMT_DIMS.story;
  // a composer/ratings format link that preserves the category's current inputs
  const classicHref = (f: "square" | "story") => {
    let u = `/admin/studio?cat=${cat.id}&fmt=${f}`;
    if (cat.id === "liked" || cat.id === "status" || cat.id === "best-eps" || cat.engine === "ratings")
      u += `&slug=${enc(slug)}&kind=${kind}`;
    if (cat.id === "top") u += `&genre=${enc(genre)}`;
    if (cat.id === "vs") u += `&a=${enc(vsA)}&ka=${vsKa}&b=${enc(vsB)}&kb=${vsKb}`;
    return u;
  };
  // a category has its own input tray (search / vs / genre / moment picker)?
  const hasTray =
    cat.engine === "ratings" ||
    cat.engine === "pin" ||
    cat.engine === "showcase" ||
    (cat.engine === "classic" &&
      (cat.needs === "title" || cat.id === "vs" || cat.id === "top")) ||
    (cat.engine === "promo" && moments.length > 0);

  const hasPreview = !!src && !(cat.engine === "promo" && !active);
  const checklist = studioChecklist(cat, {
    hasPreview,
    hasMoment: cat.engine === "promo" ? !!active : true,
    hasTitle: cat.needs === "title" ? !!slug : true,
    hasVs: cat.needs === "vs" ? !!(vsA && vsB) : true,
  });
  const primaryCap = primaryCaptionKey(cat);
  const fixedFmt = studioFixedFmtLabel(cat);
  const [vidW, vidH] = VIDEO_DIMS[aspect] ?? [1080, 1920];
  const camHint = (CAMERA_MOVES.find((c) => c.id === DEFAULT_CAMERA) ?? CAMERA_MOVES[0]).hint;

  return c.html(
    <Layout c={c} title="Studio — admin" noindex bare scripts={["/js/mp4-muxer.js", "/js/studio.js"]}>
      <AdminShell page="studio" wide lead="Shorts · TikTok · Reels · X · Pinterest · WhatsApp">
        <div class="studio-body">
          <aside class="studio-rail">
            {groups.map((g) => (
              <div class="studio-group">
                <h2 class="studio-group-h">{g}</h2>
                {STUDIO_CATS.filter((x) => x.group === g).map((x) => (
                  <a class={`studio-cat${x.id === cat.id ? " on" : ""}`} href={catHref(x.id)}>
                    <span class="studio-cat-label">{x.label}</span>
                    <span class="studio-cat-fmt">{studioFmtHint(x)}</span>
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
              {cat.platforms.length ? (
                <div class="studio-platforms" aria-label="Best for">
                  {cat.platforms.map((p) => (
                    <span class="studio-platform">{p}</span>
                  ))}
                </div>
              ) : null}
            </div>
            {fixedFmt ? (
              <span class="studio-fmt-static">{fixedFmt}</span>
            ) : fmtOpts && cat.engine === "promo" ? (
              active ? (
                <div class="studio-fmts" role="group" aria-label="Format">
                  {fmtOpts.map((f) => (
                    <a
                      class={`studio-fmt${f === fmt ? " on" : ""}`}
                      href={`/admin/studio?cat=${cat.id}&pick=${enc(active!.id)}&fmt=${f}`}
                    >
                      {FMT_LABEL[f]}
                    </a>
                  ))}
                </div>
              ) : null
            ) : fmtOpts ? (
              <div class="studio-fmts" role="group" aria-label="Format">
                {fmtOpts
                  .filter((f): f is "square" | "story" => f !== "wide")
                  .map((f) => (
                    <a class={`studio-fmt${(sq ? "square" : "story") === f ? " on" : ""}`} href={classicHref(f)}>
                      {FMT_LABEL[f]}
                    </a>
                  ))}
              </div>
            ) : null}
          </header>

          {/* controls per category — the input tray */}
          {hasTray ? (
            <div class="studio-tray">
              {cat.engine === "classic" && (cat.id === "liked" || cat.id === "status" || cat.id === "best-eps") ? (
                <div class="studio-search" data-format={cat.id}>
                  <input
                    id="studio-q"
                    type="search"
                    placeholder={cat.id === "best-eps" ? "Search a show to rank every episode…" : "Search a show or movie…"}
                    autocomplete="off"
                  />
                  <div id="studio-ta" class="studio-ta" hidden></div>
                </div>
              ) : null}
              {cat.engine === "ratings" ? (
                <div class="studio-search" data-format="ratings">
                  <input id="studio-q" type="search" placeholder="Search a show for its ratings graph…" autocomplete="off" />
                  <div id="studio-ta" class="studio-ta" hidden></div>
                </div>
              ) : null}
              {cat.engine === "pin" ? (
                <div class="studio-search" data-format="pin">
                  <input id="studio-q" type="search" placeholder="Search a show for its Pinterest pin…" autocomplete="off" />
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
                  <button type="button" id="studio-gen" class="studio-dl-btn" data-cat="vs">Generate</button>
                </div>
              ) : null}
              {cat.engine === "showcase" ? (
                <div class="studio-vs studio-showcase-tray">
                  <div class="studio-search">
                    <input id="studio-qa" type="search" placeholder="First show…" autocomplete="off" />
                    <div id="studio-taa" class="studio-ta" hidden></div>
                  </div>
                  <div class="studio-search">
                    <input id="studio-qb" type="search" placeholder="Second show…" autocomplete="off" />
                    <div id="studio-tab" class="studio-ta" hidden></div>
                  </div>
                  <input id="studio-headline" class="studio-text-in" type="text" placeholder="Headline (optional)" value={scHeadline} />
                  <input id="studio-kicker" class="studio-text-in" type="text" placeholder="Kicker (optional)" value={scKicker} />
                  <select id="studio-art" class="studio-text-in">
                    <option value="poster" selected={scArt === "poster"}>Poster art</option>
                    <option value="backdrop" selected={scArt === "backdrop"}>Backdrop + logo</option>
                  </select>
                  <button type="button" id="studio-gen" class="studio-dl-btn" data-cat="showcase">Generate</button>
                </div>
              ) : null}
              {cat.id === "top" ? (
                <form method="get" action="/admin/studio" class="studio-genre">
                  <input type="hidden" name="cat" value="top" />
                  <input type="hidden" name="fmt" value={sq ? "square" : "story"} />
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
                <>
                  <div class="studio-frame">
                    <img
                      id="studio-card"
                      src={src}
                      alt="Card preview"
                      data-card-format={cat.id}
                      data-liked-meta={likedShortMeta ? JSON.stringify(likedShortMeta) : undefined}
                    />
                    <canvas id="studio-preview" class="studio-preview" aria-label="Live video preview"></canvas>
                    {aspect === "story" ? <div class="studio-safe" aria-hidden="true" title="TikTok / Shorts safe zone"></div> : null}
                    <div class="studio-preview-bar">
                      <span class="studio-preview-badge">● Live preview</span>
                      <button type="button" id="studio-preview-toggle" class="studio-preview-toggle">❚❚ Pause</button>
                    </div>
                  </div>
                  <span class="studio-dims">{dims}</span>
                </>
              )}
            </div>

            <div class="studio-side">
              <div class="studio-checklist" id="studio-checklist">
                <h3 class="studio-check-h">Post checklist</h3>
                <ol class="studio-checks">
                  {checklist.map((step) => (
                    <li
                      class={`studio-check${step.done ? " is-done" : ""}`}
                      data-check={step.id}
                      data-auto={step.done ? "1" : undefined}
                    >
                      {step.label}
                    </li>
                  ))}
                </ol>
              </div>
              {src ? (
                <>
                  <p class="studio-actions">
                    {cat.engine === "promo" || cat.engine === "pin" || cat.engine === "showcase" ? (
                      <a id="studio-dl-link" class="studio-dl-btn" href={src} download={dlName} data-check-trigger="download">
                        ↓ PNG
                      </a>
                    ) : (
                      <button type="button" id="studio-dl" class="studio-dl-btn" data-check-trigger="download">
                        ↓ PNG
                      </button>
                    )}
                    <button
                      type="button"
                      id="studio-vid"
                      class="studio-vid-btn"
                      data-w={String(vidW)}
                      data-h={String(vidH)}
                      data-check-trigger="download"
                    >
                      🎬 Render MP4
                    </button>
                    <a href={src} target="_blank" rel="noopener" class="studio-open">Open ↗</a>
                  </p>

                  {/* Camera movement */}
                  <div class="studio-vstudio">
                    <div class="studio-vstudio-h">
                      <span class="studio-vstudio-t">🎥 Camera Movement</span>
                      <span class="muted" id="studio-cam-hint">{camHint}</span>
                    </div>
                    <div class="studio-cam-grid" id="studio-cams">
                      {CAMERA_MOVES.map((cm) => (
                        <button
                          type="button"
                          class={`studio-cam-btn${cm.id === DEFAULT_CAMERA ? " on" : ""}`}
                          data-cam={cm.id}
                          data-hint={cm.hint}
                          title={cm.hint}
                        >
                          <span class="studio-cam-ic">{cm.glyph}</span>
                          <span class="studio-cam-l">{cm.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Lighting + Mood */}
                  <div class="studio-lm">
                    <div class="studio-vstudio">
                      <div class="studio-vstudio-h">
                        <span class="studio-vstudio-t">💡 Lighting</span>
                      </div>
                      <div class="studio-choice-grid" id="studio-lights">
                        {LIGHTING.map((o) => (
                          <button
                            type="button"
                            class={`studio-choice-btn${o.id === DEFAULT_LIGHTING ? " on" : ""}`}
                            data-light={o.id}
                          >
                            <span class="studio-choice-ic">{o.glyph}</span>
                            <span class="studio-choice-l">{o.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div class="studio-vstudio">
                      <div class="studio-vstudio-h">
                        <span class="studio-vstudio-t">❤️ Mood</span>
                      </div>
                      <div class="studio-choice-grid" id="studio-moods">
                        {MOODS.map((o) => (
                          <button
                            type="button"
                            class={`studio-choice-btn${o.id === DEFAULT_MOOD ? " on" : ""}`}
                            data-mood={o.id}
                          >
                            <span class="studio-choice-ic">{o.glyph}</span>
                            <span class="studio-choice-l">{o.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Atmosphere & FX */}
                  <div class="studio-vstudio">
                    <div class="studio-vstudio-h">
                      <span class="studio-vstudio-t">✨ Atmosphere &amp; FX</span>
                      <span class="studio-fx-tools">
                        <span class="studio-fx-count" id="studio-fx-count">{`${DEFAULT_FX.length} active`}</span>
                        <button type="button" class="studio-fx-clear" id="studio-fx-clear">Clear</button>
                      </span>
                    </div>
                    {FX_GROUPS.map((grp) => (
                      <div class="studio-fx-group">
                        <span class="studio-fx-gh">{grp}</span>
                        <div class="studio-fx-row">
                          {ATMOS_FX.filter((f) => f.group === grp).map((f) => (
                            <button
                              type="button"
                              class={`studio-fx-btn${DEFAULT_FX.includes(f.id) ? " on" : ""}`}
                              data-fx={f.id}
                            >
                              <span class="studio-fx-ic">{f.glyph}</span>
                              {f.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* pacing knobs */}
                  <div class="studio-vstudio">
                    <div class="studio-knobs">
                      <label class="studio-knob">
                        <span class="studio-knob-l">Length</span>
                        <select id="studio-dur">
                          <option value="7">7s</option>
                          <option value="10" selected>10s</option>
                          <option value="15">15s</option>
                        </select>
                      </label>
                      <label class="studio-knob">
                        <span class="studio-knob-l">Beat sync</span>
                        <select id="studio-beat">
                          <option value="0">Off</option>
                          <option value="90">90 BPM</option>
                          <option value="120" selected>120 BPM</option>
                          <option value="140">140 BPM</option>
                        </select>
                      </label>
                      <label class="studio-knob studio-knob-range">
                        <span class="studio-knob-l">
                          Intensity <em id="studio-int-val">100%</em>
                        </span>
                        <input id="studio-intensity" type="range" min="30" max="160" step="5" value="100" />
                      </label>
                    </div>
                    <p class="studio-vid-note muted">
                      The preview above shows your settings live. Hit{" "}
                      <strong>Render MP4</strong> to export — frame-by-frame in your browser.
                    </p>
                  </div>

                  {/* still-image versions for image-first platforms */}
                  <div class="studio-imgs">
                    <div class="studio-vstudio-h">
                      <span class="studio-vstudio-t">🖼️ Image versions</span>
                      <span class="muted">For WhatsApp & Pinterest (image-only) + feed stills.</span>
                    </div>
                    <div class="studio-img-row">
                      {IMAGE_TARGETS.map((p) => (
                        <button
                          type="button"
                          class="studio-img-btn"
                          data-w={String(p.w)}
                          data-h={String(p.h)}
                          data-platform={p.id}
                          data-label={p.label}
                          data-check-trigger="download"
                        >
                          <span class="studio-img-ic" aria-hidden="true">{p.icon}</span>
                          <span class="studio-img-name">{p.label}</span>
                          <span class="studio-img-dim">{p.dim}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
              {caps ? (
                <div class="studio-caps">
                  <h3 class="studio-caps-h">Captions</h3>
                  <p class="studio-caps-lead muted">Copy one caption — link includes UTM tracking per platform.</p>
                  {STUDIO_CAPTIONS.map((pl) => (
                    <div class={`studio-cap${pl.key === primaryCap ? " is-primary" : ""}`}>
                      <div class="studio-cap-head">
                        <span>
                          {pl.label}
                          {pl.key === primaryCap ? <span class="studio-cap-rec">Recommended</span> : null}
                        </span>
                        <button type="button" class="studio-copy" data-check-trigger="caption">
                          Copy
                        </button>
                      </div>
                      <textarea class="studio-cap-text" readonly rows={5}>{caps[pl.key]}</textarea>
                    </div>
                  ))}
                </div>
              ) : cat.engine !== "promo" ? (
                <p class="muted studio-note">
                  Vertical cards (9:16) work best for Shorts, TikTok & Reels. Square for feed posts.
                </p>
              ) : null}
            </div>
          </div>
          </main>
        </div>
      </AdminShell>
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
  const square = c.req.query("fmt") === "square"; // 1:1 feed vs 9:16 story (default)
  const key = c.env.TMDB_API_KEY;
  const fontCss = await archivoFontCss(c.env.ASSETS);
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "no-store");

  // ---- episode-ratings heatmap (fixed 9:16, always fits) ----
  if (format === "ratings") {
    const slug = (c.req.query("slug") ?? "").trim();
    const show = await getShow(c.env.DB, slug);
    if (!show) return c.text(`No show with slug “${slug}”.`, 404);
    const { results } = await c.env.DB.prepare(
      "SELECT season, number, rating FROM episodes WHERE show_id = ? ORDER BY season, number",
    )
      .bind(show.id)
      .all<RatingsEp>();
    const bd = show.tmdb_id && key ? await tmdbBackdrop(key, show.tmdb_id) : null;
    const backdropUri = bd ? await posterDataUri(bd.x2 ?? bd.x1) : null;
    const posterUri = await posterDataUri((show.poster_url ?? show.image_url)?.replace("/w342/", "/w500/") ?? null);
    return c.body(buildRatingsCard({ name: show.name, episodes: results, fontCss, backdropUri, posterUri, square }));
  }

  if (format === "best-eps") {
    const slug = (c.req.query("slug") ?? "breaking-bad").trim();
    const stats = await loadShowEpisodeStats(c.env.DB, slug);
    if (!stats) return c.text(`No show with slug “${slug}”.`, 404);
    const { show, results } = stats;
    const posterUri = await posterDataUri((show.poster_url ?? show.image_url)?.replace("/w342/", "/w500/") ?? null);
    const entries: CardEntry[] = results.slice(0, 5).map((e) => ({
      name: `S${pad2(e.season)}E${pad2(e.number)}${e.name ? ` · ${e.name}` : ""}`,
      posterUri,
      rating: e.rating,
      genres: [],
      year: null,
    }));
    const guide = EPISODE_GUIDE_BY_SHOW.get(slug);
    return c.body(
      buildListCard({
        eyebrow: "EVERY EPISODE",
        title: guide?.h1 ?? `${show.name} ranked`,
        entries,
        footerLine: "Full ranking at",
        fontCss,
        square,
      }),
    );
  }

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
        square,
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
        square,
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
    return c.body(buildListCard({ eyebrow, title, entries, footerLine: "Tonight's full schedule at", fontCss, square }));
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
      buildStatusCard({ name: show.name, meta, verdict, verdictColor, subLine, backdropUri, posterUri, fontCss, square }),
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
    return c.body(buildVsCard(A, B, verdict, fontCss, square));
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
  return c.body(buildLikedCard(hero, pickEntries, fontCss, backdropUri, square));
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

// 1000×1500 (2:3) Pinterest pin for a show's "Shows like X" page — the tall,
// branded asset to download and post to TV Nightly's Pinterest. Admin-only;
// posters/backdrop inlined as data-URIs so the saved PNG is standalone.
app.get("/admin/studio/pin.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const slug = (c.req.query("slug") ?? "").trim();
  const show = await getShow(c.env.DB, slug);
  if (!show) return c.text(`No show with slug “${slug}”.`, 404);
  const key = c.env.TMDB_API_KEY;
  // same depth as the public /similar page so the footer count is truthful
  const similar = await similarShows(c.env.DB, show, 18);
  if (!similar.length) return c.text(`No similar shows for “${show.name}” yet.`, 404);
  const featured = similar.slice(0, 3);
  const bd = show.tmdb_id && key ? await tmdbBackdrop(key, show.tmdb_id) : null;
  const [backdropUri, ...posterUris] = await Promise.all([
    posterDataUri(bd?.x1 ?? show.poster_url ?? show.image_url ?? null),
    ...featured.map((s) => posterDataUri((s.poster_url ?? s.image_url)?.replace("/w342/", "/w500/") ?? null)),
  ]);
  const svg = buildSimilarPin({
    sourceTitle: show.name,
    totalCount: similar.length,
    backdropUri,
    featured: featured.map((s, i) => ({ name: s.name, posterUri: posterUris[i], rating: s.rating })),
    rest: similar.slice(3, 8).map((s) => ({ name: s.name, rating: s.rating })),
  });
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, 1000);
  return new Response(png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store" },
  });
});

// POC: 1080×1350 "scroll-stopper" showcase card (dual poster + chrome headline).
// /admin/studio/showcase.png?a=slug&b=slug&headline=...&kicker=...
app.get("/admin/studio/showcase.png", async (c) => {
  const denied = await requireAdmin(c);
  if (denied) return denied;
  const q = c.req.query();
  // default to two top-weight shows with posters so the POC renders out of the box
  const pick = async (slug: string | undefined, rank: number): Promise<ShowRow | null> => {
    if (slug) return (await resolveShow(c, slug.trim()))?.show ?? null; // D1, then live TMDB
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM shows WHERE poster_url IS NOT NULL AND rating IS NOT NULL ORDER BY rating DESC, weight DESC LIMIT 5",
    ).all<ShowRow>();
    return results[rank] ?? null;
  };
  const [a, b] = await Promise.all([pick(q.a, 0), pick(q.b, 1)]);
  if (!a || !b) return c.text("Need two shows with posters.", 404);
  // vertical key-art poster per half (like the reference). Posters already carry
  // their own title art, so no logo overlay — that's reserved for textless
  // backdrops (see ?art=backdrop below) to avoid doubling the title.
  const key = c.env.TMDB_API_KEY;
  const useBackdrop = q.art === "backdrop";
  const side = async (s: ShowRow): Promise<{ imageUri: string | null; logoUri: string | null; name: string }> => {
    if (useBackdrop) {
      const [bd, logo] = await Promise.all([
        s.tmdb_id && key ? tmdbBackdrop(key, s.tmdb_id) : null,
        s.tmdb_id && key ? tmdbLogo(key, s.tmdb_id) : null,
      ]);
      const [imageUri, logoUri] = await Promise.all([posterDataUri(bd?.x2 ?? bd?.x1 ?? null), posterDataUri(logo)]);
      return { imageUri, logoUri, name: s.name };
    }
    const img = (s.poster_url ?? s.image_url)?.replace("/w342/", "/w780/") ?? null;
    return { imageUri: await posterDataUri(img), logoUri: null, name: s.name };
  };
  const [left, right] = await Promise.all([side(a), side(b)]);
  const svg = buildShowcaseCard({
    topStrip: q.strip ?? "TV Nightly · What to watch",
    left,
    right,
    panelKicker: q.kicker ?? "Tonight's top picks",
    headline: q.headline ?? "Tonight, decided",
    subline: q.sub ?? "Episode rankings · where to stream · what's on tonight",
    footer: q.footer ?? "Free. No account needed. Updated nightly. tvnightly.com",
  });
  const fonts = await loadOgFonts(c.env.ASSETS);
  const png = await svgToPng(svg, fonts, 1080);
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

// ===========================================================================
// Shorts generator — /admin/shorts
// Search any title/person/genre/year → MANY "Top 10" angles → curate the ranked
// 10 → per-platform captions → one-button export of a render_short.sh that drives
// the local countdown pipeline (tools/countdown). The Worker never renders video.
// ===========================================================================
const shortsNoStore = (c: AppContext) => {
  c.header("Cache-Control", "private, no-store");
};

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
    | { title?: string; query?: string; kind?: "tv" | "movie"; ctaUrl?: string }
    | null;
  if (!b?.query) return c.json({ captions: null }, 400);
  return c.json({
    captions: shorts10Captions({ c, title: b.title ?? b.query, query: b.query, kind: b.kind ?? "movie", ctaUrl: b.ctaUrl ?? "" }),
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
      <AdminShell page="shorts" wide lead="Search → pick a Top 10 angle → curate → export">
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
                  <label class="shorts-field"><span>Accent</span><input id="sf-accent" class="shorts-input" value="0x39d98a" /></label>
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
                  {STUDIO_CAPTIONS.map((pl) => (
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
                  <label class="shorts-field"><span>Music URL (optional .mp3)</span><input id="sf-music" class="shorts-input" placeholder="https://…/track.mp3" /></label>
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
