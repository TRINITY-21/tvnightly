// SEO guide pages — three programmatic templates over the movie catalog:
//   /movies/best/:year[/:genre]   "Best [genre] movies to watch in {year}"
//   /movies/underrated[/:genre]    "Underrated [genre] movies" (hidden gems)
//   /movies/featuring/:slug        "Best movies featuring [actor]"
// Each renders a keyword-matched H1, ranked list, internal genre/person links,
// a visible FAQ mirrored into FAQPage JSON-LD, and ItemList + BreadcrumbList.
import { Hono } from "hono";
import { IconStar } from "../components/icons";
import { Layout } from "../components/Layout";
import { ExploreCard, MovieCard } from "../components/cards";
import { FilterSelect } from "../components/forms";
import { fmtRuntime, heroBg, slugifyName } from "../lib/format";
import { providerBrand, providersFor, visitorRegion } from "../lib/providers";
import { genreDirectory } from "../lib/queries";
import { canonical, faqLd, origin } from "../lib/seo";
import { tmdbMovieBackdrop } from "../lib/tmdb";
import { hubForGenres } from "../lib/verticals";
import { AppContext, Bindings, MovieRow, PersonRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// "Underrated" = trustworthy rating, but far fewer votes than the blockbusters,
// AND out long enough to prove it was overlooked rather than merely new. The
// vote floor keeps the score real; the ceiling sits below where the famous canon
// lives (so masterpieces never get mislabeled "underrated"); the age gate drops
// just-released films, whose vote counts are low by recency, not obscurity.
const UNDERRATED_MIN_RATING = 7.0;
const UNDERRATED_MIN_VOTES = 1000;
const UNDERRATED_MAX_VOTES = 10000;
const UNDERRATED_MIN_AGE = 2; // years since release before a film can read as "overlooked"
// Oldest year a /movies/best/:year page will render — keeps the route from
// minting junk pages for nonsense years while leaving recent archives crawlable.
const YEAR_MIN = 2015;

const aOrAn = (w: string) => (/^[aeiou]/i.test(w) ? "an" : "a");
const fmtVotes = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);
const titleList = (rows: MovieRow[], n: number) => rows.slice(0, n).map((m) => m.title).join(", ");

// the chart opens on its own #1 — the reigning film's real backdrop, with the
// poster as an ambient fallback when TMDB has no landscape art
async function topArt(c: AppContext, top: MovieRow | undefined) {
  let art: { x1: string; x2?: string } | null = null;
  let ambient = false;
  if (top && c.env.TMDB_API_KEY) art = await tmdbMovieBackdrop(c.env.TMDB_API_KEY, top.imdb_id);
  if (!art && top?.poster_url) {
    art = { x1: top.poster_url };
    ambient = true;
  }
  return { art, ambient };
}

// up to three internal links per row: where it streams, then its genres —
// the same cross-link shape the popular-movies chart uses
const rowLinks = (m: MovieRow, region: string) => {
  const provs = [...new Set(providersFor(m, region).names.map(providerBrand))].slice(0, 2);
  const gs: string[] = m.genres ? JSON.parse(m.genres) : [];
  return [
    ...provs.map((p) => ({ href: `/network/${slugifyName(p)}/movies`, label: p })),
    ...gs.slice(0, 2).map((g) => ({ href: `/genre/${slugifyName(g)}/movies`, label: g })),
  ].slice(0, 3);
};

