import { Context, Hono } from "hono";
import { Child, FC } from "hono/jsx";
import { Layout } from "../components/Layout";
import { ClampSummary, ExploreCard } from "../components/cards";
import { DossierRow } from "../components/dossier";
import { HomeSidebarRail } from "../components/home-sidebar";
import { IconGlobe, IconInstagram, IconStar, IconX } from "../components/icons";
import { KeepGoing, fillKeepGoingBackdrops, loadPersonHubDoorArts, loadShowKeepGoingArts, movieKeepGoingBackdrop, showKeepGoingBackdrop } from "../components/keep-going";
import { SeasonTabs, ShowTabs } from "../components/nav";
import { buildDossier } from "../lib/dossier";
import { genreShowArt, hubArt } from "../lib/explore-art";
import { ageOf, headshot, longDate, posterImg, posterSrc, slugifyName, stripHtml } from "../lib/format";
import { visitorRegion } from "../lib/providers";
import { crewLinkMap, similarShows } from "../lib/queries";
import { breadcrumbLd, breadcrumbTrail, canonical, origin } from "../lib/seo";
import { tmdbPersonProfileImages, tmdbPersonTaggedStills, tmdbTrailer } from "../lib/tmdb";
import { TMDB_PERSON_OFFSET, resolvePersonProfile, resolveShow, tmdbShowCast } from "../lib/tmdb-show";
import { hubForGenres } from "../lib/verticals";
import { HonoEnv, PersonRow, ShowRow } from "../types";

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

const app = new Hono<HonoEnv>();

