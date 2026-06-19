// Hybrid catalog: build a full ShowRow + episode list from live TMDB so a title
// that isn't in the D1 mirror renders the *exact same* show page (episode guide,
// cast, providers, ratings) — not a lighter fallback. Two edge-cached calls.
import type { Context } from "hono";
import { Bindings, EpisodeRow, MovieRow, PersonRow, ShowRow } from "../types";
import { getShow } from "./queries";
import { tmdbSearch, liveRating } from "./tmdb";
import { slugifyName } from "./format";
import { REGIONS } from "./providers";

// TMDB-sourced people are addressed at this offset above their TMDB id (the same
// namespace the guest/movie-cast backfills use), so a /person/<slug>-<id> link
// round-trips to TMDB when the person isn't mirrored.
export const TMDB_PERSON_OFFSET = 10_000_000;

const IMG = (p: string | null | undefined, size: string) =>
  p ? `https://image.tmdb.org/t/p/${size}${p}` : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cachedJson(url: string, tag: string): Promise<any | null> {
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/${tag}`);
  const cache = caches.default;
  try {
    let res = await cache.match(cacheKey);
    if (!res) {
      const live = await fetch(url, { headers: { accept: "application/json" } });
      if (!live.ok) return null;
      res = new Response(live.body, live);
      res.headers.set("Cache-Control", "public, max-age=86400");
      await cache.put(cacheKey, res.clone());
    }
    return await res.json();
  } catch {
    return null;
  }
}

const STATUS: Record<string, string> = {
  "Returning Series": "Running",
  Ended: "Ended",
  Canceled: "Ended",
  "In Production": "Running",
  Planned: "To Be Determined",
};

/** Resolve a /show/:slug miss to a TMDB title and build it into our row shapes. */
export async function tmdbShowData(
  c: Context<{ Bindings: Bindings }>,
  slug: string,
): Promise<{ show: ShowRow; episodes: EpisodeRow[]; tmdbId: number } | null> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return null;

  const hint = Number(c.req.query("t"));
  let tmdbId = Number.isFinite(hint) && hint > 0 ? hint : null;
  if (!tmdbId) {
    const hits = (await tmdbSearch(key, slug.replace(/-/g, " "))).filter((h) => h.kind === "tv");
    tmdbId = (hits.find((h) => slugifyName(h.name) === slug) ?? hits[0])?.tmdbId ?? null;
  }
  if (!tmdbId) return null;
  return buildTmdbShow(c, tmdbId, slug);
}

// Materialized live shows live in the `shows` table above the TVmaze id range so
// their synthetic id can never collide with a mirrored row.
export const TMDB_SHOW_OFFSET = 20_000_000;

/** Build a full ShowRow + episodes from a known TMDB tv id. `slug` overrides the
 *  derived slug (used so a /show/:slug URL keeps its slug). */
export async function buildTmdbShow(
  c: Context<{ Bindings: Bindings }>,
  tmdbId: number,
  slug?: string,
): Promise<{ show: ShowRow; episodes: EpisodeRow[]; tmdbId: number } | null> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return null;

  const base = await cachedJson(
    `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&append_to_response=credits,external_ids,watch/providers`,
    `show/v1/${tmdbId}`,
  );
  if (!base || !base.name) return null;

  const nSeasons = Math.min(base.number_of_seasons ?? 0, 20);
  const seasonNums = Array.from({ length: nSeasons }, (_, i) => i + 1);
  const seasonsData = seasonNums.length
    ? await cachedJson(
        `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&append_to_response=${seasonNums
          .map((n) => `season/${n}`)
          .join(",")}`,
        `show/v1/${tmdbId}/seasons`,
      )
    : null;

  const episodes: EpisodeRow[] = [];
  for (const n of seasonNums) {
    const season = seasonsData?.[`season/${n}`];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const e of (season?.episodes ?? []) as any[]) {
      episodes.push({
        id: tmdbId * 100000 + n * 1000 + (e.episode_number ?? 0),
        show_id: tmdbId,
        season: e.season_number ?? n,
        number: e.episode_number ?? null,
        name: e.name ?? null,
        airdate: e.air_date ?? null,
        airstamp: e.air_date ? `${e.air_date}T00:00:00Z` : null,
        runtime: e.runtime ?? null,
        rating: typeof e.vote_average === "number" && e.vote_average > 0 ? e.vote_average : null,
        image_url: IMG(e.still_path, "w300"),
        summary: e.overview || null,
      });
    }
  }
  episodes.sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.number ?? 0) - (b.number ?? 0));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cast = ((base.credits?.cast ?? []) as any[]).slice(0, 30).map((p) => ({
    id: TMDB_PERSON_OFFSET + p.id, // person pages key TMDB people at 10M + their id
    n: p.name,
    c: p.character ?? null,
    img: IMG(p.profile_path, "w185"),
  }));

  const wp = base["watch/providers"]?.results ?? {};
  const intl: Record<string, string[]> = {};
  for (const cc of REGIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = ((wp[cc]?.flatrate ?? []) as any[]).map((p) => p.provider_name);
    if (names.length) intl[cc] = names;
  }

  const ended = base.status === "Ended" || base.status === "Canceled";
  const show = {
    id: tmdbId,
    slug: slug ?? slugifyName(base.name),
    name: base.name,
    status: STATUS[base.status] ?? base.status ?? null,
    premiered: base.first_air_date || null,
    ended: ended ? base.last_air_date || null : null,
    network: base.networks?.[0]?.name ?? null,
    web_channel: null,
    rating: liveRating(base.vote_average, base.vote_count),
    weight: 0,
    image_url: null,
    poster_url: IMG(base.poster_path, "w342"),
    summary: base.overview || null,
    imdb_id: base.external_ids?.imdb_id ?? null,
    blurb: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    genres: base.genres?.length ? JSON.stringify((base.genres as any[]).map((g) => g.name)) : null,
    runtime: base.episode_run_time?.[0] ?? null,
    cast_json: cast.length ? JSON.stringify(cast) : null,
    providers_intl: Object.keys(intl).length ? JSON.stringify(intl) : null,
    tmdb_id: tmdbId,
    type: "Scripted",
  } as unknown as ShowRow;

  return { show, episodes, tmdbId };
}

/** Series-regular cast for a MIRRORED show whose cast_json is empty — the bulk
 *  TVmaze seed carries no cast until the hourly sync or the cast backfill fills
 *  it, so without this a freshly-seeded show renders no Cast section. Fetched
 *  live from TMDB (edge-cached) in the SAME {id, n, c, img} shape as cast_json,
 *  carrying a person id (TMDB people live at 10M + their id) so the cards link. */
export async function tmdbShowCast(
  key: string,
  tmdbId: number,
  limit = 30,
): Promise<{ id: number; n: string; c: string | null; img: string | null }[]> {
  const data = await cachedJson(
    `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&append_to_response=credits`,
    `tvcast/v1/${tmdbId}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data?.credits?.cast ?? []) as any[]).slice(0, limit).map((p) => ({
    id: TMDB_PERSON_OFFSET + p.id,
    n: p.name,
    c: p.character ?? null,
    img: IMG(p.profile_path, "w185"),
  }));
}

