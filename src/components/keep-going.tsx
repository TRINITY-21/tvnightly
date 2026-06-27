import { FC } from "hono/jsx";
import {
    franchiseArt,
    genreMovieArt,
    genreShowArt,
    hubArt,
    networkShowArt,
    type ExploreArt,
} from "../lib/explore-art";
import { hiRes } from "../lib/format";
import { tmdbBackdrop, tmdbBackdrops, tmdbMovieBackdrop } from "../lib/tmdb";
import { hubForGenres } from "../lib/verticals";
import type { MovieRow, ShowRow } from "../types";
import { ExploreCard } from "./cards";

/** Every door gets art — cascade the first available backdrop across null slots. */
export const spreadExploreArts = <T extends Record<string, ExploreArt>>(arts: T): T => {
  const base = Object.values(arts).find((a) => a != null) ?? null;
  if (!base) return arts;
  return Object.fromEntries(Object.entries(arts).map(([k, v]) => [k, v ?? base])) as T;
};

/** Cards missing a backdrop inherit the first art in the set. */
export const fillKeepGoingBackdrops = (cards: KeepGoingCard[]): KeepGoingCard[] => {
  const fallback = cards.find((c) => c.backdrop)?.backdrop;
  if (!fallback) return cards;
  return cards.map((c) => ({ ...c, backdrop: c.backdrop ?? fallback }));
};

export type KeepGoingCard = {
  icon: string;
  title: string;
  desc: string;
  href: string;
  backdrop?: ExploreArt;
};

/** Fill in a TMDB backdrop with TVmaze art or the one-sheet when needed. */
export const finalizeExploreArt = (
  primary: ExploreArt,
  imageUrl: string | null,
  posterUrl?: string | null,
): ExploreArt => {
  if (primary) return primary;
  const hires = hiRes(imageUrl);
  if (hires) return { x1: hires };
  if (posterUrl) return { x1: posterUrl, x2: posterUrl.replace("/w342/", "/w780/") };
  return null;
};

export async function showKeepGoingBackdrop(
  apiKey: string | undefined,
  show: { tmdb_id: number | null; image_url: string | null; poster_url: string | null },
): Promise<ExploreArt> {
  const primary =
    show.tmdb_id && apiKey ? await tmdbBackdrop(apiKey, show.tmdb_id) : null;
  return finalizeExploreArt(primary, show.image_url, show.poster_url);
}

export async function movieKeepGoingBackdrop(
  apiKey: string | undefined,
  movie: { imdb_id: string; poster_url: string | null },
): Promise<ExploreArt> {
  const primary = apiKey ? await tmdbMovieBackdrop(apiKey, movie.imdb_id) : null;
  if (primary) return primary;
  if (movie.poster_url) {
    return { x1: movie.poster_url, x2: movie.poster_url.replace("/w342/", "/w780/") };
  }
  return null;
}

