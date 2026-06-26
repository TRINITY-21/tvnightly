import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { IconStar } from "../components/icons";
import { fmtRuntime, heroBg, posterSrc } from "../lib/format";
import { breadcrumbTrail, canonical, itemListLd, origin } from "../lib/seo";
import { tmdbBackdrop } from "../lib/tmdb";
import { resolveShow } from "../lib/tmdb-show";
import { TV_UNIVERSES, TV_UNIVERSE_BY_SLUG, type TvUniverseEntry } from "../lib/tv-universes";
import { Bindings, HonoEnv, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

const slugTitle = (slug: string) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

app.get("/tv-watch-orders", async (c) => {
  const slugs = [...new Set(TV_UNIVERSES.flatMap((u) => u.entries.map((e) => e.showSlug)))];
  const placeholders = slugs.map(() => "?").join(",");
  const { results: rows } = slugs.length
    ? await c.env.DB.prepare(`SELECT * FROM shows WHERE slug IN (${placeholders})`)
        .bind(...slugs)
        .all<ShowRow>()
    : { results: [] as ShowRow[] };
  const showBySlug = new Map(rows.map((s) => [s.slug, s]));

  const guides = TV_UNIVERSES.map((u) => {
    const matched = u.entries.map((e) => showBySlug.get(e.showSlug));
    const rep = matched.find((s) => s?.poster_url || s?.image_url) ?? matched[0] ?? null;
    return { u, rep, count: u.entries.length };
  });

  const arts: ({ x1: string; x2?: string; ambient?: boolean } | null)[] = await Promise.all(
    guides.map(async (g) => {
      if (c.env.TMDB_API_KEY && g.rep?.tmdb_id) {
        const bd = await tmdbBackdrop(c.env.TMDB_API_KEY, g.rep.tmdb_id);
        if (bd) return bd;
      }
      const p = g.rep ? posterSrc(g.rep) : null;
      return p ? { x1: p.src, ambient: true } : null;
    }),
  );

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=86400");
  return c.html(
    <Layout c={c}
      title="TV watch-order guides — every universe in order | TV Nightly"
      description="How to watch Game of Thrones, Breaking Bad, Star Trek, Marvel TV and more — the right order for every major TV universe."
      canonical={canonical(c)}
      ld={[
        itemListLd(
          "TV watch-order guides",
          guides.map((g) => ({
            name: `${g.u.name} watch order`,
            url: `${site}/tv-watch-order/${g.u.slug}`,
          })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "TV watch orders", url: canonical(c) },
        ]),
      ]}
    >
      <h1>TV watch-order guides</h1>
      <p class="muted wo-lead">
        The right order for every major TV universe — spin-offs, prequels, and crossovers explained.
      </p>
      <div class="lane-grid wo-grid">
        {guides.map((g, i) => (
          <a
            class={`lane-tile lane-tile-lg${arts[i]?.ambient ? " wo-ambient" : ""}`}
            href={`/tv-watch-order/${g.u.slug}`}
          >
            {arts[i] ? (
              <span class="lane-frame" style={heroBg(arts[i]!.x1, arts[i]!.x2)} aria-hidden="true"></span>
            ) : null}
            <span class="lane-body">
              <span class="lane-kicker">
                {g.count} series
                {g.u.aka ? ` · ${g.u.aka}` : ""}
              </span>
              <strong>{g.u.name}</strong>
            </span>
          </a>
        ))}
      </div>
      <p class="wo-foot">
        <a class="chev-after" href="/watch-orders">Movie franchise watch orders</a>
      </p>
    </Layout>,
  );
});

