// Live-TMDB hits → card-shaped rows, so they render with ShowCard/MovieCard and
// link to clean URLs the detail fallback resolves. Used by search + the homepage
// rails (the hybrid catalog: the catalog is TMDB's, D1 is our engaged subset).
import type { TmdbSearchHit } from "./tmdb";
import { slugifyName } from "./format";
import type { ShowRow, MovieRow } from "../types";

export const toShowRow = (h: TmdbSearchHit) =>
  ({
    slug: slugifyName(h.name),
    name: h.name,
    rating: h.rating,
    premiered: h.year ? `${h.year}-01-01` : null,
    summary: h.overview,
    poster_url: h.posterPath ? `https://image.tmdb.org/t/p/w342${h.posterPath}` : null,
    image_url: null,
    genres: null,
    status: null,
    tmdb_id: h.tmdbId,
  }) as unknown as ShowRow;

export const toMovieRow = (h: TmdbSearchHit) =>
  ({
    slug: slugifyName(h.name),
    title: h.name,
    rating: h.rating,
    year: h.year ? Number(h.year) : null,
    overview: h.overview,
    poster_url: h.posterPath ? `https://image.tmdb.org/t/p/w342${h.posterPath}` : null,
    genres: null,
    imdb_id: null,
    tmdb_id: h.tmdbId,
  }) as unknown as MovieRow;
