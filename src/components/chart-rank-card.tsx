// Ranked chart grid tiles — poster + title + meta bars; rating ribbon on poster.
import { FC, PropsWithChildren } from "hono/jsx";
import type { ChartFilters, ChartKind } from "../lib/chart-filters";
import { chartQuery, networkChartQuery } from "../lib/chart-filters";
import { CHART_PAGE_SIZE } from "../lib/chart-results";
import { fmtRuntime, posterSrc } from "../lib/format";
import type { MovieRow, ShowRow } from "../types";
import { CardPlay } from "./cards";
import { PosterRating, tmdbRingScore } from "./detail-hero";

export type ChartRankItem = {
  rank: number;
  href: string;
  name: string;
  meta: string;
  metaAccent?: boolean;
  poster: { src: string; srcset?: string } | null;
  rating: number | null;
  trailerType: "tv" | "movie";
  tmdbId?: number | null;
};

const CUR_YEAR = new Date().getFullYear();

const metaBarClass = (meta: string, accent?: boolean) =>
  accent || meta === String(CUR_YEAR) ? "chart-rank-meta is-current" : "chart-rank-meta";

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");

const PLAY_SVG =
  '<svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">' +
  '<circle cx="24" cy="24" r="19.5" fill="none" stroke="#fff" stroke-opacity="0.88" stroke-width="3.5"/>' +
  '<path d="M18.4 14.2v19.6l15.2-9.8z" fill="#fff" fill-opacity="0.55" stroke="#fff" stroke-opacity="0.55" stroke-width="0.75" stroke-linejoin="round"/>' +
  "</svg>";

export function movieChartRankItem(m: MovieRow, rank: number): ChartRankItem {
  const year = m.year ?? null;
  return {
    rank,
    href: `/movie/${m.slug}`,
    name: m.title,
    meta: year ? String(year) : m.runtime ? fmtRuntime(m.runtime) : "Film",
    metaAccent: year === CUR_YEAR,
    poster: m.poster_url
      ? {
          src: m.poster_url,
          srcset: `${m.poster_url} 1x, ${m.poster_url.replace("/t/p/w342/", "/t/p/w500/")} 2x`,
        }
      : null,
    rating: m.rating,
    trailerType: "movie",
    tmdbId: m.tmdb_id,
  };
}

export function showChartRankItem(
  s: ShowRow,
  rank: number,
  meta: string,
): ChartRankItem {
  return {
    rank,
    href: `/show/${s.slug}`,
    name: s.name,
    meta,
    metaAccent: /^\d{4}$/.test(meta) && Number(meta) === CUR_YEAR,
    poster: posterSrc(s),
    rating: s.rating,
    trailerType: "tv",
    tmdbId: s.tmdb_id,
  };
}

export function renderChartRankCardHtml(item: ChartRankItem): string {
  const score = item.rating != null ? tmdbRingScore(item.rating) : null;
  const tier =
    score != null ? (score >= 75 ? "high" : score >= 50 ? "mid" : "low") : "";
  const ribbon =
    score != null
      ? `<span class="hub-poster-rating hub-poster-rating-${tier}" title="Viewer rating: ${score}%">` +
        `<span class="hub-poster-rating-ribbon" aria-hidden="true"><span class="hub-poster-rating-val">${score}%</span></span>` +
        `<span class="sr-only">Viewer rating: ${score}%</span></span>`
      : "";
  const play =
    item.tmdbId != null
      ? `<span class="card-play" role="button" tabindex="0" aria-label="Play ${esc(item.name)} trailer" ` +
        `data-trailer-type="${item.trailerType}" data-trailer-id="${item.tmdbId}" data-trailer-name="${esc(item.name)}">${PLAY_SVG}</span>`
      : "";
  const poster = item.poster
    ? `<img class="poster" src="${esc(item.poster.src)}"${
        item.poster.srcset ? ` srcset="${esc(item.poster.srcset)}"` : ""
      } alt="${esc(item.name)} poster" width="200" height="300" loading="lazy" decoding="async"/>`
    : `<span class="card-fallback">${esc(item.name)}</span>`;
  const cls = item.tmdbId != null ? "chart-rank-card has-play" : "chart-rank-card";

  return (
    `<li><a class="${cls}" href="${esc(item.href)}">` +
    `<div class="chart-rank-media"><span class="chart-rank-num" aria-hidden="true">${item.rank}</span>${poster}${play}${ribbon}</div>` +
    `<span class="chart-rank-title">${esc(item.name)}</span>` +
    `<span class="${metaBarClass(item.meta, item.metaAccent)}">${esc(item.meta)}</span>` +
    `</a></li>`
  );
}

