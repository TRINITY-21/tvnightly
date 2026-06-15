import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { ExploreCard, MovieCard } from "../components/cards";
import { fmtMarathon, fmtRuntime, heroBg, slugifyName } from "../lib/format";
import { FRANCHISES, FRANCHISE_BY_SLUG, FranchiseEntry } from "../lib/franchises";
import { providersFor, PROVIDER_LOGOS, providerBrand } from "../lib/providers";
import { similarMovies } from "../lib/queries";
import { canonical } from "../lib/seo";
import { tmdbMovieBackdrop } from "../lib/tmdb";
import { Bindings, MovieRow } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------- franchise watch orders

/** Fuzzy title+year match against the mirror — franchise data and TMDB
 *  disagree by a year on festival releases often enough to matter. */
const matcher = (rows: MovieRow[]) => {
  const byTitle = new Map<string, MovieRow[]>();
  for (const m of rows) {
    const k = m.title.toLowerCase();
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k)!.push(m);
  }
  return (e: FranchiseEntry): MovieRow | undefined =>
    byTitle.get(e.title.toLowerCase())?.find((m) => m.year != null && Math.abs(m.year - e.year) <= 1);
};

app.get("/watch-orders", async (c) => {
  // one mirror pass covers every guide: art, runtimes, year spans.
  // Chunked — the full franchise roster overruns D1's 100-bind limit.
  const titles = [...new Set(FRANCHISES.flatMap((f) => f.entries.map((e) => e.title)))];
  const chunks: string[][] = [];
  for (let i = 0; i < titles.length; i += 90) chunks.push(titles.slice(i, i + 90));
  const rows = (
    await Promise.all(
      chunks.map((ch) =>
        c.env.DB.prepare(`SELECT * FROM movies WHERE title IN (${ch.map(() => "?").join(",")})`)
          .bind(...ch)
          .all<MovieRow>()
          .then((r) => r.results),
      ),
    )
  ).flat();
  const movieFor = matcher(rows);

  const guides = FRANCHISES.map((f) => {
    const matched = f.entries.map(movieFor);
    const mins = matched.reduce((a, m) => a + (m?.runtime ?? 0), 0);
    const years = f.entries.map((e) => e.year);
    const rated = matched.filter((m): m is MovieRow => m?.rating != null);
    return {
      f,
      mins,
      // a marathon total is only honest if every film matched a runtime —
      // otherwise a sparsely-mirrored saga fakes a short run and wins
      fullyTimed: matched.every((m) => (m?.runtime ?? 0) > 0),
      span: `${Math.min(...years)}–${Math.max(...years)}`,
      rep: matched.find((m) => m?.imdb_id) ?? null,
      // an average over a couple of films would flatter the short sagas
      avg: rated.length >= 3 ? rated.reduce((a, m) => a + m.rating!, 0) / rated.length : null,
    };
  });

  // the concierge cards: honest superlatives computed from the board itself.
  // marathon ranking only considers fully-timed sagas; best dedupes against
  // the two it might otherwise repeat.
  const timed = guides.filter((g) => g.fullyTimed && g.mins > 0);
  const shortest = timed.length ? timed.reduce((a, b) => (b.mins < a.mins ? b : a)) : null;
  const longest = timed.length ? timed.reduce((a, b) => (b.mins > a.mins ? b : a)) : null;
  const rated = guides.filter((g) => g.avg != null && g !== shortest && g !== longest);
  const best = rated.length ? rated.reduce((a, b) => (b.avg! > a.avg! ? b : a)) : null;

  // each guide's door wears its opening film's backdrop (7-day edge cache)
  const arts: ({ x1: string; x2?: string; ambient?: boolean } | null)[] = await Promise.all(
    guides.map(async (g) => {
      if (c.env.TMDB_API_KEY && g.rep) {
        const bd = await tmdbMovieBackdrop(c.env.TMDB_API_KEY, g.rep.imdb_id);
        if (bd) return bd;
      }
      return g.rep?.poster_url ? { x1: g.rep.poster_url, ambient: true } : null;
    }),
  );

  c.header("Cache-Control", "public, max-age=86400");
  return c.html(
    <Layout
      title="Franchise watch-order guides — release & chronological | TV Nightly"
      description="How to watch every big movie franchise in order: Marvel, Star Wars, Harry Potter and more — release and chronological orders with runtimes and streaming info."
      canonical={canonical(c)}
    >
      <h1>Watch-order guides</h1>
      <p class="muted wo-lead">
        Release and chronological order for every major franchise — with runtimes and where to stream.
      </p>
      <div class="lane-grid wo-grid">
        {guides.map((g, i) => (
          <a
            class={`lane-tile lane-tile-lg${arts[i]?.ambient ? " wo-ambient" : ""}`}
            href={`/watch-order/${g.f.slug}`}
          >
            {arts[i] ? (
              <span class="lane-frame" style={heroBg(arts[i]!.x1, arts[i]!.x2)} aria-hidden="true"></span>
            ) : null}
            <span class="lane-body">
              <span class="lane-kicker">
                {g.f.entries.length} films · {g.span}
              </span>
              <strong>{g.f.name}</strong>
              {g.mins ? <span class="lane-dek">Full marathon: {fmtMarathon(g.mins)}</span> : null}
            </span>
          </a>
        ))}
      </div>

      {shortest || longest || best ? (
        <section class="wo-doors">
          <h2>Where to start</h2>
          <div class="explore-grid">
            {shortest ? (
              <ExploreCard
                icon="Quickest"
                title={shortest.f.name}
                desc="The shortest run on the board — one determined weekend clears it end to end."
                href={`/watch-order/${shortest.f.slug}`}
              />
            ) : null}
            {longest && longest !== shortest ? (
              <ExploreCard
                icon="Deepest"
                title={longest.f.name}
                desc="The longest haul we track. Block out the month before you press play."
                href={`/watch-order/${longest.f.slug}`}
              />
            ) : null}
            {best ? (
              <ExploreCard
                icon="Top-rated"
                rating={best.avg!}
                title={best.f.name}
                desc="The highest average rating across its films — the safest bet on the board."
                href={`/watch-order/${best.f.slug}`}
              />
            ) : null}
          </div>
        </section>
      ) : null}
      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Film"
            title="The best films of all time"
            desc="Every movie ranked by rating, with where to stream."
            href="/movies/best"
          />
          <ExploreCard
            icon="The canon"
            title="Classic film, minus the dust"
            desc="The greatest pre-1980 movies, streamable tonight."
            href="/classics"
          />
          <ExploreCard
            icon="Picker"
            title="Can't pick a saga?"
            desc="Filter by genre, runtime, and streaming service — then spin."
            href="/what-to-watch"
          />
        </div>
      </section>
    </Layout>,
  );
});

