// Episode pages: /show/{slug}/s05e01 — everything we know about one hour
// of television. Guest cast comes live from TVmaze (free, keyless) through
// the edge cache so the D1 mirror stays lean.
import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { DossierRow } from "../components/dossier";
import { HomeSidebarRail } from "../components/home-sidebar";
import { ChevDown, ChevUp, IconStar } from "../components/icons";
import { KeepGoing, episodeKeepGoingBackdrop, loadShowKeepGoingArts } from "../components/keep-going";
import { ProviderLine } from "../components/providers";
import { ShareBar } from "../components/share";
import { buildDossier } from "../lib/dossier";
import { epCode, epHref, fmtRuntime, headshot, hiRes, longDate, posterSrc, slugifyName, stripHtml } from "../lib/format";
import { visitorRegion } from "../lib/providers";
import { similarShows } from "../lib/queries";
import { servePng } from "../lib/render";
import { canonical, origin } from "../lib/seo";
import { posterDataUri } from "../lib/signal";
import { buildOgCard } from "../lib/social";
import { TMDB_PERSON_OFFSET, resolveShow } from "../lib/tmdb-show";
import { EpisodeRow, HonoEnv } from "../types";

const app = new Hono<HonoEnv>();

interface GuestCredit {
  person: { id: number; name: string; image: { medium: string } | null };
  character: { name: string } | null;
  voice?: boolean;
}

interface GuestCrewCredit {
  person: { id: number; name: string; image: { medium: string } | null };
  guestCrewType: string | null;
}

/** TVmaze guest cast + episode crew (director, writer…), one edge-cached
 *  call for a week. Fails to empty, never to 500. */
async function guestCredits(
  epId: number,
): Promise<{ cast: GuestCredit[]; crew: GuestCrewCredit[] }> {
  // v2: guestcrew joined the embed — new key so cast-only entries age out
  const key = new Request(`https://edge-cache.tvnightly.com/guestcast/v2/${epId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(key);
    if (!res) {
      const live = await fetch(
        `https://api.tvmaze.com/episodes/${epId}?embed[]=guestcast&embed[]=guestcrew`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return { cast: [], crew: [] };
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(key, res.clone());
    }
    const data = (await res.json()) as {
      _embedded?: { guestcast?: GuestCredit[]; guestcrew?: GuestCrewCredit[] };
    };
    return { cast: data._embedded?.guestcast ?? [], crew: data._embedded?.guestcrew ?? [] };
  } catch {
    return { cast: [], crew: [] };
  }
}

/** Guest cast + crew for a live (TMDB) episode — the TVmaze call above 404s on a
 *  synthetic id, so live shows would lose these sections without this. People key
 *  at the 10M offset so the tiles link to live person pages. Edge-cached a week. */
async function tmdbEpisodeCredits(
  apiKey: string,
  tmdbId: number,
  season: number,
  number: number,
): Promise<{ cast: GuestCredit[]; crew: GuestCrewCredit[] }> {
  const cacheKey = new Request(
    `https://edge-cache.tvnightly.com/tmdbep/v1/${tmdbId}/${season}/${number}`,
  );
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/episode/${number}/credits?api_key=${apiKey}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return { cast: [], crew: [] };
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as { guest_stars?: any[]; crew?: any[] };
    const img = (p: string | null): { medium: string } | null =>
      p ? { medium: `https://image.tmdb.org/t/p/w185${p}` } : null;
    const cast: GuestCredit[] = (data.guest_stars ?? []).slice(0, 20).map((g) => ({
      person: { id: TMDB_PERSON_OFFSET + g.id, name: g.name, image: img(g.profile_path ?? null) },
      character: g.character ? { name: g.character } : null,
      voice: false,
    }));
    const crew: GuestCrewCredit[] = (data.crew ?? []).map((cr) => ({
      person: { id: TMDB_PERSON_OFFSET + cr.id, name: cr.name, image: img(cr.profile_path ?? null) },
      guestCrewType: cr.job ?? null,
    }));
    return { cast, crew };
  } catch {
    return { cast: [], crew: [] };
  }
}

// the episode credits a fan recognizes, director first; unknown types rank last
const EP_CREW_RANK = [
  "Director",
  "Writer",
  "Teleplay",
  "Story",
  "Creator",
  "Executive Producer",
  "Producer",
  "Original Music Composer",
  "Director of Photography",
  "Editor",
];

