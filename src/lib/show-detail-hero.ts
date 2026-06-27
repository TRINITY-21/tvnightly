import type { Context } from "hono";
import { heroWatchProvider } from "../components/detail-hero";
import type { EpisodeRow, HonoEnv, ShowRow } from "../types";
import { personHref, slugifyName } from "./format";
import { providersFor } from "./providers";
import { crewLinkMap } from "./queries";
import { titleStat } from "./ratings";
import { tmdbBackdrop, tmdbMedia, tmdbShowCreators, tmdbShowCrew } from "./tmdb";
import { tmdbShowCast } from "./tmdb-show";

type CastTile = { n: string; c: string | null; img: string | null; id?: number };
type HeroVideo = { key: string; name: string; type: string };

export type ShowDetailHeroContext = {
  backdrop: { x1: string; x2?: string } | null;
  trailerVid: HeroVideo | null;
  highlights: HeroVideo[];
  starring: { name: string; href: string | null }[];
  directors: { name: string; href: string | null }[];
  writers: { name: string; href: string | null }[];
  watchProv: ReturnType<typeof heroWatchProvider>;
  stat: string | null;
  communityCounts: { loved: number; liked: number; meh: number; awful: number } | null;
  netName: string | null;
  netHref: string | null;
  genres: { name: string; href: string }[];
  metaExtra: string | null;
  metaExtraHref: string | null;
  yearLabel: string | null;
  metaBadge: string | null;
};

/** Shared DetailHero data for show overview and subpages. */
export async function loadShowDetailHeroContext(
  c: Context<HonoEnv>,
  show: ShowRow,
  episodes: EpisodeRow[],
  ratingRef: string,
  region: string,
  opts?: { metaBadge?: string | null },
): Promise<ShowDetailHeroContext> {
  const netName = show.network ?? show.web_channel;
  const seasons = new Map<number, EpisodeRow[]>();
  for (const e of episodes) {
    const s = e.season ?? 0;
    if (!seasons.has(s)) seasons.set(s, []);
    seasons.get(s)!.push(e);
  }

  const castFetch: Promise<CastTile[]> = show.cast_json
    ? Promise.resolve(JSON.parse(show.cast_json) as CastTile[])
    : show.tmdb_id && c.env.TMDB_API_KEY
      ? tmdbShowCast(c.env.TMDB_API_KEY, show.tmdb_id)
      : Promise.resolve([] as CastTile[]);

  const [stat, netCount, cast, communityCounts, backdrop, creators, mediaBundle, crew] =
    await Promise.all([
      titleStat(c.env.DB, "tv", ratingRef),
      netName
        ? c.env.DB.prepare(
            "SELECT COUNT(*) AS c FROM shows WHERE (network = ? OR web_channel = ?) AND weight >= 60",
          )
            .bind(netName, netName)
            .first<{ c: number }>()
        : Promise.resolve(null),
      castFetch,
      c.env.DB
        .prepare("SELECT loved, liked, meh, awful FROM title_ratings WHERE kind = ? AND ref = ?")
        .bind("tv", ratingRef)
        .first<{ loved: number; liked: number; meh: number; awful: number }>(),
      show.tmdb_id && c.env.TMDB_API_KEY
        ? tmdbBackdrop(c.env.TMDB_API_KEY, show.tmdb_id)
        : Promise.resolve(null),
      show.tmdb_id && c.env.TMDB_API_KEY
        ? tmdbShowCreators(c.env.TMDB_API_KEY, show.tmdb_id)
        : Promise.resolve([]),
      show.tmdb_id && c.env.TMDB_API_KEY
        ? tmdbMedia(c.env.TMDB_API_KEY, show.tmdb_id)
        : Promise.resolve(null),
      show.tmdb_id && c.env.TMDB_API_KEY
        ? tmdbShowCrew(c.env.TMDB_API_KEY, show.tmdb_id, 12)
        : Promise.resolve([]),
    ]);

  const creatorLinks = creators.length ? await crewLinkMap(c.env.DB, creators) : new Map<number, number>();
  const media = mediaBundle;
  const trailerVid = media?.videos.find((v) => v.type === "Trailer") ?? media?.videos[0] ?? null;
  const highlights = (media?.videos ?? []).filter((v) => v !== trailerVid).slice(0, 14);
  const writers = crew
    .filter((p) => p.jobs.split(" · ").some((j) => j === "Writer" || j === "Screenplay"))
    .slice(0, 3);
  const writerLinks = writers.length ? await crewLinkMap(c.env.DB, writers) : new Map<number, number>();
  const prov = providersFor(show, region);
  const watchProv = heroWatchProvider(prov.names, show.name, prov.region, "tv");
  const showGenres: string[] = show.genres ? JSON.parse(show.genres) : [];

  return {
    backdrop,
    trailerVid,
    highlights,
    starring: cast.slice(0, 4).map((p) => ({
      name: p.n,
      href: personHref(p),
    })),
    directors: creators.map((p) => ({
      name: p.name,
      href: creatorLinks.get(p.id)
        ? `/person/${slugifyName(p.name)}-${creatorLinks.get(p.id)}`
        : null,
    })),
    writers: writers.map((p) => ({
      name: p.name,
      href: writerLinks.get(p.id)
        ? `/person/${slugifyName(p.name)}-${writerLinks.get(p.id)}`
        : null,
    })),
    watchProv,
    stat,
    communityCounts: communityCounts ?? null,
    netName: netName && (netCount?.c ?? 0) >= 3 ? netName : null,
    netHref: netName && (netCount?.c ?? 0) >= 3 ? `/network/${slugifyName(netName)}` : null,
    genres: showGenres.slice(0, 4).map((g) => ({
      name: g,
      href: `/genre/${slugifyName(g)}/shows`,
    })),
    metaExtra: episodes.length
      ? `${seasons.size} season${seasons.size === 1 ? "" : "s"}, ${episodes.length} episode${episodes.length === 1 ? "" : "s"}`
      : null,
    metaExtraHref: episodes.length ? `/show/${show.slug}/best-episodes` : null,
    yearLabel: show.premiered
      ? ` (${show.premiered.slice(0, 4)}${show.ended ? `–${show.ended.slice(0, 4)}` : show.status === "Running" ? "–present" : ""})`
      : null,
    metaBadge:
      opts?.metaBadge ??
      (show.status === "Running" ? "On air" : show.status === "Ended" ? "Ended" : null),
  };
}
