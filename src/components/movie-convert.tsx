// Conversion band for movie pages — movie-native links (no episodes, renewals,
// or per-title email alerts). Shares the ConvertBand shell with ShowConvertBand.
import { FC } from "hono/jsx";
import { similarMovies } from "../lib/queries";
import { titleStatAndCount } from "../lib/ratings";
import { MovieRow } from "../types";
import { ConvertBand } from "./convert-band";

export async function loadMovieConvertCtx(
  db: D1Database,
  movie: MovieRow,
  ratingRef: string,
  // pages that already fetched a similar list pass it in to skip the re-query
  similar?: Pick<MovieRow, "slug" | "title">[],
) {
  const [stats, sim] = await Promise.all([
    titleStatAndCount(db, "movie", ratingRef),
    similar ? Promise.resolve(similar) : similarMovies(db, movie, 3),
  ]);
  return { stat: stats.stat, raterCount: stats.raterCount, similar: sim };
}

export const MovieConvertBand: FC<{
  movie: MovieRow;
  ratingRef: string;
  stat: string | null;
  raterCount: number;
  similar?: Pick<MovieRow, "slug" | "title">[];
  hideSimilar?: boolean;
}> = ({
  movie,
  ratingRef,
  stat,
  raterCount,
  similar = [],
  hideSimilar = false,
}) => (
  <ConvertBand
    ariaName={movie.title}
    stat={stat}
    raterCount={raterCount}
    similar={
      !hideSimilar && similar.length
        ? {
            label: "Similar movies",
            items: similar.slice(0, 3).map((m) => ({ href: `/movie/${m.slug}`, text: m.title })),
            allHref: `/movie/${movie.slug}/similar`,
          }
        : null
    }
    rate={{ kind: "movie", refId: ratingRef }}
  />
);
