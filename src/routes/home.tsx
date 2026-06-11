import { Hono } from "hono";
import { Bindings, ShowRow, TonightRow, MovieRow } from "../types";
import { visitorRegion, PROVIDER_LOGOS } from "../lib/providers";
import { epCode, airTime, premiereDateParts, homeDateline, posterSrc, hiRes, heroBg, longDate, stripHtml } from "../lib/format";
import { tmdbBackdrop } from "../lib/tmdb";
import {
  IconReel,
  IconDial,
  IconClapper,
  IconHearts,
  IconAudience,
  IconTvPlay,
  IconVs,
  IconCal,
} from "../components/icons";
import { canonical } from "../lib/seo";
import { VERTICALS } from "../lib/verticals";
import { Layout } from "../components/Layout";
import { StatusBadge, ShowCard, MovieCard } from "../components/cards";
import { ProviderLine } from "../components/providers";

const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------- home

app.get("/", async (c) => {
  type SpotRow = ShowRow & {
    ep_name: string | null;
    ep_season: number | null;
    ep_number: number | null;
    ep_airdate: string | null;
    ep_airstamp: string | null;
  };
  const [top, topMovies, tonight, premieres, spotTonight, spotPremiere, topStill] = await Promise.all([
    // weight-only ORDER BY rides idx_shows_weight; a rating tiebreak would
    // force a full scan + temp sort (weights are near-unique anyway)
    c.env.DB.prepare("SELECT * FROM shows ORDER BY weight DESC LIMIT 18")
      .all<ShowRow>()
      .then((r) => r.results),
    c.env.DB.prepare("SELECT * FROM movies ORDER BY popularity DESC LIMIT 18")
      .all<MovieRow>()
      .then((r) => r.results),
    c.env.DB.prepare(
      `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.network AS network,
              s.poster_url AS show_poster, s.image_url AS show_image
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.airstamp >= datetime('now','start of day')
         AND e.airstamp < datetime('now','start of day','+1 day')
       ORDER BY e.airstamp LIMIT 8`,
    )
      .all<TonightRow>()
      .then((r) => r.results),
    c.env.DB.prepare(
      `SELECT e.airdate, e.season, s.name AS show_name, s.slug AS show_slug,
              s.poster_url AS show_poster, s.image_url AS show_image
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.number = 1 AND e.airstamp > datetime('now')
         AND e.airstamp < datetime('now', '+21 days')
       ORDER BY e.airstamp LIMIT 6`,
    )
      .all<{
        airdate: string | null;
        season: number | null;
        show_name: string;
        show_slug: string;
        show_poster: string | null;
        show_image: string | null;
      }>()
      .then((r) => r.results),
    // spotlight: tonight's biggest show by popularity weight
    c.env.DB.prepare(
      `SELECT s.*, e.name AS ep_name, e.season AS ep_season, e.number AS ep_number,
              e.airdate AS ep_airdate, e.airstamp AS ep_airstamp
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.airstamp >= datetime('now','start of day')
         AND e.airstamp < datetime('now','start of day','+1 day')
       ORDER BY s.weight DESC LIMIT 1`,
    ).first<SpotRow>(),
    // fallback spotlight: the biggest premiere of the next three weeks
    c.env.DB.prepare(
      `SELECT s.*, e.name AS ep_name, e.season AS ep_season, e.number AS ep_number,
              e.airdate AS ep_airdate, e.airstamp AS ep_airstamp
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.number = 1 AND e.airstamp > datetime('now')
         AND e.airstamp < datetime('now', '+21 days')
       ORDER BY s.weight DESC LIMIT 1`,
    ).first<SpotRow>(),
    // the current #1 episode's still — the greatest-episodes tile wears it
    c.env.DB.prepare(
      `SELECT image_url FROM episodes
       WHERE image_url IS NOT NULL AND rating IS NOT NULL
       ORDER BY rating DESC LIMIT 1`,
    ).first<{ image_url: string }>(),
  ]);

  const spot: SpotRow | null =
    spotTonight ??
    spotPremiere ??
    (top[0]
      ? {
          ...top[0],
          ep_name: null,
          ep_season: null,
          ep_number: null,
          ep_airdate: null,
          ep_airstamp: null,
        }
      : null);
  const spotEyebrow = spotTonight
    ? "On tonight"
    : spotPremiere
      ? `Premieres ${spotPremiere.ep_airdate ? longDate(spotPremiere.ep_airdate) : "soon"}`
      : "Tonight's pick";
  const spotAirTime = spotTonight?.ep_airstamp ? airTime(spotTonight.ep_airstamp) : null;
  const spotGenres: string[] = spot?.genres ? JSON.parse(spot.genres) : [];
  const alsoTonight = spotTonight ? tonight.filter((e) => e.show_slug !== spotTonight.slug) : tonight;

  // the sign-on frame: the spotlight show's real designed backdrop (one
  // edge-cached call); falls back to its poster blurred into ambient light
  const backdrop =
    spot?.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, spot.tmdb_id)
      : null;
  const spotPosterBg = spot ? hiRes(spot.image_url) : null;
  const spotFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : spotPosterBg
      ? heroBg(spotPosterBg)
      : null;

  c.header("Cache-Control", "public, max-age=300");
  return c.html(
    <Layout
      title="TV Nightly — best episodes, release dates & what's on TV tonight"
      description="Track the best episodes of every TV show, season release dates, renewal status, and what's airing tonight."
      canonical={canonical(c)}
      scripts={["/js/poster-rail.js"]}
      preloadImage={backdrop ?? undefined}
    >
      <div class="home">
        {/* Sign-on: tonight's headline in the house frame treatment. The
            section has no chrome — the scrim resolves to --bg, so it melts
            into the page. Data-driven, never a marketing banner. */}
        {spot ? (
          <section
            class={backdrop ? "spotlight" : "spotlight spot-ambient"}
            aria-labelledby="spot-title"
          >
            {spotFrame ? <div class="hero-backdrop" style={spotFrame}></div> : null}
            <div class="spot-head">
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
                  {spotTonight ? <span class="live-dot"></span> : null}
                  {homeDateline()}
                  <span class="eyebrow-sep">·</span>
                  {spotEyebrow}
                  {spotAirTime ? (
                    <>
                      <span class="eyebrow-sep">·</span>
                      {spotAirTime} UTC
                    </>
                  ) : null}
                </p>
                <h1 class="spot-title" id="spot-title">
                  <a href={`/show/${spot.slug}`}>{spot.name}</a>
                </h1>
                <p class="meta-strip">
                  <StatusBadge status={spot.status} />
                  {spot.premiered ? <span>{spot.premiered.slice(0, 4)}</span> : null}
                  {spotGenres.length ? (
                    <>
                      <span class="sep">·</span>
                      <span>{spotGenres.slice(0, 3).join(", ")}</span>
                    </>
                  ) : null}
                  {spot.rating != null ? (
                    <>
                      <span class="sep">·</span>
                      <span class="rating">★ {spot.rating.toFixed(1)}</span>
                    </>
                  ) : null}
                </p>
                {spot.summary ? <p class="spot-dek">{stripHtml(spot.summary)}</p> : null}
                {spot.ep_season != null ? (
                  <p class="spot-ep">
                    S{String(spot.ep_season).padStart(2, "0")}E
                    {String(spot.ep_number ?? 0).padStart(2, "0")}
                    {spot.ep_name ? ` — ${spot.ep_name}` : ""}
                    {spot.network || spot.web_channel ? (
                      <span class="muted"> · {spot.network ?? spot.web_channel}</span>
                    ) : null}
                  </p>
                ) : null}
                <ProviderLine row={spot} region={visitorRegion(c)} pickerType="tv" />
                <p class="spot-actions">
                  <a class="btn-ghost chev-after" href={`/show/${spot.slug}`}>
                    Episode guide & ratings
                  </a>
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {/* two cards, and the CTA stack floats centered over their curved
            bottoms — the evening ends at the question */}
        <section class="evening">
          <div class="evening-grid">
            <div class="evening-card evening-main">
              <p class="section-eyebrow">Your evening</p>
              <div class="evening-head">
                <h2>
                  {spotTonight ? (
                    <>
                      <span class="live-dot"></span>Also on tonight
                    </>
                  ) : (
                    <>
                      <span class="live-dot"></span>On tonight
                    </>
                  )}{" "}
                  <a class="more" href="/tonight">
                    full schedule
                  </a>
                </h2>
                <p class="section-lead muted">Every episode airing today, in air-time order.</p>
              </div>
              {alsoTonight.length ? (
                <ol class="poster-shelf">
                  {alsoTonight.map((e) => (
                    <li>
                      <a
                        class="shelf-tile"
                        href={`/show/${e.show_slug}`}
                        title={`${e.show_name} ${epCode(e)}${e.name ? ` — ${e.name}` : ""}${e.network ? ` · ${e.network}` : ""}`}
                        aria-label={`${e.show_name} ${epCode(e)}, ${airTime(e.airstamp) ?? "tonight"}`}
                      >
                        {(e.show_poster ?? e.show_image) ? (
                          <img
                            src={(e.show_poster ?? e.show_image)!}
                            alt=""
                            width="92"
                            height="138"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <span class="shelf-fallback">{e.show_name}</span>
                        )}
                        <span class="shelf-chip">{airTime(e.airstamp) ?? "tonight"}</span>
                      </a>
                      <span class="shelf-name">{e.show_name}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p class="muted">
                  {spotTonight
                    ? "Nothing else on the schedule tonight — the spotlight has the room."
                    : "Quiet night in the schedule — a good one to start something."}
                </p>
              )}
            </div>
            <div class="evening-card evening-aside">
              <div class="evening-head">
                <h2>
                  Coming up{" "}
                  <a class="more" href="/premieres">
                    all premieres
                  </a>
                </h2>
                <p class="section-lead muted">Season premieres in the next three weeks.</p>
              </div>
              {premieres.length ? (
                <ul class="poster-shelf">
                  {premieres.map((p) => {
                    const { day, month } = premiereDateParts(p.airdate);
                    return (
                      <li>
                        <a
                          class="shelf-tile"
                          href={`/show/${p.show_slug}/release-date`}
                          title={`${p.show_name} — Season ${p.season} premiere`}
                          aria-label={`${p.show_name} Season ${p.season} premieres ${month ? `${month} ${day}` : "soon"}`}
                        >
                          {(p.show_poster ?? p.show_image) ? (
                            <img
                              src={(p.show_poster ?? p.show_image)!}
                              alt=""
                              width="92"
                              height="138"
                              loading="lazy"
                              decoding="async"
                            />
                          ) : (
                            <span class="shelf-fallback">{p.show_name}</span>
                          )}
                          <span class="shelf-chip shelf-chip-date">
                            <span class="chip-soon">Soon</span>
                            {month ? `${month} ${day}` : null}
                          </span>
                        </a>
                        <span class="shelf-name">{p.show_name}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p class="muted">No premieres in the next three weeks.</p>
              )}
            </div>
          </div>
          <div class="evening-cta">
            <a class="verdict-btn" href="/what-to-watch">
              What should I watch tonight?
            </a>
            <a class="btn-ghost" href="/recommend">
              Rate one thing, get a personal pick
            </a>
          </div>
        </section>

        <section class="home-discover">
          <p class="section-eyebrow">Discover</p>
          <div class="discover-tabs">
            <input type="radio" name="discover" id="discover-tv" class="discover-input" checked />
            <input type="radio" name="discover" id="discover-movies" class="discover-input" />
            <div class="discover-head">
              <h2>Popular right now</h2>
              <p class="section-lead muted">Ranked by what people search and return to most.</p>
            </div>
            <div class="discover-tablist">
              <label for="discover-tv">TV shows</label>
              <label for="discover-movies">Movies</label>
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
              <div class="poster-rail">
                <button type="button" class="rail-btn rail-btn-prev" aria-label="Scroll shows left">
                  <span class="chev-icon chev-icon-prev" aria-hidden="true"></span>
                </button>
                <div class="poster-row">
                  {top.map((s) => (
                    <ShowCard show={s} />
                  ))}
                </div>
                <button type="button" class="rail-btn rail-btn-next" aria-label="Scroll shows right">
                  <span class="chev-icon" aria-hidden="true"></span>
                </button>
              </div>
            </div>
            <div class="discover-panel panel-movies">
              <div class="poster-rail">
                <button type="button" class="rail-btn rail-btn-prev" aria-label="Scroll movies left">
                  <span class="chev-icon chev-icon-prev" aria-hidden="true"></span>
                </button>
                <div class="poster-row">
                  {topMovies.map((m) => (
                    <MovieCard movie={m} />
                  ))}
                </div>
                <button type="button" class="rail-btn rail-btn-next" aria-label="Scroll movies right">
                  <span class="chev-icon" aria-hidden="true"></span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <section class="home-tools">
          <p class="section-eyebrow">Tools</p>
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
            <a class="tool-tile tool-tile-lg" href="/what-to-watch">
              <span class="tool-tile-glyph" aria-hidden="true">
                <IconDial size={132} />
              </span>
              <strong>Tonight's picker</strong>
              <p class="muted">Filter by genre, runtime, and streaming service — then spin.</p>
              <span class="chev-icon" aria-hidden="true"></span>
            </a>
            <div class="tools-bento-rest">
              <a class="tool-tile tool-tile-sm" href="/tonight">
                <span>Tonight's full schedule</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconCal size={38} />
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
              <a class="tool-tile tool-tile-sm" href="/compare">
                <span>Compare two shows</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconVs size={58} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/loved">
                <span>Loved by this community</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconHearts size={56} />
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
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconAudience size={50} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
              <a class="tool-tile tool-tile-sm" href="/top/tv">
                <span>Top TV shows</span>
                <span class="tool-tile-glyph-sm" aria-hidden="true">
                  <IconTvPlay size={54} />
                </span>
                <span class="chev-icon chev-icon-sm" aria-hidden="true"></span>
              </a>
            </div>
          </div>
          <p class="browse-line">
            <span class="browse-label">Browse</span>
            {VERTICALS.map((v, i) => (
              <>
                {i > 0 ? " · " : " "}
                <a href={`/${v.slug}`}>{v.name}</a>
              </>
            ))}
            {" · "}
            <a class="chev-after" href="/lists">
              All lists
            </a>
          </p>
        </section>
      </div>
    </Layout>,
  );
});

export default app;
