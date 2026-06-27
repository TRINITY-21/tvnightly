// SEO discovery pages: upcoming TV, awards trackers — high-intent queries built
// from data we already mirror (status, show_events, ratings).
import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ExploreCard, ShowCard } from "../components/cards";
import { HomeSidebarRail } from "../components/home-sidebar";
import { KeepExploring, loadTvChartDoorArts, showKeepGoingBackdrop, fillKeepGoingBackdrops } from "../components/keep-going";
import { IconStar } from "../components/icons";
import { emmySeason, goldenGlobeSeason, type AwardsSeason } from "../lib/awards";
import { heroBg, hiRes, posterSrc } from "../lib/format";
import { showsLikeSlate } from "../lib/queries";
import { breadcrumbTrail, canonical, faqLd, itemListLd, origin } from "../lib/seo";
import { tmdbBackdrop } from "../lib/tmdb";
import { AppContext, Bindings, HonoEnv, ShowRow } from "../types";

const app = new Hono<HonoEnv>();

const SCRIPTED = "'Scripted', 'Animation', 'Documentary'";

async function heroForShow(c: { env: { TMDB_API_KEY?: string } }, show: ShowRow | undefined) {
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (show?.tmdb_id && c.env.TMDB_API_KEY) art = await tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id);
  if (!art && show) {
    const p = hiRes(show.image_url);
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }
  return { art, ambient };
}