/** Save a live TMDB show (+ episodes) into D1 the first time someone engages with
 *  it (subscribe, vote). Returns the D1 show id. Idempotent: if already mirrored
 *  (by tmdb_id or slug) it just returns the existing id. This is the founder's
 *  "only save the show when someone acts on it" rule for the write paths. */
export async function materializeShow(
  c: Context<{ Bindings: Bindings }>,
  tmdbId: number,
): Promise<number | null> {
  const db = c.env.DB;
  const existing = await db
    .prepare("SELECT id FROM shows WHERE tmdb_id = ?")
    .bind(tmdbId)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const built = await buildTmdbShow(c, tmdbId);
  if (!built) return null;
  const s = built.show;
  const id = TMDB_SHOW_OFFSET + tmdbId;
  try {
    await db
      .prepare(
        `INSERT INTO shows (id, slug, name, status, premiered, ended, network, web_channel, rating,
            weight, image_url, summary, imdb_id, updated_at, blurb, genres, runtime, providers_intl,
            tmdb_id, cast_json, poster_url, type)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        id, s.slug, s.name, s.status, s.premiered, s.ended, s.network, s.web_channel, s.rating,
        s.weight ?? 0, s.image_url, s.summary, s.imdb_id, s.blurb, s.genres, s.runtime,
        s.providers_intl, tmdbId, s.cast_json, s.poster_url, s.type,
      )
      .run();
  } catch {
    // slug already taken by a different mirrored title — reuse that row
    const bySlug = await db
      .prepare("SELECT id FROM shows WHERE slug = ?")
      .bind(s.slug)
      .first<{ id: number }>();
    return bySlug?.id ?? null;
  }

  if (built.episodes.length) {
    const ins = db.prepare(
      `INSERT INTO episodes (show_id, season, number, name, airdate, airstamp, runtime, rating, image_url, summary)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    await db.batch(
      built.episodes.map((e) =>
        ins.bind(id, e.season, e.number, e.name, e.airdate, e.airstamp, e.runtime, e.rating, e.image_url, e.summary),
      ),
    );
  }
  return id;
}

/** A rich ShowRow for the homepage hero from a single /tv/{id} call (genres,
 *  status, network, providers) — no seasons/episodes, since the marquee never
 *  needs them. Lets the hero spotlight the week's true #1 trending title even
 *  when it isn't in our D1 mirror. */
export async function tmdbHeroShow(key: string, tmdbId: number): Promise<ShowRow | null> {
  const base = await cachedJson(
    `https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}&append_to_response=external_ids,watch/providers`,
    `hero/v1/${tmdbId}`,
  );
  if (!base || !base.name) return null;

  const wp = base["watch/providers"]?.results ?? {};
  const intl: Record<string, string[]> = {};
  for (const cc of REGIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = ((wp[cc]?.flatrate ?? []) as any[]).map((p) => p.provider_name);
    if (names.length) intl[cc] = names;
  }
  const ended = base.status === "Ended" || base.status === "Canceled";
  return {
    id: tmdbId,
    slug: slugifyName(base.name),
    name: base.name,
    status: STATUS[base.status] ?? base.status ?? null,
    premiered: base.first_air_date || null,
    ended: ended ? base.last_air_date || null : null,
    network: base.networks?.[0]?.name ?? null,
    web_channel: null,
    rating: liveRating(base.vote_average, base.vote_count),
    weight: 0,
    image_url: null,
    poster_url: IMG(base.poster_path, "w342"),
    summary: base.overview || null,
    imdb_id: base.external_ids?.imdb_id ?? null,
    blurb: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    genres: base.genres?.length ? JSON.stringify((base.genres as any[]).map((g) => g.name)) : null,
    runtime: base.episode_run_time?.[0] ?? null,
    cast_json: null,
    providers_intl: Object.keys(intl).length ? JSON.stringify(intl) : null,
    tmdb_id: tmdbId,
    type: "Scripted",
  } as unknown as ShowRow;
}

/** Resolve a /movie/:slug miss to a TMDB film and build it into our MovieRow. */
export async function tmdbMovieData(
  c: Context<{ Bindings: Bindings }>,
  slug: string,
): Promise<{ movie: MovieRow; tmdbId: number } | null> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return null;

  const hint = Number(c.req.query("t"));
  let tmdbId = Number.isFinite(hint) && hint > 0 ? hint : null;
  if (!tmdbId) {
    const hits = (await tmdbSearch(key, slug.replace(/-/g, " "))).filter((h) => h.kind === "movie");
    tmdbId = (hits.find((h) => slugifyName(h.name) === slug) ?? hits[0])?.tmdbId ?? null;
  }
  if (!tmdbId) return null;

  const base = await cachedJson(
    `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${key}&append_to_response=external_ids,watch/providers`,
    `movie/v1/${tmdbId}`,
  );
  if (!base || !base.title) return null;

  const wp = base["watch/providers"]?.results ?? {};
  const intl: Record<string, string[]> = {};
  for (const cc of REGIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const names = ((wp[cc]?.flatrate ?? []) as any[]).map((p) => p.provider_name);
    if (names.length) intl[cc] = names;
  }

  const movie = {
    imdb_id: base.imdb_id || base.external_ids?.imdb_id || `tmdb-${tmdbId}`,
    slug,
    title: base.title,
    year: base.release_date ? Number(base.release_date.slice(0, 4)) : null,
    release_date: base.release_date || null,
    overview: base.overview || null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    genres: base.genres?.length ? JSON.stringify((base.genres as any[]).map((g) => g.name)) : null,
    runtime: base.runtime ?? null,
    rating: liveRating(base.vote_average, base.vote_count),
    votes: base.vote_count ?? null,
    popularity: base.popularity ?? null,
    poster_url: IMG(base.poster_path, "w342"),
    tmdb_id: tmdbId,
    providers: intl.US ? JSON.stringify(intl.US) : null,
    providers_intl: Object.keys(intl).length ? JSON.stringify(intl) : null,
  } as unknown as MovieRow;

  return { movie, tmdbId };
}

