import { edgeMemoJson } from "./edge-memo";
import { FRANCHISE_BY_SLUG } from "./franchises";
import { hiRes, slugifyName } from "./format";
import { tmdbBackdrop, tmdbDiscoverGenre, tmdbGenreId, tmdbMovieBackdrop } from "./tmdb";
import { genreBinds, genreOr, VERTICALS } from "./verticals";

export type ExploreArt = { x1: string; x2?: string } | null;

// Door art is deterministic per key and backed by `genres LIKE` scans that no
// index can serve — the #1 D1 rows-read family (≈1.6B rows/wk). Memoized at the
// edge for a day; a stale door backdrop is invisible, a re-scan is billed.
const ART_TTL = 86400;

const showArt = (key: string, tmdbId: number | null | undefined) =>
  tmdbId ? tmdbBackdrop(key, tmdbId) : Promise.resolve(null);

const movieArt = (key: string, imdbId: string | null | undefined) =>
  imdbId ? tmdbMovieBackdrop(key, imdbId) : Promise.resolve(null);

// TMDB compound labels ("Action & Adventure") vs TVmaze singles ("Action") — try
// every synonym before falling back to live /discover.
const genreLookupTerms = (genre: string): string[] => {
  const terms = new Set<string>([genre]);
  const lower = genre.toLowerCase();
  if (lower.includes("sci-fi") || lower.includes("science")) terms.add("Science-Fiction");
  if (lower.includes("fantasy")) terms.add("Fantasy");
  if (lower.includes("action")) terms.add("Action");
  if (lower.includes("adventure")) terms.add("Adventure");
  if (lower.includes("horror")) terms.add("Horror");
  if (lower.includes("comedy")) terms.add("Comedy");
  if (lower.includes("drama")) terms.add("Drama");
  if (lower.includes("crime")) terms.add("Crime");
  if (lower.includes("thriller")) terms.add("Thriller");
  for (const part of genre.split(/\s*&\s*/)) {
    const p = part.trim();
    if (p) terms.add(p);
  }
  return [...terms];
};

const tmdbGenreIdsFor = (kind: "tv" | "movie", genre: string): number[] => {
  const ids = new Set<number>();
  for (const term of genreLookupTerms(genre)) {
    const id = tmdbGenreId(kind, slugifyName(term));
    if (id != null) ids.add(id);
  }
  return [...ids];
};

async function d1ShowGenreArt(db: D1Database, key: string, genre: string): Promise<ExploreArt> {
  for (const term of genreLookupTerms(genre)) {
    const row = await db
      .prepare(
        `SELECT tmdb_id, image_url FROM shows
         WHERE genres LIKE ? AND rating IS NOT NULL AND weight >= 60 AND tmdb_id IS NOT NULL
         ORDER BY rating DESC, weight DESC LIMIT 1`,
      )
      .bind(`%"${term}"%`)
      .first<{ tmdb_id: number; image_url: string | null }>();
    if (!row) continue;
    const bd = await showArt(key, row.tmdb_id);
    if (bd) return bd;
    if (row.image_url) return { x1: hiRes(row.image_url) ?? row.image_url };
  }
  return null;
}

async function tmdbShowGenreArt(key: string, genre: string): Promise<ExploreArt> {
  for (const gid of tmdbGenreIdsFor("tv", genre)) {
    const hits = await tmdbDiscoverGenre(key, "tv", gid);
    const top = hits.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    if (!top) continue;
    const bd = await tmdbBackdrop(key, top.tmdbId);
    if (bd) return bd;
    if (top.posterPath) return { x1: `https://image.tmdb.org/t/p/w780${top.posterPath}` };
  }
  return null;
}

/** Top-rated show in a genre — the genre door wears its reigning #1 backdrop. */
export async function genreShowArt(db: D1Database, key: string, genre: string): Promise<ExploreArt> {
  return edgeMemoJson(
    `genre-show-art/${slugifyName(genre)}`,
    ART_TTL,
    async () => (await d1ShowGenreArt(db, key, genre)) ?? (await tmdbShowGenreArt(key, genre)),
  );
}

async function d1MovieGenreArt(db: D1Database, key: string, genre: string): Promise<ExploreArt> {
  for (const term of genreLookupTerms(genre)) {
    const row = await db
      .prepare(
        `SELECT imdb_id, poster_url FROM movies
         WHERE genres LIKE ? AND rating IS NOT NULL
         ORDER BY rating DESC, votes DESC LIMIT 1`,
      )
      .bind(`%"${term}"%`)
      .first<{ imdb_id: string; poster_url: string | null }>();
    if (!row) continue;
    const bd = await movieArt(key, row.imdb_id);
    if (bd) return bd;
    if (row.poster_url) return { x1: row.poster_url };
  }
  return null;
}

