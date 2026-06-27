import { Hono } from "hono";
import { Child, FC } from "hono/jsx";
import { Honeypot, Layout } from "../components/Layout";
import { ExploreCard, MovieCard, ShowCard } from "../components/cards";
import { HomeSidebarRail } from "../components/home-sidebar";
import { KeepExploring, movieKeepGoingBackdrop, showKeepGoingBackdrop } from "../components/keep-going";
import { IconStar, IconStarBadge } from "../components/icons";
import { ShareBar } from "../components/share";
import { TasteProfileShare } from "../components/taste-profile";
import { ipHash } from "../lib/crypto";
import { heroBg, hiRes, retinaSet } from "../lib/format";
import { isTmdbRef, materializeTmdbTitle } from "../lib/materialize";
import { RatedEntry, VERDICTS, VERDICT_SCALE, fmtRated, getRatedTitle, parseRated } from "../lib/ratings";
import { DeckCard, Pick, WhySignal, buildRecommendation, enrichDeck, landingPicks } from "../lib/recommend";
import { servePng } from "../lib/render";
import { foldSql, foldText } from "../lib/search";
import { breadcrumbTrail, canonical, itemListLd, origin } from "../lib/seo";
import { posterDataUri } from "../lib/signal";
import { TasteProfileCardData, buildOgCard, buildTasteProfileCard, buildTasteProfileOgCard } from "../lib/social";
import { tmdbBackdrop, tmdbMovieBackdrop, tmdbTrendingList } from "../lib/tmdb";
import { toMovieRow, toShowRow } from "../lib/tmdb-rows";
import type { ExploreArt } from "../lib/explore-art";
import type { AppContext } from "../types";
import { Bindings, HonoEnv, MovieRow, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

// Ratings collected before we synthesize the match (rate card 1 + deck cards).
const TARGET = 5;

/** Shared loader for taste-profile PNG + public share page. */
async function loadTasteShare(c: AppContext, rated: RatedEntry[]) {
  if (rated.length < 2) return null;
  const hash = await ipHash(c.env.SECRET ?? "anon-salt", "taste-share");
  const rec = await buildRecommendation(c.env.DB, hash, rated);
  if (!rec.primary || !rec.tasteProfile.slices.length) return null;
  const primary = rec.primary;
  let bd: { x1: string } | null = null;
  if (c.env.TMDB_API_KEY) {
    bd =
      primary.kind === "tv" && primary.tmdbId
        ? await tmdbBackdrop(c.env.TMDB_API_KEY, primary.tmdbId)
        : primary.imdbId
          ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, primary.imdbId)
          : null;
  }
  const heroPoster = primary.poster ? (hiRes(primary.poster) ?? primary.poster) : null;
  const [backdropUri, posterUri] = await Promise.all([
    posterDataUri(bd?.x1 ?? heroPoster),
    posterDataUri(heroPoster),
  ]);
  const cardData: TasteProfileCardData = {
    slices: rec.tasteProfile.slices,
    era: rec.tasteProfile.era,
    nextName: primary.name,
    nextMeta: [primary.genres.slice(0, 2).join(" · "), primary.year].filter(Boolean).join(" · ") || null,
    nextRating: primary.rating,
    posterUri,
    backdropUri,
  };
  return { ...rec, cardData };
}

// Hi-res 1x/2x srcset for a poster — keeps the big rate/deck cards sharp on
// retina phones (the bare w342 / medium_portrait source scaled up was blurry).
// Handles both a TVmaze (medium_*) and a TMDB (w342) URL.
const posterSet = (url: string | null | undefined): string | undefined =>
  !url
    ? undefined
    : /\/medium_(portrait|landscape)\//.test(url)
      ? retinaSet(url)
      : url.includes("/w342/")
        ? `${url} 1x, ${url.replace("/w342/", "/w780/")} 2x`
        : undefined;

// ---- shared bits ----------------------------------------------------------

// 4-step rating control: a fanned arc of overlapping colored circles
// (cool→warm sentiment ramp), label inside, the chosen one is the only glow.
// Real mini POST forms — zero-JS safe; recommend.js upgrades the deck to one-tap.
const RatingControl: FC<{ kind: string; ref: string; rated: string }> = ({ kind, ref, rated }) => (
  <div class="rate-fan" role="group" aria-label="How was it?">
    {VERDICT_SCALE.map(({ code, label }) => (
      <form method="post" action="/recommend" class="rate-opt">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="ref" value={ref} />
        {rated ? <input type="hidden" name="rated" value={rated} /> : null}
        <input type="hidden" name="verdict" value={code} />
        <button type="submit" class={`rate-circle rc-${code}`} data-verdict={code}>
          {label}
        </button>
      </form>
    ))}
  </div>
);

// the app's standard poster card, linking into the rate step
const PosterCard: FC<{ c: DeckCard; href: string }> = ({ c, href }) => (
  <a class="card" href={href}>
    <div class="card-media">
      {c.poster ? (
        <img src={c.poster} alt={c.name} loading="lazy" decoding="async" />
      ) : (
        <div class="card-fallback">{c.name}</div>
      )}
      <span class="card-hover-title" aria-hidden="true">{c.name}</span>
    </div>
    <div class="card-body">
      <span class="card-title">{c.name}</span>
    </div>
  </a>
);

// one short, honest chip per contender — the single strongest signal, not prose
const contChip = (p: Pick): string => {
  const w = p.why;
  if (w) {
    if (w.cf >= 2) return "Shared taste";
    if (w.genres.length) return w.genres[0].name;
    if (w.era) return w.era;
    if (w.prov) return w.prov;
  }
  return "Close match";
};