async function awardsTrackerPage(
  c: AppContext,
  season: AwardsSeason | null,
  opts: { awardLabel: string; path: string; whenFaq: (s: AwardsSeason) => string },
) {
  if (!season) return c.notFound();

  const allSlugs = [...new Set(season.categories.flatMap((cat) => cat.slugs))];
  const placeholders = allSlugs.map(() => "?").join(",");
  const { results: shows } = allSlugs.length
    ? await c.env.DB.prepare(`SELECT * FROM shows WHERE slug IN (${placeholders})`).bind(...allSlugs).all<ShowRow>()
    : { results: [] as ShowRow[] };
  const bySlug = new Map(shows.map((s) => [s.slug, s]));

  const categories = season.categories
    .map((cat) => ({
      ...cat,
      shows: cat.slugs.map((slug) => bySlug.get(slug)).filter((s): s is ShowRow => !!s),
    }))
    .filter((cat) => cat.shows.length > 0);

  const lead = categories[0]?.shows[0];
  // "Shows like the nominees" — same-genre series we rate highly, not themselves
  // nominated. Shared by the Emmy and Golden Globe trackers.
  const likeNominees = await showsLikeSlate(c.env.DB, shows, 8);
  const { art, ambient } = await heroForShow(c, lead);
  const site = origin(c);
  const path = opts.path;

  const faqs = [
    {
      q: `When are the ${opts.awardLabel} ${season.year}?`,
      a: opts.whenFaq(season),
    },
    {
      q: `How are ${opts.awardLabel} contenders chosen on TV Nightly?`,
      a: "Category lists are curated editorially from acclaimed series we track, cross-checked against viewer ratings and renewal status — not a prediction market.",
    },
    {
      q: "Where can I watch the nominated shows?",
      a: "Every show links to its TV Nightly page with live streaming availability for your country.",
    },
  ];

  const sidebar = c.get("siteSidebar");
  const apiKey = c.env.TMDB_API_KEY;
  const doorArts = fillKeepGoingBackdrops([
    { icon: "", title: "", desc: "", href: "", backdrop: lead ? await showKeepGoingBackdrop(apiKey, lead) : null },
    {
      icon: "",
      title: "",
      desc: "",
      href: "",
      backdrop: categories[0]?.shows[1]
        ? await showKeepGoingBackdrop(apiKey, categories[0].shows[1])
        : null,
    },
    {
      icon: "",
      title: "",
      desc: "",
      href: "",
      backdrop: categories[1]?.shows[0]
        ? await showKeepGoingBackdrop(apiKey, categories[1].shows[0])
        : null,
    },
  ]).map((c) => c.backdrop ?? null);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${opts.awardLabel} ${season.year} — Nominees, Frontrunners & Where to Watch | TV Nightly`}
      description={`${season.ceremony}: drama, comedy, and limited-series frontrunners with episode ratings, renewal status, and streaming links.`}
      canonical={`${site}${path}`}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: opts.awardLabel, url: `${site}${path}` },
        ]),
        faqLd(faqs),
        ...categories.map((cat) => ({
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: cat.name,
          itemListElement: cat.shows.map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        })),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">{season.ceremony}</p>
          <h1>
            {opts.awardLabel} {season.year}
          </h1>
          <p class="wo-intro">{season.intro}</p>
          <p class="hub-actions">
            <a class="verdict-btn" href="/best-episodes">
              Best episodes ever
            </a>
            <a class="btn-ghost" href="/upcoming">
              Upcoming TV {season.year}
            </a>
          </p>
        </div>
      </header>

      <div class="home-main-grid">
        <div class="home-col">
      {categories.map((cat) => (
        <section class="hub-sec">
          <h2>{cat.name}</h2>
          {cat.note ? <p class="muted">{cat.note}</p> : null}
          <div class="grid">
            {cat.shows.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ))}

      {likeNominees.length ? (
        <section class="hub-sec">
          <h2>Shows like the nominees</h2>
          <p class="muted">
            Same-genre series we rate highly — if this year's contenders are your taste, start here.
          </p>
          <div class="grid">
            {likeNominees.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}

      <section class="hub-sec guide-faq">
        <h2>Good to know</h2>
        {faqs.map((f) => (
          <div class="guide-faq-item">
            <h3>{f.q}</h3>
            <p class="muted">{f.a}</p>
          </div>
        ))}
      </section>

      <KeepExploring
        cards={[
          {
            icon: "Charts",
            title: "Top TV shows",
            desc: "The highest-rated series we track.",
            href: "/top/tv",
            backdrop: doorArts[0],
          },
          {
            icon: "Premieres",
            title: "Upcoming TV",
            desc: "In-development series and dated premieres.",
            href: "/upcoming",
            backdrop: doorArts[1],
          },
          {
            icon: "Hidden gems",
            title: opts.awardLabel.includes("Emmy") ? `Golden Globes ${season.year}` : `Emmy Awards ${season.year}`,
            desc: "The other major awards tracker on TV Nightly.",
            href: opts.awardLabel.includes("Emmy")
              ? `/awards/golden-globes/${season.year}`
              : `/awards/emmys/${season.year}`,
            backdrop: doorArts[2],
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
    </Layout>,
  );
}

// --------------------------------------------------------------- /upcoming

app.get("/upcoming", async (c) => {
  const year = new Date().getFullYear();
  const db = c.env.DB;

  type Announced = ShowRow & { event_type: string; event_value: string | null; event_season: number | null };

  const [developing, awaiting, announced, premieres] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM shows WHERE status = 'In Development' AND weight >= 35
         ORDER BY weight DESC, rating DESC LIMIT 24`,
      )
      .all<ShowRow>(),
    db
      .prepare(
        `SELECT * FROM shows WHERE status = 'To Be Determined' AND weight >= 55
         ORDER BY weight DESC, rating DESC LIMIT 16`,
      )
      .all<ShowRow>(),
    db
      .prepare(
        `SELECT s.*, e.type AS event_type, e.new_value AS event_value, e.season AS event_season
         FROM show_events e JOIN shows s ON s.id = e.show_id
         WHERE e.type IN ('season_announced', 'premiere_set', 'premiere_moved')
           AND e.detected_at > unixepoch() - 7776000
         ORDER BY e.detected_at DESC LIMIT 20`,
      )
      .all<Announced>(),
    db
      .prepare(
        `SELECT s.* FROM episodes e JOIN shows s ON s.id = e.show_id
         WHERE e.number = 1 AND e.airstamp > datetime('now')
           AND e.airstamp < datetime('now', '+90 days')
           AND s.type IN (${SCRIPTED})
         GROUP BY s.id ORDER BY MIN(e.airstamp) LIMIT 12`,
      )
      .all<ShowRow>(),
  ]);

  const seen = new Set<string>();
  const dedupeAnnounced = announced.results.filter((s) => {
    if (seen.has(s.slug)) return false;
    seen.add(s.slug);
    return true;
  });

  const lead = developing.results[0] ?? awaiting.results[0] ?? premieres.results[0];
  const { art, ambient } = await heroForShow(c, lead);
  const site = origin(c);

  const faqs = [
    {
      q: `What upcoming TV shows are coming in ${year}?`,
      a: developing.results.length
        ? `We track ${developing.results.length} series currently in development, plus ${premieres.results.length} season premieres dated in the next 90 days — including ${developing.results
            .slice(0, 3)
            .map((s) => s.name)
            .join(", ")}.`
        : `We track in-development series and dated premieres as TVmaze and our hourly sync update them.`,
    },
    {
      q: "How do I get notified when a show returns?",
      a: "Open any show page and enter your email — we send renewal and premiere alerts after a one-click confirmation.",
    },
    {
      q: "What's the difference between upcoming and premieres?",
      a: "This page covers in-development series and renewal news; our premieres calendar lists every dated season premiere and movie release in the next 90 days.",
    },
  ];

  const sidebar = c.get("siteSidebar");
  const [decadeArt, episodesArt, emmyArt] = await loadTvChartDoorArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    lead ?? null,
    developing.results[1] ?? awaiting.results[0] ?? null,
  );

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`Upcoming TV Shows ${year} — New Series & Premiere Dates | TV Nightly`}
      description={`Upcoming TV shows in ${year}: series in development, awaiting renewal, and newly announced seasons — plus dated premieres in the next 90 days.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        itemListLd(
          `Upcoming TV shows ${year}`,
          [...developing.results, ...premieres.results].slice(0, 25).map((s) => ({
            name: s.name,
            url: `${site}/show/${s.slug}/release-date`,
          })),
        ),
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: "Upcoming TV", url: canonical(c) },
        ]),
        faqLd(faqs),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Coming soon</p>
          <h1>Upcoming TV shows in {year}</h1>
          <p class="wo-intro">
            New series in development, shows awaiting renewal news, and season premieres with dates on
            the books — updated from our TVmaze mirror every hour.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href="/premieres">
              Dated premieres (90 days)
            </a>
            <a class="btn-ghost" href="/renewals">
              Renewals & cancellations
            </a>
          </p>
        </div>
      </header>

      <div class="home-main-grid">
        <div class="home-col">
      {premieres.results.length ? (
        <section class="hub-sec">
          <h2>Season premieres on the calendar</h2>
          <p class="muted">Dated season starts in the next 90 days — tap through for countdowns and alerts.</p>
          <div class="grid">
            {premieres.results.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
          <p>
            <a class="chev-after" href="/premieres">
              Full premieres calendar
            </a>
          </p>
        </section>
      ) : null}

      {dedupeAnnounced.length ? (
        <section class="hub-sec">
          <h2>Recently announced</h2>
          <p class="muted">Renewals and premiere dates spotted by our sync in the last 90 days.</p>
          <ol class="wo-list wo-ranked wo-ranked-meta">
            {dedupeAnnounced.map((s, i) => {
              const p = posterSrc(s);
              const hook =
                s.event_type === "season_announced"
                  ? `Season ${s.event_season ?? "?"} renewed`
                  : s.event_value
                    ? `Premiere: ${s.event_value}`
                    : "Premiere date set";
              return (
                <li class="wo-row">
                  <span class="wo-num" aria-hidden="true">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {p ? (
                    <img class="wo-poster" src={p.src} srcset={p.srcset} alt="" width="46" height="69" loading="lazy" />
                  ) : (
                    <span class="wo-poster wo-poster-blank" aria-hidden="true"></span>
                  )}
                  <span class="wo-main">
                    <span class="wo-title">
                      <a href={`/show/${s.slug}/release-date`}>{s.name}</a>
                    </span>
                    <span class="wo-synopsis">{hook}</span>
                  </span>
                  <span class="wo-side">
                    {s.rating != null ? (
                      <span class="rating">
                        <IconStar class="rating-star" />
                        {s.rating.toFixed(1)}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {developing.results.length ? (
        <section class="hub-sec">
          <h2>In development</h2>
          <p class="muted">Series officially in development — no premiere date yet.</p>
          <div class="grid">
            {developing.results.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}

      {awaiting.results.length ? (
        <section class="hub-sec">
          <h2>Awaiting renewal news</h2>
          <p class="muted">Finished or paused shows where the next season is still TBD — we track hourly.</p>
          <div class="grid">
            {awaiting.results.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}

      <section class="hub-sec guide-faq">
        <h2>Good to know</h2>
        {faqs.map((f) => (
          <div class="guide-faq-item">
            <h3>{f.q}</h3>
            <p class="muted">{f.a}</p>
          </div>
        ))}
      </section>

      <KeepExploring
        cards={[
          {
            icon: "Charts",
            title: "Best TV of the 2010s",
            desc: "The highest-rated series that premiered during the 2010s.",
            href: "/tv/best/2010s",
            backdrop: decadeArt,
          },
          {
            icon: "Shortcut",
            title: "Best episodes ever",
            desc: "The single greatest hours of television, across every show.",
            href: "/best-episodes",
            backdrop: episodesArt,
          },
          {
            icon: "Premieres",
            title: `Emmy Awards ${year}`,
            desc: "Frontrunners, categories, and where to stream each contender.",
            href: `/awards/emmys/${year}`,
            backdrop: emmyArt,
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
    </Layout>,
  );
});

// --------------------------------------------------------- /awards/emmys/:year

app.get("/awards/emmys/:year", async (c) => {
  const year = Number(c.req.param("year"));
  return awardsTrackerPage(c, emmySeason(year), {
    awardLabel: "Emmy Awards",
    path: `/awards/emmys/${year}`,
    whenFaq: (s) =>
      `The ${s.ceremony} typically air in September ${s.year}. We update this tracker as nominations and wins are announced.`,
  });
});

app.get("/awards/golden-globes/:year", async (c) => {
  const year = Number(c.req.param("year"));
  return awardsTrackerPage(c, goldenGlobeSeason(year), {
    awardLabel: "Golden Globe Awards",
    path: `/awards/golden-globes/${year}`,
    whenFaq: (s) =>
      `The ${s.ceremony} typically air in January ${s.year}. We update this tracker as nominations and wins are announced.`,
  });
});

export default app;