const RankList = ({
  rows,
  region,
  showVotes,
}: {
  rows: (MovieRow & { character?: string | null })[];
  region: string;
  showVotes?: boolean;
}) => (
  <ol class="wo-list wo-ranked wo-ranked-meta">
    {rows.map((m, i) => {
      const links = rowLinks(m, region);
      return (
        <li class="wo-row">
          <span class="wo-num" aria-hidden="true">
            {String(i + 1).padStart(2, "0")}
          </span>
          {m.poster_url ? (
            <img
              class="wo-poster"
              src={m.poster_url}
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
              <a href={`/movie/${m.slug}`}>{m.title}</a>
              {m.year ? <span class="muted"> ({m.year})</span> : null}
            </span>
            <span class="wo-provs">
              {m.character ? (
                <>
                  as {m.character}
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
            {m.rating != null ? <span class="rating"><IconStar class="rating-star" />{m.rating.toFixed(1)}</span> : null}
            {showVotes && m.votes ? (
              <span class="wo-mins">{fmtVotes(m.votes)} votes</span>
            ) : m.runtime ? (
              <span class="wo-mins">{fmtRuntime(m.runtime)}</span>
            ) : null}
          </span>
        </li>
      );
    })}
  </ol>
);

// A visible FAQ whose answer text is mirrored verbatim into FAQPage JSON-LD —
// Google requires the answer to appear in the page body, so one source feeds both.
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

// ----------------------------------------- Best [genre] movies to watch in {year}

async function bestYearPage(c: AppContext, year: number, genreSlug?: string) {
  const now = new Date().getFullYear();
  if (!Number.isInteger(year) || year < YEAR_MIN || year > now + 1) return c.notFound();
  const db = c.env.DB;
  const region = visitorRegion(c);
  const dir = await genreDirectory(db);

  let genre = "";
  if (genreSlug) {
    const match = dir.movie.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect(`/movies/best/${year}`, 301);
    genre = match;
  }
  const lower = genre.toLowerCase();

  // main ranking: recency-weighted so the year page leads with newer acclaimed
  // films, not the same all-time order as /movies/best
  const conds = ["rating IS NOT NULL", "votes >= 1000"];
  const binds: (string | number)[] = [];
  if (genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${genre}"%`);
  }
  const { results: rows } = await db
    .prepare(
      `SELECT * FROM movies WHERE ${conds.join(" AND ")}
       ORDER BY rating + (CASE WHEN year >= ? THEN 0.6 WHEN year >= ? THEN 0.3 ELSE 0 END) DESC,
                votes DESC LIMIT 40`,
    )
    .bind(...binds, year - 2, year - 5)
    .all<MovieRow>();

  // a "new this year" shelf of actual recent releases (lower vote floor: fresh
  // films haven't accrued votes yet)
  const freshBinds: (string | number)[] = [year - 1, year];
  let freshSql =
    "SELECT * FROM movies WHERE rating IS NOT NULL AND votes >= 100 AND year BETWEEN ? AND ?";
  if (genre) {
    freshSql += " AND genres LIKE ?";
    freshBinds.push(`%"${genre}"%`);
  }
  freshSql += " ORDER BY year DESC, rating DESC, votes DESC LIMIT 12";
  const { results: fresh } = await db.prepare(freshSql).bind(...freshBinds).all<MovieRow>();

  const { art, ambient } = await topArt(c, rows[0]);
  const heading = genre
    ? `The best ${lower} movies to watch in ${year}`
    : `The best movies to watch in ${year}`;
  const site = origin(c);
  const hub = genre ? hubForGenres([genre], null) : null;
  const siblings = dir.movie.filter((g) => g !== genre);

  const faqs = [
    {
      q: genre
        ? `What are the best ${lower} movies to watch in ${year}?`
        : `What are the best movies to watch in ${year}?`,
      a: rows.length
        ? `Our top ${genre ? `${lower} ` : ""}picks for ${year} are ${titleList(rows, 3)} — ranked by viewer rating, with where to stream each.`
        : `We're still ranking ${genre ? `${lower} ` : ""}films for ${year}.`,
    },
    {
      q: `How is this ${year} list ranked?`,
      a: `By real viewer rating with a 1,000-vote minimum, weighted slightly toward recent releases so the freshest great ${genre ? `${lower} ` : ""}films rise to the top.`,
    },
    {
      q: `Where can I watch these ${genre ? `${lower} ` : ""}movies?`,
      a: `Every film links to its page with live streaming availability for your country, so you can jump straight to where it's playing.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Best ${genre ? `${genre} ` : ""}Movies to Watch in ${year} | TV Nightly`}
      description={`The best ${genre ? `${lower} ` : ""}movies to watch in ${year}, ranked by viewer rating with where to stream${rows.length ? ` — ${titleList(rows, 3)} and more` : ""}.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      scripts={["/js/dropdown.js"]}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: heading,
          itemListElement: rows.slice(0, 25).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${m.title}${m.year ? ` (${m.year})` : ""}`,
            url: `${site}/movie/${m.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
            { "@type": "ListItem", position: 2, name: "Best movies", item: `${site}/movies/best` },
            { "@type": "ListItem", position: 3, name: heading, item: canonical(c) },
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
            The {genre ? `${lower} ` : ""}films worth your time this year — ranked by real viewer
            rating, newest greats first, with where to stream each in your country.
          </p>
          <p class="hub-actions">
            <a
              class="verdict-btn"
              href={`/what-to-watch?type=movie${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`}
            >
              Pick me {genre ? `${aOrAn(lower)} ${lower}` : "a"} movie
            </a>
            <a class="btn-ghost" href={genre ? `/movies/underrated/${genreSlug}` : "/movies/underrated"}>
              Underrated {genre ? lower : ""} picks
            </a>
            <a class="btn-ghost" href="/premieres?tab=movies">
              What's coming next
            </a>
          </p>
        </div>
      </header>

      {/* data-submit-on-change: dropdown.js submits on pick; the :year handler
          turns ?genre=slug into the clean /movies/best/{year}/{slug} path */}
      <form method="get" action={`/movies/best/${year}`} class="region-line watch-region" data-submit-on-change>
        <FilterSelect
          label="Genre"
          name="genre"
          current={genre ? slugifyName(genre) : ""}
          options={[
            { value: "", text: "All genres" },
            ...dir.movie.map((g) => ({ value: slugifyName(g), text: g })),
          ]}
        />
      </form>

      {fresh.length ? (
        <section class="hub-sec">
          <h2>New for {year}</h2>
          <p class="muted">
            The latest {genre ? `${lower} ` : ""}releases people are actually rating.
          </p>
          <div class="grid">
            {fresh.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}

      <section class="hub-sec">
        <h2>The {year} ranking</h2>
        {rows.length ? (
          <RankList rows={rows} region={region} />
        ) : (
          <p class="muted">No rated {lower} films for that filter yet.</p>
        )}
      </section>

      <section class="hub-sec">
        <h2>Best movies by genre, for {year}</h2>
        <div class="footer-picks">
          {genre ? (
            <a class="footer-card" href={`/movies/best/${year}`}>
              All genres
            </a>
          ) : null}
          {siblings.map((g) => (
            <a class="footer-card" href={`/movies/best/${year}/${slugifyName(g)}`}>
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
            title={genre ? `Underrated ${lower} movies` : "Underrated movies"}
            desc="High ratings, low profile — the great films most people have missed."
            href={genre ? `/movies/underrated/${genreSlug}` : "/movies/underrated"}
          />
          <ExploreCard
            icon="The chart"
            title={genre ? `Best ${lower} movies of all time` : "Best movies of all time"}
            desc="The all-time ranking by viewer rating — a thousand-vote minimum."
            href={genre ? `/movies/best?genre=${encodeURIComponent(genre)}` : "/movies/best"}
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
              icon="Tailored"
              title="Rate one thing, get a pick"
              desc="The recommender finds your next watch from one rating."
              href="/recommend"
            />
          )}
        </div>
      </section>
    </Layout>,
  );
}

app.get("/movies/best/:year/:genre", (c) =>
  bestYearPage(c, Number(c.req.param("year")), c.req.param("genre")),
);
app.get("/movies/best/:year", (c) => {
  // ?genre=action filter (from the dropdown's no-JS path) maps to the clean path
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/movies/best/${c.req.param("year")}/${slugifyName(g)}`, 301);
  return bestYearPage(c, Number(c.req.param("year")));
});

// --------------------------------------------------- Underrated [genre] movies

async function underratedPage(c: AppContext, genreSlug?: string) {
  const db = c.env.DB;
  const region = visitorRegion(c);
  const dir = await genreDirectory(db);

  let genre = "";
  if (genreSlug) {
    const match = dir.movie.find((g) => slugifyName(g) === genreSlug);
    if (!match) return c.redirect("/movies/underrated", 301);
    genre = match;
  }
  const lower = genre.toLowerCase();

  const maxYear = new Date().getFullYear() - UNDERRATED_MIN_AGE;
  const conds = ["rating >= ?", "votes BETWEEN ? AND ?", "year IS NOT NULL", "year <= ?"];
  const binds: (string | number)[] = [
    UNDERRATED_MIN_RATING,
    UNDERRATED_MIN_VOTES,
    UNDERRATED_MAX_VOTES,
    maxYear,
  ];
  if (genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${genre}"%`);
  }
  // best-rated first, and among equals the least-seen first — surfacing the gems
  const { results: rows } = await db
    .prepare(
      `SELECT * FROM movies WHERE ${conds.join(" AND ")} ORDER BY rating DESC, votes ASC LIMIT 40`,
    )
    .bind(...binds)
    .all<MovieRow>();

  const { art, ambient } = await topArt(c, rows[0]);
  const heading = genre ? `Underrated ${lower} movies` : "Underrated movies";
  const site = origin(c);
  const hub = genre ? hubForGenres([genre], null) : null;
  const siblings = dir.movie.filter((g) => g !== genre);

  const faqs = [
    {
      q: "What makes a movie underrated?",
      a: `These are films rated ${UNDERRATED_MIN_RATING.toFixed(1)} or higher by viewers but with far fewer votes than the blockbusters, and out long enough to count as overlooked rather than just new — genuinely good ${genre ? `${lower} ` : ""}movies most people have missed.`,
    },
    {
      q: `Are these ${genre ? `${lower} ` : ""}movies actually worth watching?`,
      a: rows.length
        ? `Every title here clears a ${UNDERRATED_MIN_RATING.toFixed(1)}+ rating on a verified vote count, so the score is real — just under the radar. Top of the list: ${titleList(rows, 3)}.`
        : `Each title clears a ${UNDERRATED_MIN_RATING.toFixed(1)}+ rating on a verified vote count, so the score is real — just under the radar.`,
    },
    {
      q: `Where can I stream these hidden gems?`,
      a: `Every film links to its page with live streaming availability for your country.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Underrated ${genre ? `${genre} ` : ""}Movies — Hidden Gems to Stream | TV Nightly`}
      description={`Underrated ${genre ? `${lower} ` : ""}movies worth discovering — highly rated but overlooked films${rows.length ? ` like ${titleList(rows, 3)}` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      scripts={["/js/dropdown.js"]}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: heading,
          itemListElement: rows.slice(0, 25).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${m.title}${m.year ? ` (${m.year})` : ""}`,
            url: `${site}/movie/${m.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
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
            Great {lower} films that flew under the radar — high ratings, low profile, ranked so the
            best-kept secrets come first.
          </p>
          <p class="hub-actions">
            <a
              class="verdict-btn"
              href={`/what-to-watch?type=movie${genre ? `&genre=${encodeURIComponent(genre)}` : ""}`}
            >
              Surprise me with one
            </a>
            <a class="btn-ghost" href={genre ? `/movies/best/${new Date().getFullYear()}/${genreSlug}` : `/movies/best/${new Date().getFullYear()}`}>
              Best {genre ? lower : ""} of {new Date().getFullYear()}
            </a>
          </p>
        </div>
      </header>

      <form method="get" action="/movies/underrated" class="region-line watch-region" data-submit-on-change>
        <FilterSelect
          label="Genre"
          name="genre"
          current={genre ? slugifyName(genre) : ""}
          options={[
            { value: "", text: "All genres" },
            ...dir.movie.map((g) => ({ value: slugifyName(g), text: g })),
          ]}
        />
      </form>

      {rows.length ? (
        <div class="grid">
          {rows.map((m) => (
            <MovieCard movie={m} />
          ))}
        </div>
      ) : (
        <p class="muted">No underrated {lower} films match yet — try another genre.</p>
      )}

      <section class="hub-sec">
        <h2>Underrated movies by genre</h2>
        <div class="footer-picks">
          {genre ? (
            <a class="footer-card" href="/movies/underrated">
              All genres
            </a>
          ) : null}
          {siblings.map((g) => (
            <a class="footer-card" href={`/movies/underrated/${slugifyName(g)}`}>
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
            title={genre ? `Best ${lower} movies of ${new Date().getFullYear()}` : `Best movies of ${new Date().getFullYear()}`}
            desc="The acclaimed films to watch this year, newest greats first."
            href={genre ? `/movies/best/${new Date().getFullYear()}/${genreSlug}` : `/movies/best/${new Date().getFullYear()}`}
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
              title="Best movies of all time"
              desc="Every movie ranked by rating, with where to stream."
              href="/movies/best"
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

app.get("/movies/underrated/:genre", (c) => underratedPage(c, c.req.param("genre")));
app.get("/movies/underrated", (c) => {
  const g = (c.req.query("genre") ?? "").trim();
  if (g) return c.redirect(`/movies/underrated/${slugifyName(g)}`, 301);
  return underratedPage(c);
});

// ----------------------------------------------- Best movies featuring [actor]

app.get("/movies/featuring/:slug", async (c) => {
  const slug = c.req.param("slug");
  const idMatch = /-(\d+)$/.exec(slug);
  if (!idMatch) return c.notFound();
  const person = await c.env.DB.prepare("SELECT * FROM people WHERE id = ?")
    .bind(Number(idMatch[1]))
    .first<PersonRow>();
  if (!person) return c.notFound();
  // one canonical URL per person — name drift 301s to the real slug
  const canonicalSlug = `${slugifyName(person.name)}-${person.id}`;
  if (slug !== canonicalSlug) return c.redirect(`/movies/featuring/${canonicalSlug}`, 301);

  const { results: films } = await c.env.DB.prepare(
    `SELECT mc.character, m.* FROM movie_credits mc JOIN movies m ON m.imdb_id = mc.movie_id
     WHERE mc.person_id = ?
     ORDER BY m.rating IS NULL, m.rating DESC, m.popularity DESC, m.votes DESC LIMIT 40`,
  )
    .bind(person.id)
    .all<MovieRow & { character: string | null }>();
  // no films on record → the person page is the right destination
  if (!films.length) return c.redirect(`/person/${canonicalSlug}`, 302);

  const region = visitorRegion(c);
  const site = origin(c);
  const best = films.find((m) => m.rating != null) ?? null;
  const rated = films.filter((m) => m.rating != null);
  const avg = rated.length
    ? (rated.reduce((s, m) => s + m.rating!, 0) / rated.length).toFixed(1)
    : null;
  const { art, ambient } = await topArt(c, films[0]);
  const first = person.name.split(" ")[0];

  const faqs = [
    {
      q: `What is ${person.name}'s best movie?`,
      a: best
        ? `${best.title}${best.year ? ` (${best.year})` : ""} is ${person.name}'s highest-rated film here, at ★ ${best.rating!.toFixed(1)}.`
        : `We track ${films.length} ${person.name} ${films.length === 1 ? "film" : "films"}, ranked on this page.`,
    },
    {
      q: `How many movies has ${person.name} been in?`,
      a: `We track ${films.length} ${person.name} ${films.length === 1 ? "film" : "films"}${avg ? `, averaging ★ ${avg}` : ""} — ranked here by viewer rating.`,
    },
    {
      q: `Where can I watch ${first}'s movies?`,
      a: `Each film links to its page with live streaming availability for your country.`,
    },
  ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`Best Movies Featuring ${person.name} — Ranked | TV Nightly`}
      description={`Every ${person.name} movie we track, ranked by viewer rating${best ? ` — from ${best.title} down` : ""}, with where to stream each.`}
      canonical={canonical(c)}
      ogImage={person.image_url ?? undefined}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `Best movies featuring ${person.name}`,
          itemListElement: films.slice(0, 25).map((m, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${m.title}${m.year ? ` (${m.year})` : ""}`,
            url: `${site}/movie/${m.slug}`,
          })),
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Movies", item: `${site}/movies` },
            { "@type": "ListItem", position: 2, name: person.name, item: `${site}/person/${canonicalSlug}` },
            { "@type": "ListItem", position: 3, name: "Best movies", item: canonical(c) },
          ],
        },
        faqLd(faqs),
      ]}
    >
      <header class={`wo-hero wo-hero-bleed${ambient ? " hub-ambient" : ""}`}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Filmography</p>
          <h1>Best movies featuring {person.name}</h1>
          <p class="wo-intro">
            Every {person.name} film we track, ranked by real viewer rating
            {best ? <> — led by <a href={`/movie/${best.slug}`}>{best.title}</a> at <IconStar class="rating-star" /> {best.rating!.toFixed(1)}</> : null}
            . Where to stream each is one tap away.
          </p>
          <p class="hub-actions">
            <a class="verdict-btn" href={`/person/${canonicalSlug}`}>
              {first}'s full profile
            </a>
            <a class="btn-ghost" href="/movies/best">
              Best movies, ranked
            </a>
          </p>
        </div>
      </header>

      <section class="hub-sec">
        <h2>
          {person.name}'s films, ranked <span class="sched-count">{films.length}</span>
        </h2>
        <RankList rows={films} region={region} />
      </section>

      <FaqSection items={faqs} />

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          {best ? (
            <ExploreCard
              icon="Highest rated"
              title={best.title}
              desc={`${first}'s best-reviewed film — rating, runtime and where to watch.`}
              href={`/movie/${best.slug}`}
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
            icon="TV"
            title={`Best TV shows featuring ${first}`}
            desc="The television side — every series ranked by viewer rating."
            href={`/tv/featuring/${canonicalSlug}`}
          />
        </div>
      </section>
    </Layout>,
  );
});

export default app;