async function tmdbMovieGenreArt(key: string, genre: string): Promise<ExploreArt> {
  for (const gid of tmdbGenreIdsFor("movie", genre)) {
    const hits = await tmdbDiscoverGenre(key, "movie", gid);
    const top = hits.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    if (!top) continue;
    // live-only films may lack an imdb_id in our mirror — backdrop via TMDB id works
    const bundleId = top.tmdbId ? String(top.tmdbId) : null;
    if (bundleId) {
      const bd = await tmdbMovieBackdrop(key, bundleId);
      if (bd) return bd;
    }
    if (top.posterPath) return { x1: `https://image.tmdb.org/t/p/w780${top.posterPath}` };
  }
  return null;
}

/** Top-rated film in a genre. */
export async function genreMovieArt(db: D1Database, key: string, genre: string): Promise<ExploreArt> {
  return edgeMemoJson(
    `genre-movie-art/${slugifyName(genre)}`,
    ART_TTL,
    async () => (await d1MovieGenreArt(db, key, genre)) ?? (await tmdbMovieGenreArt(key, genre)),
  );
}

/** The network's highest-rated series backdrop. */
export async function networkShowArt(db: D1Database, key: string, netName: string): Promise<ExploreArt> {
  return edgeMemoJson(`network-show-art/${slugifyName(netName)}`, ART_TTL, () => networkShowArtLive(db, key, netName));
}

async function networkShowArtLive(db: D1Database, key: string, netName: string): Promise<ExploreArt> {
  const row = await db
    .prepare(
      `SELECT tmdb_id, image_url FROM shows
       WHERE (network = ? OR web_channel = ?) AND rating IS NOT NULL AND weight >= 60 AND tmdb_id IS NOT NULL
       ORDER BY rating DESC, weight DESC LIMIT 1`,
    )
    .bind(netName, netName)
    .first<{ tmdb_id: number; image_url: string | null }>();
  if (!row) return null;
  const bd = await showArt(key, row.tmdb_id);
  return bd ?? (row.image_url ? { x1: hiRes(row.image_url) ?? row.image_url } : null);
}

/** A vertical hub's reigning #1 title — TV first, then film. */
export async function hubArt(db: D1Database, key: string, hubSlug: string): Promise<ExploreArt> {
  return edgeMemoJson(`hub-art/${hubSlug}`, ART_TTL, () => hubArtLive(db, key, hubSlug));
}

async function hubArtLive(db: D1Database, key: string, hubSlug: string): Promise<ExploreArt> {
  const v = VERTICALS.find((h) => h.slug === hubSlug);
  if (!v) return null;

  const movieConds = ["rating IS NOT NULL", "votes >= 1000"];
  const movieBinds: (string | number)[] = [];
  if (v.movieGenres?.length) {
    movieConds.push(genreOr("genres", v.movieGenres));
    movieBinds.push(...genreBinds(v.movieGenres));
  }
  if (v.movieYearMax) {
    movieConds.push("year <= ?");
    movieBinds.push(v.movieYearMax);
  }

  const [topShow, topMovie] = await Promise.all([
    v.tvGenres?.length
      ? db
          .prepare(
            `SELECT tmdb_id, image_url FROM shows
             WHERE ${genreOr("genres", v.tvGenres)} AND rating IS NOT NULL AND weight >= 60
             ORDER BY rating DESC, weight DESC LIMIT 1`,
          )
          .bind(...genreBinds(v.tvGenres))
          .first<{ tmdb_id: number | null; image_url: string | null }>()
      : null,
    db
      .prepare(
        `SELECT imdb_id, poster_url FROM movies WHERE ${movieConds.join(" AND ")}
         ORDER BY rating DESC, votes DESC LIMIT 1`,
      )
      .bind(...movieBinds)
      .first<{ imdb_id: string; poster_url: string | null }>(),
  ]);

  if (topShow?.tmdb_id) {
    const bd = await showArt(key, topShow.tmdb_id);
    if (bd) return bd;
  }
  if (!topShow && topMovie?.imdb_id) {
    const bd = await movieArt(key, topMovie.imdb_id);
    if (bd) return bd;
  }
  const p = topShow?.image_url ? hiRes(topShow.image_url) : (topMovie?.poster_url ?? null);
  return p ? { x1: p } : null;
}