// Shared resolvers used by EVERY /show/:slug* and /movie/:slug* route, so all of
// them render the same whether the title is in D1 or built live from TMDB.
export async function resolveShow(
  c: Context<{ Bindings: Bindings }>,
  slug: string,
): Promise<{ show: ShowRow; episodes: EpisodeRow[]; ratingRef: string; isTmdb: boolean } | null> {
  const d1 = await getShow(c.env.DB, slug);
  if (d1) {
    const episodes = (
      await c.env.DB.prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, number")
        .bind(d1.id)
        .all<EpisodeRow>()
    ).results;
    return { show: d1, episodes, ratingRef: String(d1.id), isTmdb: false };
  }
  const built = await tmdbShowData(c, slug);
  return built
    ? { show: built.show, episodes: built.episodes, ratingRef: `t${built.tmdbId}`, isTmdb: true }
    : null;
}

export async function resolveMovie(
  c: Context<{ Bindings: Bindings }>,
  slug: string,
): Promise<{ movie: MovieRow; ratingRef: string; isTmdb: boolean } | null> {
  const d1 = await c.env.DB.prepare("SELECT * FROM movies WHERE slug = ?").bind(slug).first<MovieRow>();
  if (d1) return { movie: d1, ratingRef: d1.imdb_id, isTmdb: false };
  const built = await tmdbMovieData(c, slug);
  return built ? { movie: built.movie, ratingRef: `t${built.tmdbId}`, isTmdb: true } : null;
}

