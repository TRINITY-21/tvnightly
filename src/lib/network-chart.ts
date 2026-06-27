import type { Context } from "hono";
import type { HonoEnv, MovieRow, ShowRow } from "../types";
import { enrichMoviesFromD1, enrichShowsFromD1 } from "./chart-enrich";
import { sortMovies, sortShows, type ChartFilters } from "./chart-filters";
import { slugifyName } from "./format";
import { providerBrand, tmdbNetworkId } from "./providers";
import { networkDirectory } from "./queries";
import { tmdbDiscoverNetwork, tmdbDiscoverProvider, tmdbGenreId, tmdbShowNetworks } from "./tmdb";
import { toMovieRow, toShowRow, withGenreLabel } from "./tmdb-rows";

export type NetEntry = { name: string; slug: string; count: number };

export const NETWORK_CHART_LIMIT = 500;
const TMDB_NETWORK_PAGES = 25;

const HEADLINE_PATTERNS: RegExp[] = [
  /netflix/i,
  /hulu/i,
  /\bhbo\b|hbo max/i,
  /disney/i,
  /prime video|amazon prime/i,
  /apple tv/i,
  /paramount/i,
  /peacock/i,
  /showtime/i,
  /\bfx\b/i,
  /amc/i,
  /\bnbc\b/i,
  /\bcbs\b/i,
  /\babc\b/i,
  /\bcw\b/i,
  /syfy/i,
  /bbc one/i,
  /bbc two/i,
  /adult swim/i,
  /starz/i,
  /\btnt\b/i,
];

export function sortBrowseNetworks(networks: NetEntry[]): NetEntry[] {
  const used = new Set<string>();
  const sorted: NetEntry[] = [];
  for (const pat of HEADLINE_PATTERNS) {
    const hit = networks.find((n) => !used.has(n.name) && pat.test(n.name));
    if (hit) {
      sorted.push(hit);
      used.add(hit.name);
    }
  }
  for (const n of networks) {
    if (!used.has(n.name)) sorted.push(n);
  }
  return sorted;
}

/** Three resolution tiers: directory (top 30), any network we hold shows
 *  for, then streaming brands the catalogs know but TVmaze doesn't call a
 *  network ("Paramount+", "fuboTV") — the dossier logos link here, so
 *  every brand we print must resolve. */
export async function resolveNetwork(db: D1Database, slug: string): Promise<NetEntry | null> {
  const dir = await networkDirectory(db);
  const top = dir.find((n) => n.slug === slug);
  if (top) return top;
  const { results: nets } = await db
    .prepare(
      `SELECT n, COUNT(*) AS c FROM (
         SELECT COALESCE(network, web_channel) AS n FROM shows
       ) WHERE n IS NOT NULL GROUP BY n`,
    )
    .all<{ n: string; c: number }>();
  const net = nets.find((r) => slugifyName(r.n) === slug);
  if (net) return { name: net.n, slug, count: net.c };
  const { results: provRows } = await db
    .prepare(
      `SELECT DISTINCT j.value AS p FROM movies, json_tree(movies.providers_intl) AS j
         WHERE movies.providers_intl IS NOT NULL AND j.type = 'text'
       UNION
       SELECT DISTINCT j.value FROM shows, json_tree(shows.providers_intl) AS j
         WHERE shows.providers_intl IS NOT NULL AND j.type = 'text'`,
    )
    .all<{ p: string }>();
  const members = provRows.map((r) => r.p).filter((p) => slugifyName(providerBrand(p)) === slug);
  if (!members.length) return null;
  const name = members.reduce((a, b) => (b.trim().length < a.trim().length ? b : a)).trim();
  return { name, slug, count: 0 };
}

export const regionTester = (region: string, brandName: string) => {
  const brand = providerBrand(brandName);
  return (json: string | null): boolean => {
    const intl: Record<string, string[]> = json ? JSON.parse(json) : {};
    return (intl[region] ?? []).some((p) => providerBrand(p) === brand);
  };
};

const TMDB_PROVIDER_IDS: Record<string, number> = {
  netflix: 8,
  hulu: 15,
  "disney-plus": 337,
  max: 1899,
  "hbo-max": 1899,
  "amazon-prime-video": 9,
  "prime-video": 9,
  "apple-tv-plus": 350,
  "paramount-plus": 531,
  peacock: 386,
};

const tmdbProviderId = (name: string): number | null =>
  TMDB_PROVIDER_IDS[slugifyName(providerBrand(name))] ?? null;

/** Whether this network resolves to a TMDB watch-provider (streaming catalog). */
export const networkHasStreamingCatalog = (name: string, apiKey?: string): boolean =>
  Boolean(apiKey && tmdbProviderId(name));

type Ctx = { env: { DB: D1Database; TMDB_API_KEY?: string } };

