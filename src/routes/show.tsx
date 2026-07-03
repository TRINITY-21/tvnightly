import { Hono } from "hono";
import { raw } from "hono/html";
import { ExploreCard } from "../components/cards";
import { VsCard } from "../components/compare";
import { communityRingScore, DetailHero, heroWatchProvider, tmdbRingScore } from "../components/detail-hero";
import { byngeHandoffHref } from "../lib/bynge";
import { DossierRow } from "../components/dossier";
import { FilterSelect, SubscribeCompact, SubscribeForm } from "../components/forms";
import { HomeSidebarRail } from "../components/home-sidebar";
import { IconPlay, IconStar } from "../components/icons";
import { KeepGoing, loadShowKeepGoingArts } from "../components/keep-going";
import { Layout } from "../components/Layout";
import { SeasonTabs, ShowTabs } from "../components/nav";
import { mergeGalleryImages, PhotoGallery } from "../components/photo-gallery";
import { ShareBar } from "../components/share";
import { VideoGallery } from "../components/video-gallery";
import { buildDossier } from "../lib/dossier";
import { fetchShowExploreArts } from "../lib/explore-art";
import { comparePathFor, epCode, epHref, epregStill, epregStillPreload, fmtRuntime, heroBg, hiRes, inlineStill, longDate, personHref, posterSrc, slugifyName, stripHtml } from "../lib/format";
import { PROVIDER_LOGOS, providerBrand, providersFor, regionOptions, REGIONS, visitorRegion } from "../lib/providers";
import { crewLinkMap, getShow, similarShows } from "../lib/queries";
import { aggregateRatingLd, titleRaterCount, titleStat } from "../lib/ratings";
import { breadcrumbLd, breadcrumbTrail, canonical, faqLd, origin } from "../lib/seo";
import { tmdbBackdrop, tmdbMedia, tmdbRecommendations, tmdbShowCreators, tmdbShowCrew } from "../lib/tmdb";
import { playableFromVideos, playableVideoList } from "../lib/youtube";
import { toShowRow } from "../lib/tmdb-rows";
import { d1OrLiveEpisodes, resolveShow, tmdbShowCast, tmdbShowData } from "../lib/tmdb-show";
import { hubForGenres } from "../lib/verticals";
import { EpisodeRow, HonoEnv, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

// A show's meta description: its real (HTML-stripped) summary when present, cut
// cleanly on a word boundary; otherwise a synthesized line built from genre,
// years and status — so the description (and the og/twitter description Layout
// derives from it) is never empty for the summary-less shows in the catalog.
const showMetaDescription = (show: ShowRow): string => {
  const summary = stripHtml(show.summary).trim();
  if (summary) {
    if (summary.length <= 160) return summary;
    const cut = summary.slice(0, 157);
    const sp = cut.lastIndexOf(" ");
    return (sp > 120 ? cut.slice(0, sp) : cut).trimEnd() + "…";
  }
  const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const g = genres.slice(0, 2).join(", ");
  const years = show.premiered
    ? ` (${show.premiered.slice(0, 4)}${show.ended ? `–${show.ended.slice(0, 4)}` : show.status === "Running" ? "–present" : ""})`
    : "";
  return `${show.name}${years} — ${g ? `${g} ` : ""}TV series: episode ratings, season guide, renewal status and where to stream, on TV Nightly.`;
};

// The hero poster: the same canonical art every other surface uses
// (backfilled TMDB one-sheet, TVmaze fallback) — never a second variant.
const HeroPoster = (show: ShowRow) => {
  const p = posterSrc(show);
  // The above-the-fold hero poster: explicit 2:3 dims reserve its box (CLS) and
  // it's an LCP candidate, so load it eagerly at high priority — never lazily.
  return p ? (
    <img
      class="poster"
      src={p.src}
      srcset={p.srcset}
      alt={`${show.name} poster`}
      width="200"
      height="300"
      fetchpriority="high"
      decoding="async"
    />
  ) : (
    <div class="poster card-fallback">{show.name}</div>
  );
};

app.get("/show/:slug", async (c) => {
  const slug = c.req.param("slug");
  let show = await getShow(c.env.DB, slug);
  let episodes: EpisodeRow[];
  let ratingRef: string;
  if (show) {
    episodes = await d1OrLiveEpisodes(c, show);
    ratingRef = String(show.id);
  } else {
    // hybrid: build the SAME page live from TMDB for a title not in the mirror
    const built = await tmdbShowData(c, slug);
    if (!built) return c.notFound();
    show = built.show;
    episodes = built.episodes;
    ratingRef = `t${built.tmdbId}`;
  }

  const seasons = new Map<number, EpisodeRow[]>();
  for (const e of episodes) {
    const s = e.season ?? 0;
    if (!seasons.has(s)) seasons.set(s, []);
    seasons.get(s)!.push(e);
  }
  const netName = show.network ?? show.web_channel;
  const region = visitorRegion(c);
  // Cast: the mirror's stored cast_json, or — for a freshly-seeded show that
  // hasn't been cast-synced yet — fetched live from TMDB so the section never
  // comes up empty. Same {n,c,img} shape; live entries also carry a person id.
  type CastTile = { n: string; c: string | null; img: string | null; id?: number };
  const castFetch: Promise<CastTile[]> = show.cast_json
    ? Promise.resolve(JSON.parse(show.cast_json) as CastTile[])
    : show.tmdb_id && c.env.TMDB_API_KEY
      ? tmdbShowCast(c.env.TMDB_API_KEY, show.tmdb_id)
      : Promise.resolve([] as CastTile[]);
  // one bound COUNT instead of the full network GROUP-BY scan per pageview
  const [d1Similar, stat, aggRating, netCount, cast, raterCount, communityCounts] = await Promise.all([
    similarShows(c.env.DB, show),
    titleStat(c.env.DB, "tv", ratingRef),
    aggregateRatingLd(c.env.DB, "tv", ratingRef),
    netName
      ? c.env.DB.prepare(
          "SELECT COUNT(*) AS c FROM shows WHERE (network = ? OR web_channel = ?) AND weight >= 60",
        )
          .bind(netName, netName)
          .first<{ c: number }>()
      : Promise.resolve(null),
    castFetch,
    titleRaterCount(c.env.DB, "tv", ratingRef),
    c.env.DB
      .prepare("SELECT loved, liked, meh, awful FROM title_ratings WHERE kind = ? AND ref = ?")
      .bind("tv", ratingRef)
      .first<{ loved: number; liked: number; meh: number; awful: number }>(),
  ]);
  let similar = d1Similar;
  // live-only titles carry TMDB genre names ("Action & Adventure") that don't
  // overlap the mirror's TVmaze labels ("Action", "Adventure") — same fallback
  // as /show/:slug/similar so the overview rail never comes up empty.
  if (!similar.length && show.tmdb_id && c.env.TMDB_API_KEY) {
    similar = (await tmdbRecommendations(c.env.TMDB_API_KEY, "tv", show.tmdb_id))
      .slice(0, 6)
      .map(toShowRow);
  }
  const netEntry =
    netName && (netCount?.c ?? 0) >= 3 ? { name: netName, slug: slugifyName(netName) } : undefined;

  const site = origin(c);

  // The hero frame: the show's real designed backdrop from TMDB (edge-cached),
  // falling back to the poster for the few shows without a TMDB bridge.
  const backdrop =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id)
      : null;
  // the creator(s) are the TV headline credit — same cached bundle as the
  // backdrop, linked to a person page where we track them
  const creators =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbShowCreators(c.env.TMDB_API_KEY, show.tmdb_id)
      : [];
  const creatorLinks = creators.length
    ? await crewLinkMap(c.env.DB, creators)
    : new Map<number, number>();

  const [media, crew] =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await Promise.all([
          tmdbMedia(c.env.TMDB_API_KEY, show.tmdb_id),
          tmdbShowCrew(c.env.TMDB_API_KEY, show.tmdb_id, 12),
        ])
      : [null, []];
  const trailerVids = await playableVideoList(c, media?.videos ?? []);
  const trailerVid = trailerVids[0] ?? null;
  const highlights = (media?.videos ?? []).filter((v) => v.key !== trailerVid?.key).slice(0, 14);
  const galleryPhotos = mergeGalleryImages(media?.posters ?? [], media?.backdrops ?? [], 12);
  const galleryVideos = (media?.videos ?? []).slice(0, 12);
  const writers = crew
    .filter((p) => p.jobs.split(" · ").some((j) => j === "Writer" || j === "Screenplay"))
    .slice(0, 3);
  const writerLinks = writers.length ? await crewLinkMap(c.env.DB, writers) : new Map<number, number>();
  const prov = providersFor(show, region);
  const watchProv = heroWatchProvider(prov.names, show.name, prov.region, "tv");
  const byngeWatchHref = byngeHandoffHref("tv", {
    tmdbId: show.tmdb_id,
    imdbId: show.imdb_id,
  }, {
    title: show.name,
    poster: show.poster_url ?? show.image_url,
  });

  // TVSeries node built here (after creators resolve) so it can carry the creator
  // credits, plus genre and episode count from the data already in scope.
  const showGenres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const creatorNodes = creators.map((p) => {
    const pid = creatorLinks.get(p.id);
    return {
      "@type": "Person",
      name: p.name,
      ...(pid ? { url: `${site}/person/${slugifyName(p.name)}-${pid}` } : {}),
    };
  });
  const ld: unknown[] = [
    {
      "@context": "https://schema.org",
      "@type": "TVSeries",
      name: show.name,
      url: `${site}/show/${show.slug}`,
      ...(show.poster_url || show.image_url
        ? { image: show.poster_url ?? show.image_url }
        : {}),
      ...(show.premiered ? { startDate: show.premiered } : {}),
      ...(show.ended ? { endDate: show.ended } : {}),
      ...(seasons.size ? { numberOfSeasons: Math.max(...seasons.keys()) } : {}),
      ...(episodes.length ? { numberOfEpisodes: episodes.length } : {}),
      ...(showGenres.length ? { genre: showGenres } : {}),
      ...(creatorNodes.length ? { creator: creatorNodes } : {}),
      // first-party community verdicts only (see aggregateRatingLd) — null below
      // the rater threshold, so thin shows emit no star snippet
      ...(aggRating ? { aggregateRating: aggRating } : {}),
    },
    breadcrumbTrail([
      { name: "TV Nightly", url: site },
      { name: "TV shows", url: `${site}/top/tv` },
      { name: show.name, url: `${site}/show/${show.slug}` },
    ]),
  ];

  const posterBg = hiRes(show.image_url);

  // the rivals' backdrops for the head-to-head split cards (edge-cached)
  const [rivalBackdrops] = await Promise.all([
    c.env.TMDB_API_KEY
      ? Promise.all(
          similar
            .slice(0, 3)
            .map((s) =>
              s.tmdb_id ? tmdbBackdrop(c.env.TMDB_API_KEY!, s.tmdb_id) : Promise.resolve(null),
            ),
        )
      : Promise.resolve([] as (Awaited<ReturnType<typeof tmdbBackdrop>> | null)[]),
  ]);
  const sidebar = c.get("siteSidebar");

  const exploreGenres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const exploreHub = hubForGenres(exploreGenres, null);
  const exploreArts = c.env.TMDB_API_KEY
    ? await fetchShowExploreArts(c.env.DB, c.env.TMDB_API_KEY, {
        showBackdrop: backdrop,
        compareBackdrop: rivalBackdrops[0] ?? backdrop,
        netName: netEntry?.name ?? null,
        genres: exploreGenres.slice(0, 2),
        hubSlug: exploreHub?.slug ?? null,
      })
    : {
        essential: backdrop,
        compare: rivalBackdrops[0] ?? backdrop,
        network: null,
        genres: [],
        hub: null,
      };

  c.header("Cache-Control", "public, max-age=300");
  // og.png resolves live titles too, so a hybrid (non-D1) show still unfurls as the
  // branded 1200×630 card, not a portrait poster mis-sized as a large card.
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title={`${show.name} — episodes, ratings & renewals | TV Nightly`}
      description={showMetaDescription(show)}
      canonical={canonical(c)}
      ld={ld}
      ogImage={`${canonical(c)}/og.png`}
      ogImageLarge
      preloadImage={backdrop?.x2 ? { x1: backdrop.x1, x2: backdrop.x2 } : undefined}
      scripts={["/js/share.js", "/js/exit-capture.js"]}
    >
      <article class="show-hub">
        <DetailHero
          kind="tv"
          title={show.name}
          yearLabel={
            show.premiered
              ? ` (${show.premiered.slice(0, 4)}${show.ended ? `–${show.ended.slice(0, 4)}` : show.status === "Running" ? "–present" : ""})`
              : null
          }
          shareTitle={`${show.name} — episodes, ratings & where to stream`}
          shareUrl={canonical(c)}
          typeLabel="TV Show"
          typeHref="/top/tv"
          network={watchProv ? null : netName}
          networkHref={netName ? `/network/${slugifyName(netName)}` : null}
          tmdbScore={tmdbRingScore(show.rating)}
          communityScore={communityRingScore(communityCounts ?? null)}
          poster={HeroPoster(show)}
          trailer={trailerVid}
          trailerCandidates={trailerVids}
          highlights={highlights}
          starring={cast.slice(0, 4).map((p) => ({
            name: p.n,
            href: personHref(p),
          }))}
          directors={creators.map((p) => ({
            name: p.name,
            href: creatorLinks.get(p.id)
              ? `/person/${slugifyName(p.name)}-${creatorLinks.get(p.id)}`
              : null,
          }))}
          writers={writers.map((p) => ({
            name: p.name,
            href: writerLinks.get(p.id)
              ? `/person/${slugifyName(p.name)}-${writerLinks.get(p.id)}`
              : null,
          }))}
          watchProvider={
            watchProv
              ? { ...watchProv, href: watchProv.href ?? `/show/${show.slug}/where-to-watch` }
              : null
          }
          byngeWatchHref={byngeWatchHref}
          metaBadge={show.status === "Running" ? "On air" : show.status === "Ended" ? "Ended" : null}
          genres={showGenres.slice(0, 4).map((g) => ({
            name: g,
            href: `/genre/${slugifyName(g)}/shows`,
          }))}
          metaExtra={
            episodes.length
              ? `${seasons.size} season${seasons.size === 1 ? "" : "s"}, ${episodes.length} episode${episodes.length === 1 ? "" : "s"}`
              : null
          }
          metaExtraHref={episodes.length ? `/show/${show.slug}/best-episodes` : null}
          plot={show.summary ? stripHtml(show.summary) : null}
          blurb={show.blurb ?? null}
          rateKind="tv"
          rateRef={ratingRef}
          rateStat={stat}
          mediaHref={`/show/${show.slug}/media`}
          fallbackBackdrop={backdrop}
        />
        <ShowTabs slug={show.slug} current="overview" />
        <div class="show-alert-inline">
          <SubscribeCompact
            showId={show.id}
            showName={show.name}
            kicker={
              show.status === "Running"
                ? `Get an email the moment ${show.name} is renewed`
                : show.status === "Ended"
                  ? `Email me if ${show.name} returns or gets revived`
                  : `Email me when ${show.name} premieres`
            }
          />
        </div>
        <div id="exit-capture" class="exit-capture" hidden>
          <div class="exit-capture-card" role="dialog" aria-modal="true" aria-labelledby="exit-capture-title">
            <button type="button" class="exit-capture-x" data-exit-close aria-label="Close">
              ×
            </button>
            <p class="exit-capture-kicker">Before you go</p>
            <p id="exit-capture-title" class="exit-capture-title">
              Never miss {show.name}
            </p>
            <p class="exit-capture-sub muted">
              We'll email you the moment {show.name} is renewed, cancelled or gets a premiere date. No account,
              one-click unsubscribe.
            </p>
            <SubscribeCompact showId={show.id} showName={show.name} kicker={`Email me about ${show.name}`} />
          </div>
        </div>
        <div class="home-main-grid">
          <div class="home-col">
        {(() => {
          const nextEp = episodes.find((e) => e.airstamp && new Date(e.airstamp) > new Date());
          return nextEp ? (
            <p class="answer">
              <span class="live-dot"></span>Next episode: <strong>{epCode(nextEp)}</strong>
              {nextEp.name ? ` — ${nextEp.name}` : ""}
              {nextEp.airdate ? ` · ${longDate(nextEp.airdate)}` : ""}{" "}
              <a href={`/show/${show.slug}/next-episode`} class="chev-after">countdown</a>
            </p>
          ) : null;
        })()}
        {(() => {
          const top3 = episodes
            .filter((e) => e.rating != null)
            .sort((a, b) => b.rating! - a.rating!)
            .slice(0, 3);
          return top3.length ? (
            <section>
              <h2>
                <span class="h2-label">Highest-rated episodes</span>{" "}
                <a class="more" href={`/show/${show.slug}/best-episodes`}>
                  all ranked
                </a>
              </h2>
              <ol class="top3">
                {top3.map((e, i) => {
                  const pitch = stripHtml(e.summary);
                  return (
                    <li>
                      <span class="top3-num">{String(i + 1).padStart(2, "0")}</span>
                      {e.image_url ? (
                        <img
                          class="top3-still"
                          {...inlineStill(e.image_url)}
                          alt={`${show.name} ${epCode(e)}`}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                      <span class="top3-main">
                        <span class="top3-name">
                          <a href={epHref(show.slug, e)}>{e.name}</a>
                        </span>
                        <span class="top3-meta">
                          <span class="muted">{epCode(e)}</span> ·{" "}
                          <span class="rating"><IconStar class="rating-star" />{e.rating!.toFixed(1)}</span>
                        </span>
                        {pitch ? <span class="top3-sub">{pitch}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null;
        })()}
        {seasons.size ? (
          <section>
            <h2>Episodes by season</h2>
            <div class="lineup-board">
              {(() => {
                const latest = Math.max(...seasons.keys());
                const seasonAvg = (eps: EpisodeRow[]) => {
                  const rated = eps.filter((e) => e.rating != null);
                  return rated.length
                    ? rated.reduce((s, e) => s + e.rating!, 0) / rated.length
                    : null;
                };
                // "Best season" only when the comparison is honest: two or
                // more seasons with 5+ rated episodes each.
                const contenders = [...seasons.entries()]
                  .map(([n, eps]) => ({
                    n,
                    rated: eps.filter((e) => e.rating != null).length,
                    avg: seasonAvg(eps),
                  }))
                  .filter((s) => s.rated >= 5 && s.avg != null);
                const bestSeason =
                  contenders.length >= 2
                    ? contenders.reduce((a, b) => (b.avg! > a.avg! ? b : a)).n
                    : null;
                // Season shape at a glance: one bar per rated episode in
                // airing order on a ground line, the season's peak in gold.
                const seasonSpark = (rated: EpisodeRow[], bestId: number) => {
                  const W = 4;
                  const G = 2;
                  const H = 16;
                  const w = rated.length * (W + G) - G;
                  const bars = rated
                    .map((e, i) => {
                      const h = Math.max(2, Math.min(H, Math.round(((e.rating! - 4) / 6) * H)));
                      const fill = e.id === bestId ? "var(--warn)" : "rgba(163, 158, 151, 0.35)";
                      return `<rect x="${i * (W + G)}" y="${H - h}" width="${W}" height="${h}" rx="1" fill="${fill}"/>`;
                    })
                    .join("");
                  const base = `<rect x="0" y="${H - 1}" width="${w}" height="1" fill="rgba(163, 158, 151, 0.25)"/>`;
                  return raw(
                    `<svg class="fold-spark" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img"><title>Episode ratings across the season — the gold bar is its best episode</title>${base}${bars}</svg>`,
                  );
                };
                const epRate = (e: EpisodeRow) =>
                  e.rating != null ? (
                    <span class="ep-rate rating">
                      <span class="star"><IconStar class="rating-star" /></span> {e.rating.toFixed(1)}
                    </span>
                  ) : (
                    <span class="ep-rate muted">—</span>
                  );
                const twoToneCode = (e: EpisodeRow) => {
                  const code = epCode(e);
                  return (
                    <span class="ep-code">
                      <span class="s">{code.slice(0, 3)}</span>
                      {code.slice(3)}
                    </span>
                  );
                };
                return [...seasons.entries()].map(([season, eps]) => {
                  const rated = eps.filter((e) => e.rating != null);
                  const avg = seasonAvg(eps);
                  const yrs = eps
                    .map((e) => e.airdate?.slice(0, 4))
                    .filter((y): y is string => !!y);
                  const aired = yrs.length
                    ? yrs[0] === yrs[yrs.length - 1]
                      ? yrs[0]
                      : `${yrs[0]}–${yrs[yrs.length - 1].slice(2)}`
                    : null;
                  const best =
                    rated.length >= 3
                      ? rated.reduce((a, b) => (b.rating! > a.rating! ? b : a))
                      : null;
                  return (
                    <details class="season-fold" open={season === latest}>
                      <summary>
                        <span class="fold-slate">
                          {season === 0 ? (
                            <span class="fold-eyebrow">Specials</span>
                          ) : (
                            <>
                              <span class="fold-eyebrow">Season</span>
                              <span class="fold-num">{String(season).padStart(2, "0")}</span>
                            </>
                          )}
                        </span>
                        {season === bestSeason ? <span class="ep-best">Best season</span> : null}
                        {best ? seasonSpark(rated, best.id) : null}
                        <span class="fold-meta">
                          <span class="m">
                            <span class="m-val">{eps.length}</span>
                            <span class="m-label">Episodes</span>
                          </span>
                          {aired ? (
                            <span class="m m-aired">
                              <span class="m-val">{aired}</span>
                              <span class="m-label">Aired</span>
                            </span>
                          ) : null}
                          <span class="m">
                            <span class="m-val rating">
                              {avg != null ? (
                                <>
                                  <span class="star"><IconStar class="rating-star" /></span> {avg.toFixed(1)}
                                </>
                              ) : (
                                "—"
                              )}
                            </span>
                            <span class="m-label">Season avg</span>
                          </span>
                        </span>
                      </summary>
                      <div class="fold-body">
                        <ol class="ep-list">
                          {eps.map((e) => {
                            const isBest = best != null && e.id === best.id;
                            const pitch = stripHtml(e.summary).slice(0, 140);
                            return (
                              <li class="ep-row">
                                {twoToneCode(e)}
                                <span class="still-wrap">
                                  {e.image_url ? (
                                    <img
                                      {...inlineStill(e.image_url)}
                                      width="84"
                                      height="47"
                                      alt={`${show.name} ${epCode(e)}`}
                                      loading="lazy"
                                      decoding="async"
                                    />
                                  ) : (
                                    <span class="still-empty" aria-hidden="true"></span>
                                  )}
                                  {isBest ? <span class="still-chyron">Season's best</span> : null}
                                </span>
                                <span class="ep-lead-main">
                                  <span class="ep-lead-line">
                                    <a
                                      class="ep-name"
                                      href={epHref(show.slug, e)}
                                      title={e.name ?? undefined}
                                    >
                                      {e.name ?? epCode(e)}
                                    </a>
                                    <span class="ep-leader"></span>
                                    <span class="ep-date muted">
                                      {e.airdate ? longDate(e.airdate) : ""}
                                    </span>
                                    {epRate(e)}
                                  </span>
                                  {pitch ? <span class="ep-lead-sub">{pitch}</span> : null}
                                </span>
                              </li>
                            );
                          })}
                        </ol>
                        <p class="fold-foot">
                          <a class="chev-after" href={`/show/${show.slug}/season/${season}`}>
                            Season {season} ranked & reviewed
                          </a>
                        </p>
                      </div>
                    </details>
                  );
                });
              })()}
            </div>
          </section>
        ) : null}
        {(() => {
          return cast.length ? (
            <section id="cast">
              <h2>
                <span class="h2-label">Cast</span>
                {cast.length > 8 ? (
                  <a class="more" href={`/show/${show.slug}/cast`}>
                    full cast & details
                  </a>
                ) : null}
              </h2>
              <div class="cast-row">
                {cast.slice(0, 8).map((p) => {
                  const href = personHref(p);
                  const inner = (
                    <>
                      {p.img ? (
                        <img src={p.img} alt={p.n} loading="lazy" />
                      ) : (
                        <div class="cast-fallback">{p.n}</div>
                      )}
                      <span class="cast-name">{p.n}</span>
                      {p.c ? <span class="cast-char muted">{p.c}</span> : null}
                    </>
                  );
                  return href ? (
                    <a class="cast-card" href={href}>
                      {inner}
                    </a>
                  ) : (
                    <div class="cast-card">{inner}</div>
                  );
                })}
              </div>
            </section>
          ) : null;
        })()}
        {galleryPhotos.length ? (
          <PhotoGallery
            entityName={show.name}
            mediaHref={`/show/${show.slug}/media`}
            images={galleryPhotos}
          />
        ) : null}
        {galleryVideos.length ? (
          <VideoGallery
            mediaHref={`/show/${show.slug}/media`}
            videos={galleryVideos}
          />
        ) : null}
        {similar.length ? (
          <section id="similar">
            <h2>
              <span class="h2-label">Shows like {show.name}</span>{" "}
              <a class="more" href={`/show/${show.slug}/similar`}>
                all similar shows
              </a>
            </h2>
            {/* the method line is literally what the SQL does — same honesty
                move as the tab rail: say only what we can back */}
            <p class="dossier-method">
              The closest matches on shared genres, ranked by match strength and popularity.
            </p>
            <ol class="dossier-board">
              {similar.map((s, i) => (
                <DossierRow
                  i={i}
                  href={`/show/${s.slug}`}
                  name={s.name}
                  d={buildDossier(show, s, region)}
                  rating={s.rating}
                  poster={posterSrc(s)}
                  compare={{
                    href: comparePathFor(show.slug, s.slug),
                    label: `Compare ${s.name} with ${show.name}`,
                  }}
                />
              ))}
            </ol>
          </section>
        ) : null}
        {similar.length ? (
          <section id="head-to-head">
            <h2>
              <span class="h2-label">Head-to-head</span>{" "}
              <a class="more" href={`/compare?a=${show.slug}`}>
                pick any opponent
              </a>
            </h2>
            <p class="dossier-method">
              Stack {show.name}'s full episode-rating history against a rival, on one chart.
            </p>
            <div class="vs-grid">
              {similar.slice(0, 3).map((s, i) => {
                const small = (u: string) => u.replace("/w1280/", "/w780/");
                return (
                  <VsCard
                    href={comparePathFor(show.slug, s.slug)}
                    a={{
                      name: show.name,
                      poster: posterSrc(show)?.src ?? null,
                      backdrop: backdrop ? small(backdrop.x1) : null,
                    }}
                    b={{
                      name: s.name,
                      poster: posterSrc(s)?.src ?? null,
                      backdrop: rivalBackdrops[i] ? small(rivalBackdrops[i]!.x1) : null,
                    }}
                    cta="Full episode chart"
                  />
                );
              })}
            </div>
          </section>
        ) : null}
        {(() => {
          const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
          const hub = hubForGenres(genres, null);
          return (
            <section>
              <h2>
                <span class="h2-label">Keep exploring</span>{" "}
                <a class="more" href="/top/tv">
                  top shows
                </a>
              </h2>
              <div class="explore-grid">
                <ExploreCard
                  icon="Shortcut"
                  title="The essential episodes"
                  desc="Short on time? The pilot-to-finale shortcut, only the episodes that matter."
                  href={`/show/${show.slug}/essential`}
                  backdrop={exploreArts.essential}
                />
                <ExploreCard
                  icon="Matchup"
                  title="Compare with another show"
                  desc="Two shows' episode ratings on one chart — settle it."
                  href={`/compare?a=${show.slug}`}
                  backdrop={exploreArts.compare}
                />
                {netEntry ? (
                  <ExploreCard
                    icon="Network"
                    title={`Best ${netEntry.name} shows`}
                    desc="More from the same network, ranked by rating."
                    href={`/network/${netEntry.slug}`}
                    backdrop={exploreArts.network}
                  />
                ) : null}
                {genres.slice(0, 2).map((g, i) => (
                  <ExploreCard
                    icon="Genre"
                    title={`Best ${g.toLowerCase()} shows & films`}
                    desc={`The top of the ${g.toLowerCase()} pile, across both mediums.`}
                    href={`/genre/${slugifyName(g)}`}
                    backdrop={exploreArts.genres[i] ?? null}
                  />
                ))}
                {hub ? (
                  <ExploreCard
                    icon="Fandom hub"
                    title={`The ${hub.name.toLowerCase()} hub`}
                    desc="The whole fandom on one bookmarkable page — rankings, premieres, what's new."
                    href={`/${hub.slug}`}
                    backdrop={exploreArts.hub}
                  />
                ) : null}
              </div>
            </section>
          );
        })()}
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

// ----------------------------------------------------- ICS calendar feed

app.get("/show/:slug/calendar.ics", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const show = r.show;
  const cutoff = Date.now() - 7 * 86_400_000;
  const eps = r.episodes
    .filter((e) => e.airstamp && new Date(e.airstamp).getTime() > cutoff)
    .sort(
      (a, b) => new Date(a.airstamp as string).getTime() - new Date(b.airstamp as string).getTime(),
    )
    .slice(0, 100);

  const icsEsc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/[;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const stamp = dt(new Date().toISOString());

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TV Nightly//tvnightly.com//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEsc(show.name)} — TV Nightly`,
  ];
  for (const e of eps) {
    if (!e.airstamp) continue;
    lines.push(
      "BEGIN:VEVENT",
      `UID:ep-${e.id}@tvnightly.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${dt(e.airstamp)}`,
      `DURATION:PT${e.runtime ?? 60}M`,
      `SUMMARY:${icsEsc(`${show.name} ${epCode(e)}${e.name ? ` — ${e.name}` : ""}`)}`,
      `URL:${origin(c)}/show/${show.slug}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  c.header("Content-Type", "text/calendar; charset=utf-8");
  c.header("Cache-Control", "public, max-age=21600");
  return c.body(lines.join("\r\n") + "\r\n");
});

// ---------------------------------------------------------- season pages

// "Where to watch X" is one of TV's biggest query patterns; we answer it
// region by region from the mirror the provider patrol keeps fresh.
app.get("/show/:slug/where-to-watch", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const { show } = r;
  const base = `/show/${show.slug}/where-to-watch`;
  const reqRegion = (c.req.query("region") ?? "").trim().toUpperCase();
  if (reqRegion && !REGIONS.includes(reqRegion)) return c.redirect(base, 301);
  const region = reqRegion || visitorRegion(c);

  const intl: Record<string, string[]> = show.providers_intl
    ? JSON.parse(show.providers_intl)
    : {};
  const names = intl[region] ?? [];
  const elsewhere = REGIONS.filter((r) => r !== region && intl[r]?.length);

  const [backdrop, d1Similar] = await Promise.all([
    show.tmdb_id && c.env.TMDB_API_KEY
      ? tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id)
      : Promise.resolve(null),
    similarShows(c.env.DB, show, 6),
  ]);
  let similar = d1Similar;
  if (!similar.length && show.tmdb_id && c.env.TMDB_API_KEY) {
    similar = (await tmdbRecommendations(c.env.TMDB_API_KEY, "tv", show.tmdb_id))
      .slice(0, 6)
      .map(toShowRow);
  }
  const heroFrame = backdrop
    ? heroBg(backdrop.x1, backdrop.x2)
    : show.poster_url
      ? heroBg(show.poster_url.replace("/w342/", "/w780/"))
      : null;

  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  const keepGoingArts = await loadShowKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    show,
    similar[0]?.tmdb_id,
  );
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title={`Where to watch ${show.name} — streaming options | TV Nightly`}
      description={
        names.length
          ? `${show.name} is streaming on ${names.slice(0, 4).join(", ")} in ${region}. Every service and region, checked around the clock.`
          : `Where ${show.name} is streaming, region by region — checked around the clock.`
      }
      canonical={`${site}${base}`}
      ogImage={`${site}/show/${show.slug}/og.png`}
      ogImageLarge
      preloadImage={backdrop?.x2 ? { x1: backdrop.x1, x2: backdrop.x2 } : undefined}
      ld={[
        breadcrumbLd(site, show, "Where to watch", base),
        ...(names.length
          ? [
              faqLd([
                {
                  q: `Where can I watch ${show.name}?`,
                  a: `${show.name} is streaming on ${names.slice(0, 6).join(", ")} in ${region}.`,
                },
              ]),
            ]
          : []),
      ]}
      scripts={["/js/dropdown.js"]}
    >
      <article class={`show-hub${backdrop ? " hub-backdrop" : ""}`}>
        <header class="detail-hero frame-hero">
          {heroFrame ? <div class="hero-backdrop" style={heroFrame}></div> : null}
          <div class="detail-head">
            <div class="detail-side">{HeroPoster(show)}</div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> Streaming guide
              </p>
              <h1>Where to watch {show.name}</h1>
              <form method="get" action={base} class="region-line watch-region" data-submit-on-change>
                <FilterSelect
                  label="Showing options for"
                  name="region"
                  current={region}
                  options={regionOptions()}
                />
              </form>
            </div>
          </div>
        </header>
        <ShowTabs slug={show.slug} current="watch" />
        <div class="home-main-grid">
          <div class="home-col">
        <section>
          <h2>Streaming in {region}</h2>
          {names.length ? (
            <ul class="watch-list">
              {names.map((n) => (
                <li class="watch-row">
                  {PROVIDER_LOGOS[n] ? (
                    <img
                      class="watch-logo"
                      src={PROVIDER_LOGOS[n]}
                      alt=""
                      width="44"
                      height="44"
                      loading="lazy"
                    />
                  ) : (
                    <span class="watch-logo watch-logo-fallback" aria-hidden="true">
                      {n.slice(0, 1)}
                    </span>
                  )}
                  <span class="watch-name">{n}</span>
                  <a
                    class="chev-after watch-more"
                    href={`/network/${slugifyName(providerBrand(n))}/shows`}
                  >
                    More on {providerBrand(n)}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <p class="muted">
                {show.name} isn't on a streaming service in {region} right now.
              </p>
              {elsewhere.length ? (
                <>
                  <p class="watch-elsewhere-eyebrow muted">Also streaming in</p>
                  <div class="footer-picks watch-region-picks">
                    {elsewhere.map((r) => (
                      <a class="footer-card" href={`${base}?region=${r}`}>
                        {r}
                      </a>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </section>
        {similar.length ? (
          <section>
            <h2>
              <span class="h2-label">Shows like {show.name}</span>{" "}
              <a class="more" href={`/show/${show.slug}/similar`}>
                all similar shows
              </a>
            </h2>
            <p class="dossier-method">
              The closest matches on shared genres, ranked by match strength and popularity.
            </p>
            <ol class="dossier-board">
              {similar.map((s, i) => (
                <DossierRow
                  i={i}
                  href={`/show/${s.slug}`}
                  name={s.name}
                  d={buildDossier(show, s, region)}
                  rating={s.rating}
                  poster={posterSrc(s)}
                  compare={{
                    href: comparePathFor(show.slug, s.slug),
                    label: `Compare ${s.name} with ${show.name}`,
                  }}
                />
              ))}
            </ol>
          </section>
        ) : null}
        <KeepGoing
          cards={[
            {
              icon: "Overview",
              title: `${show.name} overview`,
              desc: "Episodes, ratings, cast and the full series dossier.",
              href: `/show/${show.slug}`,
              backdrop: keepGoingArts.overview,
            },
            {
              icon: "Charts",
              title: "Best episodes",
              desc: "The highest-rated hours, ranked with viewer scores.",
              href: `/show/${show.slug}/best-episodes`,
              backdrop: keepGoingArts.bestEpisodes,
            },
            {
              icon: "Premieres",
              title: "What's new on streaming",
              desc: "Fresh arrivals and renewals across every service.",
              href: "/whats-new",
              backdrop: keepGoingArts.whatsNew,
            },
          ]}
        />
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
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

// "Shows like X" is its own query pattern — the full dossier gets a page.
app.get("/show/:slug/similar", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const show = r.show;
  let similar = await similarShows(c.env.DB, show, 18);
  // live-only or genre-less titles get nothing from the D1 genre-overlap query —
  // fall back to TMDB's own recommendations so the page never bounces
  if (!similar.length && show.tmdb_id && c.env.TMDB_API_KEY) {
    similar = (await tmdbRecommendations(c.env.TMDB_API_KEY, "tv", show.tmdb_id))
      .slice(0, 18)
      .map(toShowRow);
  }
  if (!similar.length) return c.redirect(`/show/${show.slug}`, 302);
  const region = visitorRegion(c);
  const base = `/show/${show.slug}/similar`;

  const site = origin(c);
  const sidebar = c.get("siteSidebar");
  const keepGoingArts = await loadShowKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    show,
    similar[0]?.tmdb_id,
  );
  const ld = [
    breadcrumbLd(site, show, "Similar shows", base),
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `Shows like ${show.name}`,
      itemListElement: similar.map((s, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${site}/show/${s.slug}`,
        name: s.name,
      })),
    },
  ];
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title={`Shows like ${show.name} — ${similar.length} similar shows ranked | TV Nightly`}
      description={`The ${similar.length} closest matches to ${show.name}: ${similar
        .slice(0, 4)
        .map((s) => s.name)
        .join(", ")} and more, ranked by match strength with ratings and where to stream.`}
      canonical={`${site}${base}`}
      ogImage={`${site}${base}/og.jpg`}
      ld={ld}
      scripts={["/js/share.js"]}
    >
      <article class="show-hub">
        <header class="detail-hero media-hero">
          <div class="detail-head">
            <div class="detail-side">{HeroPoster(show)}</div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> More like this
              </p>
              <div class="detail-title-row">
                <h1>Shows like {show.name}</h1>
                <ShareBar
                  url={`${site}${base}`}
                  title={`Shows like ${show.name}`}
                  pinMedia={`${site}${base}/og.jpg`}
                  pinDescription={`Shows like ${show.name} — ${similar.length} similar shows ranked by match strength, with ratings & where to stream.`}
                />
              </div>
              <p class="summary">
                The {similar.length} closest matches on shared genres, ranked by match strength
                and popularity — each with its evidence: shared cast, networks, and where it's
                streaming in your region.
              </p>
            </div>
          </div>
        </header>
        <ShowTabs slug={show.slug} current="similar" />
        <div class="home-main-grid">
          <div class="home-col">
        <section>
          <h2>The closest matches</h2>
          <ol class="dossier-board">
            {similar.map((s, i) => (
              <DossierRow
                i={i}
                href={`/show/${s.slug}`}
                name={s.name}
                d={buildDossier(show, s, region)}
                rating={s.rating}
                poster={posterSrc(s)}
                compare={{
                  href: comparePathFor(show.slug, s.slug),
                  label: `Compare ${s.name} with ${show.name}`,
                }}
              />
            ))}
          </ol>
        </section>
        <KeepGoing
          cards={[
            {
              icon: "Overview",
              title: `${show.name} overview`,
              desc: "Episodes, ratings, cast and the full series dossier.",
              href: `/show/${show.slug}`,
              backdrop: keepGoingArts.overview,
            },
            {
              icon: "Stream",
              title: "Where to watch",
              desc: `Every service carrying ${show.name}, region by region.`,
              href: `/show/${show.slug}/where-to-watch`,
              backdrop: keepGoingArts.watch,
            },
            {
              icon: "Picker",
              title: "What should I watch tonight?",
              desc: "Filter by mood, service and runtime — pick in seconds.",
              href: "/what-to-watch",
              backdrop: keepGoingArts.tonight,
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

// Media: the show's designed artwork and its YouTube trailers/clips,
// straight from TMDB (one edge-cached call) — no mirror tables touched.
app.get("/show/:slug/media", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const show = r.show;
  const media =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbMedia(c.env.TMDB_API_KEY, show.tmdb_id)
      : null;
  const base = `/show/${show.slug}/media`;
  const site = origin(c);

  const trailer = await playableFromVideos(c, media?.videos ?? []);
  const clips = (media?.videos ?? []).filter((v) => v !== trailer).slice(0, 9);
  const backdrops = (media?.backdrops ?? []).slice(0, 12);
  const posters = (media?.posters ?? []).slice(0, 12);
  const hasAny = Boolean(trailer || clips.length || backdrops.length || posters.length);
  const sidebar = c.get("siteSidebar");

  // No VideoObject here: the trailer is a thumbnail that links out to YouTube
  // (not an inline player), so this isn't a "watch page" by Google's definition.
  // Declaring VideoObject only earns a "Video isn't on a watch page" indexing
  // failure — the canonical video result belongs to YouTube anyway.
  const ld: unknown[] = [breadcrumbLd(site, show, "Media", base)];

  const similarPick = await similarShows(c.env.DB, show, 1);
  const keepGoingArts = await loadShowKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    show,
    similarPick[0]?.tmdb_id,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title={`${show.name} — trailer, posters & artwork | TV Nightly`}
      description={`Every trailer, clip, poster and backdrop for ${show.name} in one place.`}
      canonical={`${site}${base}`}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={ld}
      scripts={["/js/media-lightbox.js"]}
    >
      <article class="show-hub">
        <header class="detail-hero media-hero">
          <div class="detail-head">
            <div class="detail-side">{HeroPoster(show)}</div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> Media
              </p>
              <h1>{show.name} — trailers & artwork</h1>
              <p class="summary">
                {hasAny
                  ? `The official trailers, clips, posters and backdrops for ${show.name}.`
                  : `No media available for ${show.name} yet.`}
              </p>
            </div>
          </div>
        </header>
        <ShowTabs slug={show.slug} current="media" />
        <div class="home-main-grid">
          <div class="home-col">
        {trailer ? (
          <section>
            <h2>Trailer</h2>
            <a
              class="media-player media-player-cta"
              href={`https://www.youtube.com/watch?v=${trailer.key}`}
              target="_blank"
              rel="noopener"
              data-video-key={trailer.key}
              data-video-name={trailer.name}
              aria-label={`Play trailer: ${trailer.name}`}
            >
              <img
                src={`https://img.youtube.com/vi/${trailer.key}/hqdefault.jpg`}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <IconPlay size={56} />
            </a>
          </section>
        ) : null}
        {clips.length ? (
          <section>
            <h2>More videos</h2>
            <div class="media-videos">
              {clips.map((v) => (
                <a
                  class="media-video"
                  href={`https://www.youtube.com/watch?v=${v.key}`}
                  target="_blank"
                  rel="noopener"
                  data-video-key={v.key}
                  data-video-name={v.name}
                >
                  <span class="media-thumb">
                    <img
                      src={`https://img.youtube.com/vi/${v.key}/hqdefault.jpg`}
                      alt=""
                      width="480"
                      height="360"
                      loading="lazy"
                      decoding="async"
                    />
                    <IconPlay size={34} />
                  </span>
                  <span class="media-video-kind">{v.type}</span>
                  <span class="media-video-name">{v.name}</span>
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {backdrops.length ? (
          <section>
            <h2>Backdrops</h2>
            <div class="media-backdrops" data-gallery-title={show.name} data-gallery-kind="Backdrop">
              {backdrops.map((p, i) => (
                <a
                  class="media-art"
                  href={`https://image.tmdb.org/t/p/original${p}`}
                  target="_blank"
                  rel="noopener"
                  data-gallery="backdrops"
                  data-view={`https://image.tmdb.org/t/p/w1280${p}`}
                  data-alt={`${show.name} backdrop ${i + 1} of ${backdrops.length}`}
                >
                  <img
                    src={`https://image.tmdb.org/t/p/w780${p}`}
                    srcset={`https://image.tmdb.org/t/p/w780${p} 1x, https://image.tmdb.org/t/p/w1280${p} 2x`}
                    alt={`${show.name} backdrop ${i + 1}`}
                    width="780"
                    height="439"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        {posters.length ? (
          <section>
            <h2>Posters</h2>
            <div class="media-posters" data-gallery-title={show.name} data-gallery-kind="Poster">
              {posters.map((p, i) => (
                <a
                  class="media-art"
                  href={`https://image.tmdb.org/t/p/original${p}`}
                  target="_blank"
                  rel="noopener"
                  data-gallery="posters"
                  data-view={`https://image.tmdb.org/t/p/w780${p}`}
                  data-alt={`${show.name} poster ${i + 1} of ${posters.length}`}
                >
                  <img
                    src={`https://image.tmdb.org/t/p/w342${p}`}
                    srcset={`https://image.tmdb.org/t/p/w342${p} 1x, https://image.tmdb.org/t/p/w780${p} 2x`}
                    alt={`${show.name} poster ${i + 1}`}
                    width="342"
                    height="513"
                    loading="lazy"
                    decoding="async"
                  />
                </a>
              ))}
            </div>
          </section>
        ) : null}
        <KeepGoing
          cards={[
            {
              icon: "Overview",
              title: `${show.name} overview`,
              desc: "Episodes, ratings, cast and the full series dossier.",
              href: `/show/${show.slug}`,
              backdrop: keepGoingArts.overview,
            },
            {
              icon: "Matchup",
              title: `Shows like ${show.name}`,
              desc: "The closest matches, ranked by overlap and rating.",
              href: `/show/${show.slug}/similar`,
              backdrop: keepGoingArts.similar,
            },
            {
              icon: "Stream",
              title: "Where to watch",
              desc: `Every service carrying ${show.name}, region by region.`,
              href: `/show/${show.slug}/where-to-watch`,
              backdrop: keepGoingArts.watch,
            },
          ]}
        />
        <SubscribeForm showId={show.id} label={`Email me when ${show.name} has news:`} />
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

app.get("/show/:slug/season/:n{[0-9]+}", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const show = r.show;
  const n = Number(c.req.param("n"));
  let eps: EpisodeRow[];
  let maxRow: { m: number | null } | null;
  if (r.isTmdb) {
    eps = r.episodes
      .filter((e) => e.season === n)
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    maxRow = { m: r.episodes.reduce((m, e) => Math.max(m, e.season ?? 0), 0) || null };
  } else {
    const [epsRes, mx] = await Promise.all([
      c.env.DB.prepare("SELECT * FROM episodes WHERE show_id = ? AND season = ? ORDER BY number")
        .bind(show.id, n)
        .all<EpisodeRow>(),
      c.env.DB.prepare("SELECT MAX(season) AS m FROM episodes WHERE show_id = ?")
        .bind(show.id)
        .first<{ m: number | null }>(),
    ]);
    eps = epsRes.results;
    maxRow = mx;
  }
  const similar = await similarShows(c.env.DB, show, 6);
  if (eps.length === 0) return c.notFound();
  const region = visitorRegion(c);
  const keepGoingArts = await loadShowKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    show,
    similar[0]?.tmdb_id,
  );
  const sidebar = c.get("siteSidebar");

  const site = origin(c);
  const path = new URL(c.req.url).pathname;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title={`${show.name} Season ${n} — episode list, ratings & air dates | TV Nightly`}
      description={`All ${eps.length} episodes of ${show.name} Season ${n}, with air dates and viewer ratings.`}
      canonical={canonical(c)}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, `Season ${n}`, path)]}
      preloadImage={
        eps[0]?.image_url
          ? epregStillPreload(eps[0].image_url, false)
          : undefined
      }
    >
      <article class="show-hub">
        <header class="detail-hero media-hero">
          <div class="detail-head">
            <div class="detail-side">{HeroPoster(show)}</div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> Season {n}
              </p>
              <h1>
                <a href={`/show/${show.slug}`}>{show.name}</a> — Season {n}
              </h1>
              <p class="summary">
                All {eps.length} episodes in airing order, with first-run dates and viewer ratings.
              </p>
            </div>
          </div>
        </header>
        <SeasonTabs slug={show.slug} season={n} current="overview" latest={n === maxRow?.m} />
        <div class="home-main-grid">
          <div class="home-col">
      {(() => {
        const anyStill = eps.some((e) => e.image_url);
        return (
          <ol class={anyStill ? "epreg" : "epreg epreg--textonly"}>
            {eps.map((e, i) => (
              <li>
                {/* the numeral IS the episode number here, so the chyron
                    skips the code — one encoding per fact */}
                <span class="epreg-num">{String(e.number ?? i + 1).padStart(2, "0")}</span>
                {anyStill ? (
                  <a class="epreg-still-link" href={epHref(show.slug, e)} tabindex={-1} aria-hidden="true">
                    {e.image_url ? (
                      <img
                        class="epreg-still"
                        {...epregStill(e.image_url, false)}
                        width="168"
                        height="95"
                        alt={`${show.name} ${epCode(e)}`}
                        loading={i === 0 ? "eager" : "lazy"}
                        fetchpriority={i === 0 ? "high" : undefined}
                        decoding="async"
                      />
                    ) : (
                      <span class="epreg-still--empty">{epCode(e)}</span>
                    )}
                  </a>
                ) : null}
                <span class="epreg-main">
                  {e.airdate || e.runtime ? (
                    <p class="epreg-meta">
                      {e.airdate ? <span>{longDate(e.airdate)}</span> : null}
                      {e.airdate && e.runtime ? <span class="sep"> · </span> : null}
                      {e.runtime ? <span class="epreg-rt">{fmtRuntime(e.runtime)}</span> : null}
                    </p>
                  ) : null}
                  <p class="epreg-line">
                    <a class="epreg-name" href={epHref(show.slug, e)}>
                      {e.name ?? epCode(e)}
                    </a>
                    <span class="epreg-leader"></span>
                    {e.rating != null ? <span class="rating"><IconStar class="rating-star" />{e.rating.toFixed(1)}</span> : null}
                  </p>
                  {e.summary ? <p class="epreg-sum">{stripHtml(e.summary)}</p> : null}
                </span>
              </li>
            ))}
          </ol>
        );
      })()}
      {similar.length ? (
        <section>
          <h2>Shows like {show.name}</h2>
          <p class="dossier-method">
            The closest matches on shared genres, ranked by match strength and popularity.
          </p>
          <ol class="dossier-board">
            {similar.map((s, i) => (
              <DossierRow
                i={i}
                href={`/show/${s.slug}`}
                name={s.name}
                d={buildDossier(show, s, region)}
                rating={s.rating}
                poster={posterSrc(s)}
              />
            ))}
          </ol>
        </section>
      ) : null}
      <KeepGoing
        cards={[
          {
            icon: "Overview",
            title: `${show.name} overview`,
            desc: "Episodes, ratings, cast and the full series dossier.",
            href: `/show/${show.slug}`,
            backdrop: keepGoingArts.overview,
          },
          {
            icon: "Charts",
            title: "Best episodes",
            desc: `The highest-rated hours of Season ${n}, ranked.`,
            href: `/show/${show.slug}/best-episodes?season=${n}`,
            backdrop: keepGoingArts.bestEpisodes,
          },
          {
            icon: "Charts",
            title: "Ratings graph",
            desc: `Every rated episode of Season ${n} on one chart.`,
            href: `/show/${show.slug}/ratings?season=${n}`,
            backdrop: keepGoingArts.similar,
          },
          {
            icon: "Stream",
            title: "Where to watch",
            desc: `Every service carrying ${show.name}, region by region.`,
            href: `/show/${show.slug}/where-to-watch`,
            backdrop: keepGoingArts.watch,
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