/** Opening film of a franchise watch-order guide. */
export async function franchiseArt(db: D1Database, key: string, slug: string): Promise<ExploreArt> {
  return edgeMemoJson(`franchise-art/${slug}`, ART_TTL, () => franchiseArtLive(db, key, slug));
}

async function franchiseArtLive(db: D1Database, key: string, slug: string): Promise<ExploreArt> {
  const fr = FRANCHISE_BY_SLUG.get(slug);
  const first = fr?.entries[0];
  if (!first) return null;
  const row = await db
    .prepare("SELECT imdb_id, poster_url FROM movies WHERE lower(title) = ? AND year = ? LIMIT 1")
    .bind(first.title.toLowerCase(), first.year)
    .first<{ imdb_id: string; poster_url: string | null }>();
  if (!row) return null;
  const bd = await movieArt(key, row.imdb_id);
  return bd ?? (row.poster_url ? { x1: row.poster_url } : null);
}

/** Top-rated film on a streaming service. */
export async function providerMovieArt(db: D1Database, key: string, provider: string): Promise<ExploreArt> {
  return edgeMemoJson(`provider-movie-art/${slugifyName(provider)}`, ART_TTL, () => providerMovieArtLive(db, key, provider));
}

async function providerMovieArtLive(db: D1Database, key: string, provider: string): Promise<ExploreArt> {
  const row = await db
    .prepare(
      `SELECT imdb_id, poster_url FROM movies
       WHERE providers_intl LIKE ? AND rating IS NOT NULL
       ORDER BY rating DESC, votes DESC LIMIT 1`,
    )
    .bind(`%"${provider}"%`)
    .first<{ imdb_id: string; poster_url: string | null }>();
  if (!row) return null;
  const bd = await movieArt(key, row.imdb_id);
  return bd ?? (row.poster_url ? { x1: row.poster_url } : null);
}

export type ShowExploreArts = {
  essential: ExploreArt;
  compare: ExploreArt;
  network: ExploreArt;
  genres: ExploreArt[];
  hub: ExploreArt;
};

export async function fetchShowExploreArts(
  db: D1Database,
  key: string,
  opts: {
    showBackdrop: ExploreArt;
    compareBackdrop: ExploreArt;
    netName: string | null;
    genres: string[];
    hubSlug: string | null;
  },
): Promise<ShowExploreArts> {
  const genreCount = opts.genres.length;
  const fetches: Promise<ExploreArt>[] = [
    opts.netName ? networkShowArt(db, key, opts.netName) : Promise.resolve(null),
    ...opts.genres.map((g) => genreShowArt(db, key, g)),
    opts.hubSlug ? hubArt(db, key, opts.hubSlug) : Promise.resolve(null),
  ];
  const results = await Promise.all(fetches);
  return {
    essential: opts.showBackdrop,
    compare: opts.compareBackdrop,
    network: results[0] ?? null,
    genres: results.slice(1, 1 + genreCount),
    hub: results[1 + genreCount] ?? null,
  };
}

export type MovieExploreArts = {
  franchise: ExploreArt;
  compare: ExploreArt;
  genres: ExploreArt[];
  provider: ExploreArt;
  hub: ExploreArt;
};

export async function fetchMovieExploreArts(
  db: D1Database,
  key: string,
  opts: {
    movieBackdrop: ExploreArt;
    franchiseSlug: string | null;
    genres: string[];
    provider: string | null;
    hubSlug: string | null;
  },
): Promise<MovieExploreArts> {
  const genreCount = opts.genres.length;
  const fetches: Promise<ExploreArt>[] = [
    opts.franchiseSlug ? franchiseArt(db, key, opts.franchiseSlug) : Promise.resolve(null),
    ...opts.genres.map((g) => genreMovieArt(db, key, g)),
    opts.provider ? providerMovieArt(db, key, opts.provider) : Promise.resolve(null),
    opts.hubSlug ? hubArt(db, key, opts.hubSlug) : Promise.resolve(null),
  ];
  const results = await Promise.all(fetches);
  return {
    franchise: results[0] ?? null,
    compare: opts.movieBackdrop,
    genres: results.slice(1, 1 + genreCount),
    provider: results[1 + genreCount] ?? null,
    hub: results[2 + genreCount] ?? null,
  };
}