export type PersonRoles = (ShowRow & { character: string | null; voice: number; episodes: number | null })[];
export type PersonFilms = (MovieRow & { character: string | null })[];

/** Build a person page (bio + TV roles + films) live from TMDB. tmdbPersonId is
 *  the person's TMDB id (a /person/<slug>-<10M+id> link decodes back to it). */
export async function tmdbPersonData(
  c: Context<{ Bindings: Bindings }>,
  tmdbPersonId: number,
): Promise<{ person: PersonRow; roles: PersonRoles; films: PersonFilms } | null> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return null;
  const data = await cachedJson(
    `https://api.themoviedb.org/3/person/${tmdbPersonId}?api_key=${key}&append_to_response=combined_credits,external_ids`,
    `person/v1/${tmdbPersonId}`,
  );
  if (!data || !data.name) return null;

  const ig = data.external_ids?.instagram_id || null;
  const tw = data.external_ids?.twitter_id || null;
  const person = {
    id: TMDB_PERSON_OFFSET + tmdbPersonId,
    name: data.name,
    birthday: data.birthday ?? null,
    deathday: data.deathday ?? null,
    country: null,
    image_url: IMG(data.profile_path, "w342"),
    bio: data.biography || null,
    birthplace: data.place_of_birth ?? null,
    known_dept: data.known_for_department ?? null,
    tmdb_id: tmdbPersonId,
    imdb_id: data.external_ids?.imdb_id ?? data.imdb_id ?? null,
    homepage: data.homepage || null,
    socials: ig || tw ? JSON.stringify({ ...(ig ? { ig } : {}), ...(tw ? { tw } : {}) }) : null,
  } as unknown as PersonRow;

  const { roles, films } = buildPersonCredits(data.combined_credits?.cast ?? [], 40, 30);
  return { person, roles, films };
}

/** A person's FULL profile — D1 community data where mirrored, enriched with the
 *  rest of their TMDB filmography (or built entirely live for an unmirrored
 *  person at id ≥ TMDB_PERSON_OFFSET). The single source of truth for the person
 *  page AND the /tv|/movies featuring pages, so all three show the same credits
 *  (the D1 credits table only mirrors a slice of the catalogue — querying it
 *  alone makes a real actor look like they did 1–2 titles). Returns null when no
 *  such person resolves anywhere. */