/** One row per person, jobs merged ("Writer · Story"), director first. */
function keyEpCrew(crew: GuestCrewCredit[], limit = 10) {
  const merged = new Map<
    number,
    { person: GuestCrewCredit["person"]; jobs: string[]; rank: number }
  >();
  for (const cr of crew) {
    const job = cr.guestCrewType?.trim();
    if (!job) continue;
    const idx = EP_CREW_RANK.indexOf(job);
    const rank = idx === -1 ? EP_CREW_RANK.length : idx;
    const cur = merged.get(cr.person.id);
    if (cur) {
      if (!cur.jobs.includes(job)) cur.jobs.push(job);
      cur.rank = Math.min(cur.rank, rank);
    } else {
      merged.set(cr.person.id, { person: cr.person, jobs: [job], rank });
    }
  }
  return [...merged.values()]
    .sort((a, b) => a.rank - b.rank || a.person.name.localeCompare(b.person.name))
    .slice(0, limit)
    .map((x) => ({ person: x.person, jobLine: x.jobs.join(" · ") }));
}

app.get("/show/:slug/:code{[sS][0-9]{1,3}[eE][0-9]{1,3}}", async (c) => {
  const r = await resolveShow(c, c.req.param("slug"));
  if (!r) return c.notFound();
  const show = r.show;
  const m = /^s(\d{1,3})e(\d{1,3})$/i.exec(c.req.param("code"));
  if (!m) return c.notFound();
  const seasonNo = Number(m[1]);
  const epNo = Number(m[2]);

  let episodes: (EpisodeRow & { up: number | null; down: number | null })[] = r.isTmdb
    ? r.episodes.map((e) => ({ ...e, up: null, down: null }))
    : (
        await c.env.DB.prepare(
          `SELECT e.*, v.up, v.down FROM episodes e
           LEFT JOIN episode_votes v ON v.episode_id = e.id
           WHERE e.show_id = ? ORDER BY e.season, e.number`,
        )
          .bind(show.id)
          .all<EpisodeRow & { up: number | null; down: number | null }>()
      ).results;
  // D1 show whose episodes were never synced: resolveShow already backfilled them
  // live from TMDB, so use those (no votes yet) instead of 404ing the episode.
  if (!episodes.length) episodes = r.episodes.map((e) => ({ ...e, up: null, down: null }));

  const idx = episodes.findIndex((e) => e.season === seasonNo && e.number === epNo);
  if (idx === -1) return c.notFound();
  const ep = episodes[idx];

  // one canonical form: lowercase, zero-padded
  const canonicalPath = epHref(show.slug, ep);
  if (new URL(c.req.url).pathname !== canonicalPath) return c.redirect(canonicalPath, 301);

  const prev = idx > 0 ? episodes[idx - 1] : null;
  const next = idx < episodes.length - 1 ? episodes[idx + 1] : null;

  const seasonEps = episodes.filter((e) => e.season === seasonNo);
  const seasonRated = seasonEps.filter((e) => e.rating != null);
  const seasonAvg = seasonRated.length
    ? seasonRated.reduce((s, e) => s + e.rating!, 0) / seasonRated.length
    : null;
  const rankIn = (pool: EpisodeRow[]) =>
    ep.rating != null
      ? pool.filter((e) => e.rating != null && e.rating > ep.rating!).length + 1
      : null;
  const seasonRank = rankIn(seasonEps);
  const allRated = episodes.filter((e) => e.rating != null);
  const seriesRank = rankIn(episodes);
  const vsAvg = ep.rating != null && seasonAvg != null ? ep.rating - seasonAvg : null;

  const credits =
    r.isTmdb && show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbEpisodeCredits(c.env.TMDB_API_KEY, show.tmdb_id, seasonNo, epNo)
      : await guestCredits(ep.id);
  const guests = credits.cast.slice(0, 14);
  const crew = keyEpCrew(credits.crew);
  // link anyone we already track: guests by TVmaze id, crew by id or — for
  // people who entered via the TMDB crew backfill — by name
  const known = new Set<number>();
  const crewLink = new Map<number, number>();
  const ids = [...guests, ...crew].map((x) => x.person.id).filter((n) => Number.isInteger(n));
  if (ids.length) {
    const names = crew.map((x) => x.person.name.toLowerCase());
    // UNION (not OR) so the id branch uses the people PK and the name branch uses
    // idx_people_name_lower — the old `id IN OR lower(name) IN` scanned all ~34k people.
    const { results } = await c.env.DB.prepare(
      `SELECT id, name FROM people WHERE id IN (${ids.join(",")})` +
        (names.length
          ? ` UNION SELECT id, name FROM people WHERE lower(name) IN (${names.map(() => "?").join(",")})`
          : ""),
    )
      .bind(...names)
      .all<{ id: number; name: string }>();
    const byName = new Map(results.map((r) => [r.name.toLowerCase(), r.id]));
    for (const r of results) known.add(r.id);
    for (const x of crew) {
      const pid = known.has(x.person.id)
        ? x.person.id
        : byName.get(x.person.name.toLowerCase());
      if (pid != null) crewLink.set(x.person.id, pid);
    }
  }

  const site = origin(c);
  const code = epCode(ep);
  const pitch = stripHtml(ep.summary);
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "TVEpisode",
      name: ep.name ?? code,
      url: `${site}${canonicalPath}`,
      episodeNumber: epNo,
      partOfSeason: { "@type": "TVSeason", seasonNumber: seasonNo },
      partOfSeries: { "@type": "TVSeries", name: show.name, url: `${site}/show/${show.slug}` },
      ...(ep.image_url ? { image: hiRes(ep.image_url) } : {}),
      ...(ep.airdate ? { datePublished: ep.airdate } : {}),
      ...(pitch ? { description: pitch.slice(0, 300) } : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "TV Nightly", item: site },
        { "@type": "ListItem", position: 2, name: show.name, item: `${site}/show/${show.slug}` },
        { "@type": "ListItem", position: 3, name: `${code} — ${ep.name ?? ""}`, item: `${site}${canonicalPath}` },
      ],
    },
  ];

  // Keep the meta description within the ~160-char SERP limit, trimming the plot
  // pitch on a word boundary rather than letting the whole line overflow.
  const epDesc = (() => {
    const head = `${show.name} ${code}${ep.name ? ` "${ep.name}"` : ""}: recap, cast${ep.rating != null ? `, ★${ep.rating.toFixed(1)} rating` : ""} and where to stream${ep.airdate ? `. Aired ${longDate(ep.airdate)}` : ""}.`;
    const full = pitch ? `${head} ${pitch}` : head;
    if (full.length <= 160) return full;
    const cut = full.slice(0, 157);
    const sp = cut.lastIndexOf(" ");
    return (sp > 120 ? cut.slice(0, sp) : cut).trimEnd() + "…";
  })();

  const similar = await similarShows(c.env.DB, show, 6);
  const region = visitorRegion(c);
  const keepGoingArts = await loadShowKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    show,
    similar[0]?.tmdb_id,
  );
  const seasonArt = episodeKeepGoingBackdrop(keepGoingArts.season, ep.image_url);
  const sidebar = c.get("siteSidebar");

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
      title={`${show.name} ${code}: ${ep.name ?? "episode"} — recap, rating & where to watch`}
      description={epDesc}
      canonical={canonical(c)}
      ld={ld}
      ogImage={`${canonical(c)}/og.png`}
      ogImageLarge
      scripts={["/js/votes.js", "/js/share.js"]}
    >
      <article class="show-hub">
        <div class="home-main-grid">
          <div class="home-col">
        <header class="detail-hero media-hero episode-hero">
          <div class="detail-head">
            <div class="detail-side">
              {(() => {
                const p = posterSrc(show);
                return p ? (
                  <img class="poster" src={p.src} srcset={p.srcset} alt={show.name} />
                ) : (
                  <div class="poster card-fallback">{show.name}</div>
                );
              })()}
              {ep.rating != null ? (
                <span class="vote ep-vote" data-ep-id={String(ep.id)}>
                  <span class="muted">Fair rating?</span>
                  <button class="vote-btn" data-dir="up" aria-label="Agree with this rating">
                    <ChevUp /> <span class="vote-count">{ep.up ?? 0}</span>
                  </button>
                  <button class="vote-btn" data-dir="down" aria-label="Disagree with this rating">
                    <ChevDown /> <span class="vote-count">{ep.down ?? 0}</span>
                  </button>
                </span>
              ) : null}
            </div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep ep-eyebrow-sep">·</span>{" "}
                <span class="ep-eyebrow-se">
                  <a href={`/show/${show.slug}/season/${seasonNo}`}>Season {seasonNo}</a>{" "}
                  <span class="sep">·</span> Episode {epNo}
                </span>
              </p>
              <h1>{ep.name ?? code}</h1>
              <p class="meta-strip">
                <span>{code}</span>
                {ep.rating != null ? (
                  <>
                    <span class="sep">·</span>
                    <span class="rating"><IconStar class="rating-star" />{ep.rating.toFixed(1)}</span>
                  </>
                ) : null}
                {ep.airdate ? (
                  <>
                    <span class="sep">·</span>
                    <span>{longDate(ep.airdate)}</span>
                  </>
                ) : null}
                {ep.runtime || show.network || show.web_channel ? (
                  <span class="ep-meta2">
                    {ep.runtime ? (
                      <>
                        <span class="sep">·</span>
                        <span>{fmtRuntime(ep.runtime)}</span>
                      </>
                    ) : null}
                    {show.network || show.web_channel ? (
                      <>
                        <span class="sep">·</span>
                        <span>{show.network ?? show.web_channel}</span>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </p>
              {pitch ? <div class="summary">{pitch}</div> : null}
              <div class="ep-hero-foot">
                <ProviderLine
                  row={show}
                  region={visitorRegion(c)}
                  title={show.name}
                  fallbackHref={`/show/${show.slug}/release-date`}
                  pickerType="tv"
                  allHref={`/show/${show.slug}/where-to-watch`}
                />
                <ShareBar url={canonical(c)} title={`${show.name} ${code}${ep.name ? ` — ${ep.name}` : ""} on TV Nightly`} />
              </div>
            </div>
          </div>
        </header>
        {ep.rating != null && (seasonRank || seriesRank) ? (
          <section class="stat-band">
            {seasonRank ? (
              <div class="stat">
                <span class="stat-num">#{seasonRank}</span>
                <span class="stat-label">In Season {seasonNo}</span>
                <span class="stat-sub muted">of {seasonRated.length} rated episodes</span>
              </div>
            ) : null}
            {seriesRank ? (
              <div class="stat">
                <span class="stat-num">#{seriesRank}</span>
                <span class="stat-label">All-time</span>
                <span class="stat-sub muted">of {allRated.length} rated episodes</span>
              </div>
            ) : null}
            {vsAvg != null ? (
              <div class="stat">
                <span class="stat-num">
                  {vsAvg >= 0 ? "+" : "−"}
                  {Math.abs(vsAvg).toFixed(1)}
                </span>
                <span class="stat-label">vs season avg</span>
                <span class="stat-sub muted">Season {seasonNo} averages <IconStar class="rating-star" /> {seasonAvg!.toFixed(1)}</span>
              </div>
            ) : null}
            {ep.airdate ? (
              <div class="stat">
                <span class="stat-num">{ep.airdate.slice(0, 4)}</span>
                <span class="stat-label">First aired</span>
                <span class="stat-sub muted">{longDate(ep.airdate)}</span>
              </div>
            ) : null}
          </section>
        ) : null}
        {guests.length ? (
          <section>
            <h2>Guest stars</h2>
            <div class="guest-list">
              {guests.map((g) => {
                const h = g.person.image?.medium ? headshot(g.person.image.medium) : null;
                const inner = (
                  <>
                    {h ? (
                      <img src={h.src} srcset={h.srcset} alt={g.person.name} loading="lazy" decoding="async" />
                    ) : (
                      <span class="guest-fallback" aria-hidden="true">
                        {g.person.name.slice(0, 1)}
                      </span>
                    )}
                    <span class="guest-who">
                      <span class="guest-name">{g.person.name}</span>
                      {g.character?.name ? (
                        <span class="guest-char muted">
                          as {g.character.name}
                          {g.voice ? " (voice)" : ""}
                        </span>
                      ) : null}
                    </span>
                  </>
                );
                return known.has(g.person.id) || g.person.id >= TMDB_PERSON_OFFSET ? (
                  <a class="guest-row" href={`/person/${slugifyName(g.person.name)}-${g.person.id}`}>
                    {inner}
                  </a>
                ) : (
                  <div class="guest-row">{inner}</div>
                );
              })}
            </div>
          </section>
        ) : null}
        {crew.length ? (
          <section>
            <h2>Crew</h2>
            <div class="guest-list">
              {crew.map((x) => {
                const h = x.person.image?.medium ? headshot(x.person.image.medium) : null;
                const pid =
                  crewLink.get(x.person.id) ??
                  (x.person.id >= TMDB_PERSON_OFFSET ? x.person.id : undefined);
                const inner = (
                  <>
                    {h ? (
                      <img src={h.src} srcset={h.srcset} alt={x.person.name} loading="lazy" decoding="async" />
                    ) : (
                      <span class="guest-fallback" aria-hidden="true">
                        {x.person.name.slice(0, 1)}
                      </span>
                    )}
                    <span class="guest-who">
                      <span class="guest-name">{x.person.name}</span>
                      <span class="guest-char muted">{x.jobLine}</span>
                    </span>
                  </>
                );
                return pid != null ? (
                  <a class="guest-row" href={`/person/${slugifyName(x.person.name)}-${pid}`}>
                    {inner}
                  </a>
                ) : (
                  <div class="guest-row">{inner}</div>
                );
              })}
            </div>
          </section>
        ) : null}
        {prev || next ? (
          <nav class="ep-pager" aria-label="Episode navigation">
            {prev ? (
              <a class="ep-pager-card" href={epHref(show.slug, prev)}>
                <span class="pager-label">Previous</span>
                <span class="pager-title">{prev.name ?? epCode(prev)}</span>
                <span class="pager-sub muted">
                  {epCode(prev)}
                  {prev.rating != null ? <> · <IconStar class="rating-star" /> {prev.rating.toFixed(1)}</> : null}
                </span>
              </a>
            ) : (
              <span></span>
            )}
            {next ? (
              <a class="ep-pager-card pager-next" href={epHref(show.slug, next)}>
                <span class="pager-label">Next</span>
                <span class="pager-title">{next.name ?? epCode(next)}</span>
                <span class="pager-sub muted">
                  {epCode(next)}
                  {next.rating != null ? <> · <IconStar class="rating-star" /> {next.rating.toFixed(1)}</> : null}
                </span>
              </a>
            ) : (
              <span></span>
            )}
          </nav>
        ) : null}
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
              icon: "Season",
              title: `Season ${seasonNo} ranked & reviewed`,
              desc: "Every episode in airing order with ratings and dates.",
              href: `/show/${show.slug}/season/${seasonNo}`,
              backdrop: seasonArt,
            },
            {
              icon: "Stream",
              title: `Where to watch ${show.name}`,
              desc: "Every streaming service and region, checked around the clock.",
              href: `/show/${show.slug}/where-to-watch`,
              backdrop: keepGoingArts.watch,
            },
            {
              icon: "Matchup",
              title: `Shows like ${show.name}`,
              desc: "The closest matches, ranked by overlap and rating.",
              href: `/show/${show.slug}/similar`,
              backdrop: keepGoingArts.similar,
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

// 1200×630 branded card for link unfurls — the episode's own still as the hero.
app.get("/show/:slug/:code{[sS][0-9]{1,3}[eE][0-9]{1,3}}/og.png", async (c) => {
  const slug = c.req.param("slug");
  const code = c.req.param("code").toLowerCase();
  return servePng(c, `ep/${slug}/${code}`, async () => {
    const r = await resolveShow(c, slug);
    if (!r) return null;
    const show = r.show;
    const m = /^s(\d{1,3})e(\d{1,3})$/i.exec(code);
    if (!m) return null;
    const ep = r.episodes.find((e) => e.season === Number(m[1]) && e.number === Number(m[2])) ?? null;
    if (!ep) return null;
    const [backdropUri, posterUri] = await Promise.all([
      posterDataUri(hiRes(ep.image_url ?? show.image_url)),
      posterDataUri(posterSrc(show)?.src ?? null),
    ]);
    return buildOgCard({
      kicker: show.name,
      title: ep.name ?? epCode(ep),
      meta: [epCode(ep), ep.airdate ? longDate(ep.airdate) : null].filter(Boolean).join(" · "),
      rating: ep.rating,
      posterUri,
      backdropUri,
    });
  });
});

export default app;