app.get("/tv-watch-order/:slug", async (c) => {
  const u = TV_UNIVERSE_BY_SLUG.get(c.req.param("slug"));
  if (!u) return c.notFound();

  const resolved = await Promise.all(
    u.entries.map(async (e) => ({ e, r: await resolveShow(c, e.showSlug) })),
  );
  const ordered = resolved
    .sort((a, b) => a.e.order - b.e.order)
    .map(({ e, r }) => ({ e, show: r?.show ?? null }));
  const shows = ordered.map((o) => o.show).filter((s): s is ShowRow => s != null);

  const rep = shows[0] ?? null;
  let art: { x1: string; x2?: string; ambient?: boolean } | null = null;
  if (c.env.TMDB_API_KEY && rep?.tmdb_id) {
    art = await tmdbBackdrop(c.env.TMDB_API_KEY, rep.tmdb_id);
  }
  if (!art && rep) {
    const p = posterSrc(rep);
    if (p) art = { x1: p.src, ambient: true };
  }

  const Row = ({ e, show: s, idx }: { e: TvUniverseEntry; show: ShowRow | null; idx: number }) => {
    const href = s ? `/show/${s.slug}` : `/show/${e.showSlug}`;
    const name = s?.name ?? slugTitle(e.showSlug);
    const poster = s ? posterSrc(s) : null;
    return (
      <li class="wo-row">
        <span class="wo-num" aria-hidden="true">
          {String(idx + 1).padStart(2, "0")}
        </span>
        {poster ? (
          <a class="wo-poster-link" href={href} tabindex={-1} aria-hidden="true">
            <img
              class="wo-poster"
              src={poster.src}
              alt=""
              width="46"
              height="69"
              loading="lazy"
              decoding="async"
            />
          </a>
        ) : (
          <span class="wo-poster wo-poster-blank" aria-hidden="true"></span>
        )}
        <span class="wo-main">
          <span class="wo-title">
            <a href={href}>{name}</a>
            {e.note ? <span class="why-tag">{e.note}</span> : null}
          </span>
          <span class="wo-links muted">
            <a href={`${href}/best-episodes`}>Every episode ranked</a>
            {" · "}
            <a href={`${href}/release-date`}>Release date</a>
          </span>
        </span>
        <span class="wo-side">
          {s?.rating != null ? (
            <span class="rating">
              <IconStar class="rating-star" />
              {s.rating.toFixed(1)}
            </span>
          ) : null}
          {s?.runtime ? <span class="wo-mins">{fmtRuntime(s.runtime)}/ep</span> : null}
        </span>
      </li>
    );
  };

  const site = origin(c);
  c.header("Cache-Control", "public, max-age=86400");
  return c.html(
    <Layout c={c}
      title={`${u.name} watch order — how to watch in order | TV Nightly`}
      description={`${u.name} watch order: ${ordered.length} series in the right sequence${u.aka ? ` (${u.aka})` : ""} — with episode rankings and streaming info for each.`}
      canonical={canonical(c)}
      ogImage={rep?.poster_url ?? rep?.image_url ?? undefined}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `${u.name} watch order`,
          itemListElement: ordered.map(({ e, show: s }, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s?.name ?? slugTitle(e.showSlug),
            url: `${site}/show/${s?.slug ?? e.showSlug}`,
          })),
        },
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "TV watch orders", url: `${site}/tv-watch-orders` },
          { name: u.name, url: canonical(c) },
        ]),
      ]}
    >
      <header class={art ? `wo-hero wo-hero-bleed${art.ambient ? " wo-ambient" : ""}` : "wo-hero wo-hero-bare"}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">TV watch-order guide</p>
          <h1>{u.name} watch order</h1>
          {u.aka ? <p class="wo-aka muted">{u.aka}</p> : null}
          <p class="wo-intro">{u.intro}</p>
        </div>
      </header>
      <section class="wo-section">
        <h2>Watch in this order</h2>
        <ol class="wo-list">
          {ordered.map(({ e, show: s }, i) => (
            <Row e={e} show={s} idx={i} />
          ))}
        </ol>
      </section>
      <p class="wo-foot">
        <a class="chev-after" href="/tv-watch-orders">All TV watch-order guides</a>
      </p>
    </Layout>,
  );
});

export default app;