const ContenderCard: FC<{ p: Pick; bg: string | null }> = ({ p, bg }) => (
  <a class="rec-cont" href={p.kind === "tv" ? `/show/${p.slug}` : `/movie/${p.slug}`}>
    <div class="rec-cont-art" style={bg ?? undefined}>
      {!bg ? <span class="rec-cont-blank">{p.name}</span> : null}
      <span class="rec-cont-scrim" aria-hidden="true"></span>
      {p.rating != null ? (
        <span class="card-rating rec-cont-rating">
          <IconStarBadge class="card-rating-star" />
          {p.rating.toFixed(1)}
        </span>
      ) : null}
      <span class="rec-cont-overlay">
        {p.poster ? (
          <img
            class="rec-cont-poster"
            src={p.poster}
            srcset={posterSet(p.poster)}
            alt={`${p.name} poster`}
            loading="lazy"
            decoding="async"
          />
        ) : null}
        <span class="rec-cont-text">
          <span class="card-title">{p.name}</span>
          <span class="rec-cont-chip">{contChip(p)}</span>
        </span>
      </span>
    </div>
  </a>
);

// The "Why this matches" ledger — the heart of the redesign. Each row is a fact
// the user can check against their own taste, derived from the engine's signals.
const WhyLedger: FC<{ why: WhySignal }> = ({ why }) => {
  const rows: { k: string; main: Child; sub: string }[] = [];
  if (why.anchor) rows.push({ k: "anchor", main: <>Because you loved <strong>{why.anchor}</strong></>, sub: "your standout" });
  if (why.genres.length) {
    const names = why.genres.map((g) => g.name).join(" · ");
    const topN = Math.max(...why.genres.map((g) => g.n));
    rows.push({ k: "genre", main: <strong>{names}</strong>, sub: topN >= 2 ? `in ${topN} of your picks` : "your lane" });
  }
  if (why.era) rows.push({ k: "era", main: <strong>{why.era}</strong>, sub: "the era you rate highest" });
  if (why.prov) rows.push({ k: "prov", main: <>On <strong>{why.prov}</strong></>, sub: "where you watch" });
  if (why.cf >= 2) rows.push({ k: "cf", main: <><strong>{why.cf}</strong> with your taste loved it</>, sub: "community" });
  if (!rows.length) return null;
  return (
    <div class="rec-why-ledger">
      <p class="rec-why-head">Why this matches</p>
      <ul>
        {rows.map((r) => (
          <li class={`rwl rwl-${r.k}`}>
            <span class="rwl-mark" aria-hidden="true"></span>
            <span class="rwl-main">{r.main}</span>
            <span class="rwl-sub">{r.sub}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const MatchHero: FC<{
  primary: Pick;
  heroFrame: string | null;
  peek: boolean;
  matchPct: number | null;
  confidence: string;
  ratedCount: number;
  heroHref: string;
}> = ({ primary, heroFrame, peek, matchPct, confidence, ratedCount, heroHref }) => (
  <header class="detail-hero frame-hero rec-match">
    {heroFrame ? <div class="hero-backdrop" style={heroFrame}></div> : null}
    <div class="detail-head">
      <div class="detail-side">
        <div class="rec-poster-wrap">
          {primary.poster ? (
            <img class="poster" src={primary.poster} alt={primary.name} />
          ) : (
            <div class="poster card-fallback">{primary.name}</div>
          )}
          {!peek && matchPct ? (
            <span class="rec-match-pct" style={`--pct:${matchPct}`} role="img" aria-label={`${matchPct} percent match`}>
              <span class="rec-match-pct-num">
                {matchPct}
                <span class="rec-match-pct-sign">%</span>
              </span>
            </span>
          ) : null}
        </div>
      </div>
      <div class="detail-info">
        <p class="rec-match-tag">
          <span class="rec-conf">{peek ? "Best guess so far" : confidence}</span>
          {primary.rating != null ? <span class="rec-match-star"> · <IconStar class="rating-star" />{primary.rating.toFixed(1)}</span> : null}
          {" · "}
          {primary.kind === "tv" ? "TV series" : "Film"}
          {!peek ? <span class="rec-from"> · from {ratedCount} ratings</span> : null}
        </p>
        <h1>
          {primary.name}
          {primary.year ? <span class="rec-match-year"> ({primary.year})</span> : null}
        </h1>
        {primary.why && (primary.why.anchor || primary.why.genres.length || primary.why.era || primary.why.prov || primary.why.cf >= 2) ? (
          <WhyLedger why={primary.why} />
        ) : (
          <p class="rec-match-reason">{primary.reason}.</p>
        )}
        <p class="rec-match-cta">
          <a class="verdict-btn" href={heroHref}>See {primary.kind === "tv" ? "the show" : "the film"}</a>
        </p>
      </div>
    </div>
  </header>
);

const RecDoors: FC = () => (
  <div class="rec-doors">
    <ExploreCard icon="Picker" title="Browse by mood" desc="Filter by genre, service and runtime — pick in seconds." href="/what-to-watch" />
    <ExploreCard icon="Tonight" title="On tonight" desc="Every episode airing today, in air-time order." href="/tonight" />
    <ExploreCard icon="Loved" title="Community loved" desc="What TV Nightly's raters rate highest right now." href="/loved" />
  </div>
);

// the same Alerts component used across show pages — general daily digest here
const RecEmail: FC = () => (
  <form action="/subscribe" method="post" class="sub-form inline">
    <input type="hidden" name="kind" value="daily" />
    <div class="sub-copy">
      <span class="sub-kicker">Alerts</span>
      <label class="sub-title" for="rec-email">A nightly pick in your inbox</label>
      <span class="sub-note">
        Tonight's TV, new arrivals and one pick worth your evening. One confirmation email first —
        unsubscribe any time.
      </span>
    </div>
    <div class="sub-controls">
      <input id="rec-email" type="email" name="email" placeholder="you@example.com" required />
      <button type="submit">Notify me</button>
    </div>
    <Honeypot />
  </form>
);

// honest progress: how many of the target ratings are in. Server-rendered from
// real trail state; recommend.js only nudges it after an actual rating.
const RecProgress: FC<{ done: number; target: number }> = ({ done, target }) => (
  <div class="rec-prog" style={`--done:${done}; --target:${target}`}>
    <div class="rec-prog-label">
      <span class="rec-prog-text">Grow Your Profile</span>
      <span class="rec-prog-count">{Math.round((done / target) * 100)}%</span>
    </div>
    <div class="rec-prog-track">
      <div class="rec-prog-fill"></div>
    </div>
  </div>
);

// undo: a real link back to the prior trail (works with no JS); the deck's JS
// upgrades it to pop the last rating in place.
const RecUndo: FC<{ href: string; label: string }> = ({ href, label }) => (
  <a class="rec-undo" href={href} aria-label={label}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  </a>
);

// ---- GET /recommend (multi-state) -----------------------------------------

// 1200×630 branded card for link unfurls — the primary pick as the subject.
// Fully determined by ?rated= (a fixed hash keeps it deterministic + cacheable,
// unlike the personalized page which excludes the visitor's own seen titles).
app.get("/recommend/og.png", async (c) => {
  const rated = parseRated(c.req.query("rated"));
  if (!rated.length) return c.notFound();
  return servePng(c, `recommend/${encodeURIComponent(fmtRated(rated))}`, async () => {
    const hash = await ipHash(c.env.SECRET ?? "anon-salt", "og-card");
    const { primary } = await buildRecommendation(c.env.DB, hash, rated);
    if (!primary) return null;
    let bd: { x1: string } | null = null;
    if (c.env.TMDB_API_KEY) {
      bd =
        primary.kind === "tv"
          ? primary.tmdbId
            ? await tmdbBackdrop(c.env.TMDB_API_KEY, primary.tmdbId)
            : null
          : primary.imdbId
            ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, primary.imdbId)
            : null;
    }
    const heroPoster = primary.poster ? (hiRes(primary.poster) ?? primary.poster) : null;
    const [backdropUri, posterUri] = await Promise.all([
      posterDataUri(bd?.x1 ?? heroPoster),
      posterDataUri(heroPoster),
    ]);
    const meta = [primary.genres.slice(0, 3).join(" · "), primary.year].filter(Boolean).join(" · ");
    return buildOgCard({
      kicker: "Your next watch",
      title: primary.name,
      meta: meta || null,
      rating: primary.rating,
      note: primary.reason || null,
      posterUri,
      backdropUri,
    });
  });
});

app.get("/recommend/taste/og.png", async (c) => {
  const rated = parseRated(c.req.query("rated"));
  if (rated.length < 2) return c.notFound();
  return servePng(c, `taste-og/${encodeURIComponent(fmtRated(rated))}`, async () => {
    const loaded = await loadTasteShare(c, rated);
    if (!loaded) return null;
    return buildTasteProfileOgCard(loaded.cardData);
  });
});

app.get("/recommend/taste.png", async (c) => {
  const rated = parseRated(c.req.query("rated"));
  if (rated.length < 2) return c.notFound();
  return servePng(
    c,
    `taste/${encodeURIComponent(fmtRated(rated))}`,
    async () => {
      const loaded = await loadTasteShare(c, rated);
      if (!loaded) return null;
      return buildTasteProfileCard(loaded.cardData);
    },
    1080,
  );
});

app.get("/recommend/taste", async (c) => {
  const rated = parseRated(c.req.query("rated"));
  if (rated.length < 2) return c.redirect("/recommend", 302);
  const loaded = await loadTasteShare(c, rated);
  if (!loaded) return c.redirect("/recommend", 302);
  const { primary, tasteProfile } = loaded;
  const ratedStr = fmtRated(rated);
  const site = origin(c);
  const tasteUrl = `${site}/recommend/taste?rated=${encodeURIComponent(ratedStr)}`;
  const cardUrl = `/recommend/taste.png?rated=${encodeURIComponent(ratedStr)}`;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      title={`My TV taste: ${tasteProfile.summary} | TV Nightly`}
      description={`My TV taste profile — ${tasteProfile.summary}${primary ? ` → next watch: ${primary.name}` : ""}. Make yours at TV Nightly.`}
      canonical={tasteUrl}
      ogImage={`${site}/recommend/taste/og.png?rated=${encodeURIComponent(ratedStr)}`}
      ogImageLarge
      scripts={["/js/recommend.js", "/js/share.js"]}
    >
      <article class="rec-page rec-taste-page">
        <header class="chart-head rec-center">
          <p class="section-eyebrow">TV taste profile</p>
          <h1 class="chart-h1">My TV taste</h1>
        </header>
        <TasteProfileShare
          tasteProfile={tasteProfile}
          primary={primary!}
          tasteShareUrl={tasteUrl}
          tasteCardUrl={cardUrl}
        />
        <section class="rec-profile-make">
          <h2>What's your taste?</h2>
          <p class="muted">
            Rate a few shows and movies you've seen — we'll build your profile and pick your next watch. No account
            needed.
          </p>
          <p class="rec-center">
            <a class="verdict-btn verdict-btn-lg" href="/recommend">
              Make your TV taste profile
            </a>
          </p>
        </section>
        <RecDoors />
      </article>
    </Layout>,
  );
});

app.get("/recommend", async (c) => {
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim();
  const kind = c.req.query("kind") ?? "";
  const ref = (c.req.query("ref") ?? "").trim();
  const step = c.req.query("step") ?? "";
  const rated = parseRated(c.req.query("rated"));
  const ratedStr = fmtRated(rated);
  const ratedQS = ratedStr ? `&rated=${encodeURIComponent(ratedStr)}` : "";

  // ----- RESULTS -----
  if (step === "results" && rated.length) {
    const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
    const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
    const { primary, contenders, confidence, tasteRead, tasteProfile, matchPct } = await buildRecommendation(db, hash, rated);
    // Under two ratings we're guessing, and we say so — honesty is the trust.
    const peek = rated.length < 2;
    const site = origin(c);
    const tasteShareUrl = `${site}/recommend/taste?rated=${encodeURIComponent(ratedStr)}`;
    const tasteCardUrl = `/recommend/taste.png?rated=${encodeURIComponent(ratedStr)}`;
    const showTasteProfile = !peek && primary && tasteProfile.slices.length >= 2;

    let art: { x1: string; x2?: string } | null = null;
    if (primary && c.env.TMDB_API_KEY) {
      // movies carry a tmdbId too, but tmdbBackdrop hits /tv/{id} — route by kind
      // or a movie picks up some unrelated TV show with the same numeric id.
      art =
        primary.kind === "tv"
          ? primary.tmdbId
            ? await tmdbBackdrop(c.env.TMDB_API_KEY, primary.tmdbId)
            : null
          : primary.imdbId
            ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, primary.imdbId)
            : null;
    }
    if (!art && primary?.poster) art = { x1: hiRes(primary.poster) ?? primary.poster };
    const heroFrame = art ? heroBg(art.x1, art.x2) : null;
    const heroHref = primary ? (primary.kind === "tv" ? `/show/${primary.slug}` : `/movie/${primary.slug}`) : "/recommend";
    const sharpenHref = `/recommend?step=enrich${ratedQS}`;

    // Contender cards wear their own landscape backdrop (same pattern as the
    // home lanes): fetched in parallel, edge-cached, poster as graceful fallback.
    const contArt = await Promise.all(
      contenders.map(async (p) => {
        if (c.env.TMDB_API_KEY) {
          const bd =
            p.kind === "tv"
              ? p.tmdbId
                ? await tmdbBackdrop(c.env.TMDB_API_KEY, p.tmdbId)
                : null
              : p.imdbId
                ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, p.imdbId)
                : null;
          if (bd) return heroBg(bd.x1, bd.x2);
        }
        return p.poster ? heroBg(hiRes(p.poster) ?? p.poster) : null;
      }),
    );

    c.header("Cache-Control", "no-store");
    return c.html(
      <Layout c={c}
        title={primary ? (peek ? `A starting point: ${primary.name} | TV Nightly` : `Watch ${primary.name} next | TV Nightly`) : "Your next watch | TV Nightly"}
        description={primary ? `Based on your ratings, TV Nightly says watch ${primary.name} next.` : "Rate a few things, get your next watch."}
        canonical={`${origin(c)}/recommend`}
        noindex
        ogImage={primary ? `${origin(c)}/recommend/og.png?rated=${encodeURIComponent(ratedStr)}` : undefined}
        ogImageLarge={!!primary}
        scripts={["/js/recommend.js", "/js/share.js"]}
      >
        <article class={`rec-page rec-results${showTasteProfile && primary ? " rec-results-duo" : ""}`}>
          <header class="chart-head rec-result-head">
            <p class="section-eyebrow">{peek ? "Early read" : "Your match"}</p>
            {/* styled statement, not the page h1 — the matched title below is the
                sole <h1> so the results view has exactly one top-level heading */}
            <p class="rec-h1 rec-result-title">{primary ? (peek ? `A starting point: ${primary.name}` : `Watch ${primary.name} next`) : "Your next watch"}</p>
            {tasteRead.length ? (
              <p class="rec-taste">
                <span class="rec-taste-label">Your taste</span>
                <span class="rec-taste-chips">
                  {tasteRead.map((t) => (
                    <span class="taste-chip">{t}</span>
                  ))}
                </span>
              </p>
            ) : null}
          </header>

          {primary ? (
            showTasteProfile ? (
              <div class="rec-duo">
                <div class="rec-duo-match">
                  <MatchHero
                    primary={primary}
                    heroFrame={heroFrame}
                    peek={peek}
                    matchPct={matchPct}
                    confidence={confidence}
                    ratedCount={rated.length}
                    heroHref={heroHref}
                  />
                </div>
                <TasteProfileShare
                  sidecar
                  tasteProfile={tasteProfile}
                  primary={primary}
                  tasteShareUrl={tasteShareUrl}
                  tasteCardUrl={tasteCardUrl}
                />
              </div>
            ) : (
              <MatchHero
                primary={primary}
                heroFrame={heroFrame}
                peek={peek}
                matchPct={matchPct}
                confidence={confidence}
                ratedCount={rated.length}
                heroHref={heroHref}
              />
            )
          ) : (
            <p class="muted">We couldn't find a confident pick yet — <a href="/recommend">rate one more thing</a>.</p>
          )}

          {primary && rated.length < 4 ? (
            <div class={`rec-sharpen${peek ? " is-primary" : ""}`}>
              <span class="rec-sharpen-copy">{peek ? "Rate a couple more and this locks in" : "Want a sharper match?"}</span>
              <a class="verdict-btn rec-sharpen-btn" href={sharpenHref}>
                Rate {peek ? "more" : "one more"}
              </a>
            </div>
          ) : null}

          {contenders.length ? (
            <section class="rec-sec">
              <div class="rec-sec-head">
                <h2>If not that, then</h2>
                {primary && !showTasteProfile ? (
                  <ShareBar
                    url={`${origin(c)}/recommend?step=results&rated=${encodeURIComponent(ratedStr)}`}
                    title={`TV Nightly says watch ${primary.name} next`}
                  />
                ) : null}
              </div>
              <div class="rec-cont-grid">
                {contenders.map((p, i) => (
                  <ContenderCard p={p} bg={contArt[i]} />
                ))}
              </div>
            </section>
          ) : null}

          <section class="rec-foot">
            {!showTasteProfile && primary ? (
              <div class="rec-foot-actions">
                <button
                  type="button"
                  class="btn-ghost rec-copy"
                  data-copied="Link copied"
                  data-url={`${origin(c)}/recommend?step=results&rated=${encodeURIComponent(ratedStr)}`}
                >
                  Copy link to this pick
                </button>
              </div>
            ) : null}
            <RecDoors />
            <RecEmail />
          </section>
        </article>
      </Layout>,
    );
  }

  // ----- ENRICH DECK -----
  if (step === "enrich" && !rated.length) return c.redirect("/recommend", 302);
  if (step === "enrich" && rated.length) {
    const synthHref = `/recommend?step=synth${ratedQS}`;
    if (rated.length >= TARGET) return c.redirect(synthHref, 302);
    const deck = await enrichDeck(db, rated, TARGET + 1);
    if (!deck.length) return c.redirect(synthHref, 302);
    // Undo pops to the prior enrich trail, or — for the very first rating —
    // back to that title's own rate card (never an empty/dead-end trail).
    const prevTrail = rated.slice(0, -1);
    const last = rated[rated.length - 1];
    const undoHref = prevTrail.length
      ? `/recommend?step=enrich&rated=${encodeURIComponent(fmtRated(prevTrail))}`
      : `/recommend?kind=${last.kind}&ref=${last.ref}`;

    c.header("Cache-Control", "no-store");
    return c.html(
      <Layout c={c} title="Calculating your taste... | TV Nightly" canonical={`${origin(c)}/recommend`} noindex scripts={["/js/recommend.js"]}>
        <div class="rec-page rec-narrow rec-center rec-room">
          <RecProgress done={rated.length} target={TARGET} />
          <div class="rec-deck" data-rated={ratedStr} data-target={String(TARGET)}>
            {deck.map((card, i) => (
              <article class="rec-deck-card" data-idx={String(i)} data-kind={card.kind} data-ref={card.ref} hidden={i > 0}>
                <div class="rec-card-shell">
                  <RecUndo href={undoHref} label="Undo last rating" />
                  <span class="rec-poster">
                    {card.poster ? (
                      <img src={card.poster} srcset={posterSet(card.poster)} alt={card.name} loading={i === 0 ? "eager" : "lazy"} decoding="async" />
                    ) : (
                      <span class="rec-poster-blank">{card.name}</span>
                    )}
                    <span class="rec-card-cap">
                      <span class="rec-card-title">{card.name}</span>
                      {card.year ? <span class="rec-card-year">{card.year}</span> : null}
                    </span>
                  </span>
                </div>
                <RatingControl kind={card.kind} ref={card.ref} rated={ratedStr} />
              </article>
            ))}
          </div>
          <a class="rec-skip" href={synthHref}>Haven't Seen</a>
        </div>
      </Layout>,
    );
  }

  // ----- SYNTH: the "thinking" interstitial — gathers the rated titles into a
  // spinner before revealing the match. Real page (works no-JS via meta-refresh;
  // recommend.js advances a touch sooner). The results route does the genuine
  // engine + backdrop work; this is the framing for that moment. -----
  if (step === "synth" && rated.length) {
    const resultsHref = `/recommend?step=results${ratedQS}`;
    const thumbs = (await Promise.all(rated.map((e) => getRatedTitle(db, e.kind, e.ref))))
      .map((t, i) => ({ image: t?.image ?? null, name: t?.name ?? "", verdict: rated[i].verdict }))
      .filter((t) => t.image);
    c.header("Cache-Control", "no-store");
    return c.html(
      <Layout c={c}
        title="Generating your next watch… | TV Nightly"
        canonical={`${origin(c)}/recommend`}
        noindex
        refresh={{ delay: 4, url: resultsHref }}
        scripts={["/js/recommend.js"]}
      >
        <div class="rec-page rec-center rec-room rec-synth" data-results={resultsHref}>
          <div class="rec-synth-stage" style={`--n:${thumbs.length}`}>
            {thumbs.map((t, i) => (
              <span class={`rec-synth-chip v-${t.verdict}`} style={`--i:${i}`}>
                <img src={t.image as string} alt="" loading="eager" decoding="async" />
              </span>
            ))}
            <span class="rec-synth-core" aria-hidden="true">
              <span class="rec-spinner"></span>
            </span>
          </div>
          <h1 class="rec-h1 rec-synth-title">Generating your next watch</h1>
          <p class="muted rec-synth-sub" role="status">
            Reading your {rated.length} ratings against the catalog…
          </p>
          <noscript>
            <p class="rec-synth-cont">
              <a class="verdict-btn" href={resultsHref}>See your match</a>
            </p>
          </noscript>
        </div>
      </Layout>,
    );
  }

  // ----- RATE (the title just chosen) -----
  if (kind && ref) {
    const title = await getRatedTitle(db, kind, ref);
    if (!title) return c.notFound();
    // clean name + year for the on-poster caption (getRatedTitle bakes the year
    // into movie names; the card wants them on separate lines)
    const cardName = title.show ? title.show.name : title.movie ? title.movie.title : title.name;
    const cardYear = title.show?.premiered ? title.show.premiered.slice(0, 4) : title.movie?.year != null ? String(title.movie.year) : null;
    // undo (only when a trail exists) resumes the deck rather than dead-ends
    const backHref = `/recommend?step=enrich&rated=${encodeURIComponent(fmtRated(rated))}`;
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(
      <Layout c={c} title={`How was ${cardName}? | TV Nightly`} canonical={`${origin(c)}/recommend`} noindex scripts={["/js/recommend.js"]}>
        <div class="rec-page rec-narrow rec-center rec-room">
          {rated.length ? <RecProgress done={rated.length} target={5} /> : null}
          <div class="rec-card-shell rec-rate-card">
            {rated.length ? <RecUndo href={backHref} label="Back" /> : null}
            <span class="rec-poster rec-poster-lg">
              {title.image ? (
                <img src={title.image} srcset={posterSet(title.image)} alt={cardName} />
              ) : (
                <span class="rec-poster-blank">{cardName}</span>
              )}
              <span class="rec-card-cap">
                <span class="rec-card-title">{cardName}</span>
                {cardYear ? <span class="rec-card-year">{cardYear}</span> : null}
              </span>
            </span>
          </div>
          <RatingControl kind={kind} ref={ref} rated={ratedStr} />
          <p class="muted rec-note">One tap — it teaches us your taste.</p>
        </div>
      </Layout>,
    );
  }

  // ----- SEARCH / DISAMBIGUATE -----
  if (q) {
    const [shows, movies] = await Promise.all([
      db
        .prepare(`SELECT id, name, premiered, COALESCE(poster_url, image_url) AS poster FROM shows WHERE ${foldSql("name")} LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 6`)
        .bind(foldText(q))
        .all<{ id: number; name: string; premiered: string | null; poster: string | null }>(),
      db
        .prepare(`SELECT imdb_id, title, year, poster_url AS poster FROM movies WHERE ${foldSql("title")} LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 6`)
        .bind(foldText(q))
        .all<{ imdb_id: string; title: string; year: number | null; poster: string | null }>(),
    ]);
    // Carry kind+ref, never a bare name. A unique exact-name match skips ahead.
    const ql = q.toLowerCase();
    const exShows = shows.results.filter((s) => s.name.toLowerCase() === ql);
    const exMovies = movies.results.filter((m) => m.title.toLowerCase() === ql);
    if (exShows.length + exMovies.length === 1) {
      const sel = exShows.length ? `kind=tv&ref=${exShows[0].id}` : `kind=movie&ref=${exMovies[0].imdb_id}`;
      return c.redirect(`/recommend?${sel}${ratedQS}`, 302);
    }
    c.header("Cache-Control", "public, max-age=300");
    return c.html(
      <Layout c={c} title="Which one did you watch? | TV Nightly" canonical={`${origin(c)}/recommend`} noindex>
        <div class="rec-page rec-narrow">
          <header class="chart-head">
            <p class="section-eyebrow">Pick the right one</p>
            <h1 class="chart-h1">Which "{q}"?</h1>
          </header>
          {shows.results.length === 0 && movies.results.length === 0 ? (
            <p class="muted">Nothing matched "{q}" — <a href="/recommend">try another search</a>.</p>
          ) : (
            <ul class="rec-pick-list">
              {shows.results.map((s) => (
                <li>
                  <a href={`/recommend?kind=tv&ref=${s.id}${ratedQS}`}>
                    <span class="rec-pick-thumb">
                      {s.poster ? <img src={s.poster} alt={`${s.name} poster`} width="40" height="60" loading="lazy" /> : <span class="rec-pick-blank"></span>}
                    </span>
                    <span class="rec-pick-main">
                      <span class="rec-pick-name">{s.name}{s.premiered ? ` (${s.premiered.slice(0, 4)})` : ""}</span>
                      <span class="rec-pick-meta">TV show</span>
                    </span>
                    <span class="chev-icon" aria-hidden="true"></span>
                  </a>
                </li>
              ))}
              {movies.results.map((m) => (
                <li>
                  <a href={`/recommend?kind=movie&ref=${m.imdb_id}${ratedQS}`}>
                    <span class="rec-pick-thumb">
                      {m.poster ? <img src={m.poster} alt={`${m.title} poster`} width="40" height="60" loading="lazy" /> : <span class="rec-pick-blank"></span>}
                    </span>
                    <span class="rec-pick-main">
                      <span class="rec-pick-name">{m.title}{m.year ? ` (${m.year})` : ""}</span>
                      <span class="rec-pick-meta">Movie</span>
                    </span>
                    <span class="chev-icon" aria-hidden="true"></span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Layout>,
    );
  }

  // ----- LANDING -----
  const picks = await landingPicks(db, 30);
  c.header("Cache-Control", "public, max-age=1800");
  return c.html(
    <Layout c={c}
      title="What should I watch next? Rate a few, get your pick | TV Nightly"
      description="Tell us a few things you've watched and how they landed — we triangulate your taste and pick your next watch. No account needed."
      canonical={canonical(c)}
      scripts={["/js/recommend.js"]}
    >
      <div class="rec-page">
        <header class="rec-center rec-land-head">
          <h1 class="rec-h1">What should I watch next?</h1>
          <p class="section-lead rec-lead">
            Name a couple of things you've watched and how they landed — we read your taste and hand you one pick for tonight.
          </p>
          {/* No Start button: the live typeahead dropdown (recommend.js) is the
              path — pick a suggestion to jump straight to rating. With no JS the
              single field still submits on Enter to the disambiguation list. */}
          <form method="get" action="/recommend" class="rec-search" role="search">
            <span class="rec-search-field">
              <input type="search" name="q" placeholder="A show or movie you've watched…" aria-label="A show or movie you've watched" autocomplete="off" required />
            </span>
            {ratedStr ? <input type="hidden" name="rated" value={ratedStr} /> : null}
          </form>
          <p class="rec-steps">
            <span class="rec-step">Pick something you've seen</span>{" "}
            <span class="rec-arrow chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
            <span class="rec-step">say how it landed</span>{" "}
            <span class="rec-arrow chev-icon chev-icon-sm" aria-hidden="true"></span>{" "}
            <span class="rec-step">get your match</span>
          </p>
          <p class="rec-trust muted">No account — your taste lives in a shareable link.</p>
        </header>
        <section class="rec-sec">
          <h2>Or tap one you've seen</h2>
          <div class="grid">
            {picks.map((p) => (
              <PosterCard c={p} href={`/recommend?kind=${p.kind}&ref=${p.ref}${ratedQS}`} />
            ))}
          </div>
        </section>
        <p class="rec-center">
          <a class="chev-after" href="/loved">See what the community loves</a>
        </p>
      </div>
    </Layout>,
  );
});

// ---- POST /recommend (save a verdict) -------------------------------------

app.post("/recommend", async (c) => {
  let body: Awaited<ReturnType<typeof c.req.parseBody>>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.body(null, 400);
  }
  const kind = String(body.kind ?? "");
  const ref = String(body.ref ?? "").trim();
  const verdict = String(body.verdict ?? "");
  const ajax = body.ajax != null;
  const col = VERDICTS[verdict];
  if (!col || (kind !== "tv" && kind !== "movie")) return ajax ? c.body(null, 400) : c.notFound();
  // materialize-on-write: a live-TMDB title (ref "t<id>") joins our engaged set the
  // moment it's rated, so its snapshot exists for getRatedTitle + community lists.
  if (isTmdbRef(ref) && c.env.TMDB_API_KEY) {
    await materializeTmdbTitle(c.env.DB, c.env.TMDB_API_KEY, kind, Number(ref.slice(1)));
  }
  const title = await getRatedTitle(c.env.DB, kind, ref);
  if (!title) return ajax ? c.body(null, 404) : c.notFound();

  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
  const dup = await c.env.DB.prepare("SELECT 1 AS x FROM rate_log WHERE ip_hash = ? AND kind = ? AND ref = ?")
    .bind(hash, kind, ref)
    .first();
  if (!dup) {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT OR IGNORE INTO rate_log (ip_hash, kind, ref, created_at, verdict) VALUES (?,?,?,unixepoch(),?)").bind(hash, kind, ref, verdict),
      c.env.DB.prepare(
        `INSERT INTO title_ratings (kind, ref, loved, liked, meh, awful) VALUES (?,?,?,?,?,?)
         ON CONFLICT(kind, ref) DO UPDATE SET
           loved = loved + excluded.loved, liked = liked + excluded.liked,
           meh = meh + excluded.meh, awful = awful + excluded.awful`,
      ).bind(kind, ref, col === "loved" ? 1 : 0, col === "liked" ? 1 : 0, col === "meh" ? 1 : 0, col === "awful" ? 1 : 0),
    ]);
  }
  // JS deck records in the background and steers itself.
  if (ajax) return c.body(null, 204);

  // No-JS path. Collect TARGET ratings through the enrich deck, then the synth
  // interstitial frames the "thinking" moment before the match is revealed.
  const trail = parseRated(typeof body.rated === "string" ? body.rated : undefined);
  if (!trail.some((e) => e.kind === kind && e.ref === ref)) {
    trail.push({ kind: kind as RatedEntry["kind"], ref, verdict: verdict as RatedEntry["verdict"] });
  }
  // Collect TARGET ratings, then hand off to the synth interstitial → match.
  const dest = trail.length >= TARGET ? "step=synth" : "step=enrich";
  return c.redirect(`/recommend?${dest}&rated=${encodeURIComponent(fmtRated(trail))}`, 303);
});

// ------------------------------------------------- community loved charts

app.get("/loved", async (c) => {
  const db = c.env.DB;
  const { results: rows } = await db
    .prepare(
      `SELECT * FROM (
         SELECT kind, ref, loved, liked, meh, awful, (loved + liked + meh + awful) AS total,
                (loved + 0.5 * liked) / CAST(loved + liked + meh + awful AS REAL) AS score
         FROM title_ratings
       ) WHERE total >= 2 ORDER BY score DESC, total DESC LIMIT 40`,
    )
    .all<{ kind: string; ref: string; loved: number; liked: number; meh: number; awful: number; total: number; score: number }>();

  const isSnap = (ref: string) => /^t\d+$/.test(ref); // materialized live-TMDB title
  const showIds = rows.filter((r) => r.kind === "tv" && !isSnap(r.ref)).map((r) => Number(r.ref));
  const movieIds = rows.filter((r) => r.kind === "movie" && !isSnap(r.ref)).map((r) => r.ref);
  const snapRefs = rows.filter((r) => isSnap(r.ref));
  const shows = showIds.length
    ? (
        await db
          .prepare(
            `SELECT id, name, slug, tmdb_id, image_url, COALESCE(poster_url, image_url) AS poster
             FROM shows WHERE id IN (${showIds.map(() => "?").join(",")})`,
          )
          .bind(...showIds)
          .all<{ id: number; name: string; slug: string; tmdb_id: number | null; image_url: string | null; poster: string | null }>()
      ).results
    : [];
  const movies = movieIds.length
    ? (
        await db
          .prepare(
            `SELECT imdb_id, title, year, slug, poster_url FROM movies WHERE imdb_id IN (${movieIds.map(() => "?").join(",")})`,
          )
          .bind(...movieIds)
          .all<{ imdb_id: string; title: string; year: number | null; slug: string; poster_url: string | null }>()
      ).results
    : [];
  // materialized live-TMDB titles live in title_snapshots, not the mirror
  const snaps = snapRefs.length
    ? (
        await db
          .prepare(
            `SELECT kind, ref, name, year, slug, poster_url, tmdb_id FROM title_snapshots
             WHERE ref IN (${snapRefs.map(() => "?").join(",")})`,
          )
          .bind(...snapRefs.map((r) => r.ref))
          .all<{ kind: string; ref: string; name: string; year: string | null; slug: string; poster_url: string | null; tmdb_id: number }>()
      ).results
    : [];
  const showMap = new Map(shows.map((s) => [String(s.id), s]));
  const movieMap = new Map(movies.map((m) => [m.imdb_id, m]));
  const snapMap = new Map(snaps.map((s) => [`${s.kind}:${s.ref}`, s]));

  // one resolved view per chart row; rows whose title we can't resolve drop out
  const board = rows
    .map((r) => {
      const snap = isSnap(r.ref) ? snapMap.get(`${r.kind}:${r.ref}`) : undefined;
      const s = !snap && r.kind === "tv" ? showMap.get(r.ref) : undefined;
      const m = !snap && r.kind === "movie" ? movieMap.get(r.ref) : undefined;
      if (!s && !m && !snap) return null;
      const slug = s ? s.slug : m ? m.slug : snap!.slug;
      return {
        ...r,
        href: `/${r.kind === "tv" ? "show" : "movie"}/${slug}`,
        label: s ? s.name : m ? m.title : snap!.name,
        year: r.kind !== "movie" ? null : (m?.year ?? (snap?.year ? Number(snap.year) : null)),
        kindLabel: r.kind === "tv" ? "TV show" : "Movie",
        poster: s ? s.poster : m ? (m.poster_url ?? null) : (snap?.poster_url ?? null),
        tmdbId: s?.tmdb_id ?? snap?.tmdb_id ?? null,
        imdbId: m?.imdb_id ?? null,
        ambientSrc: s ? hiRes(s.image_url) : m ? (m.poster_url ?? null) : (snap?.poster_url ?? null),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const apiKey = c.env.TMDB_API_KEY;
  const communityHrefs = new Set(board.map((b) => b.href));
  const trendingMovies = apiKey
    ? (await tmdbTrendingList(apiKey, "movie"))
        .slice(0, 18)
        .map(toMovieRow)
        .filter((m) => !communityHrefs.has(`/movie/${m.slug}`))
    : [];
  const trendingShows = apiKey
    ? (await tmdbTrendingList(apiKey, "tv"))
        .slice(0, 18)
        .map(toShowRow)
        .filter((s) => !communityHrefs.has(`/show/${s.slug}`))
    : [];

  const boardMovieRow = (b: (typeof board)[number]): MovieRow =>
    ({
      slug: b.href.replace(/^\/movie\//, ""),
      title: b.label,
      poster_url: b.poster,
      year: b.year,
      tmdb_id: b.tmdbId,
      imdb_id: b.imdbId ?? "",
      rating: null,
    }) as unknown as MovieRow;
  const boardShowRow = (b: (typeof board)[number]): ShowRow =>
    ({
      slug: b.href.replace(/^\/show\//, ""),
      name: b.label,
      poster_url: b.poster,
      image_url: null,
      tmdb_id: b.tmdbId,
      rating: null,
    }) as unknown as ShowRow;

  const movieRail = [
    ...board.filter((b) => b.kind === "movie").map(boardMovieRow),
    ...trendingMovies,
  ].slice(0, 18);
  const showRail = [
    ...board.filter((b) => b.kind === "tv").map(boardShowRow),
    ...trendingShows,
  ].slice(0, 18);

  const entryBackdrop = async (entry: (typeof board)[number]): Promise<ExploreArt> => {
    const apiKey = c.env.TMDB_API_KEY;
    if (apiKey) {
      if (entry.tmdbId) return await tmdbBackdrop(apiKey, entry.tmdbId);
      if (entry.imdbId) return await tmdbMovieBackdrop(apiKey, entry.imdbId);
    }
    return entry.ambientSrc ? { x1: entry.ambientSrc } : null;
  };
  const sidebar = c.get("siteSidebar");
  const tvEntry = board.find((b) => b.kind === "tv");
  const movieEntry = board.find((b) => b.kind === "movie");
  const trendLeadMovie = movieRail[0] ?? null;
  const trendLeadShow = showRail[0] ?? null;
  const [fallbackShow, fallbackMovie] = await Promise.all([
    tvEntry
      ? Promise.resolve(null)
      : db
          .prepare(
            `SELECT tmdb_id, image_url, COALESCE(poster_url, image_url) AS poster_url
             FROM shows WHERE rating IS NOT NULL ORDER BY rating DESC, weight DESC LIMIT 1`,
          )
          .first<{ tmdb_id: number | null; image_url: string | null; poster_url: string | null }>(),
    movieEntry
      ? Promise.resolve(null)
      : db
          .prepare(
            `SELECT imdb_id, poster_url FROM movies WHERE rating IS NOT NULL ORDER BY rating DESC, votes DESC LIMIT 1`,
          )
          .first<{ imdb_id: string; poster_url: string | null }>(),
  ]);
  const trendMovieArt = (m: MovieRow | null): ExploreArt =>
    m?.poster_url ? { x1: m.poster_url.replace("/w342/", "/w780/") } : null;
  const [pickArt, topTvArt, movieArt] = await Promise.all([
    board[0]
      ? entryBackdrop(board[0])
      : trendLeadMovie
        ? Promise.resolve(trendMovieArt(trendLeadMovie))
        : trendLeadShow
          ? showKeepGoingBackdrop(apiKey, trendLeadShow)
          : fallbackShow
            ? showKeepGoingBackdrop(apiKey, fallbackShow)
            : Promise.resolve(null),
    tvEntry
      ? entryBackdrop(tvEntry)
      : trendLeadShow
        ? showKeepGoingBackdrop(apiKey, trendLeadShow)
        : fallbackShow
          ? showKeepGoingBackdrop(apiKey, fallbackShow)
          : Promise.resolve(null),
    movieEntry
      ? entryBackdrop(movieEntry)
      : trendLeadMovie
        ? Promise.resolve(trendMovieArt(trendLeadMovie))
        : fallbackMovie
          ? movieKeepGoingBackdrop(apiKey, fallbackMovie)
          : Promise.resolve(null),
  ]);
  const site = origin(c);
  c.header("Cache-Control", "public, max-age=900");
  return c.html(
    <Layout c={c}
      sidebarInline
      title="The most loved shows & movies on TV Nightly"
      description="Community charts built from real one-tap verdicts: what TV Nightly's raters love right now."
      canonical={canonical(c)}
      ld={[
        itemListLd(
          "Most loved shows and movies",
          [
            ...movieRail.map((m) => ({ name: m.title, url: `${site}/movie/${m.slug}` })),
            ...showRail.map((s) => ({ name: s.name, url: `${site}/show/${s.slug}` })),
          ],
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Most loved", url: canonical(c) },
        ]),
      ]}
    >
      <article class="chart-page loved">
        <header class="chart-head">
          <p class="section-eyebrow">Community</p>
          <h1 class="chart-h1">Most loved shows and movies</h1>
          <p class="section-lead">
            What&apos;s hot right now — reader picks slot in as they land.
          </p>
          {movieRail.length || showRail.length ? (
            <p class="chart-statline">
              <span class="chart-statline-main">
                <strong>{movieRail.length + showRail.length}</strong> titles
              </span>
              <span class="chart-statline-links">
                <a class="chev-after" href="/recommend">
                  Rate &amp; get a pick
                </a>
                <a class="chev-after" href="/top/tv">
                  Top TV shows
                </a>
                <a class="chev-after" href="/movies/best">
                  Best movies
                </a>
              </span>
            </p>
          ) : null}
        </header>

        <div class="home-main-grid">
          <div class="home-col">
        {movieRail.length ? (
          <section class="loved-trending">
            <h2>Movies</h2>
            <div class="poster-row poster-row-ranked loved-trend-rail">
              {movieRail.map((m, i) => (
                <MovieCard movie={m} eager={i < 4} />
              ))}
            </div>
          </section>
        ) : null}

        {showRail.length ? (
          <section class="loved-trending">
            <h2>TV shows</h2>
            <div class="poster-row poster-row-ranked loved-trend-rail">
              {showRail.map((s, i) => (
                <ShowCard show={s} eager={i < 4} />
              ))}
            </div>
          </section>
        ) : null}

        <KeepExploring
          cards={[
            {
              icon: "Tailored",
              title: "Rate & get a pick",
              desc: "Rate a few you've seen — we read your taste and hand you your next watch.",
              href: "/recommend",
              backdrop: pickArt,
            },
            {
              icon: "Charts",
              title: "Top TV shows",
              desc: "The highest-rated series we track — weight and popularity gate the board.",
              href: "/top/tv",
              backdrop: topTvArt,
            },
            {
              icon: "Charts",
              title: "Best movies",
              desc: "The 50 best films of all time, ranked by viewer rating.",
              href: "/movies/best",
              backdrop: movieArt,
            },
          ]}
        />
          </div>
          <HomeSidebarRail
            trailers={sidebar?.trailers ?? []}
            topSeries={sidebar?.topSeries ?? []}
            topMovies={sidebar?.topMovies ?? []}
          />
        </div>
      </article>
    </Layout>,
  );
});

export default app;
