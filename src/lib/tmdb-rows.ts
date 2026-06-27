// Live-TMDB hits → card-shaped rows, so they render with ShowCard/MovieCard and
// link to clean URLs the detail fallback resolves. Used by search + the homepage
// rails (the hybrid catalog: the catalog is TMDB's, D1 is our engaged subset).
import type { TmdbSearchHit } from "./tmdb";
import { tmdbGenreLabelsFromIds } from "./tmdb";
import { slugifyName } from "./format";
import type { ShowRow, MovieRow } from "../types";

const genresJsonFromHit = (h: TmdbSearchHit): string | null => {
  const labels = tmdbGenreLabelsFromIds(h.kind, h.genreIds ?? []);
  return labels.length ? JSON.stringify(labels) : null;
};

export const toShowRow = (h: TmdbSearchHit) =>
  ({
    slug: slugifyName(h.name),
    name: h.name,
    rating: h.rating,
    premiered: h.year ? `${h.year}-01-01` : null,
    summary: h.overview,
    poster_url: h.posterPath ? `https://image.tmdb.org/t/p/w342${h.posterPath}` : null,
    image_url: null,
    genres: genresJsonFromHit(h),
    status: null,
    tmdb_id: h.tmdbId,
    weight: Math.round(h.popularity) || 0,
  }) as unknown as ShowRow;

export const toMovieRow = (h: TmdbSearchHit) =>
  ({
    slug: slugifyName(h.name),
    title: h.name,
    rating: h.rating,
    year: h.year ? Number(h.year) : null,
    overview: h.overview,
    poster_url: h.posterPath ? `https://image.tmdb.org/t/p/w342${h.posterPath}` : null,
    genres: genresJsonFromHit(h),
    imdb_id: null,
    tmdb_id: h.tmdbId,
    popularity: h.popularity,
  }) as unknown as MovieRow;

/** When a chart filter pins a genre, ensure the row carries it for downstream filters. */
export const withGenreLabel = <T extends { genres: string | null }>(
  row: T,
  genreLabel: string | null | undefined,
): T => {
  if (!genreLabel || row.genres) return row;
  return { ...row, genres: JSON.stringify([genreLabel]) };
};
