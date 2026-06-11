// Episode pages: /show/{slug}/s05e01 — everything we know about one hour
// of television. Guest cast comes live from TVmaze (free, keyless) through
// the edge cache so the D1 mirror stays lean.
import { Hono } from "hono";
import { Bindings, EpisodeRow } from "../types";
import { stripHtml, epCode, epHref, longDate, slugifyName } from "../lib/format";
import { origin, canonical } from "../lib/seo";
import { getShow } from "../lib/queries";
import { Layout } from "../components/Layout";
import { SeasonTabs } from "../components/nav";
import { ChevUp, ChevDown } from "../components/icons";

const app = new Hono<{ Bindings: Bindings }>();

interface GuestCredit {
  person: { id: number; name: string; image: { medium: string } | null };
  character: { name: string } | null;
  voice?: boolean;
}

/** TVmaze guest cast, edge-cached for a week. Fails to null, never to 500. */
async function guestCast(epId: number): Promise<GuestCredit[] | null> {
  const key = new Request(`https://edge-cache.tvnightly.com/guestcast/${epId}`);
  const cache = caches.default;
  try {
    let res = await cache.match(key);
    if (!res) {
      const live = await fetch(`https://api.tvmaze.com/episodes/${epId}?embed=guestcast`, {
        headers: { accept: "application/json" },
      });
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(key, res.clone());
    }
    const data = (await res.json()) as { _embedded?: { guestcast?: GuestCredit[] } };
    return data._embedded?.guestcast ?? null;
  } catch {
    return null;
  }
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

  const guests = (await guestCast(ep.id))?.slice(0, 14) ?? [];
  // link guests we already track; everyone else renders unlinked
  const known = new Set<number>();
  if (guests.length) {
    const ids = guests.map((g) => g.person.id).filter((n) => Number.isInteger(n));
    if (ids.length) {
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM people WHERE id IN (${ids.join(",")})`,
      ).all<{ id: number }>();
      for (const r of results) known.add(r.id);
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
      ...(ep.image_url ? { image: ep.image_url } : {}),
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
      ogImage={ep.image_url ?? show.image_url ?? undefined}
      scripts={["/js/votes.js"]}
    >
      <article class="show-hub">
        <header class="detail-hero">
          {(ep.image_url ?? show.image_url) ? (
            <div
              class="hero-backdrop"
              style={`background-image:url('${ep.image_url ?? show.image_url}')`}
            ></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side ep-side">
              {ep.image_url ? (
                <img class="ep-still-hero" src={ep.image_url} alt={ep.name ?? code} />
              ) : (
                <div class="ep-still-hero still-empty">{code}</div>
              )}
            </div>
            <div class="detail-info">
              <p class="ep-eyebrow">
                <a href={`/show/${show.slug}`}>{show.name}</a>
                <span class="sep">·</span> Season {seasonNo} <span class="sep">·</span> Episode{" "}
                {epNo}
              </p>
              <h1>{ep.name ?? code}</h1>
              <p class="meta-strip">
                <span>{code}</span>
                {ep.rating != null ? (
                  <>
                    <span class="sep">·</span>
                    <span class="rating">★ {ep.rating.toFixed(1)}</span>
                  </>
                ) : null}
                {ep.airdate ? (
                  <>
                    <span class="sep">·</span>
                    <span>{longDate(ep.airdate)}</span>
                  </>
                ) : null}
                {ep.runtime ? (
                  <>
                    <span class="sep">·</span>
                    <span>{ep.runtime} min</span>
                  </>
                ) : null}
                {show.network || show.web_channel ? (
                  <>
                    <span class="sep">·</span>
                    <span>{show.network ?? show.web_channel}</span>
                  </>
                ) : null}
              </p>
              {pitch ? <div class="summary">{pitch}</div> : null}
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
          </div>
        </header>
        <SeasonTabs slug={show.slug} season={seasonNo} latest={seasonNo === Math.max(...episodes.map((e) => e.season ?? 0))} />
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
                <span class="stat-sub muted">Season {seasonNo} averages ★ {seasonAvg!.toFixed(1)}</span>
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
        {prev || next ? (
          <nav class="ep-pager" aria-label="Episode navigation">
            {prev ? (
              <a class="ep-pager-card" href={epHref(show.slug, prev)}>
                <span class="pager-label">Previous</span>
                <span class="pager-title">{prev.name ?? epCode(prev)}</span>
                <span class="pager-sub muted">
                  {epCode(prev)}
                  {prev.rating != null ? ` · ★ ${prev.rating.toFixed(1)}` : ""}
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
                  {next.rating != null ? ` · ★ ${next.rating.toFixed(1)}` : ""}
                </span>
              </a>
            ) : (
              <span></span>
            )}
          </nav>
        ) : null}
        <section>
          <h2>Keep going</h2>
          <p>
            <a class="chev-after" href={`/show/${show.slug}/season/${seasonNo}`}>
              Season {seasonNo} ranked & reviewed
            </a>{" "}
            <a class="chev-after" href={`/show/${show.slug}/best-episodes`}>
              Best of {show.name}
            </a>{" "}
            <a class="chev-after" href={`/show/${show.slug}/ratings`}>
              Ratings graph
            </a>
          </p>
        </section>
      </article>
    </Layout>,
  );
});

export default app;
