import { Hono } from "hono";
import { Bindings, ShowRow, MovieRow } from "../types";
import { Layout } from "../components/Layout";
import { ShowCard, MovieCard } from "../components/cards";

const app = new Hono<{ Bindings: Bindings }>();

// --------------------------------------------------------------- search

app.get("/api/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length < 2) return c.json([]);
  // Leading-wildcard LIKE can't use an index; skip the movies scan for very
  // short queries to keep per-keystroke rows-read inside the D1 free budget.
  const includeMovies = q.length >= 3;
  const [shows, movies] = await Promise.all([
    c.env.DB.prepare(
      "SELECT name, slug, premiered FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 6",
    )
      .bind(q)
      .all<{ name: string; slug: string; premiered: string | null }>(),
    includeMovies
      ? c.env.DB.prepare(
          "SELECT title, slug, year FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 4",
        )
          .bind(q)
          .all<{ title: string; slug: string; year: number | null }>()
      : Promise.resolve({ results: [] as { title: string; slug: string; year: number | null }[] }),
  ]);
  c.header("Cache-Control", "public, max-age=300");
  return c.json(
    [
      ...shows.results.map((r) => ({
        name: r.name,
        slug: r.slug,
        year: r.premiered?.slice(0, 4) ?? null,
        kind: "tv",
      })),
      ...movies.results.map((r) => ({
        name: r.title,
        slug: r.slug,
        year: r.year ? String(r.year) : null,
        kind: "movie",
      })),
    ].slice(0, 8),
  );
});

app.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const [{ results }, { results: movieResults }] = q
    ? await Promise.all([
        c.env.DB.prepare(
          `SELECT * FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 20`,
        )
          .bind(q)
          .all<ShowRow>(),
        c.env.DB.prepare(
          `SELECT * FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 12`,
        )
          .bind(q)
          .all<MovieRow>(),
      ])
    : [{ results: [] as ShowRow[] }, { results: [] as MovieRow[] }];

  c.header("Cache-Control", "public, max-age=300");
  // infinite ?q= variants must not enter the index (doorway/thin-content risk)
  return c.html(
    <Layout title={`Search: ${q} | TV Nightly`} noindex>
      <h1>Search{q ? `: ${q}` : ""}</h1>
      {q && results.length === 0 && movieResults.length === 0 ? (
        <p class="muted">Nothing found.</p>
      ) : null}
      {results.length ? (
        <section>
          <h2>TV shows</h2>
          <div class="grid">
            {results.map((s) => (
              <ShowCard show={s} />
            ))}
          </div>
        </section>
      ) : null}
      {movieResults.length ? (
        <section>
          <h2>Movies</h2>
          <div class="grid">
            {movieResults.map((m) => (
              <MovieCard movie={m} />
            ))}
          </div>
        </section>
      ) : null}
    </Layout>,
  );
});

export default app;