export function renderChartRankCardsHtml(items: ChartRankItem[]): string {
  return items.map(renderChartRankCardHtml).join("");
}

function chartMoreUrl(
  kind: ChartKind,
  filters: ChartFilters,
  genreSlug?: string,
  guideYear?: number,
  guideDecade?: string,
  guideUnderrated?: boolean,
  guideGenre?: { surface: string; slug: string },
  guideNetwork?: string,
): string {
  const base = guideNetwork
    ? kind === "movie"
      ? `/network/${guideNetwork}/movies/more`
      : `/network/${guideNetwork}/shows/more`
    : guideGenre
    ? guideGenre.surface === "hub"
      ? kind === "movie"
        ? `/genre/${guideGenre.slug}/movies/more`
        : `/genre/${guideGenre.slug}/more`
      : guideGenre.surface === "shows"
        ? `/genre/${guideGenre.slug}/shows/more`
        : `/genre/${guideGenre.slug}/movies/more`
    : guideUnderrated
    ? kind === "movie"
      ? genreSlug
        ? `/movies/underrated/${genreSlug}/more`
        : "/movies/underrated/more"
      : genreSlug
        ? `/tv/underrated/${genreSlug}/more`
        : "/tv/underrated/more"
    : guideDecade != null && kind === "tv"
      ? genreSlug
        ? `/tv/best/${guideDecade}/${genreSlug}/more`
        : `/tv/best/${guideDecade}/more`
      : guideYear != null
        ? kind === "movie"
          ? genreSlug
            ? `/movies/best/${guideYear}/${genreSlug}/more`
            : `/movies/best/${guideYear}/more`
          : genreSlug
            ? `/tv/best/${guideYear}/${genreSlug}/more`
            : `/tv/best/${guideYear}/more`
        : kind === "tv"
          ? genreSlug
            ? `/top/tv/${genreSlug}/more`
            : "/top/tv/more"
          : genreSlug
            ? `/movies/${genreSlug}/more`
            : "/movies/best/more";
  const q = guideNetwork
    ? networkChartQuery(filters)
    : chartQuery(
        filters,
        guideYear != null || guideDecade != null || guideUnderrated || guideGenre
          ? { omitYear: true }
          : undefined,
      );
  const sep = q ? "&" : "?";
  return `${base}${q}${sep}limit=${CHART_PAGE_SIZE}`;
}

export const ChartRankGrid: FC<{
  children: PropsWithChildren["children"];
  more?: {
    kind: ChartKind;
    filters: ChartFilters;
    genreSlug?: string;
    total: number;
    guideYear?: number;
    guideDecade?: string;
    guideUnderrated?: boolean;
    guideGenre?: { surface: string; slug: string };
    guideNetwork?: string;
  };
}> = ({ children, more }) => (
  <>
    <ol class="chart-rank-grid" data-chart-rank-list>
      {children}
    </ol>
    {more && more.total > CHART_PAGE_SIZE + 1 ? (
      <div
        class="chart-rank-sentinel"
        data-chart-feed={chartMoreUrl(
          more.kind,
          more.filters,
          more.genreSlug,
          more.guideYear,
          more.guideDecade,
          more.guideUnderrated,
          more.guideGenre,
          more.guideNetwork,
        )}
        data-offset={String(CHART_PAGE_SIZE + 1)}
        data-total={String(more.total)}
        aria-hidden="true"
      ></div>
    ) : null}
  </>
);

export const ChartRankCard: FC<ChartRankItem> = (item) => {
  const score = item.rating != null ? tmdbRingScore(item.rating) : null;

  return (
    <li>
      <a
        class={item.tmdbId != null ? "chart-rank-card has-play" : "chart-rank-card"}
        href={item.href}
      >
        <div class="chart-rank-media">
          <span class="chart-rank-num" aria-hidden="true">
            {item.rank}
          </span>
          {item.poster ? (
            <img
              class="poster"
              src={item.poster.src}
              {...(item.poster.srcset ? { srcset: item.poster.srcset } : {})}
              alt={`${item.name} poster`}
              width="200"
              height="300"
              loading="lazy"
              decoding="async"
            />
          ) : (
            <span class="card-fallback">{item.name}</span>
          )}
          {item.tmdbId != null ? (
            <CardPlay type={item.trailerType} id={item.tmdbId} name={item.name} />
          ) : null}
          {score != null ? <PosterRating score={score} label="Viewer rating" /> : null}
        </div>
        <span class="chart-rank-title">{item.name}</span>
        <span class={metaBarClass(item.meta, item.metaAccent)}>{item.meta}</span>
      </a>
    </li>
  );
};
