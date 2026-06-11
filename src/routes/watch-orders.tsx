import { Hono } from "hono";
import { Bindings, MovieRow } from "../types";
import { FRANCHISES, FRANCHISE_BY_SLUG, Franchise, FranchiseEntry } from "../lib/franchises";
import { providersFor } from "../lib/providers";
import { fmtMarathon } from "../lib/format";
import { canonical } from "../lib/seo";
import { Layout } from "../components/Layout";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------------- franchise watch orders

app.get("/watch-orders", (c) => {
  c.header("Cache-Control", "public, max-age=86400");
  return c.html(
    <Layout
      title="Franchise watch-order guides — release & chronological | TV Nightly"
      description="How to watch every big movie franchise in order: Marvel, Star Wars, Harry Potter and more — release and chronological orders with runtimes and streaming info."
      canonical={canonical(c)}
    >
      <h1>Watch-order guides</h1>
      <p class="muted">
        Release order and chronological order for every major franchise — with ratings, runtimes,
        and where to stream.
      </p>
      <ul class="ep-list">
        {FRANCHISES.map((f) => (
          <li>
            <strong>
              <a href={`/watch-order/${f.slug}`}>How to watch {f.name} in order</a>
            </strong>{" "}
            <span class="muted">· {f.entries.length} films</span>
          </li>
        ))}
      </ul>
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
  const byTitle = new Map(rows.map((m) => [`${m.title.toLowerCase()}`, m]));
  const movieFor = (e: FranchiseEntry): MovieRow | undefined => {
    const m = byTitle.get(e.title.toLowerCase());
    return m && m.year != null && Math.abs(m.year - e.year) <= 1 ? m : undefined;
  };

  const release = fr.entries;
  const chrono = [...fr.entries].sort((a, b) => a.chrono - b.chrono);
  const matchedRuntimes = release.map((e) => movieFor(e)?.runtime ?? 0);
  const marathonMins = matchedRuntimes.reduce((a, b) => a + b, 0);
  const allMatched = matchedRuntimes.every((r) => r > 0);

  const Row = ({ e, idx }: { e: FranchiseEntry; idx: number }) => {
    const m = movieFor(e);
    // providers_intl is the patrol-refreshed source; the legacy US-only
    // movies.providers column freezes at seed time
    const provs: string[] = m ? providersFor(m, "US").names : [];
    return (
      <li class="wo-row">
        <span class="wo-num">{idx + 1}</span>
        {m?.poster_url ? <img class="wo-poster" src={m.poster_url} alt={e.title} loading="lazy" /> : null}
        <span>
          {m ? <a href={`/movie/${m.slug}`}>{e.title}</a> : <strong>{e.title}</strong>}{" "}
          <span class="muted">({e.year})</span>
          {m?.rating != null ? <span class="rating"> ★ {m.rating.toFixed(1)}</span> : null}
          {m?.runtime ? <span class="muted"> · {m.runtime} min</span> : null}
          {provs.length ? <span class="muted"> · {provs.slice(0, 3).join(", ")}</span> : null}
          {e.note ? <span class="why-tag">{e.note}</span> : null}
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
      ogImage={movieFor(fr.entries[0])?.poster_url ?? undefined}
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
      <h1>How to watch {fr.name} in order</h1>
      <p>{fr.intro}</p>
      {marathonMins > 0 ? (
        <p class="muted">
          Full marathon: <strong>{fmtMarathon(marathonMins)}</strong>
          {allMatched ? "" : " (counting the films we have runtimes for)"} · {fr.entries.length}{" "}
          films
        </p>
      ) : null}
      <section>
        <h2>Release order (best first watch)</h2>
        <ol class="ep-list wo-list">
          {release.map((e, i) => (
            <Row e={e} idx={i} />
          ))}
        </ol>
      </section>
      <section>
        <h2>Chronological order (story timeline)</h2>
        {fr.chronoNote ? <p class="muted">{fr.chronoNote}</p> : null}
        <ol class="ep-list wo-list">
          {chrono.map((e, i) => (
            <Row e={e} idx={i} />
          ))}
        </ol>
      </section>
      <p>
        <a class="chev-after" href="/watch-orders">All watch-order guides</a>
      </p>
    </Layout>,
  );
});

export default app;