/** Episode still first when sharp enough; otherwise the show's hero art. */
export function episodeKeepGoingBackdrop(
  showArt: ExploreArt,
  epImageUrl: string | null,
): ExploreArt {
  if (epImageUrl) {
    if (/\/t\/p\/w\d+\//.test(epImageUrl)) {
      const at = (s: string) => epImageUrl.replace(/\/t\/p\/w\d+\//, `/t/p/${s}/`);
      return { x1: at("w780"), x2: at("w1280") };
    }
    const hires = hiRes(epImageUrl);
    if (hires) return { x1: hires };
    return { x1: epImageUrl };
  }
  return showArt;
}

/** Distinct backdrop art for each Keep going door on show pages. */
export async function loadShowKeepGoingArts(
  db: D1Database,
  apiKey: string | undefined,
  show: ShowRow,
  similarTmdbId?: number | null,
): Promise<{
  overview: ExploreArt;
  similar: ExploreArt;
  watch: ExploreArt;
  bestEpisodes: ExploreArt;
  tonight: ExploreArt;
  whatsNew: ExploreArt;
  season: ExploreArt;
}> {
  const overview = await showKeepGoingBackdrop(apiKey, show);
  const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const hub = hubForGenres(genres, null);
  const netName = show.network ?? show.web_channel;
  const gallery =
    show.tmdb_id && apiKey ? await tmdbBackdrops(apiKey, show.tmdb_id) : [];
  const pick = (i: number) => gallery[i] ?? overview;

  const [similarBd, genre0, genre1, netBd, hubBd] = await Promise.all([
    similarTmdbId && apiKey ? tmdbBackdrop(apiKey, similarTmdbId) : Promise.resolve(null),
    genres[0] && apiKey ? genreShowArt(db, apiKey, genres[0]) : Promise.resolve(null),
    genres[1] && apiKey ? genreShowArt(db, apiKey, genres[1]) : Promise.resolve(null),
    netName && apiKey ? networkShowArt(db, apiKey, netName) : Promise.resolve(null),
    hub?.slug && apiKey ? hubArt(db, apiKey, hub.slug) : Promise.resolve(null),
  ]);

  return spreadExploreArts({
    overview,
    similar: similarBd ?? pick(1),
    watch: netBd ?? pick(2),
    bestEpisodes: pick(0),
    tonight: genre0 ?? hubBd ?? pick(3),
    whatsNew: genre1 ?? genre0 ?? hubBd ?? pick(4),
    season: pick(0),
  });
}

/** Distinct backdrop art for each Keep going door on movie pages. */
export async function loadMovieKeepGoingArts(
  db: D1Database,
  apiKey: string | undefined,
  movie: MovieRow,
  similarImdbId?: string | null,
): Promise<{
  overview: ExploreArt;
  similar: ExploreArt;
  bestMovies: ExploreArt;
  tonight: ExploreArt;
}> {
  const overview = await movieKeepGoingBackdrop(apiKey, movie);
  const genres: string[] = movie.genres ? JSON.parse(movie.genres) : [];
  const [similarBd, genre0, genre1] = await Promise.all([
    similarImdbId && apiKey ? tmdbMovieBackdrop(apiKey, similarImdbId) : Promise.resolve(null),
    genres[0] && apiKey ? genreMovieArt(db, apiKey, genres[0]) : Promise.resolve(null),
    genres[1] && apiKey ? genreMovieArt(db, apiKey, genres[1]) : Promise.resolve(null),
  ]);

  return spreadExploreArts({
    overview,
    similar: similarBd ?? genre0 ?? overview,
    bestMovies: genre0 ?? overview,
    tonight: genre1 ?? genre0 ?? overview,
  });
}

export const KeepGoing: FC<{ cards: KeepGoingCard[] }> = ({ cards }) => {
  const filled = fillKeepGoingBackdrops(cards);
  return (
  <section>
    <h2>
      <span class="h2-label">Keep going</span>
    </h2>
    <div class="explore-grid">
      {filled.map((card) => (
        <ExploreCard
          icon={card.icon}
          title={card.title}
          desc={card.desc}
          href={card.href}
          backdrop={card.backdrop ?? undefined}
        />
      ))}
    </div>
  </section>
  );
};

/** Bottom-of-guide explore doors — same cards as Keep going, wo-doors styling. */
export const KeepExploring: FC<{ cards: KeepGoingCard[] }> = ({ cards }) => {
  const filled = fillKeepGoingBackdrops(cards);
  return (
    <section class="wo-doors">
      <h2>Keep exploring</h2>
      <div class="explore-grid">
        {filled.map((card) => (
          <ExploreCard
            icon={card.icon}
            title={card.title}
            desc={card.desc}
            href={card.href}
            backdrop={card.backdrop ?? undefined}
          />
        ))}
      </div>
    </section>
  );
};

export type GuideDoorArts = { underrated: ExploreArt; chart: ExploreArt; extra: ExploreArt };

/** Standard 3-door guide footer art (underrated / chart / hub-or-tonight). */
export async function loadTvGuideDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  opts: { lead?: ShowRow | null; genre?: string | null; hubSlug?: string | null },
): Promise<GuideDoorArts> {
  const [underrated, chart, hub] = await Promise.all([
    opts.genre && apiKey ? genreShowArt(db, apiKey, opts.genre) : Promise.resolve(null),
    opts.lead ? showKeepGoingBackdrop(apiKey, opts.lead) : Promise.resolve(null),
    opts.hubSlug && apiKey ? hubArt(db, apiKey, opts.hubSlug) : Promise.resolve(null),
  ]);
  return {
    underrated: underrated ?? chart,
    chart,
    extra: hub ?? chart,
  };
}

