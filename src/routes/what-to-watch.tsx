import { Hono } from "hono";
import { Bindings, ShowRow, MovieRow } from "../types";
import { visitorRegion } from "../lib/providers";
import { stripHtml } from "../lib/format";
import { origin, canonical } from "../lib/seo";
import { PICKER_MIN_WEIGHT } from "../lib/queries";
import { Layout } from "../components/Layout";
import { StatusBadge } from "../components/cards";
import { ProviderChips } from "../components/providers";
import { RateInline, FilterSelect } from "../components/forms";

const app = new Hono<{ Bindings: Bindings }>();

// ----------------------------------------------------- what-to-watch picker

// "Who's watching?" — situational facts, not feelings. Genre lists carry both
// TVmaze ("Science-Fiction", "Children") and TMDB ("Science Fiction") names.
const COMPANY: Record<
  string,
  { label: string; include: string[]; exclude?: string[]; min?: number }
> = {
  date: { label: "Date night", include: ["Romance", "Comedy", "Music"], min: 7 },
  family: {
    label: "Family night",
    include: ["Family", "Children", "Animation", "Adventure", "Fantasy"],
    exclude: ["Horror", "Crime", "Thriller", "War"],
  },
  friends: {
    label: "With friends",
    include: ["Action", "Comedy", "Horror", "Adventure", "Science-Fiction", "Science Fiction", "Thriller"],
  },
};

// Every filter is the custom dropdown (js/dropdown.js enhances data-fancy
// selects on fine-pointer devices; touch keeps the OS picker, no-JS keeps
// the native select).