/** Compact show subpage header: poster beside the title, aligned with the column below. */
const ShowPosterHero: FC<{ show: ShowRow; kicker: string; title: Child }> = ({
  show,
  kicker,
  title,
}) => {
  const p = posterSrc(show);
  return (
    <header class="detail-hero media-hero">
      <div class="detail-head">
        <div class="detail-side">
          {p ? (
            <img class="poster" src={p.src} srcset={p.srcset} alt={`${show.name} poster`} />
          ) : (
            <div class="poster card-fallback">{show.name}</div>
          )}
        </div>
        <div class="detail-info">
          <p class="ep-eyebrow">
            <a href={`/show/${show.slug}`}>{show.name}</a>
            <span class="sep">·</span> {kicker}
          </p>
          <h1>{title}</h1>
        </div>
      </div>
    </header>
  );
};

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
          const h = p.profile_path ? headshot(`https://image.tmdb.org/t/p/w185${p.profile_path}`) : null;
          // a mirrored crew member links to their canonical page; everyone else
          // resolves live via the TMDB person fallback (10M + their TMDB id)
          const pid = links?.get(p.id) ?? (p.id ? TMDB_PERSON_OFFSET + p.id : null);
          const inner = (
            <>
              {h ? (
                <img src={h.src} srcset={h.srcset} alt={p.name} loading="lazy" decoding="async" />
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
  c: Context<HonoEnv>,
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
  const similar = await similarShows(c.env.DB, show, 6);
  const region = visitorRegion(c);
  const keepGoingArts = await loadShowKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    show,
    similar[0]?.tmdb_id,
  );
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
  const sidebar = c.get("siteSidebar");
  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
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
      <article class="show-hub">
        <ShowPosterHero
          show={show}
          kicker={`Season ${season}`}
          title={
            <>
              <a href={`/show/${show.slug}`}>{show.name}</a> — Season {season} cast
            </>
          }
        />
        <SeasonTabs slug={show.slug} season={season} current="cast" latest={latest} />
        <div class="home-main-grid">
          <div class="home-col">
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
      {similar.length ? (
        <section>
          <h2>Shows like {show.name}</h2>
          <p class="dossier-method">
            The closest matches on shared genres, ranked by match strength and popularity.
          </p>
          <ol class="dossier-board">
            {similar.map((s, i) => (
              <DossierRow
                i={i}
                href={`/show/${s.slug}`}
                name={s.name}
                d={buildDossier(show, s, region)}
                rating={s.rating}
                poster={posterSrc(s)}
              />
            ))}
          </ol>
        </section>
      ) : null}
      <KeepGoing
        cards={[
          {
            icon: "Overview",
            title: `${show.name} overview`,
            desc: "Episodes, ratings, cast and the full series dossier.",
            href: `/show/${show.slug}`,
            backdrop: keepGoingArts.overview,
          },
          {
            icon: "Matchup",
            title: `Shows like ${show.name}`,
            desc: "The closest matches, ranked by overlap and rating.",
            href: `/show/${show.slug}/similar`,
            backdrop: keepGoingArts.similar,
          },
          {
            icon: "Charts",
            title: "Ratings graph",
            desc: `Every rated episode of ${show.name} on one chart.`,
            href: `/show/${show.slug}/ratings`,
            backdrop: keepGoingArts.bestEpisodes,
          },
          {
            icon: "Stream",
            title: "Where to watch",
            desc: `Every service carrying ${show.name}, region by region.`,
            href: `/show/${show.slug}/where-to-watch`,
            backdrop: keepGoingArts.watch,
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
      </article>
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
  const similar = await similarShows(c.env.DB, show, 6);
  const region = visitorRegion(c);
  const keepGoingArts = await loadShowKeepGoingArts(
    c.env.DB,
    c.env.TMDB_API_KEY,
    show,
    similar[0]?.tmdb_id,
  );
  const site = origin(c);
  const sidebar = c.get("siteSidebar");

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      c={c}
      sidebarInline
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
      <article class="show-hub">
        <ShowPosterHero
          show={show}
          kicker="Cast"
          title={
            <>
              Cast of <a href={`/show/${show.slug}`}>{show.name}</a>
            </>
          }
        />
        <ShowTabs slug={show.slug} current="cast" />
        <div class="home-main-grid">
          <div class="home-col">
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
      {similar.length ? (
        <section>
          <h2>Shows like {show.name}</h2>
          <p class="dossier-method">
            The closest matches on shared genres, ranked by match strength and popularity.
          </p>
          <ol class="dossier-board">
            {similar.map((s, i) => (
              <DossierRow
                i={i}
                href={`/show/${s.slug}`}
                name={s.name}
                d={buildDossier(show, s, region)}
                rating={s.rating}
                poster={posterSrc(s)}
              />
            ))}
          </ol>
        </section>
      ) : null}
      <KeepGoing
        cards={[
          {
            icon: "Overview",
            title: `${show.name} overview`,
            desc: "Episodes, ratings, cast and the full series dossier.",
            href: `/show/${show.slug}`,
            backdrop: keepGoingArts.overview,
          },
          {
            icon: "Matchup",
            title: `Shows like ${show.name}`,
            desc: "The closest matches, ranked by overlap and rating.",
            href: `/show/${show.slug}/similar`,
            backdrop: keepGoingArts.similar,
          },
          {
            icon: "Charts",
            title: "Ratings graph",
            desc: `Every rated episode of ${show.name} on one chart.`,
            href: `/show/${show.slug}/ratings`,
            backdrop: keepGoingArts.bestEpisodes,
          },
          {
            icon: "Stream",
            title: "Where to watch",
            desc: `Every service carrying ${show.name}, region by region.`,
            href: `/show/${show.slug}/where-to-watch`,
            backdrop: keepGoingArts.watch,
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
      </article>
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

  // "known for" line: real TV roles, else film credits, else a generic fallback —
  // never the empty "known for ." that an actorless/credit-thin person produced.
  const knownFor = roles.length
    ? roles.slice(0, 3).map((r) => r.name)
    : films.slice(0, 3).map((m) => m.title);
  const personDescription = knownFor.length
    ? `${person.name}${age != null && !years ? `, ${age},` : ""} — known for ${knownFor.join(", ")}. Every show, every role, where to stream them.`
    : `${person.name}${age != null && !years ? `, ${age},` : ""} — full filmography, credits and where to stream their work, on TV Nightly.`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    url: `${site}/person/${canonicalSlug}`,
    description: personDescription,
    ...(person.image_url ? { image: person.image_url } : {}),
    ...(person.birthday ? { birthDate: person.birthday } : {}),
    ...(person.deathday ? { deathDate: person.deathday } : {}),
    ...(person.country ? { nationality: person.country } : {}),
    ...(occupation
      ? { jobTitle: occupation, hasOccupation: { "@type": "Occupation", name: occupation } }
      : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(roles.length || films.length
      ? {
          performerIn: [
            ...roles.slice(0, 15).map((r) => ({
              "@type": "TVSeries",
              name: r.name,
              url: `${site}/show/${r.slug}`,
            })),
            ...films.slice(0, 15).map((m) => ({
              "@type": "Movie",
              name: m.title,
              url: `${site}/movie/${m.slug}`,
            })),
          ],
        }
      : {}),
  };

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

  const apiKey = c.env.TMDB_API_KEY;

  type PersonSpot =
    | { kind: "tv"; row: (typeof roles)[number] }
    | { kind: "movie"; row: (typeof films)[number] };

  const rankedCredits: (PersonSpot & { score: number })[] = [
    ...roles.map((r) => ({ kind: "tv" as const, row: r, score: r.weight ?? 0 })),
    ...films.map((m) => ({ kind: "movie" as const, row: m, score: m.popularity ?? 0 })),
  ].sort((a, b) => b.score - a.score);

  let spotlight: PersonSpot | null = rankedCredits[0] ?? null;
  let featureVideo: { key: string; name: string; href: string; title: string } | null = null;
  if (apiKey && rankedCredits.length) {
    const trailerHits = await Promise.all(
      rankedCredits.slice(0, 12).map(async (credit) => {
        const id =
          credit.kind === "tv"
            ? credit.row.tmdb_id
            : credit.row.tmdb_id ?? credit.row.imdb_id;
        if (id == null) return { credit, trailer: null as { key: string; name: string } | null };
        const trailer = await tmdbTrailer(
          apiKey,
          credit.kind === "tv" ? "tv" : "movie",
          id,
        );
        return { credit, trailer };
      }),
    );
    const hit = trailerHits.find((x) => x.trailer);
    if (hit?.trailer) {
      spotlight = hit.credit;
      featureVideo = {
        key: hit.trailer.key,
        name: hit.trailer.name,
        title: hit.credit.kind === "tv" ? hit.credit.row.name : hit.credit.row.title,
        href:
          hit.credit.kind === "tv"
            ? `/show/${hit.credit.row.slug}/media`
            : `/movie/${hit.credit.row.slug}/media`,
      };
    }
  }

  const featureHref = spotlight
    ? spotlight.kind === "tv"
      ? `/show/${spotlight.row.slug}`
      : `/movie/${spotlight.row.slug}`
    : null;
  const featureBackdrop =
    !featureVideo && spotlight
      ? spotlight.kind === "tv"
        ? await showKeepGoingBackdrop(apiKey, spotlight.row)
        : await movieKeepGoingBackdrop(apiKey, spotlight.row)
      : null;

  const highlights: { label: string; thumb: string; view: string }[] = [];
  const personTmdbId =
    person.tmdb_id ?? (person.id >= TMDB_PERSON_OFFSET ? person.id - TMDB_PERSON_OFFSET : null);
  const [profiles, taggedStills] = await Promise.all([
    apiKey && personTmdbId ? tmdbPersonProfileImages(apiKey, personTmdbId) : [],
    apiKey && personTmdbId ? tmdbPersonTaggedStills(apiKey, personTmdbId) : [],
  ]);
  const creditLabels = new Map<string, string>();
  for (const r of roles) {
    if (r.tmdb_id) creditLabels.set(`tv:${r.tmdb_id}`, r.name);
  }
  for (const m of films) {
    if (m.tmdb_id) creditLabels.set(`movie:${m.tmdb_id}`, m.title);
  }
  const highlightCreditLabel = (s: (typeof taggedStills)[number]) =>
    creditLabels.get(`${s.mediaType}:${s.mediaId}`) ?? s.mediaTitle;
  const seenHighlight = new Set<string>();
  const seenImages = new Set<string>();
  for (const p of profiles) {
    if (highlights.length >= 6) break;
    if (seenImages.has(p.filePath)) continue;
    seenImages.add(p.filePath);
    highlights.push({
      label: person.name,
      thumb: `https://image.tmdb.org/t/p/w500${p.filePath}`,
      view: `https://image.tmdb.org/t/p/w1280${p.filePath}`,
    });
  }
  for (const s of taggedStills) {
    if (highlights.length >= 6) break;
    if (seenImages.has(s.filePath)) continue;
    const key = `${s.mediaType}:${s.mediaId}`;
    if (seenHighlight.has(key)) continue;
    seenHighlight.add(key);
    seenImages.add(s.filePath);
    highlights.push({
      label: `${person.name} in ${highlightCreditLabel(s)}`,
      thumb: `https://image.tmdb.org/t/p/w780${s.filePath}`,
      view: `https://image.tmdb.org/t/p/w1280${s.filePath}`,
    });
  }

  const occBadge = occupation
    ? occupation.toUpperCase()
    : person.known_dept
      ? person.known_dept.toUpperCase()
      : "CELEBRITY";
  const birthPlace = person.birthplace || person.country;

  const spotlightMediaHref = spotlight
    ? spotlight.kind === "tv"
      ? `/show/${spotlight.row.slug}/media`
      : `/movie/${spotlight.row.slug}/media`
    : null;

  const exploreHub = topGenres[0] ? hubForGenres([topGenres[0]], null) : null;
  const [bestTitleArt, genreArt, directoryArt] = await Promise.all([
    bestShow && bestTitle?.href === `/show/${bestShow.slug}`
      ? showKeepGoingBackdrop(apiKey, bestShow)
      : bestMovie && bestTitle?.href === `/movie/${bestMovie.slug}`
        ? movieKeepGoingBackdrop(apiKey, bestMovie)
        : Promise.resolve(null),
    topGenres[0] && apiKey ? genreShowArt(c.env.DB, apiKey, topGenres[0]) : Promise.resolve(null),
    exploreHub?.slug && apiKey ? hubArt(c.env.DB, apiKey, exploreHub.slug) : Promise.resolve(null),
  ]);
  const personDoors = fillKeepGoingBackdrops([
    ...(bestTitle
      ? [
          {
            icon: "Highest rated",
            title: bestTitle.name,
            desc: `${person.name.split(" ")[0]}'s best-reviewed title — ratings and where to watch.`,
            href: bestTitle.href,
            backdrop: bestTitleArt,
          },
        ]
      : []),
    ...(topGenres[0]
      ? [
          {
            icon: "Genre",
            title: `The best of ${topGenres[0]}`,
            desc: `Top-rated ${topGenres[0].toLowerCase()} shows and films, ranked.`,
            href: `/genre/${slugifyName(topGenres[0])}`,
            backdrop: genreArt,
          },
        ]
      : []),
    {
      icon: "Directory",
      title: "Browse everything",
      desc: "Networks, genres, fandom hubs, and every chart in one place.",
      href: "/lists",
      backdrop: directoryArt,
    },
  ]);

  const sidebar = c.get("siteSidebar");

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      sidebarInline
      title={`${person.name} — TV shows, age & roles | TV Nightly`}
      description={personDescription}
      canonical={canonical(c)}
      ogImage={person.image_url ?? undefined}
      ld={[ld, breadcrumbTrail(personCrumbs)]}
      scripts={["/js/media-lightbox.js"]}
    >
      <article class="show-hub">
        <header class="hub-hero person-hero" aria-label={`${person.name} profile`}>
          <div class="hub-hero-inner">
            <div class="hub-hero-head">
              <h1 class="hub-hero-title">{person.name}</h1>
            </div>
            <div class="hub-hero-intro">
              <div class="hub-hero-chips">
                <span class="hub-hero-badge">{occBadge}</span>
              </div>
            </div>

            <div class="hub-hero-stage">
              <div class="hub-hero-poster">
                {(() => {
                  const h = headshot(person.image_url, true);
                  return h ? (
                    <img class="poster" src={h.src} srcset={h.srcset} alt={person.name} />
                  ) : (
                    <div class="poster card-fallback">{person.name}</div>
                  );
                })()}
              </div>
              <div class="hub-hero-player" data-hero-pip>
                {featureVideo ? (
                  <div class="hub-hero-video">
                    <iframe
                      class="hub-hero-video-frame"
                      src={`https://www.youtube-nocookie.com/embed/${featureVideo.key}?autoplay=1&mute=1&loop=1&playlist=${featureVideo.key}&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`}
                      title={`${person.name} — ${featureVideo.name}`}
                      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                      loading="eager"
                      referrerpolicy="strict-origin-when-cross-origin"
                      allowfullscreen
                    ></iframe>
                  </div>
                ) : featureBackdrop && featureHref ? (
                  <a class="hub-hero-video hub-hero-video-backdrop" href={featureHref}>
                    <img
                      src={featureBackdrop.x1}
                      {...(featureBackdrop.x2
                        ? { srcset: `${featureBackdrop.x1} 1x, ${featureBackdrop.x2} 2x` }
                        : {})}
                      alt=""
                      loading="eager"
                      decoding="async"
                    />
                  </a>
                ) : (
                  <a
                    class="hub-hero-video hub-hero-video-empty"
                    href={spotlightMediaHref ?? "#"}
                  >
                    <span class="hub-hero-video-fallback">Trailers &amp; clips</span>
                  </a>
                )}
              </div>
              <aside class="hub-hero-credits hub-hero-credits-person" aria-label="Biography">
                <div class="hub-hero-credits-body">
                  {person.birthday ? (
                    <div class="hub-credit-block">
                      <h3>Birthday</h3>
                      <p>{longDate(person.birthday)}</p>
                    </div>
                  ) : null}
                  {birthPlace ? (
                    <div class="hub-credit-block">
                      <h3>From</h3>
                      <p>{birthPlace}</p>
                    </div>
                  ) : null}
                  {roles.length || films.length ? (
                    <>
                      {yearsActive ? (
                        <div class="hub-credit-block hub-person-stat">
                          <h3>Years active</h3>
                          <p class="hub-person-stat-val">{yearsActive}</p>
                          <p class="hub-person-stat-sub muted">first to latest</p>
                        </div>
                      ) : null}
                      {topRated ? (
                        <div class="hub-credit-block hub-person-stat">
                          <h3>Highest rated</h3>
                          <p class="hub-person-stat-val">
                            {topRated.rating.toFixed(1)}{" "}
                            <span class="rating">
                              <IconStar class="rating-star" />
                            </span>
                          </p>
                          <p class="hub-person-stat-sub muted">{topRated.name}</p>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
                {socials.ig || socials.tw || person.homepage ? (
                  <div class="hub-hero-credits-foot">
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
                  </div>
                ) : null}
              </aside>
            </div>

            {highlights.length ? (
              <section class="hub-hero-highlights person-highlights" aria-label={`${person.name} highlights`}>
                <h2 class="hub-hero-section-label">
                  {person.name} <span>highlights</span>
                </h2>
                <div
                  class="hub-hero-vidrow person-highlight-gallery"
                  data-gallery-title={person.name}
                  data-gallery-kind="Photo"
                >
                  {highlights.map((h, i) => (
                    <a
                      class="hub-hero-vid media-art"
                      href={h.view}
                      data-gallery="person-highlights"
                      data-view={h.view}
                      data-alt={`${h.label} — photo ${i + 1} of ${highlights.length}`}
                      aria-label={h.label}
                      title={h.label}
                    >
                      <span class="hub-hero-vid-thumb">
                        <img
                          src={h.thumb}
                          alt=""
                          width="160"
                          height="240"
                          loading="lazy"
                          decoding="async"
                        />
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </header>
        <div class="home-main-grid">
          <div class="home-col">
        {person.bio || topGenres.length || (roles.length && !person.bio) ? (
          <section class="person-intro">
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
          </section>
        ) : null}
        {roles.length ? (
          <section class="credit-sec">
            <h2 class="credit-head">
              {person.name}'s top TV shows <span class="credit-count">{roles.length}</span>
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
                    <img
                      class="rank-thumb"
                      {...posterImg(r.poster_url ?? r.image_url, "thumb")!}
                      alt={`${r.name} poster`}
                      loading="lazy"
                      decoding="async"
                    />
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
              {person.name}'s top movies <span class="credit-count">{films.length}</span>
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
                    <img
                      class="rank-thumb"
                      {...posterImg(m.poster_url, "thumb")!}
                      alt={`${m.title} poster`}
                      loading="lazy"
                      decoding="async"
                    />
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
        {personDoors.length ? (
          <section class="wo-doors">
            <h2>Keep exploring</h2>
            <div class="explore-grid">
              {personDoors.map((card) => (
                <ExploreCard
                  icon={card.icon}
                  title={card.title}
                  desc={card.desc}
                  href={card.href}
                  backdrop={card.backdrop ?? undefined}
                  {...(bestTitle && card.href === bestTitle.href
                    ? { rating: bestTitle.rating }
                    : {})}
                />
              ))}
            </div>
          </section>
        ) : null}
          </div>
          <HomeSidebarRail
            trailers={sidebar?.trailers ?? []}
            topSeries={sidebar?.topSeries ?? []}
            topMovies={sidebar?.topMovies ?? []}
          />
        </div>
      </article>
    </Layout>,
  );
});

type PersonHubRow = PersonRow & {
  credit_count: number;
  peak_weight: number;
  // directors can surface via a film cameo or a TV credit — this drives the
  // "N films" vs "N shows" label per row
  credit_kind?: "film" | "show";
};

async function personHubPage(
  c: Context<HonoEnv>,
  dept: "Acting" | "Directing",
) {
  const isActor = dept === "Acting";
  const { results } = isActor
    ? await c.env.DB
        .prepare(
          `SELECT p.*, COUNT(DISTINCT cr.show_id) AS credit_count, MAX(s.weight) AS peak_weight
           FROM people p
           JOIN credits cr ON cr.person_id = p.id AND cr.guest = 0
           JOIN shows s ON s.id = cr.show_id AND s.weight >= 45
           WHERE p.known_dept = 'Acting'
              OR (p.known_dept IS NULL AND cr.character IS NOT NULL AND cr.character != '')
           GROUP BY p.id
           ORDER BY peak_weight DESC, credit_count DESC, p.name
           LIMIT 120`,
        )
        .all<PersonHubRow>()
    : await c.env.DB
        .prepare(
          // Directors are tagged via known_dept; they surface either through a
          // film cameo (movie_credits) OR a TV credit. Counting both — and
          // labelling each row films/shows accordingly — widens the hub well
          // beyond the handful who happen to have acted in a mirrored film.
          `SELECT *,
             CASE WHEN film_count > 0 THEN film_count ELSE tv_count END AS credit_count,
             CASE WHEN film_count > 0 THEN 'film' ELSE 'show' END AS credit_kind,
             CASE WHEN film_count > 0 THEN peak_film ELSE peak_tv END AS peak_weight
           FROM (
             SELECT p.*,
               (SELECT COUNT(DISTINCT mc.movie_id) FROM movie_credits mc WHERE mc.person_id = p.id) AS film_count,
               (SELECT COUNT(DISTINCT cr.show_id) FROM credits cr JOIN shows s ON s.id = cr.show_id AND s.weight >= 45 WHERE cr.person_id = p.id) AS tv_count,
               (SELECT MAX(m.popularity) FROM movie_credits mc JOIN movies m ON m.imdb_id = mc.movie_id WHERE mc.person_id = p.id) AS peak_film,
               (SELECT MAX(s.weight) FROM credits cr JOIN shows s ON s.id = cr.show_id WHERE cr.person_id = p.id) AS peak_tv
             FROM people p
             WHERE p.known_dept = 'Directing'
           )
           WHERE film_count > 0 OR tv_count > 0
           ORDER BY (film_count > 0) DESC, credit_count DESC, peak_weight DESC, name
           LIMIT 60`,
        )
        .all<PersonHubRow>();

  const site = origin(c);
  const path = isActor ? "/actors" : "/directors";
  const title = isActor ? "Actors" : "Directors";
  const [crossArt, chartsArt, browseArt] = await loadPersonHubDoorArts(c.env.DB, c.env.TMDB_API_KEY, dept);

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout c={c}
      title={`${title} — TV & film credits, ranked by catalogue weight | TV Nightly`}
      description={
        isActor
          ? "Browse actors we track — ranked by the popularity of their shows, with links to every credit and episode guide."
          : "Browse directors we track — ranked by the titles in our catalogue, with links to every credit."
      }
      canonical={`${site}${path}`}
      ld={[
        breadcrumbTrail([
          { name: "TV Nightly", url: site },
          { name: title, url: `${site}${path}` },
        ]),
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: title,
          itemListElement: results.slice(0, 25).map((p, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: p.name,
            url: `${site}/person/${slugifyName(p.name)}-${p.id}`,
          })),
        },
      ]}
    >
      <header class="chart-head">
        <p class="section-eyebrow">{isActor ? "Cast & credits" : "Filmography"}</p>
        <h1 class="chart-h1">{title}</h1>
        <p class="section-lead">
          {isActor
            ? "The actors behind the shows we track — ranked by the weight of their series, not tabloid fame."
            : "The directors behind the titles we track — ranked by catalogue prominence."}
        </p>
      </header>

      {!results.length ? (
        <p class="muted">Credits are still loading — check back soon.</p>
      ) : (
        <div class="cast-grid person-hub-grid">
          {results.map((p) => {
            const href = `/person/${slugifyName(p.name)}-${p.id}`;
            const h = headshot(p.image_url);
            return (
              <a class="cast-tile" href={href}>
                {h ? (
                  <img src={h.src} srcset={h.srcset} alt={p.name} loading="lazy" />
                ) : (
                  <div class="cast-fallback">{p.name.slice(0, 1)}</div>
                )}
                <div class="cast-tile-body">
                  <strong>{p.name}</strong>
                  <span class="cast-char">
                    {p.credit_count} {isActor ? "show" : p.credit_kind ?? "film"}
                    {p.credit_count === 1 ? "" : "s"}
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      )}

      <section class="wo-doors">
        <h2>Keep exploring</h2>
        <div class="explore-grid">
          <ExploreCard
            icon="Directory"
            title={isActor ? "Directors" : "Actors"}
            desc={isActor ? "Film directors in our catalogue." : "TV actors in our catalogue."}
            href={isActor ? "/directors" : "/actors"}
            backdrop={crossArt ?? undefined}
          />
          <ExploreCard
            icon="Charts"
            title="Top TV shows"
            desc="The highest-rated series we track."
            href="/top/tv"
            backdrop={chartsArt ?? undefined}
          />
          <ExploreCard
            icon="Shortcut"
            title="Browse everything"
            desc="Charts, genres, and networks."
            href="/lists"
            backdrop={browseArt ?? undefined}
          />
        </div>
      </section>
    </Layout>,
  );
}

app.get("/actors", (c) => personHubPage(c, "Acting"));
app.get("/directors", (c) => personHubPage(c, "Directing"));

export default app;
