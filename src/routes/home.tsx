import { Hono } from "hono";
import { FC, PropsWithChildren } from "hono/jsx";
import { Honeypot, Layout } from "../components/Layout";
import { MovieCard, ShowCard, StatusBadge } from "../components/cards";
import { HeroTrailerEmbed } from "../components/hero-trailer";
import { HomeSidebarRail } from "../components/home-sidebar";
import { IconCal, IconClapper, IconDial, IconHearts, IconMail, IconReel, IconRoute, IconSparkle, IconStar, IconTvPlay, IconVs } from "../components/icons";
import { NewsletterBand } from "../components/newsletter";
import { ProviderLine } from "../components/providers";
import { airTime, epCode, heroBg, hiRes, homeDateline, isNewYear, longDate, personHref, posterImg, posterSrc, premiereDateParts, slugifyName, stripHtml } from "../lib/format";
import { latestTrailers, trailerSeedsFromRails } from "../lib/latest-trailers";
import { PROVIDER_LOGOS, visitorRegion } from "../lib/providers";
import { communityVerdictTotal } from "../lib/ratings";
import { liveTonight } from "../lib/schedule-live";
import { canonical, origin, siteIdentityLd } from "../lib/seo";
import { SIDEBAR_TRAILER_LIMIT } from "../lib/sidebar-tops";
import { tmdbBackdrop, tmdbMovieBackdrop, tmdbPopular, tmdbTrendingList, tmdbUpcomingMovies } from "../lib/tmdb";
import { playableTrailer, playableTrailerList } from "../lib/youtube";
import { toMovieRow, toShowRow } from "../lib/tmdb-rows";
import { tmdbHeroShow, tmdbShowCast } from "../lib/tmdb-show";
import { AppContext, Bindings, HonoEnv, MovieRow, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

// Lazy trailer lookup for the poster-card play buttons. A card carries only the
// title's tmdb id + media type; the YouTube key is fetched here on click, so
// nothing is paid for trailers nobody plays. Rides the 7-day edge cache, and the
// JSON response is itself cacheable for a week.
app.get("/api/trailer", async (c) => {
  const type = c.req.query("type");
  const id = c.req.query("id");
  if ((type !== "tv" && type !== "movie") || !id) {
    return c.json({ key: null }, 400);
  }
  const key = c.env.TMDB_API_KEY;
  if (!key) return c.json({ key: null }, 503);
  const bundleId =
    type === "movie" && /^tt\d+$/.test(id) ? id : /^\d+$/.test(id) ? Number(id) : null;
  if (bundleId == null) return c.json({ key: null }, 400);
  const t = await playableTrailer(c, type, bundleId);
  c.header("Cache-Control", "public, max-age=604800");
  return c.json(t ?? { key: null });
});

// The browse lanes: doors into the hubs and genre charts. Each lane wears
// its own page's current #1 title art — never stock, never stale by more
// than the page cache.
const HUB_LANES = [
  { href: "/anime", name: "Anime", genre: "Anime", dek: "The best series, what's new, where to stream it." },
  { href: "/horror", name: "Horror", genre: "Horror", dek: "For people who watch through their fingers." },
  { href: "/sci-fi", name: "Sci-fi & fantasy", genre: "Science-Fiction", dek: "Other worlds, ranked by real ratings." },
  { href: "/classics", name: "Classic film", genre: null, dek: "The canon before 1980, streamable tonight." },
] as const;
const GENRE_LANES = ["Drama", "Crime", "Comedy", "Thriller", "Fantasy", "Mystery", "Romance", "Action"] as const;

// Real series & films only for the marquee surfaces — keeps live-broadcast filler
// (talk shows, news, reality, sports, variety, game/award/panel shows) out of the
// hero, the tonight rail and premieres. type is TVmaze's own classification
// (migration 0021_show_type); rows whose type is still NULL are simply not surfaced.
const MARQUEE_TYPE_LIST = ["Scripted", "Animation", "Documentary"] as const;
const MARQUEE_TYPES = MARQUEE_TYPE_LIST.map((t) => `'${t}'`).join(", ");

/** Backdrop of a lane's reigning #1 — its genre's top show (or, for the
 *  classics lane, the top pre-1980 film). All TMDB calls ride the 7-day
 *  edge cache, so a full render is one burst of cache hits. */
async function laneArts(c: { env: Bindings }): Promise<({ x1: string; x2: string } | null)[]> {
  const key = c.env.TMDB_API_KEY;
  const blank = new Array<null>(HUB_LANES.length + GENRE_LANES.length).fill(null);
  if (!key) return blank;
  const fromShows = async (genre: string) => {
    const r = await c.env.DB.prepare(
      `SELECT tmdb_id FROM shows WHERE genres LIKE ? AND tmdb_id IS NOT NULL
       ORDER BY weight DESC LIMIT 1`,
    )
      .bind(`%"${genre}"%`)
      .first<{ tmdb_id: number }>();
    return r ? tmdbBackdrop(key, r.tmdb_id) : null;
  };
  const fromClassics = async () => {
    const r = await c.env.DB.prepare(
      `SELECT imdb_id FROM movies WHERE year <= 1979 ORDER BY popularity DESC LIMIT 1`,
    ).first<{ imdb_id: string }>();
    return r ? tmdbMovieBackdrop(key, r.imdb_id) : null;
  };
  try {
    return await Promise.all([
      ...HUB_LANES.map((h) => (h.genre ? fromShows(h.genre) : fromClassics())),
      ...GENRE_LANES.map((g) => fromShows(g)),
    ]);
  } catch {
    return blank;
  }
}

// a scrollable poster row with its paging chevrons — the discover rails.
// `ranked` stamps a Top-N numeral on each poster (the trending chart voice).
const Rail: FC<PropsWithChildren<{ label: string; ranked?: boolean }>> = ({ label, ranked, children }) => (
  <div class="poster-rail">
    <button type="button" class="rail-btn rail-btn-prev" aria-label={`Scroll ${label} left`}>
      <span class="chev-icon chev-icon-prev" aria-hidden="true"></span>
    </button>
    <div class={ranked ? "poster-row poster-row-ranked" : "poster-row"}>{children}</div>
    <button type="button" class="rail-btn rail-btn-next" aria-label={`Scroll ${label} right`}>
      <span class="chev-icon" aria-hidden="true"></span>
    </button>
  </div>
);

// evening-card shelves — same chevrons, but the list itself scrolls
const ShelfRail: FC<PropsWithChildren<{ label: string; ordered?: boolean }>> = ({
  label,
  ordered,
  children,
}) => (
  <div class="poster-rail shelf-rail">
    <button type="button" class="rail-btn rail-btn-prev" aria-label={`Scroll ${label} left`}>
      <span class="chev-icon chev-icon-prev" aria-hidden="true"></span>
    </button>
    {ordered ? <ol class="poster-shelf">{children}</ol> : <ul class="poster-shelf">{children}</ul>}
    <button type="button" class="rail-btn rail-btn-next" aria-label={`Scroll ${label} right`}>
      <span class="chev-icon" aria-hidden="true"></span>
    </button>
  </div>
);

// ---------------------------------------------------------------- home

// homepage discovery rails: live TMDB (always current), card-shaped so the cards
// render + their links resolve via the detail fallback. A D1 fallback keeps the
// rail from emptying if the key is missing / TMDB hiccups.
//
// "Popular" stays ranked by TMDB popularity (the heat signal — distinct from the
// Top-rated rail), but we keep a quality floor: a card must actually be rated and
// clear a watchable bar, so brand-new unrated titles and low-rated noise never
// ride the popularity wave onto the shelf.
const POPULAR_MIN_RATING = 7.0;
const isRated = (h: { rating: number | null }) => h.rating != null && h.rating >= POPULAR_MIN_RATING;
async function popularShowRail(c: { env: Bindings }): Promise<ShowRow[]> {
  const key = c.env.TMDB_API_KEY;
  if (key) {
    const hits = (await tmdbPopular(key, "tv")).filter(isRated);
    if (hits.length) return hits.slice(0, 18).map(toShowRow);
  }
  return (
    await c.env.DB.prepare(
      "SELECT * FROM shows WHERE rating >= ? ORDER BY weight DESC LIMIT 18",
    )
      .bind(POPULAR_MIN_RATING)
      .all<ShowRow>()
  ).results;
}
async function popularMovieRail(c: { env: Bindings }): Promise<MovieRow[]> {
  const key = c.env.TMDB_API_KEY;
  if (key) {
    const hits = (await tmdbPopular(key, "movie")).filter(isRated);
    if (hits.length) return hits.slice(0, 18).map(toMovieRow);
  }
  return (
    await c.env.DB.prepare(
      "SELECT * FROM movies WHERE rating >= ? ORDER BY popularity DESC LIMIT 18",
    )
      .bind(POPULAR_MIN_RATING)
      .all<MovieRow>()
  ).results;
}
async function trendingShowRail(c: { env: Bindings }): Promise<ShowRow[]> {
  return c.env.TMDB_API_KEY
    ? (await tmdbTrendingList(c.env.TMDB_API_KEY, "tv", "day")).slice(0, 18).map(toShowRow)
    : [];
}
async function trendingMovieRail(c: { env: Bindings }): Promise<MovieRow[]> {
  return c.env.TMDB_API_KEY
    ? (await tmdbTrendingList(c.env.TMDB_API_KEY, "movie", "day")).slice(0, 18).map(toMovieRow)
    : [];
}

// the movie half of the marquee: upcoming releases, popularity-ranked, mirrored
// titles linked to their canonical page (the rest resolve via the detail hint).
type ComingMovie = {
  title: string;
  slug: string | null;
  tmdb_id: number;
  poster_url: string | null;
  release_date: string;
};
async function upcomingMovieRail(c: { env: Bindings }): Promise<ComingMovie[]> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return [];
  const today = new Date().toISOString().slice(0, 10);
  const top = (await tmdbUpcomingMovies(key))
    .filter((m) => m.releaseDate >= today)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 12);
  if (!top.length) return [];
  const slugByTmdb = new Map<number, string>();
  const ids = top.map((m) => m.tmdbId);
  const { results } = await c.env.DB.prepare(
    `SELECT tmdb_id, slug FROM movies WHERE tmdb_id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<{ tmdb_id: number; slug: string }>();
  for (const r of results) slugByTmdb.set(r.tmdb_id, r.slug);
  return top.map((m) => ({
    title: m.title,
    slug: slugByTmdb.get(m.tmdbId) ?? null,
    tmdb_id: m.tmdbId,
    poster_url: m.posterPath ? `https://image.tmdb.org/t/p/w342${m.posterPath}` : null,
    release_date: m.releaseDate,
  }));
}

