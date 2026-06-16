// Episode pages: /show/{slug}/s05e01 — everything we know about one hour
// of television. Guest cast comes live from TVmaze (free, keyless) through
// the edge cache so the D1 mirror stays lean.
import { Hono } from "hono";
import { IconStar, ChevUp, ChevDown } from "../components/icons";
import { Bindings, EpisodeRow } from "../types";
import { stripHtml, epCode, epHref, hiRes, retinaSet, posterSrc, longDate, slugifyName, fmtRuntime } from "../lib/format";
import { origin, canonical } from "../lib/seo";
import { getShow } from "../lib/queries";
import { servePng } from "../lib/render";
import { posterDataUri } from "../lib/signal";
import { buildOgCard } from "../lib/social";
import { visitorRegion } from "../lib/providers";
import { Layout } from "../components/Layout";
import { ProviderLine } from "../components/providers";
import { ShareBar } from "../components/share";

const app = new Hono<{ Bindings: Bindings }>();

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
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const m = /^s(\d{1,3})e(\d{1,3})$/i.exec(c.req.param("code"));
  if (!m) return c.notFound();
  const seasonNo = Number(m[1]);
  const epNo = Number(m[2]);

  const { results: episodes } = await c.env.DB.prepare(
    `SELECT e.*, v.up, v.down FROM episodes e
     LEFT JOIN episode_votes v ON v.episode_id = e.id
     WHERE e.show_id = ? ORDER BY e.season, e.number`,
  )
    .bind(show.id)
    .all<EpisodeRow & { up: number | null; down: number | null }>();

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

  const credits = await guestCredits(ep.id);
  const guests = credits.cast.slice(0, 14);
  const crew = keyEpCrew(credits.crew);
  // link anyone we already track: guests by TVmaze id, crew by id or — for
  // people who entered via the TMDB crew backfill — by name
  const known = new Set<number>();
  const crewLink = new Map<number, number>();
  const ids = [...guests, ...crew].map((x) => x.person.id).filter((n) => Number.isInteger(n));
  if (ids.length) {
    const names = crew.map((x) => x.person.name.toLowerCase());
    const { results } = await c.env.DB.prepare(
      `SELECT id, name FROM people WHERE id IN (${ids.join(",")})` +
        (names.length ? ` OR lower(name) IN (${names.map(() => "?").join(",")})` : ""),
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

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name} ${code} — ${ep.name ?? "episode"}: rating, recap & guest stars | TV Nightly`}
      description={`${show.name} ${code}${ep.name ? ` "${ep.name}"` : ""}${ep.rating != null ? ` — rated ★ ${ep.rating.toFixed(1)}` : ""}${ep.airdate ? `, aired ${longDate(ep.airdate)}` : ""}. ${pitch.slice(0, 110)}`}
      canonical={canonical(c)}
      ld={ld}
      ogImage={`${canonical(c)}/og.png`}
      ogImageLarge
      scripts={["/js/votes.js", "/js/share.js"]}
    >
      <article class={`show-hub${(ep.image_url ?? show.image_url) ? " hub-backdrop" : ""}`}>
        {/* Serializd-style hero: the episode's own frame, sharp and full-bleed,
            with a legibility scrim; the show's poster anchors the facts. */}
        <header class="detail-hero frame-hero">
          {(ep.image_url ?? show.image_url) ? (
            <div
              class="hero-backdrop"
              style={`background-image:url('${hiRes(ep.image_url ?? show.image_url)}')`}
            ></div>
          ) : null}
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
                const img = g.person.image?.medium ?? null;
                const inner = (
                  <>
                    {img ? (
                      <img src={img} alt={g.person.name} loading="lazy" />
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
                return known.has(g.person.id) ? (
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
                const img = x.person.image?.medium ?? null;
                const pid = crewLink.get(x.person.id);
                const inner = (
                  <>
                    {img ? (
                      <img src={img} alt={x.person.name} loading="lazy" />
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
        <section>
          <h2>Keep going</h2>
          <div class="footer-picks">
            <a class="footer-card" href={`/show/${show.slug}/season/${seasonNo}`}>
              Season {seasonNo} ranked & reviewed
            </a>
            <a class="footer-card" href={`/show/${show.slug}/best-episodes`}>
              Best of {show.name}
            </a>
            <a class="footer-card" href={`/show/${show.slug}/ratings`}>
              Ratings graph
            </a>
          </div>
        </section>
      </article>
    </Layout>,
  );
});

// 1200×630 branded card for link unfurls — the episode's own still as the hero.
app.get("/show/:slug/:code{[sS][0-9]{1,3}[eE][0-9]{1,3}}/og.png", async (c) => {
  const slug = c.req.param("slug");
  const code = c.req.param("code").toLowerCase();
  return servePng(c, `ep/${slug}/${code}`, async () => {
    const show = await getShow(c.env.DB, slug);
    if (!show) return null;
    const m = /^s(\d{1,3})e(\d{1,3})$/i.exec(code);
    if (!m) return null;
    const ep = await c.env.DB.prepare(
      "SELECT * FROM episodes WHERE show_id = ? AND season = ? AND number = ?",
    )
      .bind(show.id, Number(m[1]), Number(m[2]))
      .first<EpisodeRow>();
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