async function fetchNetworkShowsD1(
  c: Ctx,
  filters: ChartFilters,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<ShowRow[]> {
  const conds = ["rating IS NOT NULL", "providers_intl IS NOT NULL"];
  const binds: (string | number)[] = [];
  if (filters.genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${filters.genre}"%`);
  }
  if (filters.year != null) {
    conds.push("premiered LIKE ?");
    binds.push(`${filters.year}%`);
  }
  binds.push(limit);
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM shows WHERE ${conds.join(" AND ")} ORDER BY rating DESC, weight DESC LIMIT ?`,
    )
    .bind(...binds)
    .all<ShowRow>();
  return results.filter((s) => regionHas(s.providers_intl));
}

async function fetchNetworkMoviesD1(
  c: Ctx,
  filters: ChartFilters,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<MovieRow[]> {
  const conds = ["rating IS NOT NULL", "providers_intl IS NOT NULL", "votes >= 500"];
  const binds: (string | number)[] = [];
  if (filters.genre) {
    conds.push("genres LIKE ?");
    binds.push(`%"${filters.genre}"%`);
  }
  if (filters.year != null) {
    conds.push("year = ?");
    binds.push(filters.year);
  }
  binds.push(limit);
  const { results } = await c.env.DB
    .prepare(
      `SELECT * FROM movies WHERE ${conds.join(" AND ")} ORDER BY rating DESC, votes DESC LIMIT ?`,
    )
    .bind(...binds)
    .all<MovieRow>();
  return results.filter((m) => regionHas(m.providers_intl));
}

/**
 * TMDB network id for a channel: the curated name→id map first (fast, no fetch),
 * then resolved from a sample D1 show's `networks[]` (cached a week). Lets *any*
 * channel we hold a show for drive a with_networks chart, not just the 26 curated.
 */
async function resolveNetworkTmdbId(c: Ctx, entry: NetEntry): Promise<number | null> {
  const curated = tmdbNetworkId(entry.name);
  if (curated) return curated;
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) return null;
  const cache = caches.default;
  const cacheKey = new Request(`https://edge-cache.tvnightly.com/network-id/${entry.slug}`);
  try {
    const hit = await cache.match(cacheKey);
    if (hit) return ((await hit.json()) as { id: number | null }).id;
  } catch {
    /* cache miss */
  }
  const row = await c.env.DB.prepare(
    `SELECT tmdb_id FROM shows WHERE (network = ? OR web_channel = ?) AND tmdb_id IS NOT NULL
     ORDER BY weight DESC LIMIT 1`,
  )
    .bind(entry.name, entry.name)
    .first<{ tmdb_id: number }>();
  let id: number | null = null;
  if (row?.tmdb_id) {
    const nets = await tmdbShowNetworks(apiKey, row.tmdb_id);
    const want = slugifyName(entry.name);
    const match =
      nets.find((n) => slugifyName(n.name) === want) ??
      nets.find((n) => {
        const ns = slugifyName(n.name);
        return ns.includes(want) || want.includes(ns);
      });
    id = match?.id ?? null;
  }
  try {
    await cache.put(
      cacheKey,
      new Response(JSON.stringify({ id }), {
        headers: { "Cache-Control": "public, max-age=604800", "content-type": "application/json" },
      }),
    );
  } catch {
    /* best-effort cache */
  }
  return id;
}

async function fetchNetworkShowsLive(
  c: Ctx,
  entry: NetEntry,
  region: string,
  filters: ChartFilters,
): Promise<ShowRow[]> {
  const apiKey = c.env.TMDB_API_KEY;
  if (!apiKey) return [];
  const genreId = filters.genre ? tmdbGenreId("tv", slugifyName(filters.genre)) : null;
  if (filters.genre && !genreId) return [];
  // Streamers (Netflix, Hulu, Disney+…) → their full streaming catalogue via
  // watch-provider. Broadcast/cable channels (HBO, Disney Channel, BBC One…) aren't
  // TMDB watch-providers, so fall back to the channel's own catalogue via
  // with_networks — otherwise these pages render empty despite being listed.
  const pid = tmdbProviderId(entry.name);
  let hits;
  if (pid) {
    hits = await tmdbDiscoverProvider(apiKey, "tv", pid, region, TMDB_NETWORK_PAGES, {
      genreId,
      year: filters.year,
      sort: filters.sort,
    });
  } else {
    const nid = await resolveNetworkTmdbId(c, entry);
    hits = nid
      ? await tmdbDiscoverNetwork(apiKey, nid, TMDB_NETWORK_PAGES, {
          genreId,
          year: filters.year,
          sort: filters.sort,
        })
      : [];
  }
  return hits.map((h) => withGenreLabel(toShowRow(h), filters.genre || null));
}

async function fetchNetworkMoviesLive(
  c: Ctx,
  entry: NetEntry,
  region: string,
  filters: ChartFilters,
): Promise<MovieRow[]> {
  const apiKey = c.env.TMDB_API_KEY;
  const pid = apiKey ? tmdbProviderId(entry.name) : null;
  if (!apiKey || !pid) return [];
  const genreId = filters.genre ? tmdbGenreId("movie", slugifyName(filters.genre)) : null;
  if (filters.genre && !genreId) return [];
  const hits = await tmdbDiscoverProvider(apiKey, "movie", pid, region, TMDB_NETWORK_PAGES, {
    genreId,
    year: filters.year,
    sort: filters.sort,
  });
  return hits.map((h) => withGenreLabel(toMovieRow(h), filters.genre || null));
}

/** Catalog sample for genre picker — unfiltered network chart results. */
export async function topNetworkShows(
  c: Ctx,
  entry: NetEntry,
  region: string,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<ShowRow[]> {
  const results = await fetchNetworkTvChartResults(
    c as Context<HonoEnv>,
    entry,
    { genre: "", year: null, sort: "rated" },
    region,
    regionHas,
  );
  return results.slice(0, limit);
}

/** Catalog sample for genre picker — unfiltered network chart results. */
export async function topNetworkMovies(
  c: Ctx,
  entry: NetEntry,
  region: string,
  regionHas: (json: string | null) => boolean,
  limit: number,
): Promise<MovieRow[]> {
  const results = await fetchNetworkMovieChartResults(
    c as Context<HonoEnv>,
    entry,
    { genre: "", year: null, sort: "rated" },
    region,
    regionHas,
  );
  return results.slice(0, limit);
}

/** Genres present in a network catalog, strongest first. */
export function catalogGenresFromTitles(shows: ShowRow[], movies: MovieRow[]): string[] {
  const genreCount = new Map<string, { label: string; n: number }>();
  const collect = (json: string | null) => {
    if (!json) return;
    try {
      for (const g of JSON.parse(json) as string[]) {
        const sl = slugifyName(g);
        const cur = genreCount.get(sl);
        if (cur) cur.n++;
        else genreCount.set(sl, { label: g, n: 1 });
      }
    } catch {
      /* skip malformed */
    }
  };
  shows.forEach((s) => collect(s.genres));
  movies.forEach((m) => collect(m.genres));
  return [...genreCount.values()]
    .sort((a, b) => b.n - a.n)
    .map((v) => v.label);
}

export async function listNetworkFilterOptions(db: D1Database, current?: NetEntry): Promise<NetEntry[]> {
  const sorted = sortBrowseNetworks(await networkDirectory(db));
  if (current && !sorted.some((n) => n.slug === current.slug)) {
    sorted.unshift(current);
  }
  return sorted;
}

export async function fetchNetworkTvChartResults(
  c: Context<HonoEnv>,
  entry: NetEntry,
  filters: ChartFilters,
  region: string,
  regionHas: (json: string | null) => boolean,
): Promise<ShowRow[]> {
  const apiKey = c.env.TMDB_API_KEY;

  // fetchNetworkShowsLive resolves a watch-provider OR a TMDB network id; only
  // when it finds neither (and returns []) do we drop to the D1 catalogue.
  if (apiKey) {
    const live = await fetchNetworkShowsLive(c, entry, region, filters);
    if (live.length) {
      const enriched = await enrichShowsFromD1(c.env.DB, live);
      return sortShows(
        enriched.filter((s) => s.rating != null),
        filters.sort,
      ).slice(0, NETWORK_CHART_LIMIT);
    }
  }

  const d1 = await fetchNetworkShowsD1(c, filters, regionHas, NETWORK_CHART_LIMIT);
  return sortShows(d1, filters.sort).slice(0, NETWORK_CHART_LIMIT);
}

export async function fetchNetworkMovieChartResults(
  c: Context<HonoEnv>,
  entry: NetEntry,
  filters: ChartFilters,
  region: string,
  regionHas: (json: string | null) => boolean,
): Promise<MovieRow[]> {
  const apiKey = c.env.TMDB_API_KEY;
  const pid = apiKey ? tmdbProviderId(entry.name) : null;

  if (apiKey && pid) {
    const live = await fetchNetworkMoviesLive(c, entry, region, filters);
    if (live.length) {
      const enriched = await enrichMoviesFromD1(c.env.DB, live);
      return sortMovies(
        enriched.filter((m) => m.rating != null),
        filters.sort,
      ).slice(0, NETWORK_CHART_LIMIT);
    }
  }

  const d1 = await fetchNetworkMoviesD1(c, filters, regionHas, NETWORK_CHART_LIMIT);
  return sortMovies(d1, filters.sort).slice(0, NETWORK_CHART_LIMIT);
}
