// SEO guide pages for TV — the show counterparts of src/routes/guides.tsx:
//   /tv/best/:year[/:genre]   "Best [genre] TV shows to watch in {year}"
//   /tv/underrated[/:genre]    "Underrated [genre] shows" (cult / overlooked)
//   /tv/featuring/:slug        "Best TV shows featuring [actor]"
// Shows differ from movies: popularity is TVmaze `weight` (not vote count),
// the year comes from `premiered`/`status`, TV credits live in `credits`, and
// backdrops key off `tmdb_id`. Otherwise the SEO shape mirrors the movie guides:
// keyword H1, ranked list, genre/person cross-links, visible FAQ → FAQPage LD,
// plus ItemList + BreadcrumbList.
import { Hono } from "hono";
import { IconStar } from "../components/icons";
import { Layout } from "../components/Layout";
import { ExploreCard, ShowCard } from "../components/cards";
import { FilterSelect } from "../components/forms";
import { heroBg, hiRes, posterSrc, slugifyName } from "../lib/format";
import { providerBrand, providersFor, visitorRegion } from "../lib/providers";
import { genreDirectory } from "../lib/queries";
import { canonical, faqLd, origin } from "../lib/seo";
import { tmdbBackdrop } from "../lib/tmdb";
import { resolvePersonProfile } from "../lib/tmdb-show";
import { hubForGenres } from "../lib/verticals";
import { AppContext, Bindings, ShowRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// recognizable-popularity floor — the same TVmaze weight the genre charts use,
// so guide pages rank the same trustworthy pool
const SHOW_QUALITY_WEIGHT = 60;
// "Underrated" for shows: a strong rating, but parked outside the most-watched
// tier. Weight is saturated near 100 for household names, so the ceiling drops
// them while the floor keeps recognizable (not junk) series.
const SHOW_UNDERRATED_MIN_RATING = 7.8;
const SHOW_UNDERRATED_MIN_WEIGHT = 40;
const SHOW_UNDERRATED_MAX_WEIGHT = 96;
const YEAR_MIN = 2015;

const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const nameList = (rows: ShowRow[], n: number) => rows.slice(0, n).map((s) => s.name).join(", ");
const showYears = (s: ShowRow) =>
  s.premiered
    ? `${s.premiered.slice(0, 4)}${s.ended ? `–${s.ended.slice(0, 4)}` : s.status === "Running" ? "–present" : ""}`
    : null;

// the chart opens on its own #1 — the reigning show's real backdrop, with its
// hi-res still as the ambient fallback when TMDB has no landscape art
async function topArt(c: AppContext, top: ShowRow | undefined) {
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (top?.tmdb_id && c.env.TMDB_API_KEY) art = await tmdbBackdrop(c.env.TMDB_API_KEY, top.tmdb_id);
  if (!art && top) {
    const p = hiRes(top.image_url);
    if (p) {
      art = { x1: p };
      ambient = true;
    }
  }
  return { art, ambient };
}

// up to three internal links per row: where it streams, then its genres
const rowLinks = (s: ShowRow, region: string) => {
  const provs = [...new Set(providersFor(s, region).names.map(providerBrand))].slice(0, 2);
  const gs: string[] = s.genres ? JSON.parse(s.genres) : [];
  return [
    ...provs.map((p) => ({ href: `/network/${slugifyName(p)}`, label: p })),
    ...gs.slice(0, 2).map((g) => ({ href: `/genre/${slugifyName(g)}/shows`, label: g })),
  ].slice(0, 3);
};

const ShowRankList = ({
  rows,
  region,
}: {
  rows: (ShowRow & { character?: string | null })[];
  region: string;
}) => (
  <ol class="wo-list wo-ranked wo-ranked-meta">
    {rows.map((s, i) => {
      const links = rowLinks(s, region);
      const p = posterSrc(s);
      const yr = showYears(s);
      return (
        <li class="wo-row">
          <span class="wo-num" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          {p ? (
            <img
              class="wo-poster"
              src={p.src}
              srcset={p.srcset}
              alt=""
              width="46"
              height="69"
              loading={i < 6 ? "eager" : "lazy"}
              decoding="async"
            />
          ) : (
            <span class="wo-poster wo-poster-blank" aria-hidden="true"></span>
          )}
          <span class="wo-main">
            <span class="wo-title">
              <a href={`/show/${s.slug}`}>{s.name}</a>
              {yr ? <span class="muted"> ({yr})</span> : null}
            </span>
            <span class="wo-provs">
              {s.character ? (
                <>
                  as {s.character}
                  {links.length ? <span class="wo-provs-sep"> · </span> : null}
                </>
              ) : null}
              {links.map((l, j) => (
                <>
                  {j > 0 ? " · " : null}
                  <a href={l.href}>{l.label}</a>
                </>
              ))}
            </span>
          </span>
          <span class="wo-side">
            {s.rating != null ? <span class="rating"><IconStar class="rating-star" />{s.rating.toFixed(1)}</span> : null}
            {s.status === "Running" ? <span class="wo-mins">Airing now</span> : null}
          </span>
        </li>
      );
    })}
  </ol>
);

// Visible FAQ mirrored verbatim into FAQPage JSON-LD (Google requires the answer
// in the page body, so one source feeds both).
const FaqSection = ({ items }: { items: { q: string; a: string }[] }) => (
  <section class="hub-sec guide-faq">
    <h2>Good to know</h2>
    {items.map((f) => (
      <div class="guide-faq-item">
        <h3>{f.q}</h3>
        <p class="muted">{f.a}</p>
      </div>
    ))}
  </section>
);

// ------------------------------------------ Best [genre] TV shows to watch in {year}

async function bestYearPage(c: AppContext, year: number, genreSlug?: string) {
  const now = new Date().getFullYear();
  if (!Number.isInteger(year) || year < YEAR_MIN || year > now + 1) return c.notFound();
  const db = c.env.DB;
  const region = visitorRegion(c);
  const dir = await genreDirectory(db);

  let genre = "";
  if (genreSlug) {
    const match = dir.tv.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect(`/tv/best/${year}`, 301);
    genre = match;
  }
  const lower = genre.toLowerCase();

  // main ranking: recency-weighted (premiered is YYYY-MM-DD, so a string compare
  // against "2024" works) so the year page leads with newer acclaimed shows
  const conds = ["rating IS NOT NULL", "weight >= ?"];
  const binds: (string | number)[] = [SHOW_QUALITY_WEIGHT];
  if (genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${genre}"%`);
  }
  const { results: rows } = await db
    .prepare(
      `SELECT * FROM shows WHERE ${conds.join(" AND ")}
       ORDER BY rating + (CASE WHEN premiered >= ? THEN 0.6 WHEN premiered >= ? THEN 0.3 ELSE 0 END) DESC,
                weight DESC LIMIT 40`,
    )
    .bind(...binds, `${year - 2}`, `${year - 5}`)
    .all<ShowRow>();

  // "on the air now" shelf — currently-running acclaimed series, the truest
  // answer to "what should I watch this year"
  const freshConds = ["status = 'Running'", "rating IS NOT NULL", "weight >= ?"];
  const freshBinds: (string | number)[] = [SHOW_QUALITY_WEIGHT];
  if (genre) {
    freshConds.push("genres LIKE ?");
    freshBinds.push(`%"${genre}"%`);
  }
  const { results: fresh } = await db
    .prepare(
      `SELECT * FROM shows WHERE ${freshConds.join(" AND ")} ORDER BY rating DESC, weight DESC LIMIT 12`,
    )
    .bind(...freshBinds)
    .all<ShowRow>();

  const { art, ambient } = await topArt(c, rows[0]);
  const heading = genre
    ? `The best ${lower} TV shows to watch in ${year}`
    : `The best TV shows to watch in ${year}`;
  const site = origin(c);
  const hub = genre ? hubForGenres([genre], null) : null;
  const siblings = dir.tv.filter((g) => g !== genre);

  const faqs = [
    {
      q: genre
        ? `What are the best ${lower} TV shows to watch in ${year}?`
        : `What are the best TV shows to watch in ${year}?`,
      a: rows.length
        ? `Our top ${genre ? `${lower} ` : ""}picks for ${year} are ${nameList(rows, 3)} — ranked by viewer rating, with where to stream each.`
        : `We're still ranking ${genre ? `${lower} ` : ""}series for ${year}.`,
    },
    {
      q: `How is this ${year} list ranked?`,
      a: `By real viewer rating, weighted toward series that are airing now or premiered recently, so the freshest great ${genre ? `${lower} ` : ""}shows rise to the top.`,
    },
    {
      q: `Where can I watch these ${genre ? `${lower} ` : ""}shows?`,
      a: `Every series links to its page with live streaming availability for your country, so you can jump straight to where it's playing.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Best ${genre ? `${genre} ` : ""}TV Shows to Watch in ${year} | TV Nightly`}
      description={`The best ${genre ? `${lower} ` : ""}TV shows to watch in ${year}, ranked by viewer rating with where to stream${rows.length ? ` — ${nameList(rows, 3)} and more` : ""}.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      scripts={["/js/dropdown.js"]}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: heading,
          itemListElement: rows.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "TV shows", item: `${site}/top/tv` },
            { "@type": "ListItem", position: 2, name: heading, item: canonical(c) },
          ],
        },
        faqLd(faqs),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">{year} watch guide</p>
          <h1>{heading}</h1>
          <p class="wo-intro">
            The {genre ? `${lower} ` : ""}series worth your time this year — ranked by real viewer
            rating, what's airing now first, with where to stream each in your country.
          </p>
          <p class="hub-actions">
            <a
              class="verdict-btn"
              href={`/what-to-watch${genre ? `?genre=${encodeURIComponent(genre)}` : ""}`}
            >
              Pick me {genre ? `${aOrAn(lower)} ${lower}` : "a"} show
            </a>
            <a class="btn-ghost" href={genre ? `/tv/underrated/${genreSlug}` : "/tv/underrated"}>
              Underrated {genre ? lower : ""} picks
            </a>
            <a class="btn-ghost" href="/premieres">
              Upcoming premieres
            </a>
          </p>
        </div>
      </header>

      {/* data-submit-on-change: dropdown.js submits on pick; the :year handler
          turns ?genre=slug into the clean /tv/best/{year}/{slug} path */}
      <form method="get" action={`/tv/best/${year}`} class="region-line watch-region" data-submit-on-change>
        <FilterSelect
          label="Genre"
          name="genre"
          current={genre ? slugifyName(genre) : ""}
          options={[
            { value: "", text: "All genres" },
            ...dir.tv.map((g) => ({ value: slugifyName(g), text: g })),
          ]}
        />
      </form>

      {fresh.length ? (
        <section class="hub-sec">
          <h2>On the air now</h2>
          <p class="muted">
            Currently-airing {genre ? `${lower} ` : ""}series you can start this year.
          </p>
          <div class="grid">
            {fresh.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}

      <section class="hub-sec">
        <h2>The {year} ranking</h2>
        {rows.length ? (
          <ShowRankList rows={rows} region={region} />
        ) : (
          <p class="muted">No rated {lower} shows for that filter yet.</p>
        )}
      </section>

      <section class="hub-sec">
        <h2>Best TV shows by genre, for {year}</h2>
        <div class="footer-picks">
          {genre ? (
            <a class="footer-card" href={`/tv/best/${year}`}>
              All genres
            </a>
          ) : null}
          {siblings.map((g) => (
            <a class="footer-card" href={`/tv/best/${year}/${slugifyName(g)}`}>
              {g}
            </a>
          ))}
        </div>
      </section>

      <FaqSection items={faqs} />

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Hidden gems"
            title={genre ? `Underrated ${lower} shows` : "Underrated TV shows"}
            desc="High ratings, low profile — the great series most people have missed."
            href={genre ? `/tv/underrated/${genreSlug}` : "/tv/underrated"}
          />
          <ExploreCard
            icon="The chart"
            title={genre ? `Top ${lower} shows, ranked` : "Top TV shows of all time"}
            desc="The all-time ranking by viewer rating, with where to stream."
            href={genre ? `/genre/${genreSlug}/shows` : "/top/tv"}
          />
          {hub ? (
            <ExploreCard
              icon="Fandom hub"
              title={`The ${hub.name} hub`}
              desc="News, premieres, and the best of the genre on one page."
              href={`/${hub.slug}`}
            />
          ) : (
            <ExploreCard
              icon="Tonight"
              title="What's actually on"
              desc="Tonight's schedule, in air-time order."
              href="/tonight"
            />
          )}
        </div>
      </section>
    </Layout>,
  );
}

app.get("/tv/best/:year/:genre", (c) =>
  bestYearPage(c, Number(c.req.param("year")), c.req.param("genre")),
);
app.get("/tv/best/:year", (c) => {
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/tv/best/${c.req.param("year")}/${slugifyName(g)}`, 301);
  return bestYearPage(c, Number(c.req.param("year")));
});

// --------------------------------------------------- Underrated [genre] shows

async function underratedPage(c: AppContext, genreSlug?: string) {
  const db = c.env.DB;
  const region = visitorRegion(c);
  const dir = await genreDirectory(db);

  let genre = "";
  if (genreSlug) {
    const match = dir.tv.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect("/tv/underrated", 301);
    genre = match;
  }
  const lower = genre.toLowerCase();

  const conds = ["rating >= ?", "weight BETWEEN ? AND ?"];
  const binds: (string | number)[] = [
    SHOW_UNDERRATED_MIN_RATING,
    SHOW_UNDERRATED_MIN_WEIGHT,
    SHOW_UNDERRATED_MAX_WEIGHT,
  ];
  if (genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${genre}"%`);
  }
  // best-rated first, and among equals the least-watched first — surfacing gems
  const { results: rows } = await db
    .prepare(
      `SELECT * FROM shows WHERE ${conds.join(" AND ")} ORDER BY rating DESC, weight ASC LIMIT 40`,
    )
    .bind(...binds)
    .all<ShowRow>();

  const { art, ambient } = await topArt(c, rows[0]);
  const heading = genre ? `Underrated ${lower} shows` : "Underrated TV shows";
  const site = origin(c);
  const hub = genre ? hubForGenres([genre], null) : null;
  const siblings = dir.tv.filter((g) => g !== genre);

  const faqs = [
    {
      q: "What makes a TV show underrated?",
      a: `These are series rated ${SHOW_UNDERRATED_MIN_RATING.toFixed(1)} or higher by viewers but parked well outside the most-watched tier — genuinely good ${genre ? `${lower} ` : ""}shows that never got the audience they deserved.`,
    },
    {
      q: `Are these ${genre ? `${lower} ` : ""}shows actually worth watching?`,
      a: rows.length
        ? `Every title here clears a ${SHOW_UNDERRATED_MIN_RATING.toFixed(1)}+ rating, so the score is real — just under the radar. Top of the list: ${nameList(rows, 3)}.`
        : `Each title clears a ${SHOW_UNDERRATED_MIN_RATING.toFixed(1)}+ rating, so the score is real — just under the radar.`,
    },
    {
      q: `Where can I stream these hidden gems?`,
      a: `Every series links to its page with live streaming availability for your country.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Underrated ${genre ? `${genre} ` : ""}Shows — Hidden Gems to Stream | TV Nightly`}
      description={`Underrated ${genre ? `${lower} ` : ""}TV shows worth discovering — highly rated but overlooked series${rows.length ? ` like ${nameList(rows, 3)}` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      scripts={["/js/dropdown.js"]}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: heading,
          itemListElement: rows.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "TV shows", item: `${site}/top/tv` },
            { "@type": "ListItem", position: 2, name: heading, item: canonical(c) },
          ],
        },
        faqLd(faqs),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Hidden gems</p>
          <h1>{heading}</h1>
          <p class="wo-intro">
            Great {lower} series that flew under the radar — high ratings, smaller audience, ranked
            so the best-kept secrets come first.
          </p>
          <p class="hub-actions">
            <a
              class="verdict-btn"
              href={`/what-to-watch${genre ? `?genre=${encodeURIComponent(genre)}` : ""}`}
            >
              Surprise me with one
            </a>
            <a class="btn-ghost" href={genre ? `/tv/best/${new Date().getFullYear()}/${genreSlug}` : `/tv/best/${new Date().getFullYear()}`}>
              Best {genre ? lower : ""} of {new Date().getFullYear()}
            </a>
          </p>
        </div>
      </header>

      <form method="get" action="/tv/underrated" class="region-line watch-region" data-submit-on-change>
        <FilterSelect
          label="Genre"
          name="genre"
          current={genre ? slugifyName(genre) : ""}
          options={[
            { value: "", text: "All genres" },
            ...dir.tv.map((g) => ({ value: slugifyName(g), text: g })),
          ]}
        />
      </form>

      {rows.length ? (
        <div class="grid">
          {rows.map((s) => (
            <ShowCard show={s} />
          ))}
        </div>
      ) : (
        <p class="muted">No underrated {lower} shows match yet — try another genre.</p>
      )}

      <section class="hub-sec">
        <h2>Underrated shows by genre</h2>
        <div class="footer-picks">
          {genre ? (
            <a class="footer-card" href="/tv/underrated">
              All genres
            </a>
          ) : null}
          {siblings.map((g) => (
            <a class="footer-card" href={`/tv/underrated/${slugifyName(g)}`}>
              {g}
            </a>
          ))}
        </div>
      </section>

      <FaqSection items={faqs} />

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Watch guide"
            title={genre ? `Best ${lower} shows of ${new Date().getFullYear()}` : `Best shows of ${new Date().getFullYear()}`}
            desc="The acclaimed series to watch this year, what's airing now first."
            href={genre ? `/tv/best/${new Date().getFullYear()}/${genreSlug}` : `/tv/best/${new Date().getFullYear()}`}
          />
          {hub ? (
            <ExploreCard
              icon="Fandom hub"
              title={`The ${hub.name} hub`}
              desc="News, premieres, and the best of the genre on one page."
              href={`/${hub.slug}`}
            />
          ) : (
            <ExploreCard
              icon="The chart"
              title="Top TV shows of all time"
              desc="Every series ranked by rating, with where to stream."
              href="/top/tv"
            />
          )}
          <ExploreCard
            icon="Community"
            title="Loved by this community"
            desc="The chart built from real one-tap reader verdicts."
            href="/loved"
          />
        </div>
      </section>
    </Layout>,
  );
}

app.get("/tv/underrated/:genre", (c) => underratedPage(c, c.req.param("genre")));
app.get("/tv/underrated", (c) => {
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/tv/underrated/${slugifyName(g)}`, 301);
  return underratedPage(c);
});

// --------------------------------------------- Best TV shows featuring [actor]

app.get("/tv/featuring/:slug", async (c) => {
  const slug = c.req.param("slug");
  const idMatch = /-(\d+)$/.exec(slug);
  if (!idMatch) return c.notFound();
  // Same enriched roles as the person page (D1 + the rest from TMDB) — the
  // credits table alone misses most of a live-led actor's shows and bounced
  // this page straight back to /person.
  const profile = await resolvePersonProfile(c, Number(idMatch[1]));
  if (!profile) return c.notFound();
  const { person, roles: shows } = profile;
  // one canonical URL per person — name drift 301s to the real slug
  const canonicalSlug = `${slugifyName(person.name)}-${person.id}`;
  if (slug !== canonicalSlug) return c.redirect(`/tv/featuring/${canonicalSlug}`, 301);
  // no TV roles on record → the person page is the right destination
  if (!shows.length) return c.redirect(`/person/${canonicalSlug}`, 302);

  const region = visitorRegion(c);
  const site = origin(c);
  const best = shows.find((s) => s.rating != null) ?? null;
  const rated = shows.filter((s) => s.rating != null);
  const avg = rated.length
    ? (rated.reduce((sum, s) => sum + s.rating!, 0) / rated.length).toFixed(1)
    : null;
  const { art, ambient } = await topArt(c, shows[0]);
  const first = person.name.split(" ")[0];

  const faqs = [
    {
      q: `What is ${person.name}'s best TV show?`,
      a: best
        ? `${best.name}${showYears(best) ? ` (${showYears(best)})` : ""} is ${person.name}'s highest-rated series here, at ★ ${best.rating!.toFixed(1)}.`
        : `We track ${shows.length} ${person.name} ${shows.length === 1 ? "show" : "shows"}, ranked on this page.`,
    },
    {
      q: `How many TV shows has ${person.name} been in?`,
      a: `We track ${shows.length} ${person.name} ${shows.length === 1 ? "show" : "shows"}${avg ? `, averaging ★ ${avg}` : ""} — ranked here by viewer rating.`,
    },
    {
      q: `Where can I watch ${first}'s shows?`,
      a: `Each series links to its page with live streaming availability for your country.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Best TV Shows Featuring ${person.name} — Ranked | TV Nightly`}
      description={`Every ${person.name} TV show we track, ranked by viewer rating${best ? ` — from ${best.name} down` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      ogImage={person.image_url ?? undefined}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `Best TV shows featuring ${person.name}`,
          itemListElement: shows.slice(0, 25).map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: `${site}/show/${s.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "TV shows", item: `${site}/top/tv` },
            { "@type": "ListItem", position: 2, name: person.name, item: `${site}/person/${canonicalSlug}` },
            { "@type": "ListItem", position: 3, name: "Best TV shows", item: canonical(c) },
          ],
        },
        faqLd(faqs),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">TV roles</p>
          <h1>Best TV shows featuring {person.name}</h1>
          <p class="wo-intro">
            Every {person.name} series we track, ranked by real viewer rating
            {best ? <> — led by <a href={`/show/${best.slug}`}>{best.name}</a> at <IconStar class="rating-star" /> {best.rating!.toFixed(1)}</> : null}
            . Where to stream each is one tap away.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href={`/person/${canonicalSlug}`}>
              {first}'s full profile
            </a>
            <a class="btn-ghost" href="/top/tv">
              Top TV shows, ranked
            </a>
          </p>
        </div>
      </header>

      <section class="hub-sec">
        <h2>
          {person.name}'s shows, ranked <span class="sched-count">{shows.length}</span>
        </h2>
        <ShowRankList rows={shows} region={region} />
      </section>

      <FaqSection items={faqs} />

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          {best ? (
            <ExploreCard
              icon="Highest rated"
              title={best.name}
              desc={`${first}'s best-reviewed series — rating and where to watch.`}
              href={`/show/${best.slug}`}
              rating={best.rating ?? undefined}
            />
          ) : null}
          <ExploreCard
            icon="Profile"
            title={`${person.name}: shows, age & roles`}
            desc="The full profile — every TV role and film credit on one page."
            href={`/person/${canonicalSlug}`}
          />
          <ExploreCard
            icon="Movies"
            title={`Best movies featuring ${first}`}
            desc="The film side — every credit ranked by viewer rating."
            href={`/movies/featuring/${canonicalSlug}`}
          />
        </div>
      </section>
    </Layout>,
  );
});

export default app;