// the marquee: the week's #1 trending series, period — live from TMDB so it's
// always the genuine chart-topper, mirrored or not. We skip the reality/news/
// soap/talk genres the hero has always kept out (no AGT, no broadcast news),
// then build the full row (genres, network, providers) for the rich treatment.
const HERO_SKIP_GENRES = new Set([10763, 10764, 10766, 10767]); // news, reality, soap, talk
async function trendingHeroPick(
  c: AppContext,
): Promise<{
  show: ShowRow;
  trailer: { key: string; name: string } | null;
  candidates: { key: string; name: string }[];
  rank: number;
} | null> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return null;
  const list = await tmdbTrendingList(key, "tv", "day");
  // the marquee autoplays a trailer, so feature the highest-ranked trending
  // series whose trailer actually PLAYS for this viewer (region-aware) — skip
  // reality/news/soap/talk, check the top few in parallel, take the first that
  // plays; if none do, keep #1 and show its backdrop (trailer: null).
  const candidates = list
    .filter((h) => !(h.genreIds ?? []).some((g) => HERO_SKIP_GENRES.has(g)))
    .slice(0, 6);
  if (!candidates.length) return null;
  const trailers = await Promise.all(candidates.map((h) => playableTrailer(c, "tv", h.tmdbId)));
  const idx = trailers.findIndex((t) => t);
  let pick = idx >= 0 ? idx : 0;
  // full ordered candidate list for the chosen show so the inline player can fall
  // through to the next trailer if its first pick won't play (cached call).
  let cands = await playableTrailerList(c, "tv", candidates[pick].tmdbId);
  // if the chosen #1 has NO trailers at all, the inline player has nothing to
  // drive — advance to the next trending show that does, so cross-show fallthrough
  // still kicks in (matches the /api/hero contract).
  if (!cands.length) {
    for (let k = pick + 1; k < candidates.length; k++) {
      const list = await playableTrailerList(c, "tv", candidates[k].tmdbId);
      if (list.length) {
        pick = k;
        cands = list;
        break;
      }
    }
  }
  const show = await tmdbHeroShow(key, candidates[pick].tmdbId);
  if (!show) return null;
  return { show, trailer: cands[0] ?? null, candidates: cands, rank: pick };
}

