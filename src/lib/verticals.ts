// Niche vertical hub configs (/anime, /horror, ...). New hub = one object.

/** First vertical hub matching a title's genres (or the classics year cutoff). */
export function hubForGenres(genres: string[], movieYear: number | null): { slug: string; name: string } | null {
  for (const v of VERTICALS) {
    if (v.movieYearMax && movieYear && movieYear <= v.movieYearMax) return { slug: v.slug, name: v.name };
    const all = [...(v.tvGenres ?? []), ...(v.movieGenres ?? [])];
    if (genres.some((g) => all.includes(g))) return { slug: v.slug, name: v.name };
  }
  return null;
}

// ------------------------------------------------- niche vertical hubs

export interface Vertical {
  slug: string;
  name: string;
  pageTitle: string;
  description: string;
  intro: string;
  tvGenres?: string[];
  movieGenres?: string[];
  movieYearMax?: number;
  movieSectionTitle: string;
  watchOrders?: string[];
  pickerQS: string;
}

export const genreOr = (col: string, genres: string[]) =>
  `(${genres.map(() => `${col} LIKE ?`).join(" OR ")})`;
export const genreBinds = (genres: string[]) => genres.map((g) => `%"${g}"%`);

export const VERTICALS: Vertical[] = [
  {
    slug: "anime",
    name: "Anime",
    pageTitle: "Anime — where to watch, the best series & what's new",
    description:
      "The anime hub: top-rated series with streaming availability, upcoming premieres, what just hit your services, and a picker when you can't decide.",
    intro:
      "Everything anime in one place — ranked from real ratings, with streaming availability for your country.",
    tvGenres: ["Anime"],
    movieGenres: ["Animation"],
    movieSectionTitle: "Top animation & anime films",
    pickerQS: "?genre=Anime",
  },
  {
    slug: "horror",
    name: "Horror",
    pageTitle: "Horror — where to watch, the best series & films, what's new",
    description:
      "The horror hub: the best horror shows and films with streaming availability, upcoming premieres, and what just arrived on your services.",
    intro:
      "For the people who watch through their fingers — the best of horror and where to stream it.",
    tvGenres: ["Horror"],
    movieGenres: ["Horror"],
    movieSectionTitle: "Top horror films",
    watchOrders: ["conjuring-universe"],
    pickerQS: "?genre=Horror",
  },
  {
    slug: "classics",
    name: "Classic film",
    pageTitle: "Classic films — the greatest movies before 1980 & where to stream them",
    description:
      "The classic-film hub: the greatest pre-1980 movies ranked by rating, with current streaming availability in your country.",
    intro:
      "The canon, minus the dust — every classic ranked by rating, with live streaming availability.",
    movieYearMax: 1979,
    movieSectionTitle: "The greatest films before 1980",
    pickerQS: "?type=movie&min=8",
  },
  {
    slug: "sci-fi",
    name: "Sci-fi & fantasy",
    pageTitle: "Sci-fi & fantasy — where to watch, the best series & films, what's new",
    description:
      "The sci-fi & fantasy hub: the best series and films with streaming availability, upcoming premieres, and what just arrived on your services.",
    intro:
      "Other worlds, one page — the best of both genres and where to stream them.",
    tvGenres: ["Science-Fiction", "Fantasy"],
    movieGenres: ["Science Fiction", "Fantasy"],
    movieSectionTitle: "Top sci-fi & fantasy films",
    watchOrders: ["star-wars", "middle-earth", "terminator"],
    pickerQS: "?genre=Science-Fiction",
  },
];
