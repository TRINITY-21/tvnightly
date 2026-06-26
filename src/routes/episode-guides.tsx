// Curated "link magnet" episode rankings — keyword-matched URLs that render
// the same ranked data as /show/:slug/best-episodes with shareable titles.
import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ShowBlurb } from "../components/editorial";
import { ChevDown, ChevUp, IconStar } from "../components/icons";
import { ShowTabs } from "../components/nav";
import { EPISODE_GUIDES, EPISODE_GUIDE_BY_SLUG } from "../lib/episode-guides";
import { epCode, epHref, fmtRuntime, heroBg, largeStill, longDate, posterSrc, stripHtml } from "../lib/format";
import { breadcrumbTrail, canonical, itemListLd, origin } from "../lib/seo";
import { tmdbBackdrop } from "../lib/tmdb";
import { resolveShow } from "../lib/tmdb-show";
import { Bindings, HonoEnv, EpisodeRow } from "../types";

const app = new Hono<HonoEnv>();

const slugTitle = (slug: string) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

app.get("/guides", async (c) => {
  const items = await Promise.all(
    EPISODE_GUIDES.map(async (g) => ({ g, r: await resolveShow(c, g.showSlug) })),
  );
  const arts: ({ x1: string; x2?: string; ambient?: boolean } | null)[] = await Promise.all(
    items.map(async ({ r }) => {
      const show = r?.show;
      if (c.env.TMDB_API_KEY && show?.tmdb_id) {
        const bd = await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id);
        if (bd) return bd;
      }
      const p = show ? posterSrc(show) : null;
      return p ? { x1: p.src, ambient: true } : null;
    }),
  );

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=86400");
  return c.html(
    <Layout c={c}
      title="TV episode ranking guides — every episode ranked | TV Nightly"
      description="Shareable ranked lists: every Game of Thrones, Breaking Bad, The Office episode and more — ranked by real viewer ratings."
      canonical={canonical(c)}
      ld={[
        itemListLd(
          "Episode ranking guides",
          items.map(({ g }) => ({ name: g.h1, url: `${site}/guide/${g.slug}` })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Episode guides", url: canonical(c) },
        ]),
      ]}
    >
      <h1>Episode ranking guides</h1>
      <p class="muted wo-lead">
        Keyword-friendly ranked lists for the shows people search most — every episode, best to worst.
      </p>
      <div class="lane-grid wo-grid">
        {items.map(({ g, r }, i) => (
          <a
            class={`lane-tile lane-tile-lg${arts[i]?.ambient ? " wo-ambient" : ""}`}
            href={`/guide/${g.slug}`}
          >
            {arts[i] ? (
              <span class="lane-frame" style={heroBg(arts[i]!.x1, arts[i]!.x2)} aria-hidden="true"></span>
            ) : null}
            <span class="lane-body">
              <span class="lane-kicker">{r?.show?.name ?? slugTitle(g.showSlug)}</span>
              <strong>Every episode ranked</strong>
              <span class="lane-dek">{g.intro}</span>
            </span>
          </a>
        ))}
      </div>
      <p class="wo-foot">
        <a class="chev-after" href="/best-episodes">All-time top 100 episodes</a>
        {" · "}
        <a class="chev-after" href="/tv-watch-orders">TV watch orders</a>
      </p>
    </Layout>,
  );
});

