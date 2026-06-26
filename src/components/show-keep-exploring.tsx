import { FC } from "hono/jsx";
import { fetchShowExploreArts, type ShowExploreArts } from "../lib/explore-art";
import { slugifyName } from "../lib/format";
import { tmdbBackdrop } from "../lib/tmdb";
import { hubForGenres } from "../lib/verticals";
import type { ShowRow } from "../types";
import { ExploreCard } from "./cards";

export async function loadShowKeepExploring(
  db: D1Database,
  apiKey: string | undefined,
  show: ShowRow,
  compareTmdbId?: number | null,
): Promise<{
  genres: string[];
  hub: ReturnType<typeof hubForGenres>;
  netEntry?: { name: string; slug: string };
  exploreArts: ShowExploreArts;
}> {
  const genres: string[] = show.genres ? JSON.parse(show.genres) : [];
  const hub = hubForGenres(genres, null);
  const netName = show.network ?? show.web_channel;
  const netCount = netName
    ? await db
        .prepare(
          "SELECT COUNT(*) AS c FROM shows WHERE (network = ? OR web_channel = ?) AND weight >= 60",
        )
        .bind(netName, netName)
        .first<{ c: number }>()
    : null;
  const netEntry =
    netName && (netCount?.c ?? 0) >= 3 ? { name: netName, slug: slugifyName(netName) } : undefined;

  const showBackdrop =
    show.tmdb_id && apiKey ? await tmdbBackdrop(apiKey, show.tmdb_id) : null;
  const compareBackdrop =
    compareTmdbId && apiKey ? await tmdbBackdrop(apiKey, compareTmdbId) : showBackdrop;

  const exploreArts = apiKey
    ? await fetchShowExploreArts(db, apiKey, {
        showBackdrop,
        compareBackdrop: compareBackdrop ?? showBackdrop,
        netName: netEntry?.name ?? null,
        genres: genres.slice(0, 2),
        hubSlug: hub?.slug ?? null,
      })
    : {
        essential: showBackdrop,
        compare: compareBackdrop ?? showBackdrop,
        network: null,
        genres: [],
        hub: null,
      };

  return { genres, hub, netEntry, exploreArts };
}

export const ShowKeepExploring: FC<{
  slug: string;
  genres: string[];
  hub: ReturnType<typeof hubForGenres>;
  netEntry?: { name: string; slug: string };
  exploreArts: ShowExploreArts;
}> = ({ slug, genres, hub, netEntry, exploreArts }) => (
  <section>
    <h2>
      <span class="h2-label">Keep exploring</span>{" "}
      <a class="more" href="/top/tv">
        top shows
      </a>
    </h2>
    <div class="explore-grid">
      <ExploreCard
        icon="Shortcut"
        title="The essential episodes"
        desc="Short on time? The pilot-to-finale shortcut, only the episodes that matter."
        href={`/show/${slug}/essential`}
        backdrop={exploreArts.essential}
      />
      <ExploreCard
        icon="Matchup"
        title="Compare with another show"
        desc="Two shows' episode ratings on one chart — settle it."
        href={`/compare?a=${slug}`}
        backdrop={exploreArts.compare}
      />
      {netEntry ? (
        <ExploreCard
          icon="Network"
          title={`Best ${netEntry.name} shows`}
          desc="More from the same network, ranked by rating."
          href={`/network/${netEntry.slug}`}
          backdrop={exploreArts.network}
        />
      ) : null}
      {genres.slice(0, 2).map((g, i) => (
        <ExploreCard
          icon="Genre"
          title={`Best ${g.toLowerCase()} shows & films`}
          desc={`The top of the ${g.toLowerCase()} pile, across both mediums.`}
          href={`/genre/${slugifyName(g)}`}
          backdrop={exploreArts.genres[i] ?? null}
        />
      ))}
      {hub ? (
        <ExploreCard
          icon="Fandom hub"
          title={`The ${hub.name.toLowerCase()} hub`}
          desc="The whole fandom on one bookmarkable page — rankings, premieres, what's new."
          href={`/${hub.slug}`}
          backdrop={exploreArts.hub}
        />
      ) : null}
    </div>
  </section>
);
