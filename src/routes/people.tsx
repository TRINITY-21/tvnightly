import { Hono } from "hono";
import { IconStar, IconInstagram, IconX, IconGlobe } from "../components/icons";
import { Context } from "hono";
import { Bindings, ShowRow, PersonRow } from "../types";
import { stripHtml, slugifyName, headshot, longDate, ageOf } from "../lib/format";
import { TMDB_PERSON_OFFSET, resolveShow, resolvePersonProfile, tmdbShowCast } from "../lib/tmdb-show";
import { origin, canonical, breadcrumbLd, breadcrumbTrail } from "../lib/seo";
import { crewLinkMap } from "../lib/queries";
import { Layout } from "../components/Layout";
import { ShowTabs, SeasonTabs } from "../components/nav";
import { ClampSummary, ExploreCard } from "../components/cards";

/** genres are stored as a JSON string array on shows & movies */
const parseGenres = (j: string | null): string[] => {
  if (!j) return [];
  try {
    const a = JSON.parse(j);
    return Array.isArray(a) ? a.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
};

const app = new Hono<{ Bindings: Bindings }>();

interface TmdbSeasonCast {
  id: number;
  name: string;
  profile_path: string | null;
  total_episode_count: number;
  roles: { character: string }[];
}

interface TmdbAggCrew {
  id: number;
  name: string;
  profile_path: string | null;
  total_episode_count: number;
  jobs: { job: string; episode_count: number }[];
}

type TmdbAggCredits = { cast: TmdbSeasonCast[]; crew: TmdbAggCrew[] };

/** TMDB aggregate credits (season- or series-scoped), edge-cached for a
 *  week. Fails to null. */
async function tmdbAggCredits(
  key: string,
  tmdbId: number,
  season: number | null,
): Promise<TmdbAggCredits | null> {
  const cacheKey = new Request(
    season != null
      ? `https://edge-cache.tvnightly.com/season-credits/v2/${tmdbId}/${season}`
      : `https://edge-cache.tvnightly.com/show-credits/${tmdbId}`,
  );
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(
        `https://api.themoviedb.org/3/tv/${tmdbId}${season != null ? `/season/${season}` : ""}/aggregate_credits?api_key=${key}`,
        { headers: { accept: "application/json" } },
      );
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=604800");
      await cache.put(cacheKey, res.clone());
    }
    const data = (await res.json()) as { cast?: TmdbSeasonCast[]; crew?: TmdbAggCrew[] };
    return { cast: data.cast ?? [], crew: data.crew ?? [] };
  } catch {
    return null;
  }
}

// the TV credits a fan recognizes; plain "Producer" is line-producer noise
const TV_CREW_JOBS = [
  "Director",
  "Writer",
  "Executive Producer",
  "Original Music Composer",
  "Director of Photography",
];

/** Key crew, one tile per person with recognized jobs merged, ordered by
 *  how much of the run they shaped (episode count). */
function keyCrew(crew: TmdbAggCrew[], limit: number) {
  return crew
    .map((p) => {
      const jobs = [...new Set((p.jobs ?? []).map((j) => j.job).filter((j) => TV_CREW_JOBS.includes(j)))];
      return { ...p, jobLine: jobs.join(" · ") };
    })
    .filter((p) => p.jobLine)
    .sort((a, b) => b.total_episode_count - a.total_episode_count)
    .slice(0, limit);
}

/** Crew in the guest-stars row grammar: round portrait, name over the
 *  job line, episode count on the right. Rows link to person pages where
 *  the crew backfill (or the cast pipeline) gave us one. */
const CrewGrid = ({
  crew,
  links,
}: {
  crew: ReturnType<typeof keyCrew>;
  links?: Map<number, number>;
}) =>
  crew.length ? (
    <section>
      <h2>Crew</h2>
      <div class="guest-list">
        {crew.map((p) => {
          const img = p.profile_path ? `https://image.tmdb.org/t/p/w185${p.profile_path}` : null;
          // a mirrored crew member links to their canonical page; everyone else
          // resolves live via the TMDB person fallback (10M + their TMDB id)
          const pid = links?.get(p.id) ?? (p.id ? TMDB_PERSON_OFFSET + p.id : null);
          const inner = (
            <>
              {img ? (
                <img src={img} alt={p.name} loading="lazy" />
              ) : (
                <span class="guest-fallback" aria-hidden="true">
                  {p.name.slice(0, 1)}
                </span>
              )}
              <span class="guest-who">
                <span class="guest-name">{p.name}</span>
                <span class="guest-char muted">{p.jobLine}</span>
              </span>
              {p.total_episode_count ? (
                <span class="guest-eps">
                  {p.total_episode_count} ep{p.total_episode_count === 1 ? "" : "s"}
                </span>
              ) : null}
            </>
          );
          return pid != null ? (
            <a class="guest-row" href={`/person/${slugifyName(p.name)}-${pid}`}>
              {inner}
            </a>
          ) : (
            <div class="guest-row">{inner}</div>
          );
        })}
      </div>
    </section>
  ) : null;

