import { Hono } from "hono";
import { Bindings, ShowRow, MovieRow } from "../types";
import { origin, canonical } from "../lib/seo";
import { similarShows, similarMovies, PICKER_MIN_WEIGHT } from "../lib/queries";
import { VERDICTS, RatedEntry, getRatedTitle, parseRated, fmtRated, titleKey } from "../lib/ratings";
import { ipHash } from "../lib/crypto";
import { Layout } from "../components/Layout";
import { ShowCard, MovieCard } from "../components/cards";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/recommend", async (c) => {
  const db = c.env.DB;
  const q = (c.req.query("q") ?? "").trim();
  const kind = c.req.query("kind") ?? "";
  const ref = (c.req.query("ref") ?? "").trim();
  const v = c.req.query("v") ?? "";

  // Step 3: verdict saved (arrived via POST redirect) -> show the picks.
  if (kind && ref && VERDICTS[v]) {
    const title = await getRatedTitle(db, kind, ref);
    if (!title) return c.notFound();
    const rated = parseRated(c.req.query("rated"));
    if (!rated.some((e) => e.kind === kind && e.ref === ref)) {
      rated.push({ kind: kind as RatedEntry["kind"], ref, verdict: v as RatedEntry["verdict"] });
    }
    const positives = rated.filter((e) => e.verdict !== "meh");

    const counts = await db
      .prepare("SELECT loved, liked, meh FROM title_ratings WHERE kind = ? AND ref = ?")
      .bind(kind, ref)
      .first<{ loved: number; liked: number; meh: number }>();
    const total = (counts?.loved ?? 0) + (counts?.liked ?? 0) + (counts?.meh ?? 0);
    const positive = (counts?.loved ?? 0) + (counts?.liked ?? 0);
    const stat =
      total >= 2
        ? v === "meh"
          ? `${Math.round(((counts?.meh ?? 0) / total) * 100)}% of raters shrugged at it too.`
          : `${Math.round((positive / total) * 100)}% of raters loved or liked it too.`
        : "You're one of its first raters — thanks!";

    // Never recommend what this visitor already rated: the URL trail plus
    // everything their hashed IP rated before.
    const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
    const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
    const { results: priorRatings } = await db
      .prepare("SELECT kind, ref FROM rate_log WHERE ip_hash = ? LIMIT 200")
      .bind(hash)
      .all<{ kind: string; ref: string }>();
    const exclude = new Set<string>([
      ...rated.map((e) => titleKey(e.kind, e.ref)),
      ...priorRatings.map((r) => titleKey(r.kind, r.ref)),
    ]);

    // Collaborative filtering: what other raters who loved these also loved.
    let cfShows: ShowRow[] = [];
    let cfMovies: MovieRow[] = [];
    if (positives.length) {
      const pairCond = positives.map(() => "(r1.kind = ? AND r1.ref = ?)").join(" OR ");
      const { results: cfRows } = await db
        .prepare(
          `SELECT r2.kind AS kind, r2.ref AS ref, COUNT(DISTINCT r2.ip_hash) AS n
           FROM rate_log r1
           JOIN rate_log r2 ON r2.ip_hash = r1.ip_hash
           WHERE r1.verdict IN ('love','like') AND (${pairCond})
             AND r2.verdict IN ('love','like') AND r2.ip_hash != ?
             AND NOT (r2.kind = r1.kind AND r2.ref = r1.ref)
           GROUP BY r2.kind, r2.ref
           ORDER BY n DESC LIMIT 20`,
        )
        .bind(...positives.flatMap((e) => [e.kind, e.ref]), hash)
        .all<{ kind: string; ref: string; n: number }>();
      const strong = cfRows.filter((r) => r.n >= 2 && !exclude.has(titleKey(r.kind, r.ref)));
      const showIds = strong.filter((r) => r.kind === "tv").map((r) => Number(r.ref)).slice(0, 6);
      const movieIds = strong.filter((r) => r.kind === "movie").map((r) => r.ref).slice(0, 6);
      if (showIds.length) {
        const ph = showIds.map(() => "?").join(",");
        cfShows = (
          await db.prepare(`SELECT * FROM shows WHERE id IN (${ph})`).bind(...showIds).all<ShowRow>()
        ).results;
      }
      if (movieIds.length) {
        const ph = movieIds.map(() => "?").join(",");
        cfMovies = (
          await db.prepare(`SELECT * FROM movies WHERE imdb_id IN (${ph})`).bind(...movieIds).all<MovieRow>()
        ).results;
      }
    }
    const cfKeys = new Set([
      ...cfShows.map((s) => titleKey("tv", String(s.id))),
      ...cfMovies.map((m) => titleKey("movie", m.imdb_id)),
    ]);

    // Genre triangulation across everything loved/liked this session.
    let recShows: ShowRow[] = [];
    let recMovies: MovieRow[] = [];
    if (positives.length) {
      const showCount = new Map<number, { row: ShowRow; n: number }>();
      const movieCount = new Map<string, { row: MovieRow; n: number }>();
      for (const e of positives) {
        const t = e.kind === kind && e.ref === ref ? title : await getRatedTitle(db, e.kind, e.ref);
        if (!t) continue;
        if (t.show) {
          for (const s of await similarShows(db, t.show)) {
            const cur = showCount.get(s.id) ?? { row: s, n: 0 };
            cur.n++;
            showCount.set(s.id, cur);
          }
        }
        if (t.movie) {
          for (const m of await similarMovies(db, t.movie)) {
            const cur = movieCount.get(m.imdb_id) ?? { row: m, n: 0 };
            cur.n++;
            movieCount.set(m.imdb_id, cur);
          }
        }
      }
      recShows = [...showCount.values()]
        .filter((x) => !exclude.has(titleKey("tv", String(x.row.id))) && !cfKeys.has(titleKey("tv", String(x.row.id))))
        .sort((a, b) => b.n - a.n || b.row.weight - a.row.weight)
        .slice(0, 6)
        .map((x) => x.row);
      recMovies = [...movieCount.values()]
        .filter((x) => !exclude.has(titleKey("movie", x.row.imdb_id)) && !cfKeys.has(titleKey("movie", x.row.imdb_id)))
        .sort((a, b) => b.n - a.n || (b.row.rating ?? 0) - (a.row.rating ?? 0))
        .slice(0, 6)
        .map((x) => x.row);
    } else {
      // Everything so far was 'meh' — change direction: avoid ALL its genres.
      const genreJson = title.show?.genres ?? title.movie?.genres ?? null;
      const gs: string[] = (genreJson ? JSON.parse(genreJson) : []).slice(0, 3);
      const notLike = gs.map(() => "AND (genres IS NULL OR genres NOT LIKE ?)").join(" ");
      if (kind === "tv") {
        recShows = (
          await db
            .prepare(
              `SELECT * FROM shows WHERE id != ? AND weight >= ? AND rating >= 7.5 ${notLike}
               ORDER BY weight DESC LIMIT 6`,
            )
            .bind(title.show!.id, PICKER_MIN_WEIGHT, ...gs.map((g) => `%"${g}"%`))
            .all<ShowRow>()
        ).results.filter((s) => !exclude.has(titleKey("tv", String(s.id))));
      } else {
        recMovies = (
          await db
            .prepare(
              `SELECT * FROM movies WHERE imdb_id != ? AND rating >= 7.5 ${notLike}
               ORDER BY popularity DESC LIMIT 6`,
            )
            .bind(title.movie!.imdb_id, ...gs.map((g) => `%"${g}"%`))
            .all<MovieRow>()
        ).results.filter((m) => !exclude.has(titleKey("movie", m.imdb_id)));
      }
    }

    const ratedParam = encodeURIComponent(fmtRated(rated));
    const heading =
      positives.length > 1
        ? `Triangulating from your ${rated.length} ratings`
        : v === "meh"
          ? "Let's go a different direction"
          : `Because you ${v === "love" ? "loved" : "liked"} ${title.name}`;
    const recNames = [
      ...cfShows.map((s) => s.name),
      ...cfMovies.map((m) => m.title),
      ...recShows.map((s) => s.name),
      ...recMovies.map((m) => m.title),
    ];

    c.header("Cache-Control", "no-store");
    return c.html(
      <Layout
        title={`Your next watch, based on ${title.name} | TV Nightly`}
        description={
          recNames.length
            ? `Rated ${title.name}? TV Nightly says: ${recNames.slice(0, 3).join(", ")}…`
            : `Rate what you watched, get your next pick.`
        }
        canonical={`${origin(c)}/recommend`}
        ogImage={title.image ?? undefined}
      >
        <h1>{heading}</h1>
        <p class="muted">Verdict saved — {stat}</p>
        {cfShows.length || cfMovies.length ? (
          <section>
            <h2>Raters with your taste also loved</h2>
            <div class="grid">
              {cfShows.map((s) => (
                <ShowCard show={s} />
              ))}
              {cfMovies.map((m) => (
                <MovieCard movie={m} />
              ))}
            </div>
          </section>
        ) : null}
        {recShows.length || recMovies.length ? (
          <section>
            <h2>{positives.length > 1 ? "Matched to all your picks" : "More in this vein"}</h2>
            <div class="grid">
              {recShows.map((s) => (
                <ShowCard show={s} />
              ))}
              {recMovies.map((m) => (
                <MovieCard movie={m} />
              ))}
            </div>
          </section>
        ) : null}
        {!cfShows.length && !cfMovies.length && !recShows.length && !recMovies.length ? (
          <p class="muted">
            We need a bit more data for this one — try the <a href="/what-to-watch">picker</a>.
          </p>
        ) : null}
        <p>
          <a class="verdict-btn" href={`/recommend?rated=${ratedParam}`}>
            Rate one more — picks get sharper
          </a>
        </p>
        <div class="sub-form inline">
          <form method="post" action="/subscribe" class="sub-form">
            <input type="hidden" name="kind" value="daily" />
            <label>Want a fresh pick in your inbox? Join the daily email:</label>
            <input type="email" name="email" placeholder="you@example.com" required />
            <button type="submit">Sign me up</button>
          </form>
        </div>
      </Layout>,
    );
  }

  // Step 2: title chosen -> ask the verdict.
  if (kind && ref) {
    const title = await getRatedTitle(db, kind, ref);
    if (!title) return c.notFound();
    const ratedStr = fmtRated(parseRated(c.req.query("rated")));
    const Verdict = ({ value, label }: { value: string; label: string }) => (
      <form method="post" action="/recommend" class="verdict-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="ref" value={ref} />
        {ratedStr ? <input type="hidden" name="rated" value={ratedStr} /> : null}
        <input type="hidden" name="verdict" value={value} />
        <button type="submit" class="verdict-btn">
          {label}
        </button>
      </form>
    );
    c.header("Cache-Control", "public, max-age=3600");
    return c.html(
      <Layout title={`How was ${title.name}? | TV Nightly`} canonical={`${origin(c)}/recommend`}>
        <div class="pick-card">
          {title.image ? (
            <img class="poster" src={title.image} alt={title.name} />
          ) : (
            <div class="poster card-fallback">{title.name}</div>
          )}
          <div>
            <h1>How was {title.name}?</h1>
            <div class="verdicts">
              <Verdict value="love" label="😍 Loved it" />
              <Verdict value="like" label="🙂 Liked it" />
              <Verdict value="meh" label="😴 Meh" />
            </div>
            <p class="muted">One tap. We save the verdict (nothing else) and pick your next watch.</p>
          </div>
        </div>
      </Layout>,
    );
  }

  // Step 1b: searching for the title.
  const ratedQS = (() => {
    const s = fmtRated(parseRated(c.req.query("rated")));
    return s ? `&rated=${encodeURIComponent(s)}` : "";
  })();
  if (q) {
    const [shows, movies] = await Promise.all([
      db
        .prepare("SELECT id, name, premiered FROM shows WHERE name LIKE '%' || ? || '%' ORDER BY weight DESC LIMIT 5")
        .bind(q)
        .all<{ id: number; name: string; premiered: string | null }>(),
      db
        .prepare("SELECT imdb_id, title, year FROM movies WHERE title LIKE '%' || ? || '%' ORDER BY popularity DESC LIMIT 5")
        .bind(q)
        .all<{ imdb_id: string; title: string; year: number | null }>(),
    ]);
    c.header("Cache-Control", "public, max-age=300");
    return c.html(
      <Layout title={`Which one did you watch? | TV Nightly`} canonical={`${origin(c)}/recommend`}>
        <h1>Which one did you watch?</h1>
        {shows.results.length === 0 && movies.results.length === 0 ? (
          <p class="muted">
            Nothing matched "{q}" — <a href="/recommend">try another search</a>.
          </p>
        ) : null}
        <ul class="ep-list">
          {shows.results.map((s) => (
            <li>
              <a href={`/recommend?kind=tv&ref=${s.id}${ratedQS}`}>
                {s.name}
                {s.premiered ? ` (${s.premiered.slice(0, 4)})` : ""}
              </a>{" "}
              <span class="muted">· TV show</span>
            </li>
          ))}
          {movies.results.map((m) => (
            <li>
              <a href={`/recommend?kind=movie&ref=${m.imdb_id}${ratedQS}`}>
                {m.title}
                {m.year ? ` (${m.year})` : ""}
              </a>{" "}
              <span class="muted">· Movie</span>
            </li>
          ))}
        </ul>
      </Layout>,
    );
  }

  // Step 1: landing — search box + zero-typing quick picks.
  const [{ results: topShows }, { results: topMovies }] = await Promise.all([
    db.prepare("SELECT id, name FROM shows ORDER BY weight DESC LIMIT 8").all<{ id: number; name: string }>(),
    db.prepare("SELECT imdb_id, title FROM movies ORDER BY popularity DESC LIMIT 4").all<{ imdb_id: string; title: string }>(),
  ]);
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="What should I watch next? Rate one thing, get your pick | TV Nightly"
      description="Tell us the last show or movie you watched and how it landed — we'll pick your next watch. No account needed."
      canonical={canonical(c)}
    >
      <h1>What should I watch next?</h1>
      <p>Tell us the last thing you finished, and how it landed. We'll take it from there.</p>
      <form method="get" action="/recommend" class="search">
        <input type="search" name="q" placeholder="The last show or movie you watched…" required />
        {ratedQS ? (
          <input type="hidden" name="rated" value={fmtRated(parseRated(c.req.query("rated")))} />
        ) : null}
        <button type="submit" class="verdict-btn">Find it</button>
      </form>
      <h2>Or tap one you've seen</h2>
      <p class="quick-picks">
        {topShows.map((s) => (
          <a class="chip" href={`/recommend?kind=tv&ref=${s.id}${ratedQS}`}>
            {s.name}
          </a>
        ))}
        {topMovies.map((m) => (
          <a class="chip" href={`/recommend?kind=movie&ref=${m.imdb_id}${ratedQS}`}>
            {m.title}
          </a>
        ))}
      </p>
      <p>
        <a class="chev-after" href="/loved">See what the community loves</a>
      </p>
    </Layout>,
  );
});