export async function resolvePersonProfile(
  c: Context<{ Bindings: Bindings }>,
  pid: number,
): Promise<{ person: PersonRow; roles: PersonRoles; films: PersonFilms } | null> {
  let person = await c.env.DB.prepare("SELECT * FROM people WHERE id = ?").bind(pid).first<PersonRow>();
  let roles: PersonRoles;
  let films: PersonFilms;
  if (person) {
    const [r, f] = await Promise.all([
      c.env.DB.prepare(
        `SELECT cr.character, cr.voice, cr.episodes, s.*
         FROM credits cr JOIN shows s ON s.id = cr.show_id
         WHERE cr.person_id = ?
         ORDER BY s.rating IS NULL, s.rating DESC, cr.episodes DESC LIMIT 50`,
      )
        .bind(person.id)
        .all<ShowRow & { character: string | null; voice: number; episodes: number | null }>(),
      c.env.DB.prepare(
        `SELECT mc.character, m.* FROM movie_credits mc JOIN movies m ON m.imdb_id = mc.movie_id
         WHERE mc.person_id = ?
         ORDER BY m.rating IS NULL, m.rating DESC, m.popularity DESC LIMIT 50`,
      )
        .bind(person.id)
        .all<MovieRow & { character: string | null }>(),
    ]);
    roles = r.results as PersonRoles;
    films = f.results as PersonFilms;
    // Fill out the rest of their real filmography from TMDB, keeping D1 rows
    // (canonical slug + community data) wherever a title is already mirrored.
    // People are TVmaze-seeded with no tmdb_id, so resolve by name, verified
    // against titles we already know — match on normalized title, not the D1
    // slug (a mirrored slug can carry a disambiguation suffix TMDB won't have).
    const knownSlugs = new Set<string>([
      ...roles.map((x) => slugifyName(x.name)),
      ...films.map((x) => slugifyName(x.title)),
    ]);
    const extra = person.tmdb_id
      ? await tmdbPersonData(c, person.tmdb_id)
      : await tmdbPersonByName(c, person.name, knownSlugs);
    if (extra) {
      // overlay TMDB bio/profile onto the D1 person wherever we hold nothing
      const t = extra.person;
      person = {
        ...person,
        bio: person.bio ?? t.bio,
        birthday: person.birthday ?? t.birthday,
        deathday: person.deathday ?? t.deathday,
        birthplace: person.birthplace ?? t.birthplace,
        country: person.country ?? t.country,
        image_url: person.image_url ?? t.image_url,
        known_dept: person.known_dept ?? t.known_dept,
        tmdb_id: person.tmdb_id ?? t.tmdb_id,
        imdb_id: person.imdb_id ?? t.imdb_id,
        socials: person.socials ?? t.socials,
        homepage: person.homepage ?? t.homepage,
      };
      const haveShow = new Set<string>();
      for (const x of roles) {
        if (x.tmdb_id != null) haveShow.add(`t${x.tmdb_id}`);
        haveShow.add(`s${x.slug}`);
      }
      const haveFilm = new Set<string>();
      for (const x of films) {
        if (x.tmdb_id != null) haveFilm.add(`t${x.tmdb_id}`);
        haveFilm.add(`s${x.slug}`);
      }
      const byRating = (a: { rating: number | null }, b: { rating: number | null }) =>
        (b.rating ?? -1) - (a.rating ?? -1);
      const extraRoles = extra.roles
        .filter((x) => !haveShow.has(`t${x.tmdb_id}`) && !haveShow.has(`s${x.slug}`))
        .sort((a, b) => byRating(a, b) || (b.episodes ?? 0) - (a.episodes ?? 0));
      roles = [...roles, ...extraRoles.slice(0, Math.max(0, 40 - roles.length))].sort(
        (a, b) => byRating(a, b) || (b.episodes ?? 0) - (a.episodes ?? 0),
      ) as PersonRoles;
      const extraFilms = extra.films
        .filter((x) => !haveFilm.has(`t${x.tmdb_id}`) && !haveFilm.has(`s${x.slug}`))
        .sort((a, b) => byRating(a, b) || (b.popularity ?? 0) - (a.popularity ?? 0));
      films = [...films, ...extraFilms.slice(0, Math.max(0, 30 - films.length))].sort(
        (a, b) => byRating(a, b) || (b.popularity ?? 0) - (a.popularity ?? 0),
      ) as PersonFilms;
    }
  } else if (pid >= TMDB_PERSON_OFFSET) {
    // hybrid: build the SAME profile live from TMDB when not mirrored
    const built = await tmdbPersonData(c, pid - TMDB_PERSON_OFFSET);
    if (!built) return null;
    person = built.person;
    roles = built.roles;
    films = built.films;
  } else {
    return null;
  }
  return { person, roles, films };
}

