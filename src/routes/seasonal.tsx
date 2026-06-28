// Seasonal discovery pages — Halloween, Christmas TV, Thanksgiving episodes.
// Built from genres + episode titles we already mirror; rerank every year.
import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { MovieCard, ShowCard } from "../components/cards";
import { SidebarPageGrid } from "../components/home-sidebar";
import { IconStar } from "../components/icons";
import {
    KeepExploring,
    episodeKeepGoingBackdrop,
    fillKeepGoingBackdrops,
    showKeepGoingBackdrop,
} from "../components/keep-going";
import type { ExploreArt } from "../lib/explore-art";
import { genreShowArt } from "../lib/explore-art";
import { epCode, epHref, epregStill, epregStillPreload, heroBg, hiRes, longDate } from "../lib/format";
import { breadcrumbTrail, canonical, faqLd, itemListLd, origin } from "../lib/seo";
import { tmdbBackdrop, tmdbTopRated } from "../lib/tmdb";
import { toMovieRow } from "../lib/tmdb-rows";
import { Bindings, EpisodeRow, HonoEnv, MovieRow, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

const HORROR = `genres LIKE '%"Horror"%'`;
const XMAS_EP = `(e.name LIKE '%Christmas%' OR e.name LIKE '%christmas%' OR e.name LIKE '%Xmas%' OR e.name LIKE '%xmas%')`;
const THANKS_EP = `(e.name LIKE '%Thanksgiving%' OR e.name LIKE '%thanksgiving%')`;

async function horrorArt(c: { env: Bindings }, show: ShowRow | undefined) {
  if (show?.tmdb_id && c.env.TMDB_API_KEY) {
    const bd = await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id);
    if (bd) return bd;
  }
  const p = show ? hiRes(show.image_url) : null;
  return p ? { x1: p, x2: undefined as string | undefined } : null;
}

type ShowArtRow = { tmdb_id: number | null; image_url: string | null; poster_url: string | null };

async function halloweenDoorArt(db: D1Database, apiKey: string | undefined): Promise<ExploreArt> {
  const row = await db
    .prepare(
      `SELECT tmdb_id, image_url, poster_url FROM shows
       WHERE ${HORROR} AND rating IS NOT NULL AND weight >= 50
       ORDER BY rating DESC, weight DESC LIMIT 1`,
    )
    .first<ShowArtRow>();
  if (row) return showKeepGoingBackdrop(apiKey, row);
  return apiKey ? genreShowArt(db, apiKey, "Horror") : null;
}

async function christmasDoorArt(db: D1Database, apiKey: string | undefined): Promise<ExploreArt> {
  const row = await db
    .prepare(
      `SELECT s.tmdb_id, s.image_url, s.poster_url
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE ${XMAS_EP} AND e.rating IS NOT NULL AND s.weight >= 40
       GROUP BY s.id
       ORDER BY MAX(e.rating) DESC, s.weight DESC
       LIMIT 1`,
    )
    .first<ShowArtRow>();
  return row ? showKeepGoingBackdrop(apiKey, row) : null;
}

async function thanksgivingDoorArt(db: D1Database, apiKey: string | undefined): Promise<ExploreArt> {
  const row = await db
    .prepare(
      `SELECT e.image_url, s.tmdb_id, s.image_url AS show_img, s.poster_url
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE ${THANKS_EP} AND e.rating IS NOT NULL AND s.weight >= 40
       ORDER BY e.rating DESC, s.weight DESC
       LIMIT 1`,
    )
    .first<{ image_url: string | null; tmdb_id: number | null; show_img: string | null; poster_url: string | null }>();
  if (!row) return null;
  const showArt = await showKeepGoingBackdrop(apiKey, {
    tmdb_id: row.tmdb_id,
    image_url: row.show_img,
    poster_url: row.poster_url,
  });
  return episodeKeepGoingBackdrop(showArt, row.image_url);
}