app.post("/recommend", async (c) => {
  const body = await c.req.parseBody();
  const kind = String(body.kind ?? "");
  const ref = String(body.ref ?? "").trim();
  const verdict = String(body.verdict ?? "");
  const prior = fmtRated(parseRated(typeof body.rated === "string" ? body.rated : undefined));
  const col = VERDICTS[verdict];
  if (!col || (kind !== "tv" && kind !== "movie")) return c.notFound();
  const title = await getRatedTitle(c.env.DB, kind, ref);
  if (!title) return c.notFound();

  const ip = c.req.header("cf-connecting-ip") ?? "0.0.0.0";
  const hash = await ipHash(c.env.SECRET ?? "anon-salt", ip);
  const dup = await c.env.DB.prepare(
    "SELECT 1 AS x FROM rate_log WHERE ip_hash = ? AND kind = ? AND ref = ?",
  )
    .bind(hash, kind, ref)
    .first();
  if (!dup) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        "INSERT OR IGNORE INTO rate_log (ip_hash, kind, ref, created_at, verdict) VALUES (?,?,?,unixepoch(),?)",
      ).bind(hash, kind, ref, verdict),
      c.env.DB.prepare(
        `INSERT INTO title_ratings (kind, ref, loved, liked, meh) VALUES (?,?,?,?,?)
         ON CONFLICT(kind, ref) DO UPDATE SET
           loved = loved + excluded.loved, liked = liked + excluded.liked, meh = meh + excluded.meh`,
      ).bind(kind, ref, col === "loved" ? 1 : 0, col === "liked" ? 1 : 0, col === "meh" ? 1 : 0),
    ]);
  }
  return c.redirect(
    `/recommend?kind=${kind}&ref=${encodeURIComponent(ref)}&v=${verdict}${prior ? `&rated=${encodeURIComponent(prior)}` : ""}`,
    303,
  );
});