// Build TV roles + films from a TMDB combined_credits cast array. Shared by the
// live person page and the D1-person enrichment, so a mirrored person still
// shows their FULL filmography — not just the handful of titles in our mirror.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPersonCredits(
  credits: any[],
  tvLimit: number,
  movieLimit: number,
): { roles: PersonRoles; films: PersonFilms } {
  // "self" appearances — talk shows (10767), news (10763), reality (10764), and
  // making-of / behind-the-scenes documentaries where the actor plays themselves
  // — are promo-tour noise, not roles. Keep them out of the filmography on BOTH
  // sides: a "Self" documentary was ranking #1 on actors' movie lists (thin-vote
  // 10.0s), and the genre ids only ever match TV so the character regex is what
  // catches the film case.
  const SELF = /\b(self|himself|herself|themselves)\b/i;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isSelfAppearance = (cr: any) =>
    SELF.test(cr.character ?? "") ||
    (cr.genre_ids ?? []).some((g: number) => g === 10767 || g === 10763 || g === 10764);

  const seen = new Set<string>();
  const dedupTop = (mt: string, n: number) =>
    credits
      .filter((cr) => cr.media_type === mt && !isSelfAppearance(cr))
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
      .filter((cr) => {
        const k = mt + cr.id;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, n);

  const roles = dedupTop("tv", tvLimit).map((cr) => ({
    id: cr.id,
    slug: slugifyName(cr.name),
    name: cr.name,
    status: null,
    premiered: cr.first_air_date || null,
    ended: null,
    network: null,
    web_channel: null,
    rating: cr.vote_average > 0 ? cr.vote_average : null,
    weight: 0,
    image_url: null,
    poster_url: IMG(cr.poster_path, "w342"),
    summary: cr.overview || null,
    imdb_id: null,
    blurb: null,
    genres: null,
    runtime: null,
    cast_json: null,
    providers_intl: null,
    tmdb_id: cr.id,
    type: null,
    character: cr.character || null,
    voice: 0,
    episodes: cr.episode_count ?? null,
  })) as unknown as PersonRoles;

  const films = dedupTop("movie", movieLimit).map((cr) => ({
    imdb_id: `tmdb-${cr.id}`,
    slug: slugifyName(cr.title),
    title: cr.title,
    year: cr.release_date ? Number(cr.release_date.slice(0, 4)) : null,
    release_date: cr.release_date || null,
    overview: cr.overview || null,
    genres: null,
    runtime: null,
    rating: cr.vote_average > 0 ? cr.vote_average : null,
    votes: cr.vote_count ?? null,
    popularity: cr.popularity ?? null,
    poster_url: IMG(cr.poster_path, "w342"),
    tmdb_id: cr.id,
    providers: null,
    providers_intl: null,
    character: cr.character || null,
  })) as unknown as PersonFilms;

  return { roles, films };
}

/** Resolve a person we only know by name (our people table is TVmaze-seeded with
 *  no TMDB ids, bios, or birthdays) to their FULL TMDB profile + filmography. We
 *  try the top search candidates and ACCEPT one only when its credits overlap a
 *  title we already know the person for — so a common name never grafts the
 *  wrong actor on. With no known titles to check against, or a single
 *  unambiguous hit, we trust TMDB's popularity ranking. */
export async function tmdbPersonByName(
  c: Context<{ Bindings: Bindings }>,
  name: string,
  knownSlugs: Set<string>,
): Promise<{ person: PersonRow; roles: PersonRoles; films: PersonFilms } | null> {
  const key = c.env.TMDB_API_KEY;
  if (!key) return null;
  const search = await cachedJson(
    `https://api.themoviedb.org/3/search/person?api_key=${key}&query=${encodeURIComponent(name)}`,
    `psearch/v1/${slugifyName(name)}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = (search?.results ?? []) as any[];
  if (!results.length) return null;

  const overlaps = (built: { roles: PersonRoles; films: PersonFilms }) =>
    built.roles.some((r) => knownSlugs.has(r.slug)) ||
    built.films.some((f) => knownSlugs.has(f.slug));

  for (const cand of results.slice(0, 3)) {
    const built = await tmdbPersonData(c, cand.id);
    if (!built) continue;
    if (!knownSlugs.size || overlaps(built)) return built;
  }
  // a single hit for the name is unambiguous — trust it even without an overlap
  return results.length === 1 ? await tmdbPersonData(c, results[0].id) : null;
}
