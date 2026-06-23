// Above-the-fold conversion band for show landing pages (ratings, similar, …):
// quick links, community proof, one-tap verdict, compact renewal alerts.
import { FC } from "hono/jsx";
import { pad2 } from "../lib/format";
import { similarShows } from "../lib/queries";
import { titleStatAndCount } from "../lib/ratings";
import { EpisodeRow, ShowRow } from "../types";
import { ConvertBand } from "./convert-band";

/** Dynamic next-episode CTA copy — "When does S3 drop?" when nothing is scheduled. */
export function nextEpisodeHook(
  show: ShowRow,
  episodes: EpisodeRow[],
): { label: string; href: string } {
  const href = `/show/${show.slug}/next-episode`;
  const now = Date.now();
  const future = episodes
    .filter((e) => e.airstamp && new Date(e.airstamp).getTime() > now)
    .sort((a, b) => new Date(a.airstamp!).getTime() - new Date(b.airstamp!).getTime());
  if (future.length) {
    const next = future[0];
    const s = next.season ?? 0;
    if (s > 0) {
      return { label: `When is S${s}E${pad2(next.number)} airing?`, href };
    }
    return { label: "When is the next episode?", href };
  }
  const seasons = episodes.map((e) => e.season ?? 0).filter((s) => s > 0);
  const maxSeason = seasons.length ? Math.max(...seasons) : 0;
  const nextSeason = maxSeason + 1;
  if (show.status !== "Ended") {
    return { label: `When does S${nextSeason} drop?`, href };
  }
  return { label: "Renewal & schedule", href: `/show/${show.slug}/release-date` };
}

export async function loadShowConvertCtx(
  db: D1Database,
  show: ShowRow,
  ratingRef: string,
  // pages that already fetched a similar list pass it in to skip the re-query
  similar?: Pick<ShowRow, "slug" | "name">[],
) {
  const [stats, sim] = await Promise.all([
    titleStatAndCount(db, "tv", ratingRef),
    similar ? Promise.resolve(similar) : similarShows(db, show, 3),
  ]);
  return { stat: stats.stat, raterCount: stats.raterCount, similar: sim };
}

export const ShowConvertBand: FC<{
  show: ShowRow;
  ratingRef: string;
  stat: string | null;
  raterCount: number;
  episodes: EpisodeRow[];
  similar?: Pick<ShowRow, "slug" | "name">[];
  /** Appended to best-episodes / ratings links when a season filter is active. */
  seasonQuery?: string;
  /** Hide the ratings-graph chip (when you're already on that page). */
  hideRatingsLink?: boolean;
  /** Hide similar-show chips (when you're on the similar page). */
  hideSimilar?: boolean;
}> = ({
  show,
  ratingRef,
  stat,
  raterCount,
  episodes,
  similar = [],
  seasonQuery = "",
  hideRatingsLink = false,
  hideSimilar = false,
}) => {
  const next = nextEpisodeHook(show, episodes);
  const releaseHref = `/show/${show.slug}/release-date`;
  const exploreLinks = [
    { label: "Every episode ranked", href: `/show/${show.slug}/best-episodes${seasonQuery}` },
    { label: next.label, href: next.href },
  ];
  if (next.href !== releaseHref) {
    exploreLinks.push({ label: "Renewed or cancelled?", href: releaseHref });
  }
  if (!hideRatingsLink) {
    exploreLinks.push({ label: "Ratings graph", href: `/show/${show.slug}/ratings${seasonQuery}` });
  }

  return (
    <ConvertBand
      ariaName={show.name}
      stat={stat}
      raterCount={raterCount}
      exploreLinks={exploreLinks}
      similar={
        !hideSimilar && similar.length
          ? {
              label: "Similar shows",
              items: similar.slice(0, 3).map((s) => ({ href: `/show/${s.slug}`, text: s.name })),
              allHref: `/show/${show.slug}/similar`,
            }
          : null
      }
      rate={{ kind: "tv", refId: ratingRef }}
      subscribe={
        show.id ? { showId: show.id, showName: show.name, kicker: `Alerts when ${show.name} returns` } : null
      }
    />
  );
};