export async function loadMovieGuideDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  opts: { lead?: MovieRow | null; genre?: string | null; hubSlug?: string | null },
): Promise<GuideDoorArts> {
  const [underrated, chart, hub] = await Promise.all([
    opts.genre && apiKey ? genreMovieArt(db, apiKey, opts.genre) : Promise.resolve(null),
    opts.lead ? movieKeepGoingBackdrop(apiKey, opts.lead) : Promise.resolve(null),
    opts.hubSlug && apiKey ? hubArt(db, apiKey, opts.hubSlug) : Promise.resolve(null),
  ]);
  return {
    underrated: underrated ?? chart,
    chart,
    extra: hub ?? chart,
  };
}

/** Four-door TV chart page: year guide, underrated, best episodes, compare. */
export async function loadTvChartDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  lead: ShowRow | null,
  runner?: ShowRow | null,
): Promise<[ExploreArt, ExploreArt, ExploreArt, ExploreArt]> {
  const [leadArt, secondArt, genreArt] = await Promise.all([
    lead ? showKeepGoingBackdrop(apiKey, lead) : Promise.resolve(null),
    runner ? showKeepGoingBackdrop(apiKey, runner) : Promise.resolve(null),
    lead?.genres && apiKey
      ? genreShowArt(db, apiKey, (JSON.parse(lead.genres) as string[])[0] ?? "")
      : Promise.resolve(null),
  ]);
  const filled = fillKeepGoingBackdrops([
    { icon: "", title: "", desc: "", href: "", backdrop: leadArt },
    { icon: "", title: "", desc: "", href: "", backdrop: secondArt },
    { icon: "", title: "", desc: "", href: "", backdrop: leadArt },
    { icon: "", title: "", desc: "", href: "", backdrop: genreArt },
  ]);
  return filled.map((c) => c.backdrop ?? null) as [ExploreArt, ExploreArt, ExploreArt, ExploreArt];
}

/** Four-door movie chart page: year guide, underrated, watch orders, community. */
export async function loadMovieChartDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  lead: MovieRow | null,
): Promise<[ExploreArt, ExploreArt, ExploreArt, ExploreArt]> {
  const [leadArt, franchise] = await Promise.all([
    lead ? movieKeepGoingBackdrop(apiKey, lead) : Promise.resolve(null),
    apiKey ? franchiseArt(db, apiKey, "marvel") : Promise.resolve(null),
  ]);
  const filled = fillKeepGoingBackdrops([
    { icon: "", title: "", desc: "", href: "", backdrop: leadArt },
    { icon: "", title: "", desc: "", href: "", backdrop: leadArt },
    { icon: "", title: "", desc: "", href: "", backdrop: franchise },
    { icon: "", title: "", desc: "", href: "", backdrop: leadArt },
  ]);
  return filled.map((c) => c.backdrop ?? null) as [ExploreArt, ExploreArt, ExploreArt, ExploreArt];
}