app.get("/guide/:slug", async (c) => {
  const guide = EPISODE_GUIDE_BY_SLUG.get(c.req.param("slug"));
  if (!guide) return c.notFound();

  const resolved = await resolveShow(c, guide.showSlug);
  if (!resolved) return c.notFound();
  const show = resolved.show;

  let eps: (EpisodeRow & { up: number | null; down: number | null })[];
  if (resolved.isTmdb) {
    eps = resolved.episodes
      .filter((e) => e.rating != null)
      .map((e) => ({ ...e, up: null, down: null }))
      .sort(
        (a, b) =>
          (b.rating ?? 0) - (a.rating ?? 0) ||
          (a.season ?? 0) - (b.season ?? 0) ||
          (a.number ?? 0) - (b.number ?? 0),
      )
      .slice(0, 25);
  } else {
    const res = await c.env.DB.prepare(
      `SELECT e.*, v.up, v.down FROM episodes e
       LEFT JOIN episode_votes v ON v.episode_id = e.id
       WHERE e.show_id = ? AND e.rating IS NOT NULL
       ORDER BY e.rating DESC, e.season, e.number LIMIT 25`,
    )
      .bind(show.id)
      .all<EpisodeRow & { up: number | null; down: number | null }>();
    eps = res.results;
  }

  const anyStill = eps.some((e) => e.image_url);
  const plates = eps.length >= 10 ? 3 : eps.length >= 4 ? 1 : 0;
  const site = origin(c);
  const path = `/guide/${guide.slug}`;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      title={guide.title}
      description={guide.description}
      canonical={`${site}${path}`}
      noindex={eps.length === 0}
      ogImage={show.poster_url ?? show.image_url ?? undefined}
      scripts={["/js/votes.js"]}
      preloadImage={
        eps[0]?.image_url
          ? { x1: eps[0].image_url, x2: largeStill(eps[0].image_url) }
          : undefined
      }
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: guide.h1,
          itemListElement: eps.map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${e.name ?? epCode(e)} (${epCode(e)})`,
            url: `${site}${epHref(show.slug, e)}`,
          })),
        },
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Episode guides", url: `${site}/guides` },
          { name: show.name, url: `${site}${path}` },
        ]),
      ]}
    >
      <article data-show-id={String(show.id)}>
        <h1 class="epreg-h1">{guide.h1}</h1>
        <p class="epreg-method">{guide.intro}</p>
        {show.blurb ? <ShowBlurb text={show.blurb} /> : null}
        <ShowTabs slug={show.slug} current="best" />
        <ol class={anyStill ? "epreg" : "epreg epreg--textonly"}>
          {eps.map((e, i) => (
            <li class={i < plates ? "epreg-plate" : undefined}>
              <span class="epreg-num">{String(i + 1).padStart(2, "0")}</span>
              {anyStill ? (
                <a class="epreg-still-link" href={epHref(show.slug, e)} tabindex={-1} aria-hidden="true">
                  {e.image_url ? (
                    <img
                      class="epreg-still"
                      src={e.image_url}
                      srcset={`${e.image_url} 1x, ${largeStill(e.image_url)} 2x`}
                      width={i < plates ? "256" : "168"}
                      height={i < plates ? "144" : "95"}
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
                <p class="epreg-meta">
                  <span class="epreg-code">{epCode(e)}</span>
                  {e.airdate ? (
                    <>
                      <span class="sep"> · </span>
                      {longDate(e.airdate)}
                    </>
                  ) : null}
                  {e.runtime ? (
                    <>
                      <span class="sep"> · </span>
                      <span class="epreg-rt">{fmtRuntime(e.runtime)}</span>
                    </>
                  ) : null}
                </p>
                <p class="epreg-line">
                  <a class="epreg-name" href={epHref(show.slug, e)}>
                    {e.name ?? epCode(e)}
                  </a>
                  <span class="epreg-leader"></span>
                  <span class="rating">
                    <IconStar class="rating-star" />
                    {e.rating!.toFixed(1)}
                  </span>
                </p>
                {e.summary ? <p class="epreg-sum">{stripHtml(e.summary)}</p> : null}
                {!resolved.isTmdb ? (
                  <div class="epreg-verdict">
                    <span class="vote" data-ep-id={String(e.id)}>
                      <button class="vote-btn" data-dir="up" aria-label="Agree with this ranking">
                        <ChevUp /> <span class="vote-count">{e.up ?? 0}</span>
                      </button>
                      <button class="vote-btn" data-dir="down" aria-label="Disagree with this ranking">
                        <ChevDown /> <span class="vote-count">{e.down ?? 0}</span>
                      </button>
                    </span>
                  </div>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
        <nav class="epreg-links" aria-label={`More ${show.name}`}>
          <a href={`/show/${show.slug}/best-episodes`}>Full ranking on show page</a>
          <a href={`/show/${show.slug}/ratings`}>Ratings graph</a>
          <a href={`/show/${show.slug}`}>{show.name} overview</a>
        </nav>
      </article>
    </Layout>,
  );
});

export default app;