app.get("/what-to-watch", async (c) => {
  const db = c.env.DB;
  const type = c.req.query("type") === "movie" ? "movie" : "tv";
  const rawGenre = (c.req.query("genre") ?? "").trim();
  const status = c.req.query("status") ?? "";
  const minRating = Number(c.req.query("min") ?? 0) || 0;
  const runtimeBand = c.req.query("runtime") ?? ""; // '' | 'short' | 'long'
  // Same form values, sensible minutes per medium.
  const RUNTIME_CAPS = { tv: { short: 35, long: 65 }, movie: { short: 100, long: 135 } };
  const maxRuntime =
    runtimeBand === "short" || runtimeBand === "long" ? RUNTIME_CAPS[type][runtimeBand] : 0;

  const { results: genreRows } =
    type === "movie"
      ? await db
          .prepare("SELECT DISTINCT value AS g FROM movies, json_each(movies.genres) ORDER BY 1")
          .all<{ g: string }>()
      : await db
          .prepare(
            `SELECT DISTINCT value AS g FROM shows, json_each(shows.genres)
             WHERE shows.weight >= ? ORDER BY 1`,
          )
          .bind(PICKER_MIN_WEIGHT)
          .all<{ g: string }>();
  // Only genres that actually exist pass through to the LIKE pattern.
  const genre = genreRows.some((r) => r.g === rawGenre) ? rawGenre : "";

  // Service filter (both mediums): dropdown derived from real provider data,
  // localized to the visitor's region (CF geo, ?region= override).
  const region = visitorRegion(c);
  const serviceRows =
    type === "movie"
      ? (
          await db
            .prepare(
              `SELECT value AS p, COUNT(*) AS n
               FROM movies, json_each(json_extract(movies.providers_intl, ?))
               GROUP BY value ORDER BY n DESC LIMIT 12`,
            )
            .bind(`$.${region}`)
            .all<{ p: string }>()
        ).results
      : (
          await db
            .prepare(
              `SELECT value AS p, COUNT(*) AS n
               FROM shows, json_each(json_extract(shows.providers_intl, ?))
               WHERE shows.weight >= ?
               GROUP BY value ORDER BY n DESC LIMIT 12`,
            )
            .bind(`$.${region}`, PICKER_MIN_WEIGHT)
            .all<{ p: string }>()
        ).results;
  const reqService = (c.req.query("service") ?? "").trim();
  const service = serviceRows.some((r) => r.p === reqService) ? reqService : "";

  const who = COMPANY[c.req.query("who") ?? ""] ? (c.req.query("who") as string) : "";

  // Anti-repeat: spins exclude everything already seen this session (URL trail).
  const skip = (c.req.query("skip") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => (type === "movie" ? /^tt\d+$/.test(s) : /^\d+$/.test(s)))
    .slice(-20);
  const hasSpun = Boolean(
    c.req.query("type") ||
      c.req.query("genre") ||
      c.req.query("who") ||
      c.req.query("service") ||
      c.req.query("status") ||
      c.req.query("min") ||
      c.req.query("runtime") ||
      c.req.query("skip"),
  );

  const conds: string[] = ["rating IS NOT NULL"];
  const binds: (string | number)[] = [];
  if (type === "tv") {
    // Popularity floor keeps TV picks recognizable; the movies table is
    // curated-by-construction (seeded top-N), so it needs no floor.
    conds.push("weight >= ?");
    binds.push(PICKER_MIN_WEIGHT);
  }
  if (genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${genre}"%`);
  }
  if (service) {
    conds.push("json_extract(providers_intl, ?) LIKE ?");
    binds.push(`$.${region}`, `%"${service}"%`);
  }
  if (who) {
    const cfg = COMPANY[who];
    conds.push(`(${cfg.include.map(() => "genres LIKE ?").join(" OR ")})`);
    binds.push(...cfg.include.map((g) => `%"${g}"%`));
    for (const g of cfg.exclude ?? []) {
      conds.push("genres NOT LIKE ?");
      binds.push(`%"${g}"%`);
    }
    if (cfg.min && !minRating) {
      conds.push("rating >= ?");
      binds.push(cfg.min);
    }
  }
  if (type === "tv" && status === "ended") conds.push("status = 'Ended'");
  if (type === "tv" && status === "running") conds.push("status = 'Running'");
  if (minRating) {
    conds.push("rating >= ?");
    binds.push(minRating);
  }
  if (maxRuntime) {
    conds.push("runtime <= ?");
    binds.push(maxRuntime);
  }
  if (skip.length) {
    const ph = skip.map(() => "?").join(",");
    conds.push(type === "movie" ? `imdb_id NOT IN (${ph})` : `id NOT IN (${ph})`);
    binds.push(...skip);
  }
  const where = conds.join(" AND ");

  // Typed per-medium branches: a movie row never has show fields and vice
  // versa, so derive everything the card needs inside each branch.
  interface PickView {
    name: string;
    href: string;
    image: string | null;
    genres: string[];
    providers_intl: string | null;
    rating: number | null;
    runtime: number | null;
    desc: string;
    status: string | null; // TV only
    slug: string;
    refId: string; // shows.id / movies.imdb_id — for skip trail + rating
  }
  const PICK_LIMIT = 2;
  const picks: PickView[] = [];
  if (hasSpun) {
    if (type === "movie") {
      const { results } = await db
        .prepare(`SELECT * FROM movies WHERE ${where} ORDER BY RANDOM() LIMIT ${PICK_LIMIT}`)
        .bind(...binds)
        .all<MovieRow>();
      for (const m of results) {
        picks.push({
          name: m.year ? `${m.title} (${m.year})` : m.title,
          href: `/movie/${m.slug}`,
          image: m.poster_url,
          genres: m.genres ? JSON.parse(m.genres) : [],
          providers_intl: m.providers_intl,
          rating: m.rating,
          runtime: m.runtime,
          desc: (m.overview ?? "").slice(0, 160),
          status: null,
          slug: m.slug,
          refId: m.imdb_id,
        });
      }
    } else {
      const { results } = await db
        .prepare(`SELECT * FROM shows WHERE ${where} ORDER BY RANDOM() LIMIT ${PICK_LIMIT}`)
        .bind(...binds)
        .all<ShowRow>();
      for (const s of results) {
        picks.push({
          name: s.name,
          href: `/show/${s.slug}`,
          image: s.image_url,
          genres: s.genres ? JSON.parse(s.genres) : [],
          providers_intl: s.providers_intl,
          rating: s.rating,
          runtime: s.runtime,
          desc: s.blurb ?? stripHtml(s.summary).slice(0, 160),
          status: s.status,
          slug: s.slug,
          refId: String(s.id),
        });
      }
    }
  }
  const skipNext = picks.length
    ? [...skip, ...picks.map((p) => p.refId)].slice(-20).join(",")
    : skip.join(",");
  c.header("Cache-Control", "no-store");
  return c.html(
    <Layout
      title="What should I watch tonight? — TV show picker | TV Nightly"
      description="Can't decide what to watch? Spin the picker: a great TV show matching your genre, rating, and episode-length filters."
      canonical={origin(c) + "/what-to-watch"}
      scripts={["/js/dropdown.js"]}
    >
      <div class="watch-page">
        <header class="watch-head">
          <h1>What should I watch tonight?</h1>
          <p class="watch-tagline muted">Tune the filters — we'll deal you two contenders.</p>
        </header>

        <form method="get" action="/what-to-watch" class="watch-bar">
          <div class="watch-bar-row">
            <div class="watch-bar-fields">
              <FilterSelect
                label="Format"
                name="type"
                current={type}
                options={[
                  { value: "tv", text: "TV show" },
                  { value: "movie", text: "Movie" },
                ]}
              />
              <FilterSelect
                label="Who's watching"
                name="who"
                current={who}
                options={[
                  { value: "", text: "Anyone" },
                  ...Object.entries(COMPANY).map(([key, cfg]) => ({
                    value: key,
                    text: cfg.label,
                  })),
                ]}
              />
              <FilterSelect
                label="Genre"
                name="genre"
                current={genre}
                options={[
                  { value: "", text: "Any" },
                  ...genreRows.map((r) => ({ value: r.g, text: r.g })),
                ]}
              />
              <FilterSelect
                label="Rating"
                name="min"
                current={minRating ? String(minRating) : ""}
                options={[
                  { value: "", text: "Any" },
                  { value: "7", text: "7+" },
                  { value: "8", text: "8+" },
                ]}
              />
              <FilterSelect
                label={type === "movie" ? "Length" : "Ep. length"}
                name="runtime"
                current={runtimeBand === "short" || runtimeBand === "long" ? runtimeBand : ""}
                options={[
                  { value: "", text: "Any" },
                  { value: "short", text: `≤ ${RUNTIME_CAPS[type].short}m` },
                  { value: "long", text: `≤ ${RUNTIME_CAPS[type].long}m` },
                ]}
              />
              {serviceRows.length ? (
                <FilterSelect
                  label={`Streaming on (${region})`}
                  name="service"
                  current={service}
                  options={[
                    { value: "", text: "Any" },
                    ...serviceRows.map((r) => ({ value: r.p, text: r.p })),
                  ]}
                />
              ) : null}
            </div>
            {skipNext ? <input type="hidden" name="skip" value={skipNext} /> : null}
            <div class="watch-bar-actions">
              {hasSpun ? (
                <a class="watch-clear" href="/what-to-watch">
                  Reset filters
                </a>
              ) : null}
              <button type="submit" class="watch-submit">
                {picks.length ? "Shuffle again" : "Find my picks"}
              </button>
            </div>
          </div>
        </form>

        <section class="watch-results" id="picks" aria-label="Tonight's matchup">
          {picks.length ? (
            <>
              <div class="shortlist-head">
                <span class="shortlist-rule" aria-hidden="true"></span>
                <p class="shortlist-kicker">
                  {picks.length === PICK_LIMIT ? (
                    "Tonight's matchup"
                  ) : (
                    <>
                      The last one standing
                      <span class="muted"> · your filters ruled out everything else</span>
                    </>
                  )}
                </p>
                <span class="shortlist-rule" aria-hidden="true"></span>
              </div>
              <div class={`shortlist-duo${picks.length < 2 ? " shortlist-duo--solo" : ""}`}>
                {picks.flatMap((pick, i) => {
                  const card = (
                    <article class={`shortlist-card${i === 1 ? " shortlist-card--b" : ""}`}>
                      <a class="shortlist-poster" href={pick.href}>
                        {pick.image ? (
                          <img src={pick.image} alt={pick.name} loading="lazy" />
                        ) : (
                          <div class="card-fallback">{pick.name}</div>
                        )}
                        {pick.rating != null ? (
                          <span class="card-rating">★ {pick.rating.toFixed(1)}</span>
                        ) : null}
                      </a>
                      <div class="shortlist-body">
                        <h2>
                          <a href={pick.href}>{pick.name}</a>
                        </h2>
                        <p class="shortlist-meta">
                          {type === "tv" ? <StatusBadge status={pick.status} /> : null}
                          {pick.runtime ? (
                            <>
                              {type === "tv" ? <span class="sep">·</span> : null}
                              <span>
                                {type === "movie" ? `${pick.runtime} min` : `~${pick.runtime} min/ep`}
                              </span>
                            </>
                          ) : null}
                          {pick.genres.length ? (
                            <>
                              <span class="sep">·</span>
                              <span>{pick.genres.slice(0, 2).join(", ")}</span>
                            </>
                          ) : null}
                        </p>
                        <ProviderChips row={pick} region={region} />
                        <p class="shortlist-blurb">{pick.desc}</p>
                        <div class="shortlist-foot">
                          <a class="verdict-btn shortlist-btn" href={pick.href}>
                            This one tonight
                          </a>
                          <RateInline kind={type} refId={pick.refId} stat={null} />
                        </div>
                      </div>
                    </article>
                  );
                  return i === 0
                    ? [card]
                    : [
                        <span class="shortlist-or" aria-hidden="true">
                          <span class="or-badge">or</span>
                        </span>,
                        card,
                      ];
                })}
              </div>
            </>
          ) : hasSpun ? (
            <div class="watch-miss">
              <p>Nothing survived those filters.</p>
              <p class="muted">Genre and streaming service cut the deepest — loosen one of those first.</p>
              <p>
                <a class="btn-ghost" href="/what-to-watch">
                  Start over
                </a>
              </p>
            </div>
          ) : (
            <div class="watch-primer">
              <div class="shortlist-head">
                <span class="shortlist-rule" aria-hidden="true"></span>
                <p class="shortlist-kicker muted">Your shortlist</p>
                <span class="shortlist-rule" aria-hidden="true"></span>
              </div>
              <div class="watch-primer-duo" aria-hidden="true">
                <span class="watch-primer-card"></span>
                <span class="shortlist-or">
                  <span class="or-badge">or</span>
                </span>
                <span class="watch-primer-card"></span>
              </div>
              <p class="watch-primer-copy muted">
                Your two contenders land here — pick whichever feels like tonight.
              </p>
            </div>
          )}
        </section>
      </div>
    </Layout>,
  );
});

export default app;