/** Four-door /movies index: best chart, watch orders, compare, community loved. */
export async function loadMoviesHubDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  popular: MovieRow[],
): Promise<[ExploreArt, ExploreArt, ExploreArt, ExploreArt]> {
  const [bestRow, lovedRow] = await Promise.all([
    db
      .prepare(
        `SELECT imdb_id, poster_url FROM movies
         WHERE rating IS NOT NULL AND votes >= 1000
         ORDER BY rating DESC, votes DESC LIMIT 1`,
      )
      .first<{ imdb_id: string; poster_url: string | null }>(),
    db
      .prepare(
        `SELECT m.imdb_id, m.poster_url FROM title_ratings tr
         JOIN movies m ON tr.kind = 'movie' AND tr.ref = m.imdb_id
         WHERE (tr.loved + tr.liked + tr.meh + tr.awful) >= 2
         ORDER BY (tr.loved + 0.5 * tr.liked) / CAST(tr.loved + tr.liked + tr.meh + tr.awful AS REAL) DESC,
                  (tr.loved + tr.liked + tr.meh + tr.awful) DESC
         LIMIT 1`,
      )
      .first<{ imdb_id: string; poster_url: string | null }>(),
  ]);

  const [bestArt, ordersArt, compareArt, lovedArt] = await Promise.all([
    bestRow ? movieKeepGoingBackdrop(apiKey, bestRow) : Promise.resolve(null),
    apiKey ? franchiseArt(db, apiKey, "marvel") : Promise.resolve(null),
    popular[1]
      ? movieKeepGoingBackdrop(apiKey, popular[1])
      : bestRow
        ? movieKeepGoingBackdrop(apiKey, bestRow)
        : Promise.resolve(null),
    lovedRow
      ? movieKeepGoingBackdrop(apiKey, lovedRow)
      : popular[0]
        ? movieKeepGoingBackdrop(apiKey, popular[0])
        : Promise.resolve(null),
  ]);

  const filled = fillKeepGoingBackdrops([
    { icon: "", title: "", desc: "", href: "", backdrop: bestArt },
    { icon: "", title: "", desc: "", href: "", backdrop: ordersArt },
    { icon: "", title: "", desc: "", href: "", backdrop: compareArt },
    { icon: "", title: "", desc: "", href: "", backdrop: lovedArt },
  ]);
  return filled.map((c) => c.backdrop ?? null) as [ExploreArt, ExploreArt, ExploreArt, ExploreArt];
};

/** /actors and /directors hub — cross-link, top TV, browse-all doors. */
export async function loadPersonHubDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  dept: "Acting" | "Directing",
): Promise<[ExploreArt, ExploreArt, ExploreArt]> {
  const [topShow, topMovie, crossRow] = await Promise.all([
    db
      .prepare(
        `SELECT * FROM shows WHERE rating IS NOT NULL AND weight >= 75
         ORDER BY rating DESC, weight DESC LIMIT 1`,
      )
      .first<ShowRow>(),
    db
      .prepare(
        `SELECT imdb_id, poster_url FROM movies WHERE rating IS NOT NULL AND votes >= 1000
         ORDER BY rating DESC, votes DESC LIMIT 1`,
      )
      .first<{ imdb_id: string; poster_url: string | null }>(),
    dept === "Directing"
      ? db
          .prepare(
            `SELECT s.tmdb_id, s.image_url, s.poster_url FROM people p
             JOIN credits cr ON cr.person_id = p.id AND cr.guest = 0
             JOIN shows s ON s.id = cr.show_id AND s.weight >= 45
             WHERE (p.known_dept = 'Acting' OR (p.known_dept IS NULL AND cr.character IS NOT NULL AND cr.character != ''))
               AND s.rating IS NOT NULL
             ORDER BY s.rating DESC, s.weight DESC LIMIT 1`,
          )
          .first<{ tmdb_id: number | null; image_url: string | null; poster_url: string | null }>()
      : db
          .prepare(
            `SELECT m.imdb_id, m.poster_url FROM people p
             JOIN movie_credits mc ON mc.person_id = p.id
             JOIN movies m ON m.imdb_id = mc.movie_id
             WHERE p.known_dept = 'Directing' AND m.rating IS NOT NULL
             ORDER BY m.rating DESC, m.votes DESC LIMIT 1`,
          )
          .first<{ imdb_id: string; poster_url: string | null }>(),
  ]);

  const [crossArt, chartsArt, browseArt] = await Promise.all([
    crossRow
      ? dept === "Directing"
        ? // crossRow is the show-shape row for Directing, movie-shape otherwise (see
          // the discriminated query above) — TS can't narrow it across the ternary.
          showKeepGoingBackdrop(apiKey, crossRow as Parameters<typeof showKeepGoingBackdrop>[1])
        : movieKeepGoingBackdrop(apiKey, crossRow as Parameters<typeof movieKeepGoingBackdrop>[1])
      : topShow
        ? showKeepGoingBackdrop(apiKey, topShow)
        : Promise.resolve(null),
    topShow ? showKeepGoingBackdrop(apiKey, topShow) : Promise.resolve(null),
    topMovie ? movieKeepGoingBackdrop(apiKey, topMovie) : Promise.resolve(null),
  ]);

  const filled = fillKeepGoingBackdrops([
    { icon: "", title: "", desc: "", href: "", backdrop: crossArt },
    { icon: "", title: "", desc: "", href: "", backdrop: chartsArt },
    { icon: "", title: "", desc: "", href: "", backdrop: browseArt },
  ]);
  return filled.map((c) => c.backdrop ?? null) as [ExploreArt, ExploreArt, ExploreArt];
}