async function bestEpisodesDoorArt(db: D1Database, apiKey: string | undefined): Promise<ExploreArt> {
  const row = await db
    .prepare(
      `SELECT e.image_url, s.tmdb_id, s.image_url AS show_img, s.poster_url
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.rating IS NOT NULL AND s.rating IS NOT NULL AND s.weight >= 75
       ORDER BY (e.rating + 2.0 * s.rating) / 3.0 DESC
       LIMIT 1`,
    )
    .first<{ image_url: string | null; tmdb_id: number | null; show_img: string | null; poster_url: string | null }>();
  if (!row) return null;
  const showArt = await showKeepGoingBackdrop(apiKey, {
    tmdb_id: row.tmdb_id,
    image_url: row.show_img,
    poster_url: row.poster_url,
  });
  return episodeKeepGoingBackdrop(showArt, row.image_url);
}

const DOOR_FETCHERS = {
  halloween: halloweenDoorArt,
  christmas: christmasDoorArt,
  thanksgiving: thanksgivingDoorArt,
  "best-episodes": bestEpisodesDoorArt,
} as const;

type SeasonalDoor = keyof typeof DOOR_FETCHERS;

async function loadSeasonalDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  doors: SeasonalDoor[],
): Promise<ExploreArt[]> {
  const cards = await Promise.all(
    doors.map(async (door) => ({
      icon: "",
      title: "",
      desc: "",
      href: "",
      backdrop: await DOOR_FETCHERS[door](db, apiKey),
    })),
  );
  return fillKeepGoingBackdrops(cards).map((c) => c.backdrop ?? null);
}

// ------------------------------------------------------------------ /halloween