async function seasonCastPage(
  c: Context<{ Bindings: Bindings }>,
  show: ShowRow,
  season: number,
  latest: boolean,
) {
  const agg =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? await tmdbAggCredits(c.env.TMDB_API_KEY, show.tmdb_id, season)
      : null;
  const cast = (agg?.cast ?? []).slice(0, 24);
  const crew = keyCrew(agg?.crew ?? [], 12);
  const crewLinks = await crewLinkMap(c.env.DB, crew);
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
      ogImage={show.poster_url ?? show.image_url ?? undefined}
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
              const id =
                linkable.get(p.name.toLowerCase()) ??
                (p.id ? TMDB_PERSON_OFFSET + p.id : null);
              const img = p.profile_path
                ? `https://image.tmdb.org/t/p/w342${p.profile_path}`
                : null;
              const inner = (
                <>
                  {img ? (
                    <img
                      src={img}
                      srcset={`${img} 1x, https://image.tmdb.org/t/p/w500${p.profile_path} 2x`}
                      alt={p.name}
                      loading="lazy"
                    />
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
      <CrewGrid crew={crew} links={crewLinks} />
    </Layout>,
  );
}

app.get("/show/:slug/cast", async (c) => {
  const resolved = await resolveShow(c, c.req.param("slug"));
  if (!resolved) return c.notFound();
  const show = resolved.show;
  type CreditRow = PersonRow & {
    character: string | null;
    voice: number;
    episodes: number | null;
    guest: number;
  };
  const rawSeason = (c.req.query("season") ?? "").trim();
  if (rawSeason !== "") {
    // live-TMDB titles have no per-season credit table; fold to the full cast
    if (resolved.isTmdb) return c.redirect(`/show/${show.slug}/cast`, 301);
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
  let credits: CreditRow[];
  if (resolved.isTmdb) {
    const cast = show.cast_json
      ? (JSON.parse(show.cast_json) as {
          id: number;
          n: string;
          c: string | null;
          img: string | null;
        }[])
      : [];
    credits = cast.map(
      (p) =>
        ({
          id: p.id,
          name: p.n,
          image_url: p.img,
          character: p.c,
          voice: 0,
          episodes: null,
          guest: 0,
        }) as unknown as CreditRow,
    );
  } else {
    const res = await c.env.DB.prepare(
      `SELECT p.*, cr.character, cr.voice, cr.episodes, cr.guest
       FROM credits cr JOIN people p ON p.id = cr.person_id
       WHERE cr.show_id = ?
       ORDER BY cr.guest ASC, cr.episodes DESC, p.name`,
    )
      .bind(show.id)
      .all<CreditRow>();
    credits = res.results;
    // mirrored show not cast-synced yet (bulk seed carries no credits) — fall
    // back to live TMDB cast so the page isn't empty
    if (!credits.length && show.tmdb_id && c.env.TMDB_API_KEY) {
      const live = await tmdbShowCast(c.env.TMDB_API_KEY, show.tmdb_id);
      credits = live.map(
        (p) =>
          ({
            id: p.id,
            name: p.n,
            image_url: p.img,
            character: p.c,
            voice: 0,
            episodes: null,
            guest: 0,
          }) as unknown as CreditRow,
      );
    }
  }
  const main = credits.filter((r) => !r.guest);
  const guests = credits.filter((r) => r.guest);
  const crew =
    show.tmdb_id && c.env.TMDB_API_KEY
      ? keyCrew((await tmdbAggCredits(c.env.TMDB_API_KEY, show.tmdb_id, null))?.crew ?? [], 18)
      : [];
  const crewLinks = await crewLinkMap(c.env.DB, crew);
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
      ogImage={show.poster_url ?? show.image_url ?? undefined}
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
                  {(() => {
                    const h = headshot(p.image_url);
                    return h ? (
                      <img src={h.src} srcset={h.srcset} alt={p.name} loading="lazy" />
                    ) : (
                      <div class="cast-fallback">{p.name}</div>
                    );
                  })()}
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
                {(() => {
                  const h = headshot(p.image_url);
                  return h ? (
                    <img src={h.src} srcset={h.srcset} alt={p.name} loading="lazy" />
                  ) : (
                    <span class="guest-fallback" aria-hidden="true">
                      {p.name.slice(0, 1)}
                    </span>
                  );
                })()}
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
      <CrewGrid crew={crew} links={crewLinks} />
    </Layout>,
  );
});

app.get("/person/:slug", async (c) => {
  const slug = c.req.param("slug");
  const idMatch = /-(\d+)$/.exec(slug);
  if (!idMatch) return c.notFound();
  const pid = Number(idMatch[1]);
  const profile = await resolvePersonProfile(c, pid);
  if (!profile) return c.notFound();
  const { person, roles, films } = profile;
  // one canonical URL per person — name drift 301s home
  const canonicalSlug = `${slugifyName(person.name)}-${person.id}`;
  if (slug !== canonicalSlug) return c.redirect(`/person/${canonicalSlug}`, 301);
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

  // the genres this person actually works in, ranked by how often they recur
  // across their credits — real signal, derived from the catalogue
  const genreTally = new Map<string, number>();
  for (const r of roles) for (const g of parseGenres(r.genres)) genreTally.set(g, (genreTally.get(g) ?? 0) + 1);
  for (const m of films) for (const g of parseGenres(m.genres)) genreTally.set(g, (genreTally.get(g) ?? 0) + 1);
  const topGenres = [...genreTally.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g).slice(0, 4);
  const firstGenre = (g: string | null) => parseGenres(g)[0] ?? null;

  // the person's defining work, for the lateral doors at the foot of the page
  const bestShow = roles.find((r) => r.rating != null) ?? null;
  const bestMovie = films.find((m) => m.rating != null) ?? null;
  const bestTitle = (() => {
    const s = bestShow ? { name: bestShow.name, href: `/show/${bestShow.slug}`, rating: bestShow.rating! } : null;
    const m = bestMovie ? { name: bestMovie.title, href: `/movie/${bestMovie.slug}`, rating: bestMovie.rating! } : null;
    if (s && m) return s.rating >= m.rating ? s : m;
    return s ?? m;
  })();

  // sameAs ties this Person node to its authoritative profiles, the strongest
  // signal we can give a knowledge graph that "our" person is that person.
  const sameAs = [
    person.tmdb_id ? `https://www.themoviedb.org/person/${person.tmdb_id}` : null,
    person.imdb_id ? `https://www.imdb.com/name/${person.imdb_id}/` : null,
    socials.ig ? `https://www.instagram.com/${socials.ig}/` : null,
    socials.tw ? `https://twitter.com/${socials.tw}` : null,
    person.homepage || null,
  ].filter((u): u is string => !!u);

  const site = origin(c);
  // map the TMDB "known for" department to a clean schema.org occupation
  const occupation =
    person.known_dept === "Acting"
      ? "Actor"
      : person.known_dept === "Directing"
        ? "Director"
        : person.known_dept === "Writing"
          ? "Writer"
          : person.known_dept === "Production"
            ? "Producer"
            : person.known_dept;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    url: `${site}/person/${canonicalSlug}`,
    ...(person.image_url ? { image: person.image_url } : {}),
    ...(person.birthday ? { birthDate: person.birthday } : {}),
    ...(person.deathday ? { deathDate: person.deathday } : {}),
    ...(person.country ? { nationality: person.country } : {}),
    ...(occupation
      ? { jobTitle: occupation, hasOccupation: { "@type": "Occupation", name: occupation } }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };

  // "known for" line: real TV roles, else film credits, else a generic fallback —
  // never the empty "known for ." that an actorless/credit-thin person produced.
  const knownFor = roles.length
    ? roles.slice(0, 3).map((r) => r.name)
    : films.slice(0, 3).map((m) => m.title);
  const personDescription = knownFor.length
    ? `${person.name}${age != null && !years ? `, ${age},` : ""} — known for ${knownFor.join(", ")}. Every show, every role, where to stream them.`
    : `${person.name}${age != null && !years ? `, ${age},` : ""} — full filmography, credits and where to stream their work, on TV Nightly.`;

  const personCrumbs = bestTitle
    ? [
        { name: "TV Nightly", url: site },
        { name: bestTitle.name, url: `${site}${bestTitle.href}` },
        { name: person.name, url: `${site}/person/${canonicalSlug}` },
      ]
    : [
        { name: "TV Nightly", url: site },
        { name: person.name, url: `${site}/person/${canonicalSlug}` },
      ];

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title={`${person.name} — TV shows, age & roles | TV Nightly`}
      description={personDescription}
      canonical={canonical(c)}
      ogImage={person.image_url ?? undefined}
      ld={[ld, breadcrumbTrail(personCrumbs)]}
    >
      <article class="show-hub">
        <header class="detail-hero person-hero">
          {person.image_url ? (
            <div class="hero-backdrop" style={`background-image:url('${person.image_url}')`}></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side">
              {(() => {
                const h = headshot(person.image_url, true);
                return h ? (
                  <img class="poster" src={h.src} srcset={h.srcset} alt={person.name} />
                ) : (
                  <div class="poster card-fallback">{person.name}</div>
                );
              })()}
              {socials.ig || socials.tw || person.homepage ? (
                <div class="soc-links">
                  {socials.ig ? (
                    <a
                      class="soc-link"
                      href={`https://www.instagram.com/${socials.ig}/`}
                      rel="noopener"
                      aria-label={`${person.name} on Instagram`}
                      title="Instagram"
                    >
                      <IconInstagram />
                    </a>
                  ) : null}
                  {socials.tw ? (
                    <a
                      class="soc-link"
                      href={`https://x.com/${socials.tw}`}
                      rel="noopener"
                      aria-label={`${person.name} on X`}
                      title="X"
                    >
                      <IconX />
                    </a>
                  ) : null}
                  {person.homepage ? (
                    <a
                      class="soc-link"
                      href={person.homepage}
                      rel="noopener"
                      aria-label="Official website"
                      title="Website"
                    >
                      <IconGlobe />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div class="detail-info">
              <h1>{person.name}</h1>
              <p class="meta-strip">
                {(() => {
                  const hasDept = Boolean(person.known_dept && person.known_dept !== "Acting");
                  const lifeSpan = Boolean(years || age != null);
                  const place = person.birthplace || person.country;
                  return (
                    <>
                      {hasDept ? <span>{person.known_dept}</span> : null}
                      {/* only print the separator when something actually follows */}
                      {hasDept && (lifeSpan || place) ? <span class="sep">·</span> : null}
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
                      {place ? (
                        <>
                          {lifeSpan ? <span class="sep sep-loc">·</span> : null}
                          <span class="ms-birthplace">{person.birthplace ?? person.country}</span>
                        </>
                      ) : null}
                    </>
                  );
                })()}
              </p>
              {person.bio ? (
                stripHtml(person.bio).length > 280 ? (
                  <ClampSummary id="bio-clamp">{person.bio}</ClampSummary>
                ) : (
                  <div class="summary">{person.bio}</div>
                )
              ) : roles.length ? (
                <p class="summary">
                  Best known for{" "}
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
              {topGenres.length ? (
                <p class="person-genres" aria-label="Works in">
                  {topGenres.map((g) => (
                    <a class="genre-chip" href={`/genre/${slugifyName(g)}`}>
                      {g}
                    </a>
                  ))}
                </p>
              ) : null}
            </div>
          </div>
        </header>
        {roles.length || films.length ? (
          <section class="stat-band">
            <div class="stat">
              <span class="stat-num">{roles.length + films.length}</span>
              <span class="stat-label">Credits</span>
              <span class="stat-sub muted">
                {roles.length} TV · {films.length} film{films.length === 1 ? "" : "s"}
              </span>
            </div>
            {yearsActive ? (
              <div class="stat">
                <span class="stat-num">{yearsActive}</span>
                <span class="stat-label">Years active</span>
                <span class="stat-sub muted">first to latest</span>
              </div>
            ) : null}
            {topRated ? (
              <div class="stat">
                <span class="stat-num">
                  {topRated.rating.toFixed(1)} <span class="rating"><IconStar class="rating-star" /></span>
                </span>
                <span class="stat-label">Highest rated</span>
                <span class="stat-sub muted">{topRated.name}</span>
              </div>
            ) : null}
            {avgRating && ratedCredits.length > 1 ? (
              <div class="stat">
                <span class="stat-num">
                  {avgRating} <span class="rating"><IconStar class="rating-star" /></span>
                </span>
                <span class="stat-label">Average rating</span>
                <span class="stat-sub muted">across {ratedCredits.length} titles</span>
              </div>
            ) : null}
          </section>
        ) : null}
        {roles.length ? (
          <section class="credit-sec">
            <h2 class="credit-head">
              Top TV shows <span class="credit-count">{roles.length}</span>
              <a class="more" href={`/tv/featuring/${canonicalSlug}`}>
                best {person.name} shows
              </a>
            </h2>
            <ol class="rank-list">
              {roles.map((r, i) => {
                const g = firstGenre(r.genres);
                const facts = [
                  r.character ? `${r.character}${r.voice ? " (voice)" : ""}` : null,
                  r.episodes ? `${r.episodes} ep${r.episodes === 1 ? "" : "s"}` : null,
                  showYears(r),
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                <li class="rank-row">
                  <span class="rank-num">{i + 1}</span>
                  {(r.poster_url ?? r.image_url) ? (
                    <img class="rank-thumb" src={r.poster_url ?? r.image_url!} alt="" loading="lazy" />
                  ) : (
                    <span class="rank-thumb rank-thumb-empty" aria-hidden="true"></span>
                  )}
                  <span class="rank-main">
                    <a href={`/show/${r.slug}`}>{r.name}</a>
                    <span class="rank-sub muted">
                      {facts}
                      {g ? (
                        <>
                          {facts ? " · " : ""}
                          <a class="rank-genre" href={`/genre/${slugifyName(g)}`}>
                            {g}
                          </a>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {r.rating != null ? (
                    <span class="rank-score">
                      <span class="rating"><IconStar class="rating-star" />{r.rating.toFixed(1)}</span>
                    </span>
                  ) : null}
                </li>
                );
              })}
            </ol>
          </section>
        ) : (
          <p class="muted">No TV roles on record yet — check back soon.</p>
        )}
        {films.length ? (
          <section class="credit-sec">
            <h2 class="credit-head">
              Top movies <span class="credit-count">{films.length}</span>
              <a class="more" href={`/movies/featuring/${canonicalSlug}`}>
                best {person.name} movies
              </a>
            </h2>
            <ol class="rank-list">
              {films.map((m, i) => {
                const g = firstGenre(m.genres);
                const facts = [m.character, m.year ? String(m.year) : null].filter(Boolean).join(" · ");
                return (
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
                      {facts}
                      {g ? (
                        <>
                          {facts ? " · " : ""}
                          <a class="rank-genre" href={`/genre/${slugifyName(g)}`}>
                            {g}
                          </a>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {m.rating != null ? (
                    <span class="rank-score">
                      <span class="rating"><IconStar class="rating-star" />{m.rating.toFixed(1)}</span>
                    </span>
                  ) : null}
                </li>
                );
              })}
            </ol>
          </section>
        ) : null}
        {bestTitle || topGenres.length ? (
          <section class="wo-doors">
            <h2>Keep exploring</h2>
            <div class="explore-grid">
              {bestTitle ? (
                <ExploreCard
                  icon="Highest rated"
                  title={bestTitle.name}
                  desc={`${person.name.split(" ")[0]}'s best-reviewed title — ratings and where to watch.`}
                  href={bestTitle.href}
                  rating={bestTitle.rating}
                />
              ) : null}
              {topGenres[0] ? (
                <ExploreCard
                  icon="Genre"
                  title={`The best of ${topGenres[0]}`}
                  desc={`Top-rated ${topGenres[0].toLowerCase()} shows and films, ranked.`}
                  href={`/genre/${slugifyName(topGenres[0])}`}
                />
              ) : null}
              <ExploreCard
                icon="Directory"
                title="Browse everything"
                desc="Networks, genres, fandom hubs, and every chart in one place."
                href="/lists"
              />
            </div>
          </section>
        ) : null}
      </article>
    </Layout>,
  );
});

export default app;