/** Three-door footer on /recommend results + taste share pages. */
export async function loadRecDoorArts(
  db: D1Database,
  apiKey: string | undefined,
  tonightHead: { show_image: string | null; show_poster: string | null } | null,
): Promise<[ExploreArt, ExploreArt, ExploreArt]> {
  const lovedRow = await db
    .prepare(
      `SELECT kind, ref FROM title_ratings
       WHERE (loved + liked + meh + awful) >= 2
       ORDER BY (loved + 0.5 * liked) / CAST(loved + liked + meh + awful AS REAL) DESC,
                (loved + liked + meh + awful) DESC
       LIMIT 1`,
    )
    .first<{ kind: string; ref: string }>();

  const [pickerArt, tonightArt, lovedArt] = await Promise.all([
    genreShowArt(db, apiKey ?? "", "Drama"),
    tonightHead
      ? showKeepGoingBackdrop(apiKey, {
          tmdb_id: null,
          image_url: tonightHead.show_image,
          poster_url: tonightHead.show_poster,
        })
      : Promise.resolve(null),
    lovedRow
      ? lovedRow.kind === "tv"
        ? db
            .prepare(
              `SELECT tmdb_id, image_url, COALESCE(poster_url, image_url) AS poster_url
               FROM shows WHERE id = ? LIMIT 1`,
            )
            .bind(Number(lovedRow.ref))
            .first<{ tmdb_id: number | null; image_url: string | null; poster_url: string | null }>()
            .then((row) => (row ? showKeepGoingBackdrop(apiKey, row) : null))
        : db
            .prepare("SELECT imdb_id, poster_url FROM movies WHERE imdb_id = ? LIMIT 1")
            .bind(lovedRow.ref)
            .first<{ imdb_id: string; poster_url: string | null }>()
            .then((row) => (row ? movieKeepGoingBackdrop(apiKey, row) : null))
      : Promise.resolve(null),
  ]);

  const filled = fillKeepGoingBackdrops([
    { icon: "", title: "", desc: "", href: "", backdrop: pickerArt },
    { icon: "", title: "", desc: "", href: "", backdrop: tonightArt },
    { icon: "", title: "", desc: "", href: "", backdrop: lovedArt },
  ]);
  return filled.map((c) => c.backdrop ?? null) as [ExploreArt, ExploreArt, ExploreArt];
}