app.get("/halloween", async (c) => {
  const year = new Date().getFullYear();
  const [shows, movies] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT * FROM shows WHERE ${HORROR} AND rating IS NOT NULL AND weight >= 50
         ORDER BY rating DESC, weight DESC LIMIT 24`,
      )
      .all<ShowRow>(),
    c.env.TMDB_API_KEY
      ? tmdbTopRated(c.env.TMDB_API_KEY, "movie")
          .then((list) =>
            list
              .filter((m) => m.genreIds?.includes(27))
              .slice(0, 12)
              .map(toMovieRow),
          )
          .catch(() => [] as MovieRow[])
      : Promise.resolve([] as MovieRow[]),
  ]);

  const lead = shows.results[0];
  const art = await horrorArt(c, lead);
  const site = origin(c);
  const [christmasArt, thanksArt, bestEpArt] = await loadSeasonalDoorArts(c.env.DB, c.env.TMDB_API_KEY, [
    "christmas",
    "thanksgiving",
    "best-episodes",
  ]);

  const faqs = [
    {
      q: `What are the best horror TV shows to watch for Halloween ${year}?`,
      a: shows.results.length
        ? `We rank ${shows.results.length} horror series by viewer rating — led by ${shows.results
            .slice(0, 3)
            .map((s) => s.name)
            .join(", ")}.`
        : "Our horror chart fills as ratings sync.",
    },
    {
      q: "Where can I stream these horror shows?",
      a: "Every title links to its page with live streaming availability for your country.",
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Best Horror TV for Halloween ${year} — Scary Shows Ranked | TV Nightly`}
      description={`The best horror TV shows for Halloween ${year} — ranked by viewer rating, with episode guides and where to stream.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[itemListLd(`Horror TV ${year}`, shows.results.map((s) => ({ name: s.name, url: `${site}/show/${s.slug}` }))), breadcrumbTrail([{ name: "TV Nightly", url: site }, { name: "Halloween", url: canonical(c) }]), faqLd(faqs)]}
    >
      <header class={`wo-hero wo-hero-bleed${!(art?.x2) ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Seasonal · Halloween {year}</p>
          <h1>Best horror TV for Halloween</h1>
          <p class="wo-intro">
            The scariest series we track — ranked by real ratings, with episode guides and streaming
            links for your country.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href="/horror">
              Horror hub
            </a>
            <a class="btn-ghost" href="/what-to-watch?genre=Horror">
              Pick something scary
            </a>
          </p>
        </div>
      </header>

      <SidebarPageGrid c={c}>
      {shows.results.length ? (
        <section class="hub-sec">
          <h2>Top horror series</h2>
          <div class="grid">
            {shows.results.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}

      {movies.length ? (
        <section class="hub-sec">
          <h2>Horror films worth pairing with a binge</h2>
          <div class="grid">
            {movies.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}

      <KeepExploring
        cards={[
          {
            icon: "Hidden gems",
            title: "Christmas TV",
            desc: "Holiday episodes and specials.",
            href: "/christmas-tv",
            backdrop: christmasArt,
          },
          {
            icon: "Shortcut",
            title: "Thanksgiving episodes",
            desc: "The best Turkey Day hours.",
            href: "/best-thanksgiving-episodes",
            backdrop: thanksArt,
          },
          {
            icon: "Charts",
            title: "Best episodes ever",
            desc: "All-time top hours of TV.",
            href: "/best-episodes",
            backdrop: bestEpArt,
          },
        ]}
      />
      </SidebarPageGrid>
    </Layout>,
  );
});

// -------------------------------------------------------------- /christmas-tv

app.get("/christmas-tv", async (c) => {
  const year = new Date().getFullYear();
  type XmasShow = ShowRow & { best_ep_rating: number; ep_count: number };

  const { results } = await c.env.DB
    .prepare(
      `SELECT s.*, MAX(e.rating) AS best_ep_rating, COUNT(e.id) AS ep_count
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE ${XMAS_EP} AND e.rating IS NOT NULL AND s.weight >= 40
       GROUP BY s.id
       ORDER BY best_ep_rating DESC, s.weight DESC
       LIMIT 24`,
    )
    .all<XmasShow>();

  const lead = results[0];
  const art = await horrorArt(c, lead);
  const site = origin(c);
  const [halloweenArt, thanksArt, bestEpArt] = await loadSeasonalDoorArts(c.env.DB, c.env.TMDB_API_KEY, [
    "halloween",
    "thanksgiving",
    "best-episodes",
  ]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Best Christmas TV ${year} — Holiday Episodes & Specials | TV Nightly`}
      description={`The best Christmas TV episodes and holiday specials ${year} — series ranked by their highest-rated Christmas hours.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        itemListLd(
          `Christmas TV ${year}`,
          results.map((s) => ({ name: s.name, url: `${site}/show/${s.slug}/best-episodes` })),
        ),
        breadcrumbTrail([{ name: "TV Nightly", url: site }, { name: "Christmas TV", url: canonical(c) }]),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${!(art?.x2) ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Seasonal · Christmas {year}</p>
          <h1>Best Christmas TV</h1>
          <p class="wo-intro">
            Shows with the highest-rated Christmas episodes — holiday specials, Christmas parties, and
            the annual sitcom snow episode.
          </p>
        </div>
      </header>

      <SidebarPageGrid c={c}>
      {results.length ? (
        <section class="hub-sec">
          <h2>Series with great Christmas episodes</h2>
          <p class="muted">Ranked by the rating of each show's best Christmas hour.</p>
          <div class="grid">
            {results.map((s) => (
              <ShowCard show={{ ...s, rating: s.best_ep_rating }} />
            ))}
          </div>
        </section>
      ) : (
        <p class="muted">Holiday episodes are still syncing — check back soon.</p>
      )}

      <KeepExploring
        cards={[
          {
            icon: "Hidden gems",
            title: "Halloween horror",
            desc: "Scary series ranked.",
            href: "/halloween",
            backdrop: halloweenArt,
          },
          {
            icon: "Shortcut",
            title: "Thanksgiving episodes",
            desc: "Turkey Day classics.",
            href: "/best-thanksgiving-episodes",
            backdrop: thanksArt,
          },
          {
            icon: "Charts",
            title: "Best episodes ever",
            desc: "All-time top hours.",
            href: "/best-episodes",
            backdrop: bestEpArt,
          },
        ]}
      />
      </SidebarPageGrid>
    </Layout>,
  );
});

// ------------------------------------------- /best-thanksgiving-episodes

app.get("/best-thanksgiving-episodes", async (c) => {
  const year = new Date().getFullYear();
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.image_url AS show_img
     FROM episodes e JOIN shows s ON s.id = e.show_id
     WHERE ${THANKS_EP} AND e.rating IS NOT NULL AND s.weight >= 40
     ORDER BY e.rating DESC, s.weight DESC
     LIMIT 50`,
  ).all<EpisodeRow & { show_name: string; show_slug: string; show_img: string | null }>();

  const site = origin(c);
  const anyStill = results.some((e) => e.image_url);
  const [christmasArt, halloweenArt, bestEpArt] = await loadSeasonalDoorArts(c.env.DB, c.env.TMDB_API_KEY, [
    "christmas",
    "halloween",
    "best-episodes",
  ]);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Best Thanksgiving TV Episodes ${year} — Ranked | TV Nightly`}
      description={`The best Thanksgiving TV episodes of all time — Friends, The West Wing, Bob's Burgers, and every Turkey Day classic ranked by viewer rating.`}
      canonical={canonical(c)}
      ogImage={results[0]?.image_url ? epregStillPreload(results[0].image_url, true).x2 : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "Best Thanksgiving TV episodes",
          itemListElement: results.slice(0, 25).map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${e.show_name}: ${e.name ?? epCode(e)}`,
            url: `${site}${epHref(e.show_slug, e)}`,
          })),
        },
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Thanksgiving episodes", url: canonical(c) },
        ]),
      ]}
    >
      <SidebarPageGrid c={c}>
      <article class="chart-page">
        <header class="chart-head">
          <p class="section-eyebrow">Seasonal · Thanksgiving {year}</p>
          <h1 class="chart-h1">Best Thanksgiving TV episodes</h1>
          <p class="section-lead">
            Every Turkey Day classic we track — ranked by viewer rating, from sitcom dinner disasters to
            earnest holiday specials.
          </p>
        </header>

        {!results.length ? (
          <p class="muted">Thanksgiving episodes are still syncing — check back soon.</p>
        ) : (
          <ol class={anyStill ? "epreg chart-epreg" : "epreg epreg--textonly chart-epreg"}>
            {results.map((e, i) => (
              <li class={i < 3 ? "epreg-plate" : undefined}>
                <span class="epreg-num">{String(i + 1).padStart(2, "0")}</span>
                {anyStill ? (
                  <a class="epreg-still-link" href={epHref(e.show_slug, e)} tabindex={-1} aria-hidden="true">
                    {e.image_url ? (
                      <img
                        class="epreg-still"
                        {...epregStill(e.image_url, i < 3)}
                        width={i < 3 ? 256 : 168}
                        height={i < 3 ? 144 : 95}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span class="epreg-still epreg-still-empty" aria-hidden="true"></span>
                    )}
                  </a>
                ) : null}
                <span class="epreg-body">
                  <a class="epreg-title" href={epHref(e.show_slug, e)}>
                    {e.name ?? epCode(e)}
                  </a>
                  <span class="epreg-show">
                    <a href={`/show/${e.show_slug}`}>{e.show_name}</a>
                    <span class="muted"> · {epCode(e)}</span>
                    {e.airdate ? <span class="muted"> · {longDate(e.airdate)}</span> : null}
                  </span>
                  {e.rating != null ? (
                    <span class="rating epreg-rating">
                      <IconStar class="rating-star" />
                      {e.rating.toFixed(1)}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        )}
      </article>

      <KeepExploring
        cards={[
          {
            icon: "Hidden gems",
            title: "Christmas TV",
            desc: "Holiday specials ranked.",
            href: "/christmas-tv",
            backdrop: christmasArt,
          },
          {
            icon: "Shortcut",
            title: "Halloween horror",
            desc: "Scary series for October.",
            href: "/halloween",
            backdrop: halloweenArt,
          },
          {
            icon: "Charts",
            title: "Best episodes ever",
            desc: "All-time top hours.",
            href: "/best-episodes",
            backdrop: bestEpArt,
          },
        ]}
      />
      </SidebarPageGrid>
    </Layout>,
  );
});

export default app;