// --------------------------------------------------- directory & charts

// ------------------------------------------------- community loved charts

app.get("/loved", async (c) => {
  const db = c.env.DB;
  const { results: rows } = await db
    .prepare(
      `SELECT * FROM (
         SELECT kind, ref, loved, liked, meh, (loved + liked + meh) AS total,
                (loved + 0.5 * liked) / CAST(loved + liked + meh AS REAL) AS score
         FROM title_ratings
       ) WHERE total >= 2 ORDER BY score DESC, total DESC LIMIT 40`,
    )
    .all<{ kind: string; ref: string; total: number; score: number }>();

  const showIds = rows.filter((r) => r.kind === "tv").map((r) => Number(r.ref));
  const movieIds = rows.filter((r) => r.kind === "movie").map((r) => r.ref);
  const shows = showIds.length
    ? (
        await db
          .prepare(`SELECT id, name, slug FROM shows WHERE id IN (${showIds.map(() => "?").join(",")})`)
          .bind(...showIds)
          .all<{ id: number; name: string; slug: string }>()
      ).results
    : [];
  const movies = movieIds.length
    ? (
        await db
          .prepare(
            `SELECT imdb_id, title, year, slug FROM movies WHERE imdb_id IN (${movieIds.map(() => "?").join(",")})`,
          )
          .bind(...movieIds)
          .all<{ imdb_id: string; title: string; year: number | null; slug: string }>()
      ).results
    : [];
  const showMap = new Map(shows.map((s) => [String(s.id), s]));
  const movieMap = new Map(movies.map((m) => [m.imdb_id, m]));

  c.header("Cache-Control", "public, max-age=900");
  return c.html(
    <Layout
      title="The most loved shows & movies on TV Nightly"
      description="Community charts built from real one-tap verdicts: what TV Nightly's raters love right now."
      canonical={canonical(c)}
    >
      <h1>Most loved by the TV Nightly community</h1>
      <p class="muted">
        Ranked by reader verdicts from <a href="/recommend">the recommender</a>. Early days — every
        rating moves this chart.
      </p>
      {rows.length === 0 ? (
        <p class="muted">
          No titles have enough ratings yet. <a href="/recommend">Be the first</a>.
        </p>
      ) : null}
      <ol class="ranked">
        {rows.map((r) => {
          const s = r.kind === "tv" ? showMap.get(r.ref) : undefined;
          const m = r.kind === "movie" ? movieMap.get(r.ref) : undefined;
          if (!s && !m) return null;
          const href = s ? `/show/${s.slug}` : `/movie/${m!.slug}`;
          const label = s ? s.name : `${m!.title}${m!.year ? ` (${m!.year})` : ""}`;
          return (
            <li>
              <strong>
                <a href={href}>{label}</a>
              </strong>{" "}
              <span class="muted">· {s ? "TV show" : "Movie"}</span>
              <span class="rating"> {Math.round(r.score * 100)}% positive</span>
              <span class="muted">
                {" "}
                · {r.total} rating{r.total === 1 ? "" : "s"}
              </span>
            </li>
          );
        })}
      </ol>
    </Layout>,
  );
});

// ---------------------------------------------------------------- movies

export default app;