app.get("/watch-order/:slug", async (c) => {
  const fr = FRANCHISE_BY_SLUG.get(c.req.param("slug"));
  if (!fr) return c.notFound();

  // Join the curated list against the movie mirror for posters/ratings/
  // runtimes/providers. Unmatched entries render as plain rows.
  const titles = fr.entries.map((e) => e.title);
  const placeholders = titles.map(() => "?").join(",");
  const { results: rows } = await c.env.DB.prepare(
    `SELECT * FROM movies WHERE title IN (${placeholders})`,
  )
    .bind(...titles)
    .all<MovieRow>();
  const movieFor = matcher(rows);

  const release = fr.entries;
  const chrono = [...fr.entries].sort((a, b) => a.chrono - b.chrono);
  const matchedRuntimes = release.map((e) => movieFor(e)?.runtime ?? 0);
  const marathonMins = matchedRuntimes.reduce((a, b) => a + b, 0);
  const allMatched = matchedRuntimes.every((r) => r > 0);
  const years = release.map((e) => e.year);
  const span = `${Math.min(...years)}–${Math.max(...years)}`;

  // the saga's opening film frames the page
  const matched = release.map(movieFor);
  const opener = matched.find((m) => m?.imdb_id) ?? null;
  const art =
    c.env.TMDB_API_KEY && opener
      ? await tmdbMovieBackdrop(c.env.TMDB_API_KEY, opener.imdb_id)
      : null;

  // the door out: kin by genre, seeded from the saga's best-rated film,
  // with the franchise's own entries filtered back out
  const seed = matched
    .filter((m): m is MovieRow => Boolean(m))
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
  const genreCounts = new Map<string, number>();
  for (const m of matched) {
    if (!m?.genres) continue;
    const gs: string[] = JSON.parse(m.genres);
    for (const g of gs) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  }
  const primaryGenre = genreCounts.size
    ? [...genreCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    : null;
  const inFranchise = new Set(titles.map((t) => t.toLowerCase()));
  const alike = seed
    ? (await similarMovies(c.env.DB, seed, 18))
        .filter((m) => !inFranchise.has(m.title.toLowerCase()))
        .slice(0, 6)
    : [];

  const Row = ({ e, idx }: { e: FranchiseEntry; idx: number }) => {
    const m = movieFor(e);
    // providers_intl is the patrol-refreshed source; the legacy US-only
    // movies.providers column freezes at seed time
    const provs: string[] = m ? providersFor(m, "US").names : [];
    return (
      <li class="wo-row">
        <span class="wo-num" aria-hidden="true">
          {String(idx + 1).padStart(2, "0")}
        </span>
        {m?.poster_url ? (
          <a class="wo-poster-link" href={`/movie/${m.slug}`} tabindex={-1} aria-hidden="true">
            <img class="wo-poster" src={m.poster_url} alt="" width="46" height="69" loading="lazy" decoding="async" />
          </a>
        ) : (
          <span class="wo-poster wo-poster-blank" aria-hidden="true"></span>
        )}
        <span class="wo-main">
          <span class="wo-title">
            {m ? <a href={`/movie/${m.slug}`}>{e.title}</a> : <strong>{e.title}</strong>}{" "}
            <span class="muted">({e.year})</span>
            {e.note ? <span class="why-tag">{e.note}</span> : null}
          </span>
          {provs.length ? (
            <span class="wo-provs wo-provs-logos">
              {provs.slice(0, 5).map((name) => {
                const logo = PROVIDER_LOGOS[name];
                const href = `/network/${slugifyName(providerBrand(name))}/movies`;
                return (
                  <a class="wo-prov" href={href} title={`Watch on ${name}`} aria-label={`Watch on ${name}`}>
                    {logo ? (
                      <img src={logo} alt={name} width="20" height="20" loading="lazy" decoding="async" />
                    ) : (
                      <span class="wo-prov-text">{name}</span>
                    )}
                  </a>
                );
              })}
            </span>
          ) : null}
        </span>
        <span class="wo-side">
          {m?.rating != null ? <span class="rating">★ {m.rating.toFixed(1)}</span> : null}
          {m?.runtime ? <span class="wo-mins">{fmtRuntime(m.runtime)}</span> : null}
        </span>
      </li>
    );
  };

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`How to watch ${fr.name} in order (release & chronological) | TV Nightly`}
      description={`${fr.name} watch order: all ${fr.entries.length} films in release and chronological order, with runtimes and streaming availability.`}
      canonical={canonical(c)}
      ogImage={opener?.poster_url ?? undefined}
      preloadImage={art?.x2 ? { x1: art.x1, x2: art.x2 } : undefined}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: `How to watch ${fr.name} in order`,
          itemListElement: release.map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${e.title} (${e.year})`,
          })),
        },
      ]}
    >
      <header class={art ? "wo-hero wo-hero-bleed" : "wo-hero wo-hero-bare"}>
        {art ? <div class="wo-frame" style={heroBg(art.x1, art.x2)} aria-hidden="true"></div> : null}
        <div class="wo-hero-body">
          <p class="section-eyebrow">Watch-order guide</p>
          <h1>How to watch {fr.name} in order</h1>
          <p class="wo-intro">{fr.intro}</p>
          <dl class="wo-stats">
            <div>
              <dt>Films</dt>
              <dd>{fr.entries.length}</dd>
            </div>
            {marathonMins > 0 ? (
              <div>
                <dt>Full marathon{allMatched ? "" : "*"}</dt>
                <dd>{fmtMarathon(marathonMins)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Years</dt>
              <dd>{span}</dd>
            </div>
            {primaryGenre ? (
              <div>
                <dt>Genre</dt>
                <dd>
                  <a href={`/genre/${slugifyName(primaryGenre)}/movies`}>{primaryGenre}</a>
                </dd>
              </div>
            ) : null}
          </dl>
          {marathonMins > 0 && !allMatched ? (
            <p class="wo-asterisk muted">*counting the films we have runtimes for</p>
          ) : null}
        </div>
      </header>
      <section class="wo-section">
        <h2>Release order (best first watch)</h2>
        <ol class="wo-list">
          {release.map((e, i) => (
            <Row e={e} idx={i} />
          ))}
        </ol>
      </section>
      <section class="wo-section">
        <h2>Chronological order (story timeline)</h2>
        {fr.chronoNote ? <p class="muted">{fr.chronoNote}</p> : null}
        <ol class="wo-list">
          {chrono.map((e, i) => (
            <Row e={e} idx={i} />
          ))}
        </ol>
      </section>
      {alike.length ? (
        <section class="wo-section">
          <h2>Movies like {fr.name}</h2>
          <div class="grid">
            {alike.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
      <p class="wo-back">
        <a class="chev-after" href="/watch-orders">All watch-order guides</a>
      </p>
    </Layout>,
  );
});

export default app;
