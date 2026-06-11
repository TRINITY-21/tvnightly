import { Hono } from "hono";
import { Context } from "hono";
import { Bindings, ShowRow, MovieRow, PersonRow } from "../types";
import { stripHtml, slugifyName, retinaSet, longDate, ageOf } from "../lib/format";
import { origin, canonical, breadcrumbLd } from "../lib/seo";
import { getShow } from "../lib/queries";
import { Layout } from "../components/Layout";
import { ShowTabs, SeasonTabs } from "../components/nav";
import { ClampSummary } from "../components/cards";

const app = new Hono<{ Bindings: Bindings }>();

interface TmdbSeasonCast {
  id: number;
  name: string;
  profile_path: string | null;
  total_episode_count: number;
  roles: { character: string }[];
}

/** TMDB season aggregate credits, edge-cached for a week. Fails to null. */
async function tmdbSeasonCredits(
  key: string,
  tmdbId: number,
  season: number,
): Promise<TmdbSeasonCast[] | null> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/season-credits/${tmdbId}/${season}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}/aggregate_credits?api_key=${key}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { cast?: TmdbSeasonCast[] };
    return data.cast ?? null;
  } catch {
    return null;
  }
}

async function seasonCastPage(
  c: Context<{ Bindings: Bindings }>,
  show: ShowRow,
  season: number,
  latest: boolean,
) {
  const cast =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? ((await tmdbSeasonCredits(c.env.TMDB_API_KEY, show.tmdb_id, season)) ?? []).slice(0, 24)
      : [];
  // link anyone we already track on this show, matched by name
  const linkable = new Map<string, number>();
  if (cast.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT p.id, p.name FROM credits cr JOIN people p ON p.id = cr.person_id WHERE cr.show_id = ?`,
    )
      .bind(show.id)
      .all<{ id: number; name: string }>();
    for (const r of results) linkable.set(r.name.toLowerCase(), r.id);
  }

  const site = origin(c);
  const base = `/show/${show.slug}/cast`;
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name} Season ${season} cast — who's in it & episode counts | TV Nightly`}
      description={
        cast.length
          ? `Everyone in ${show.name} Season ${season}: ${cast
              .slice(0, 5)
              .map((p) => p.name)
              .join(", ")} — with roles and this season's episode counts.`
          : `The Season ${season} cast of ${show.name}.`
      }
      canonical={`${site}${base}?season=${season}`}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, `Season ${season} cast`, base)]}
    >
      <h1>
        <a href={`/show/${show.slug}`}>{show.name}</a> — Season {season} cast
      </h1>
      <SeasonTabs slug={show.slug} season={season} current="cast" latest={latest} />
      {cast.length ? (
        <>
          <p class="muted">
            {cast.length} credited this season, ordered by appearances.{" "}
            <a href={base}>Full series cast</a>
          </p>
          <div class="cast-grid">
            {cast.map((p) => {
              const id = linkable.get(p.name.toLowerCase());
              const img = p.profile_path
                ? `https://image.tmdb.org/t/p/w342${p.profile_path}`
                : null;
              const inner = (
                <>
                  {img ? (
                    <img src={img} alt={p.name} loading="lazy" />
                  ) : (
                    <div class="cast-fallback">{p.name}</div>
                  )}
                  {p.total_episode_count ? (
                    <span class="cast-eps">
                      {p.total_episode_count} ep{p.total_episode_count === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  <div class="cast-tile-body">
                    <strong>{p.name}</strong>
                    {p.roles?.[0]?.character ? (
                      <span class="cast-char">as {p.roles[0].character}</span>
                    ) : null}
                  </div>
                </>
              );
              return id ? (
                <a class="cast-tile" href={`/person/${slugifyName(p.name)}-${id}`}>
                  {inner}
                </a>
              ) : (
                <div class="cast-tile">{inner}</div>
              );
            })}
          </div>
        </>
      ) : (
        <p class="muted">
          Season-level cast isn't available for this show yet —{" "}
          <a href={base}>see the full series cast</a> instead.
        </p>
      )}
    </Layout>,
  );
}

app.get("/show/:slug/cast", async (c) => {
  const show = await getShow(c.env.DB, c.req.param("slug"));
  if (!show) return c.notFound();
  const rawSeason = (c.req.query("season") ?? "").trim();
  if (rawSeason !== "") {
    const { results: seasonRows } = await c.env.DB.prepare(
      "SELECT DISTINCT season AS s FROM episodes WHERE show_id = ? AND season IS NOT NULL ORDER BY season",
    )
      .bind(show.id)
      .all<{ s: number }>();
    const seasons = seasonRows.map((r) => r.s);
    const sn = Number(rawSeason);
    if (!Number.isInteger(sn) || !seasons.includes(sn))
      return c.redirect(`/show/${show.slug}/cast`, 301);
    return seasonCastPage(c, show, sn, sn === Math.max(...seasons));
  }
  type CreditRow = PersonRow & {
    character: string | null;
    voice: number;
    episodes: number | null;
    guest: number;
  };
  const { results: credits } = await c.env.DB.prepare(
    `SELECT p.*, cr.character, cr.voice, cr.episodes, cr.guest
     FROM credits cr JOIN people p ON p.id = cr.person_id
     WHERE cr.show_id = ?
     ORDER BY cr.guest ASC, cr.episodes DESC, p.name`,
  )
    .bind(show.id)
    .all<CreditRow>();
  const main = credits.filter((r) => !r.guest);
  const guests = credits.filter((r) => r.guest);
  const site = origin(c);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${show.name} cast — main cast & guest stars | TV Nightly`}
      description={
        main.length
          ? `The cast of ${show.name}: ${main
              .slice(0, 5)
              .map((p) => p.name)
              .join(", ")} — roles, episode counts${guests.length ? ", and notable guest stars" : ""}.`
          : `The cast of ${show.name}.`
      }
      canonical={canonical(c)}
      ogImage={show.image_url ?? undefined}
      ld={[breadcrumbLd(site, show, "Cast", `/show/${show.slug}/cast`)]}
    >
      <h1>
        Cast of <a href={`/show/${show.slug}`}>{show.name}</a>
      </h1>
      <ShowTabs slug={show.slug} current="cast" />
      {main.length ? (
        <>
          <h2>Main cast</h2>
          <div class="cast-grid">
            {main.map((p) => {
              return (
                <a class="cast-tile" href={`/person/${slugifyName(p.name)}-${p.id}`}>
                  {p.image_url ? (
                    <img src={p.image_url} srcset={retinaSet(p.image_url)} alt={p.name} loading="lazy" />
                  ) : (
                    <div class="cast-fallback">{p.name}</div>
                  )}
                  {p.episodes ? (
                    <span class="cast-eps">
                      {p.episodes} ep{p.episodes === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {p.voice ? <span class="badge">Voice</span> : null}
                  <div class="cast-tile-body">
                    <strong>{p.name}</strong>
                    {p.character ? <span class="cast-char">as {p.character}</span> : null}
                  </div>
                </a>
              );
            })}
          </div>
        </>
      ) : (
        <p class="muted">Cast data for this show is still syncing — check back soon.</p>
      )}
      {guests.length ? (
        <section>
          <h2>Guest stars</h2>
          <div class="guest-list">
            {guests.map((p) => (
              <a class="guest-row" href={`/person/${slugifyName(p.name)}-${p.id}`}>
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} loading="lazy" />
                ) : (
                  <span class="guest-fallback" aria-hidden="true">
                    {p.name.slice(0, 1)}
                  </span>
                )}
                <span class="guest-who">
                  <span class="guest-name">{p.name}</span>
                  {p.character ? <span class="guest-char muted">as {p.character}</span> : null}
                </span>
                {p.episodes ? (
                  <span class="guest-eps">
                    {p.episodes} ep{p.episodes === 1 ? "" : "s"}
                  </span>
                ) : null}
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </Layout>,
  );
});

app.get("/person/:slug", async (c) => {
  const slug = c.req.param("slug");
  const idMatch = /-(\d+)$/.exec(slug);
  if (!idMatch) return c.notFound();
  const person = await c.env.DB.prepare("SELECT * FROM people WHERE id = ?")
    .bind(Number(idMatch[1]))
    .first<PersonRow>();
  if (!person) return c.notFound();
  // one canonical URL per person — name drift 301s home
  const canonicalSlug = `${slugifyName(person.name)}-${person.id}`;
  if (slug !== canonicalSlug) return c.redirect(`/person/${canonicalSlug}`, 301);

  const [{ results: roles }, { results: films }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT cr.character, cr.voice, cr.episodes, s.*
       FROM credits cr JOIN shows s ON s.id = cr.show_id
       WHERE cr.person_id = ?
       ORDER BY s.rating IS NULL, s.rating DESC, cr.episodes DESC LIMIT 24`,
    )
      .bind(person.id)
      .all<ShowRow & { character: string | null; voice: number; episodes: number | null }>(),
    c.env.DB.prepare(
      `SELECT mc.character, m.* FROM movie_credits mc JOIN movies m ON m.imdb_id = mc.movie_id
       WHERE mc.person_id = ?
       ORDER BY m.rating IS NULL, m.rating DESC, m.popularity DESC LIMIT 18`,
    )
      .bind(person.id)
      .all<MovieRow & { character: string | null }>(),
  ]);
  const socials: { ig?: string; tw?: string } = person.socials ? JSON.parse(person.socials) : {};

  // the stat band — everything from our own mirror
  const nowYear = new Date().getFullYear();
  const spanYears: number[] = [];
  for (const r of roles) {
    if (r.premiered) spanYears.push(Number(r.premiered.slice(0, 4)));
    if (r.ended) spanYears.push(Number(r.ended.slice(0, 4)));
    else if (r.status === "Running") spanYears.push(nowYear);
  }
  for (const m of films) if (m.year) spanYears.push(m.year);
  const yearsActive = spanYears.length
    ? `${Math.min(...spanYears)}–${Math.max(...spanYears)}`
    : null;
  const ratedCredits = [
    ...roles.map((r) => ({ name: r.name, rating: r.rating })),
    ...films.map((m) => ({ name: m.title, rating: m.rating })),
  ].filter((x): x is { name: string; rating: number } => x.rating != null);
  const topRated = ratedCredits.length
    ? ratedCredits.reduce((a, b) => (b.rating > a.rating ? b : a))
    : null;
  const avgRating = ratedCredits.length
    ? (ratedCredits.reduce((s, x) => s + x.rating, 0) / ratedCredits.length).toFixed(1)
    : null;
  const showYears = (r: ShowRow) =>
    r.premiered
      ? `${r.premiered.slice(0, 4)}${
          r.ended ? `–${r.ended.slice(0, 4)}` : r.status === "Running" ? "–present" : ""
        }`
      : null;

  const age = ageOf(person.birthday ?? undefined, person.deathday ?? undefined);
  const years =
    person.birthday && person.deathday
      ? `${person.birthday.slice(0, 4)}–${person.deathday.slice(0, 4)}`
      : null;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    url: `${origin(c)}/person/${canonicalSlug}`,
    ...(person.image_url ? { image: person.image_url } : {}),
    ...(person.birthday ? { birthDate: person.birthday } : {}),
    ...(person.deathday ? { deathDate: person.deathday } : {}),
    ...(person.country ? { nationality: person.country } : {}),
  };

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${person.name} — TV shows, age & roles | TV Nightly`}
      description={`${person.name}${age != null && !years ? `, ${age},` : ""} — known for ${roles
        .slice(0, 3)
        .map((r) => r.name)
        .join(", ")}. Every show, every role, where to stream them.`}
      canonical={canonical(c)}
      ogImage={person.image_url ?? undefined}
      ld={[ld]}
    >
      <article class="show-hub">
        <header class="detail-hero">
          {person.image_url ? (
            <div class="hero-backdrop" style={`background-image:url('${person.image_url}')`}></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side">
              {person.image_url ? (
                <img class="poster" src={person.image_url} srcset={retinaSet(person.image_url)} alt={person.name} />
              ) : (
                <div class="poster card-fallback">{person.name}</div>
              )}
            </div>
            <div class="detail-info">
              <h1>{person.name}</h1>
              <p class="meta-strip">
                {person.known_dept && person.known_dept !== "Acting" ? (
                  <>
                    <span>{person.known_dept}</span>
                    <span class="sep">·</span>
                  </>
                ) : null}
                {years ? (
                  <span>
                    {years}
                    {age != null ? ` (aged ${age})` : ""}
                  </span>
                ) : age != null ? (
                  <span>
                    Age {age}
                    {person.birthday ? ` — born ${longDate(person.birthday)}` : ""}
                  </span>
                ) : null}
                {person.birthplace || person.country ? (
                  <>
                    {age != null || years ? <span class="sep">·</span> : null}
                    <span>{person.birthplace ?? person.country}</span>
                  </>
                ) : null}
                {roles.length ? (
                  <>
                    <span class="sep">·</span>
                    <span>
                      {roles.length} show{roles.length === 1 ? "" : "s"}
                      {films.length ? ` & ${films.length} film${films.length === 1 ? "" : "s"}` : ""}{" "}
                      on TV Nightly
                    </span>
                  </>
                ) : null}
              </p>
              {person.bio ? (
                stripHtml(person.bio).length > 280 ? (
                  <ClampSummary id="bio-clamp">{person.bio}</ClampSummary>
                ) : (
                  <div class="summary">{person.bio}</div>
                )
              ) : roles.length ? (
                <p class="summary">
                  Best known around here for{" "}
                  {roles.slice(0, 2).map((r, i) => (
                    <>
                      {i > 0 ? " and " : ""}
                      <a href={`/show/${r.slug}`}>{r.name}</a>
                      {r.character ? ` (as ${r.character})` : ""}
                    </>
                  ))}
                  .
                </p>
              ) : null}
              <nav class="pill-nav">
                {person.imdb_id ? (
                  <a
                    class="chev-after"
                    href={`https://www.imdb.com/name/${person.imdb_id}/`}
                    rel="noopener"
                  >
                    IMDb
                  </a>
                ) : null}
                {socials.ig ? (
                  <a
                    class="chev-after"
                    href={`https://www.instagram.com/${socials.ig}/`}
                    rel="noopener"
                  >
                    Instagram
                  </a>
                ) : null}
                {socials.tw ? (
                  <a class="chev-after" href={`https://x.com/${socials.tw}`} rel="noopener">
                    X
                  </a>
                ) : null}
                {person.homepage ? (
                  <a class="chev-after" href={person.homepage} rel="noopener">
                    Website
                  </a>
                ) : null}
              </nav>
            </div>
          </div>
        </header>
        {roles.length || films.length ? (
          <section class="stat-band">
            <div class="stat">
              <span class="stat-num">{roles.length + films.length}</span>
              <span class="stat-label">Tracked credits</span>
              <span class="stat-sub muted">TV & film on TV Nightly</span>
            </div>
            {yearsActive ? (
              <div class="stat">
                <span class="stat-num">{yearsActive}</span>
                <span class="stat-label">Years active</span>
                <span class="stat-sub muted">across tracked work</span>
              </div>
            ) : null}
            {topRated ? (
              <div class="stat">
                <span class="stat-num">
                  {topRated.rating.toFixed(1)} <span class="rating">★</span>
                </span>
                <span class="stat-label">Top-rated</span>
                <span class="stat-sub muted">{topRated.name}</span>
              </div>
            ) : null}
            {avgRating && ratedCredits.length > 1 ? (
              <div class="stat">
                <span class="stat-num">
                  {avgRating} <span class="rating">★</span>
                </span>
                <span class="stat-label">Avg rating</span>
                <span class="stat-sub muted">across {ratedCredits.length} rated</span>
              </div>
            ) : null}
          </section>
        ) : null}
        {roles.length ? (
          <section>
            <h2>Top TV shows</h2>
            <ol class="rank-list">
              {roles.map((r, i) => (
                <li class="rank-row">
                  <span class="rank-num">{i + 1}</span>
                  {r.image_url ? (
                    <img class="rank-thumb" src={r.image_url} alt="" loading="lazy" />
                  ) : (
                    <span class="rank-thumb rank-thumb-empty" aria-hidden="true"></span>
                  )}
                  <span class="rank-main">
                    <a href={`/show/${r.slug}`}>{r.name}</a>
                    <span class="rank-sub muted">
                      {[
                        r.character ? `${r.character}${r.voice ? " (voice)" : ""}` : null,
                        r.episodes ? `${r.episodes} ep${r.episodes === 1 ? "" : "s"}` : null,
                        showYears(r),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {r.rating != null ? (
                    <span class="rank-score">
                      <span class="rating">★ {r.rating.toFixed(1)}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <p class="muted">No tracked roles yet — the sync adds shows hourly.</p>
        )}
        {films.length ? (
          <section>
            <h2>Top movies</h2>
            <ol class="rank-list">
              {films.map((m, i) => (
                <li class="rank-row">
                  <span class="rank-num">{i + 1}</span>
                  {m.poster_url ? (
                    <img class="rank-thumb" src={m.poster_url} alt="" loading="lazy" />
                  ) : (
                    <span class="rank-thumb rank-thumb-empty" aria-hidden="true"></span>
                  )}
                  <span class="rank-main">
                    <a href={`/movie/${m.slug}`}>{m.title}</a>
                    <span class="rank-sub muted">
                      {[m.character, m.year ? String(m.year) : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {m.rating != null ? (
                    <span class="rank-score">
                      <span class="rating">★ {m.rating.toFixed(1)}</span>
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </article>
    </Layout>,
  );
});

export default app;