// A hero row is just a show row with the optional "what's airing tonight" episode
// fields nulled out — trending heroes carry no specific episode.
type SpotRow = ShowRow & {
  ep_name: string | null;
  ep_season: number | null;
  ep_number: number | null;
  ep_airdate: string | null;
  ep_airstamp: string | null;
};
const asSpot = (s: ShowRow): SpotRow => ({
  ...s,
  ep_name: null,
  ep_season: null,
  ep_number: null,
  ep_airdate: null,
  ep_airstamp: null,
});

// The marquee spotlight — rendered inline on "/" AND, for cross-show fallthrough,
// by GET /api/hero so the client can swap the WHOLE hero to the next trending
// show when the featured one's trailers are all region-blocked. `rank` (trending
// position) is stamped as data-hero-rank; the client requests /api/hero?i=rank+1
// for the next show. A null rank means no client switching (tonight/premiere hero).
const Spotlight: FC<{
  spot: SpotRow;
  heroBackdrop: { x1: string; x2?: string } | null;
  spotFrame: string | null;
  candidates: { key: string; name: string }[];
  cast: Awaited<ReturnType<typeof tmdbShowCast>>;
  region: string;
  eyebrow: string;
  isTonight: boolean;
  airTimeText: string | null;
  airIso: string | null;
  genres: string[];
  net: string | null;
  showProof: boolean;
  verdictTotal: number;
  rank: number | null;
}> = ({
  spot,
  heroBackdrop,
  spotFrame,
  candidates,
  cast,
  region,
  eyebrow,
  isTonight,
  airTimeText,
  airIso,
  genres,
  net,
  showProof,
  verdictTotal,
  rank,
}) => {
  const heroTrailer = candidates[0] ?? null;
  return (
    <section
      class={`spotlight${heroBackdrop ? "" : " spot-ambient"}${heroTrailer ? " spot-cinema" : ""}`}
      aria-labelledby="spot-title"
      data-hero-rank={rank != null ? String(rank) : undefined}
      data-hero-tmdb={rank != null && spot.tmdb_id != null ? String(spot.tmdb_id) : undefined}
    >
      {spotFrame ? <div class="hero-backdrop" style={spotFrame}></div> : null}
      {showProof ? (
        <div class="home-proof">
          <span class="home-proof-chip">
            {verdictTotal.toLocaleString()} community ratings
          </span>
        </div>
      ) : null}
      <div class={heroTrailer ? "spot-head spot-head-video" : "spot-head"}>
        {(() => {
          const p = posterSrc(spot);
          return p ? (
            <img
              class="spot-poster"
              src={p.src}
              srcset={p.srcset}
              alt={spot.name}
              width="172"
              height="258"
              fetchpriority="high"
              decoding="async"
            />
          ) : null;
        })()}
        <div class="spot-info">
          <p class="eyebrow">
            {isTonight ? <span class="live-dot"></span> : null}
            {homeDateline()}
            {eyebrow ? (
              <>
                <span class="eyebrow-sep">·</span>
                {eyebrow}
              </>
            ) : null}
            {airTimeText ? (
              <span class="eyebrow-time">
                <span class="eyebrow-sep">·</span>
                <time data-localtime datetime={airIso ?? undefined}>
                  {airTimeText} UTC
                </time>
              </span>
            ) : null}
          </p>
          <h1 class="spot-title" id="spot-title">
            <a href={`/show/${spot.slug}`}>{spot.name}</a>
          </h1>
          <p class="meta-strip">
            <span>
              <a href="/top/tv" title="The top TV shows, ranked">TV</a>
            </span>
            <span class="sep">·</span>
            <StatusBadge status={spot.status} />
            {spot.premiered ? <span>{spot.premiered.slice(0, 4)}</span> : null}
            {genres.length ? (
              <span class="mi-genres">
                <span class="sep sep-genres">·</span>
                <span class="mi-genres-list">
                  {genres.slice(0, 3).map((g, i) => (
                    <>
                      {i > 0 ? ", " : ""}
                      <a href={`/genre/${slugifyName(g)}/shows`}>{g}</a>
                    </>
                  ))}
                </span>
              </span>
            ) : null}
            {spot.rating != null ? (
              <>
                <span class="sep">·</span>
                <span class="rating"><IconStar class="rating-star" />{spot.rating.toFixed(1)}</span>
              </>
            ) : isNewYear(spot.premiered ? Number(spot.premiered.slice(0, 4)) : null) ? (
              <>
                <span class="sep">·</span>
                <span class="meta-new">NEW</span>
              </>
            ) : null}
          </p>
          {spot.summary ? <p class="spot-dek">{stripHtml(spot.summary)}</p> : null}
          {spot.ep_season != null ? (
            <p class="spot-ep">
              S{String(spot.ep_season).padStart(2, "0")}E
              {String(spot.ep_number ?? 0).padStart(2, "0")}
              {spot.ep_name ? ` — ${spot.ep_name}` : ""}
              {net ? (
                <span class="muted">
                  {" · "}
                  <a href={`/network/${slugifyName(net)}`}>{net}</a>
                </span>
              ) : null}
            </p>
          ) : null}
          <ProviderLine row={spot} region={region} title={spot.name} pickerType="tv" />
          <div class="spot-actions">
            <a class="verdict-btn chev-after" href="/recommend">
              Rate my taste
            </a>
            <a class="btn-ghost chev-after" href={`/show/${spot.slug}`}>
              Episode guide & ratings
            </a>
          </div>
        </div>
        {heroTrailer ? (
          <div class="spot-aside">
            <div class="hub-hero-player spot-trailer-wrap" data-hero-pip>
              <HeroTrailerEmbed
                href={`/show/${spot.slug}`}
                title={spot.name}
                candidates={candidates}
                fallbackBackdrop={heroBackdrop}
                videoClass="spot-trailer hub-hero-video"
                frameClass="spot-trailer-frame hub-hero-video-frame"
              />
            </div>
            {cast.length ? (
              <div class="spot-cast" aria-label={`${spot.name} cast`}>
                {cast.map((p) => {
                  const href = personHref(p);
                  const face = (
                    <>
                      <span class="spot-cast-face">
                        <img
                          src={p.img!}
                          alt={p.n}
                          width="60"
                          height="60"
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                      <span class="spot-cast-name">{p.n}</span>
                    </>
                  );
                  const label = p.c ? `${p.n} — ${p.c}` : p.n;
                  return href ? (
                    <a class="spot-cast-member" href={href} title={label}>
                      {face}
                    </a>
                  ) : (
                    <span class="spot-cast-member" title={label}>
                      {face}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
};

// Cross-show fallthrough fragment: the Nth trending show's spotlight (the first
// at rank >= i that has trailers). The client swaps this in when the current
// hero's trailers are all unplayable. 204 once the trending list is exhausted.
app.get("/api/hero", async (c) => {
  const key = c.env.TMDB_API_KEY;
  if (!key) return c.body(null, 204);
  const start = Math.max(0, parseInt(c.req.query("i") ?? "0", 10) || 0);
  // shows already shown+failed on the client — skip them so a cf-cache reshuffle
  // of the trending order can't re-surface a dud the viewer just saw fail
  const skip = new Set(
    (c.req.query("not") ?? "")
      .split(",")
      .map((s) => parseInt(s, 10))
      .filter((n) => !Number.isNaN(n)),
  );
  const list = await tmdbTrendingList(key, "tv", "day");
  const candidates = list
    .filter((h) => !(h.genreIds ?? []).some((g) => HERO_SKIP_GENRES.has(g)))
    .slice(0, 6);
  for (let rank = start; rank < candidates.length; rank++) {
    if (skip.has(candidates[rank].tmdbId)) continue;
    const cands = await playableTrailerList(c, "tv", candidates[rank].tmdbId);
    if (!cands.length) continue; // no trailers at all — skip to the next show
    const show = await tmdbHeroShow(key, candidates[rank].tmdbId);
    if (!show) continue;
    const [backdrop, castRaw] = await Promise.all([
      tmdbBackdrop(key, candidates[rank].tmdbId),
      tmdbShowCast(key, candidates[rank].tmdbId, 12),
    ]);
    const spot = asSpot(show);
    const poster = hiRes(show.image_url);
    const spotFrame = backdrop
      ? heroBg(backdrop.x1, backdrop.x2)
      : poster
        ? heroBg(poster)
        : null;
    // keep the site-wide social-proof chip on the swapped hero (page-level value)
    const verdictTotal = await communityVerdictTotal(c.env.DB);
    c.header("Cache-Control", "public, max-age=900");
    return c.html(
      <Spotlight
        spot={spot}
        heroBackdrop={backdrop}
        spotFrame={spotFrame}
        candidates={cands}
        cast={(castRaw ?? []).filter((p) => p.img).slice(0, 7)}
        region={visitorRegion(c)}
        eyebrow="Trending today"
        isTonight={false}
        airTimeText={null}
        airIso={null}
        genres={spot.genres ? JSON.parse(spot.genres) : []}
        net={spot.network ?? spot.web_channel ?? null}
        showProof={verdictTotal >= 50}
        verdictTotal={verdictTotal}
        rank={rank}
      />,
    );
  }
  return c.body(null, 204); // trending list exhausted
});

app.get("/", async (c) => {
  type BackRow = {
    slug: string;
    name: string;
    image_url: string | null;
    poster_url: string | null;
    next_air: string;
    season: number | null;
    number: number | null;
  };
  const [top, topMovies, tonight, comingMovies, spotTonight, spotPremiere, topStill, heroTop, trendMovies, trendTvRail, arts, heroFallback, verdictTotal, backThisWeek] = await Promise.all([
    // "Popular" rails — live TMDB (always current), card-shaped; D1 fallback inside
    popularShowRail(c),
    popularMovieRail(c),
    // On tonight: live from TVmaze's schedule API — accurate, current, scripted
    // streaming titles in air-time order (see src/lib/schedule-live.ts), not our
    // stale D1 snapshot that skewed to daytime soaps.
    // most-popular subset (liveTonight is weight-ordered), then back into
    // air-time order so the rail's times read top-to-bottom as they air
    liveTonight(c, undefined, { backfill: true }).then((r) =>
      // genuine airings ascend by time; curated backfill (no airstamp) sinks last
      r.slice(0, 12).sort((a, b) =>
        a.airstamp && b.airstamp
          ? a.airstamp.localeCompare(b.airstamp)
          : a.airstamp
            ? -1
            : b.airstamp
              ? 1
              : 0,
      ),
    ),
    // Coming up (movie half of the marquee): upcoming releases, popularity-ranked
    upcomingMovieRail(c),
    // spotlight: tonight's biggest show by popularity weight
    c.env.DB.prepare(
      `SELECT s.*, e.name AS ep_name, e.season AS ep_season, e.number AS ep_number,
              e.airdate AS ep_airdate, e.airstamp AS ep_airstamp
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.airstamp >= datetime('now','start of day')
         AND e.airstamp < datetime('now','start of day','+1 day')
         AND s.type IN (${MARQUEE_TYPES})
         AND s.tmdb_id IS NOT NULL
         AND s.rating >= 7.5
       ORDER BY s.rating DESC, s.weight DESC LIMIT 1`,
    ).first<SpotRow>(),
    // fallback spotlight: the biggest premiere of the next three weeks
    c.env.DB.prepare(
      `SELECT s.*, e.name AS ep_name, e.season AS ep_season, e.number AS ep_number,
              e.airdate AS ep_airdate, e.airstamp AS ep_airstamp
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.number = 1 AND e.airstamp > datetime('now')
         AND e.airstamp < datetime('now', '+21 days')
         AND s.type IN (${MARQUEE_TYPES})
         AND s.tmdb_id IS NOT NULL
         AND s.rating >= 7.5
       ORDER BY s.weight DESC LIMIT 1`,
    ).first<SpotRow>(),
    // the current #1 episode's still — the greatest-episodes tile wears it
    c.env.DB.prepare(
      `SELECT image_url FROM episodes
       WHERE image_url IS NOT NULL AND rating IS NOT NULL
       ORDER BY rating DESC LIMIT 1`,
    ).first<{ image_url: string }>(),
    trendingHeroPick(c),
    trendingMovieRail(c),
    trendingShowRail(c),
    laneArts(c),
    // ultimate hero fallback: the biggest scripted/animation/doc title overall, so
    // the marquee is never a talk show or reality broadcast even on a quiet night
    c.env.DB.prepare(
      `SELECT * FROM shows WHERE type IN (${MARQUEE_TYPES}) AND tmdb_id IS NOT NULL AND rating IS NOT NULL
         AND weight >= 40 AND status IN ('Running', 'To Be Determined')
       ORDER BY rating DESC, weight DESC LIMIT 1`,
    ).first<ShowRow>(),
    communityVerdictTotal(c.env.DB),
    c.env.DB
      .prepare(
        `WITH next_premiere AS (
           SELECT show_id, MIN(airstamp) AS next_air
           FROM episodes
           WHERE number = 1
             AND airstamp > datetime('now', 'start of day', '+1 day')
             AND airstamp < datetime('now', '+7 days')
           GROUP BY show_id
         )
         SELECT s.slug, s.name, s.image_url, s.poster_url, n.next_air, e.season, e.number
         FROM next_premiere n
         JOIN shows s ON s.id = n.show_id
         JOIN episodes e ON e.show_id = n.show_id AND e.airstamp = n.next_air AND e.number = 1
         WHERE s.type IN (${MARQUEE_TYPES})
           AND s.tmdb_id IS NOT NULL
           AND s.weight >= 55
           AND s.rating >= 6.5
         ORDER BY n.next_air ASC, s.weight DESC
         LIMIT 12`,
      )
      .all<BackRow>(),
  ]);

  // the marquee always leads with the week's #1 trending series — the genuine
  // chart-topper, live from TMDB (mirrored or not), reality/news/soap/talk kept
  // out. Falls back to tonight's premium airing, a premiere, then a top series.
  const trendingHero = heroTop?.show ?? null;
  const spot: SpotRow | null = trendingHero
    ? asSpot(trendingHero)
    : spotTonight ?? spotPremiere ?? (heroFallback ? asSpot(heroFallback) : null);
  // only the genuine on-tonight hero carries a live dot + air time and de-dupes
  // itself from the schedule rail below
  const heroIsTonight = spot != null && spot === spotTonight;
  const heroIsTrending = !!trendingHero;
  const spotEyebrow = heroIsTrending
    ? "Trending today"
    : spotTonight
      ? "On tonight"
      : spotPremiere
        ? `Premieres ${spotPremiere.ep_airdate ? longDate(spotPremiere.ep_airdate) : "soon"}`
        : "Tonight's pick";
  const spotAirTime = heroIsTonight && spotTonight?.ep_airstamp ? airTime(spotTonight.ep_airstamp) : null;
  // canonical UTC instant for client-side localization; the UTC string stays the
  // truthful no-JS fallback and localtime.js swaps in the viewer's local time
  const spotAirIso =
    heroIsTonight && spotTonight?.ep_airstamp ? new Date(spotTonight.ep_airstamp).toISOString() : null;
  const spotGenres: string[] = spot?.genres ? JSON.parse(spot.genres) : [];
  const spotNet: string | null = spot?.network ?? spot?.web_channel ?? null;
  const alsoTonight =
    heroIsTonight && spotTonight ? tonight.filter((e) => e.show_slug !== spotTonight.slug) : tonight;
  // a trending rail needs enough matched titles to read as a rail at all
  const hasTrendTv = trendTvRail.length >= 4;
  const hasTrendMovies = trendMovies.length >= 4;
  const tonightSlugs = new Set(tonight.map((e) => e.show_slug));
  const returning = backThisWeek.results.filter((r) => !tonightSlugs.has(r.slug)).slice(0, 8);
  const showProof = verdictTotal >= 50;

  // the sign-on frame: the spotlight show's real designed backdrop (one
  // edge-cached call); falls back to its poster blurred into ambient light.
  // Fetched alongside the hero's trailer (the autoplay panel on the right) —
  // both ride the same cached bundle, so this is one burst of cache hits.
  // reuse the trailer we already region-checked for the trending marquee;
  // for a tonight/premiere fallback spot, check its trailer's playability now.
  const spotIsTrendingHero = !!trendingHero && spot?.tmdb_id === trendingHero.tmdb_id;
  const [backdrop, heroTrailerList, heroCastRaw] =
    spot?.tmdb_id && c.env.TMDB_API_KEY
      ? await Promise.all([
          tmdbBackdrop(c.env.TMDB_API_KEY, spot.tmdb_id),
          // reuse the candidate list already region-checked for the trending
          // marquee; otherwise build it now for the tonight/premiere fallback spot
          spotIsTrendingHero
            ? Promise.resolve(heroTop?.candidates ?? [])
            : playableTrailerList(c, "tv", spot.tmdb_id),
          tmdbShowCast(c.env.TMDB_API_KEY, spot.tmdb_id, 12),
        ])
      : [null, [] as { key: string; name: string }[], [] as Awaited<ReturnType<typeof tmdbShowCast>>];
  // the billed cast that actually has a headshot — the faces under the trailer
  const heroCast = (heroCastRaw ?? []).filter((p) => p.img).slice(0, 7);
  const spotPosterBg = spot ? hiRes(spot.image_url) : null;
  const spotFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : spotPosterBg
      ? heroBg(spotPosterBg)
      : null;

  const sidebarTops = c.get("siteSidebar");
  const sidebarTrailers = await latestTrailers(
    c.env.TMDB_API_KEY,
    trailerSeedsFromRails(trendTvRail, trendMovies, top, topMovies),
    SIDEBAR_TRAILER_LIMIT,
  );

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title="TV Nightly — best episodes, release dates & TV tonight"
      description="Track the best episodes of every TV show, season release dates, renewal status, and what's airing tonight."
      canonical={canonical(c)}
      ld={siteIdentityLd(origin(c))}
      scripts={["/js/poster-rail.js"]}
      preloadImage={backdrop ?? undefined}
    >
      <div class="home">
        {/* Newsletter bar: pinned just under the header so it's the first thing
            a visitor meets — subscribe without scrolling. Full-bleed glass, the
            amber CTA the only pop. */}
        <section class="home-newsbar" aria-labelledby="home-email-title">
          <div class="home-newsbar-inner">
            <div class="home-newsbar-copy">
              <span class="home-newsbar-kicker" aria-hidden="true">
                <IconMail size={13} />
              </span>
              <p class="home-newsbar-title" id="home-email-title">
                <span class="home-newsbar-title-main">Tonight's best TV</span>
                <span class="home-newsbar-title-sub">in your inbox</span>
              </p>
            </div>
            <form action="/subscribe" method="post" class="home-newsbar-form">
              <input type="hidden" name="kind" value="daily" />
              <input
                type="email"
                name="email"
                placeholder="you@email.com"
                aria-label="Email address"
                required
                autocomplete="email"
              />
              <Honeypot />
              <button type="submit">Subscribe</button>
            </form>
          </div>
        </section>
        {/* Sign-on: tonight's headline in the house frame treatment. The
            section has no chrome — the scrim resolves to --bg, so it melts
            into the page. Data-driven, never a marketing banner. */}
        {spot ? (
          <Spotlight
            spot={spot}
            heroBackdrop={backdrop}
            spotFrame={spotFrame}
            candidates={heroTrailerList}
            cast={heroCast}
            region={visitorRegion(c)}
            eyebrow={spotEyebrow}
            isTonight={heroIsTonight}
            airTimeText={spotAirTime}
            airIso={spotAirIso}
            genres={spotGenres}
            net={spotNet}
            showProof={showProof}
            verdictTotal={verdictTotal}
            rank={heroIsTrending ? (heroTop?.rank ?? null) : null}
          />
        ) : null}

        {/* two cards, and the CTA stack floats centered over their curved
            bottoms — the evening ends at the question */}
        <section class="evening">
          <div class="evening-grid">
            <div class="evening-card evening-main">
              <div class="evening-head">
                <div class="evening-head-top">
                  <h2>
                    {heroIsTonight ? (
                      <>
                        <span class="live-dot"></span>Also on tonight
                      </>
                    ) : (
                      <>
                        <span class="live-dot"></span>On tonight
                      </>
                    )}
                  </h2>
                  <a class="more" href="/tonight">
                    full schedule
                  </a>
                </div>
                <p class="section-lead muted">Today's most-watched shows, in air-time order — your local time.</p>
              </div>
              {alsoTonight.length ? (
                <ShelfRail label="also on tonight" ordered>
                  {alsoTonight.map((e) => {
                    // curated backfill rows have no episode (null season) — don't
                    // stamp them "S00E00" in the tooltip/label
                    const ep = e.season != null ? ` ${epCode(e)}` : "";
                    return (
                    <li>
                      <a
                        class="shelf-tile"
                        href={`/show/${e.show_slug}`}
                        title={`${e.show_name}${ep}${e.name ? ` — ${e.name}` : ""}${e.network ? ` · ${e.network}` : ""}`}
                        aria-label={`${e.show_name}${ep}, ${airTime(e.airstamp) ?? "tonight"}`}
                      >
                        {(e.show_poster ?? e.show_image) ? (
                          <img
                            {...posterImg((e.show_poster ?? e.show_image)!, "shelf")!}
                            alt={`${e.show_name} poster`}
                            width="92"
                            height="138"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span class="shelf-fallback">{e.show_name}</span>
                        )}
                        <span class="shelf-chip">
                          {e.airstamp ? (
                            <time data-localtime datetime={new Date(e.airstamp).toISOString()}>
                              {airTime(e.airstamp)}
                            </time>
                          ) : (
                            "tonight"
                          )}
                        </span>
                      </a>
                      <span class="shelf-name">{e.show_name}</span>
                    </li>
                    );
                  })}
                </ShelfRail>
              ) : (
                <p class="muted">
                  {heroIsTonight
                    ? "Nothing else on the schedule tonight — the spotlight has the room."
                    : "Quiet night in the schedule — a good one to start something."}
                </p>
              )}
            </div>
            <div class="evening-card evening-aside">
              <div class="evening-head">
                <div class="evening-head-top">
                  <h2>New movies</h2>
                  <a class="more" href="/premieres?tab=movies">
                    all premieres
                  </a>
                </div>
                <p class="section-lead muted">The most anticipated films coming to theaters &amp; streaming.</p>
              </div>
              {comingMovies.length ? (
                <ShelfRail label="new movies">
                  {comingMovies.map((m) => {
                    const { day, month } = premiereDateParts(m.release_date);
                    const href = m.slug
                      ? `/movie/${m.slug}`
                      : `/movie/${slugifyName(m.title)}?t=${m.tmdb_id}`;
                    return (
                      <li>
                        <a
                          class="shelf-tile"
                          href={href}
                          title={`${m.title} — ${longDate(m.release_date)}`}
                          aria-label={`${m.title}, out ${month ? `${month} ${day}` : "soon"}`}
                        >
                          {m.poster_url ? (
                            <img
                              {...posterImg(m.poster_url, "shelf")!}
                              alt={`${m.title} poster`}
                              width="92"
                              height="138"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span class="shelf-fallback">{m.title}</span>
                          )}
                          <span class="shelf-chip shelf-chip-date">
                            <span class="chip-soon">Soon</span>
                            {month ? `${month} ${day}` : null}
                          </span>
                        </a>
                        <span class="shelf-name">{m.title}</span>
                      </li>
                    );
                  })}
                </ShelfRail>
              ) : (
                <p class="muted">No upcoming movies on the calendar right now.</p>
              )}
            </div>
          </div>
          <div class="evening-cta evening-cta-co">
            <a class="verdict-btn chev-after" href="/recommend">
              Rate my taste
            </a>
            <a class="verdict-btn verdict-btn-outline" href="/what-to-watch">
              Find something tonight
            </a>
          </div>
        </section>

        {/* Moviefone-style two-column band: the content rails on the left, a
            sticky right rail with Latest Trailers + Follow alongside. */}
        <section class="home-main-grid">
          <div class="home-col">
        {returning.length ? (
          <section class="home-returning">
            <div class="home-returning-card">
              <div class="home-returning-head">
                <h2>Premieres this week</h2>
                <a class="more" href="/premieres">
                  all premieres
                </a>
              </div>
              <p class="section-lead muted">New seasons starting in the next seven days — not what's on tonight.</p>
              <ShelfRail label="premieres this week" ordered>
                {returning.map((r) => {
                  const poster = posterSrc(r);
                  const season =
                    r.season != null ? `S${String(r.season).padStart(2, "0")}` : null;
                  const weekday = new Date(r.next_air).toLocaleString("en-US", { weekday: "short" });
                  const premiereLabel =
                    r.season != null && r.season > 1 ? `${season} premiere` : "Series premiere";
                  return (
                    <li>
                      <a
                        class="shelf-tile"
                        href={`/show/${r.slug}/release-date`}
                        title={`${r.name}${season ? ` · ${premiereLabel}` : ""}`}
                        aria-label={`${r.name}, ${premiereLabel}, ${weekday} ${airTime(r.next_air) ?? ""}`}
                      >
                        {poster ? (
                          <img
                            src={poster.src}
                            srcset={poster.srcset}
                            alt={`${r.name} poster`}
                            width="92"
                            height="138"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span class="shelf-fallback">{r.name}</span>
                        )}
                        <span class="shelf-chip shelf-chip-date">
                          <span class="chip-soon">{weekday}</span>
                          <time data-localtime="compact" datetime={new Date(r.next_air).toISOString()}>
                            {airTime(r.next_air) ?? longDate(r.next_air.slice(0, 10))}
                          </time>
                        </span>
                      </a>
                      <span class="shelf-name">
                        {r.name}
                        {season ? <span class="home-returning-ep"> · {premiereLabel}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ShelfRail>
            </div>
          </section>
        ) : null}

        <section class="home-discover">
          <div class="discover-tabs">
            <input type="radio" name="discover" id="discover-tv" class="discover-input" checked />
            <input type="radio" name="discover" id="discover-movies" class="discover-input" />
            <div class="discover-head">
              <h2>Popular TV &amp; movies</h2>
              <p class="section-lead muted">Ranked by popularity, not ratings — see top-rated for the critical picks.</p>
            </div>
            <div class="discover-tablist">
              <div class="discover-tabrow">
                <label for="discover-tv">TV shows</label>
                <label for="discover-movies">Movies</label>
              </div>
              <span class="discover-more">
                <a class="more more-tv" href="/top/tv">
                  top-rated
                </a>
                <a class="more more-movies" href="/movies/best">
                  best of all time
                </a>
              </span>
            </div>
            <div class="discover-panel panel-tv">
              <Rail label="shows">
                {top.map((s) => (
                  <ShowCard show={s} />
                ))}
              </Rail>
            </div>
            <div class="discover-panel panel-movies">
              <Rail label="movies">
                {topMovies.map((m) => (
                  <MovieCard movie={m} />
                ))}
              </Rail>
            </div>
          </div>

          {/* the weekly worldwide pulse — TMDB trending, matched against our
              mirror so every card leads to a real page. Quietly absent when
              the data is (no key, API down, nothing matched). */}
          {hasTrendTv || hasTrendMovies ? (
            <div class="discover-tabs">
              {hasTrendTv && hasTrendMovies ? (
                <>
                  <input type="radio" name="trending" id="trend-tv" class="discover-input" checked />
                  <input type="radio" name="trending" id="trend-movies" class="discover-input" />
                </>
              ) : null}
              <div class="discover-head">
                <h2>Trending today</h2>
                <p class="section-lead muted">What the world is watching.</p>
              </div>
              {hasTrendTv && hasTrendMovies ? (
                <div class="discover-tablist">
                  <div class="discover-tabrow">
                    <label for="trend-tv">TV shows</label>
                    <label for="trend-movies">Movies</label>
                  </div>
                </div>
              ) : null}
              {hasTrendTv ? (
                <div class={hasTrendMovies ? "discover-panel panel-tv" : undefined}>
                  <Rail label="trending shows" ranked>
                    {trendTvRail.map((s) => (
                      <ShowCard show={s} />
                    ))}
                  </Rail>
                </div>
              ) : null}
              {hasTrendMovies ? (
                <div class={hasTrendTv ? "discover-panel panel-movies" : undefined}>
                  <Rail label="trending movies" ranked>
                    {trendMovies.map((m) => (
                      <MovieCard movie={m} />
                    ))}
                  </Rail>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <NewsletterBand />

        {/* the doors out — hub and genre lanes wearing their pages' own art */}
        <section class="home-lanes">
          <div class="lanes-head">
            <h2>
              Pick a lane{" "}
              <a class="more" href="/lists">
                every chart &amp; list
              </a>
            </h2>
            <p class="section-lead muted nowrap-wide">
              Hubs and genres — each ranked by real ratings, with where to stream.
            </p>
          </div>
          <div class="lane-grid lane-grid-hubs">
            {HUB_LANES.map((h, i) => (
              <a class="lane-tile lane-tile-lg" href={h.href}>
                {arts[i] ? (
                  <span
                    class="lane-frame"
                    style={heroBg(arts[i]!.x1, arts[i]!.x2)}
                    aria-hidden="true"
                  ></span>
                ) : null}
                <span class="lane-body">
                  <span class="lane-kicker">Fandom hub</span>
                  <strong>{h.name}</strong>
                  <span class="lane-dek">{h.dek}</span>
                </span>
              </a>
            ))}
          </div>
          <div class="lane-grid lane-grid-genres">
            {GENRE_LANES.map((g, i) => (
              <a class="lane-tile" href={`/genre/${slugifyName(g)}`}>
                {arts[HUB_LANES.length + i] ? (
                  <span
                    class="lane-frame"
                    style={heroBg(arts[HUB_LANES.length + i]!.x1, arts[HUB_LANES.length + i]!.x2)}
                    aria-hidden="true"
                  ></span>
                ) : null}
                <span class="lane-body">
                  <span class="lane-kicker">Genre</span>
                  <strong>{g}</strong>
                </span>
              </a>
            ))}
          </div>
        </section>

        <section class="home-tools">
          <h2>Go deeper</h2>
          <div class="tools-bento">
            {/* the tiles wear their own pages' real content: the current #1
                episode's still, the picker's actual services — never stock art */}
            <a class="tool-tile tool-tile-lg" href="/best-episodes">
              {topStill?.image_url ? (
                <span
                  class="tool-tile-art"
                  style={`background-image:url('${topStill.image_url.replace("/medium_landscape/", "/large_landscape/")}')`}
                  aria-hidden="true"
                ></span>
              ) : null}
              <strong>The greatest episodes ever aired</strong>
              <p class="muted">Every show's finest hours, ranked on one honest list.</p>
              <span class="tool-tile-provs" aria-hidden="true">
                {["Netflix", "Amazon Prime Video", "Hulu", "Disney Plus"].map((n) =>
                  PROVIDER_LOGOS[n] ? (
                    <img src={PROVIDER_LOGOS[n]} alt="" width="34" height="34" loading="lazy" />
                  ) : null,
                )}
              </span>
              <span class="chev-icon" aria-hidden="true"></span>
            </a>
            <a class="tool-tile tool-tile-lg" href="/recommend">
              <span class="tool-tile-glyph" aria-hidden="true">
                <IconSparkle size={120} />
              </span>
              <strong>What should I watch next?</strong>
              <p class="muted">Rate a few you've seen — we read your taste and pick your next watch.</p>
              <span class="chev-icon" aria-hidden="true"></span>
            </a>
            <div class="tools-bento-rest">
              {/* tonight/utility */}
              <a class="tool-tile tool-tile-sm" href="/what-to-watch">
                <span>Tonight's picker</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconDial size={46} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/tonight">
                <span>Tonight's full schedule</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconCal size={38} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/compare">
                <span>Compare two shows</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconVs size={58} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              {/* rankings, grouped */}
              <a class="tool-tile tool-tile-sm" href="/top/tv">
                <span>Top TV shows</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconTvPlay size={54} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/movies/best">
                <span>Top movies</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconReel size={62} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/top/seasons">
                <span>Best TV seasons</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconClapper size={56} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/top/networks">
                <span>Top networks</span>
                <span class="tool-tile-logos" aria-hidden="true">
                  {["HBO Max", "Netflix", "Hulu", "Disney Plus"].map((n) =>
                    PROVIDER_LOGOS[n] ? (
                      <img src={PROVIDER_LOGOS[n]} alt="" width="32" height="32" loading="lazy" />
                    ) : null,
                  )}
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              {/* discover */}
              <a class="tool-tile tool-tile-sm" href="/loved">
                <span>Loved by this community</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconHearts size={56} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/whats-new">
                <span>What's new on streaming</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconSparkle size={48} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/watch-orders">
                <span>Watch-order guides</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconRoute size={50} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
            </div>
          </div>
        </section>
          </div>
          <HomeSidebarRail
            trailers={sidebarTrailers}
            topSeries={sidebarTops?.topSeries ?? []}
            topMovies={sidebarTops?.topMovies ?? []}
          />
        </section>

      </div>
    </Layout>,
  );
});

export default app;
