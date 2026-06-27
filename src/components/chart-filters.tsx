import { FC } from "hono/jsx";
import type { ChartFilters, ChartKind } from "../lib/chart-filters";
import {
  chartBasePath,
  chartDestinationOptions,
  chartSortOptions,
  chartYearOptions,
  detectChartDestination,
  guideBasePath,
  genreChartBasePath,
  networkChartBasePath,
  networkChartQuery,
  tvDecadeGuideBasePath,
  underratedBasePath,
  type GenreChartSurface,
} from "../lib/chart-filters";
import type { NetEntry } from "../lib/network-chart";
import { slugifyName } from "../lib/format";
import { FilterSelect } from "./forms";

export const ChartFilterBar: FC<{
  kind: ChartKind;
  filters: ChartFilters;
  genres: string[];
  /** When set, filter navigation stays on the year watch-guide URL instead of the all-time chart. */
  guideYear?: number;
  /** When set (TV only), filter navigation stays on /tv/best/{decade}. */
  guideDecade?: string;
  /** When set, filter navigation stays on the underrated chart URL. */
  guideUnderrated?: boolean;
  /** When set, filter navigation stays on /genre/{slug} genre chart URLs. */
  guideGenre?: { surface: GenreChartSurface; slug: string };
  /** When set, filter navigation stays on /network/{slug} chart URLs. */
  guideNetwork?: { slug: string; name: string };
  /** Network picker options (guideNetwork pages only). */
  networks?: NetEntry[];
}> = ({
  kind,
  filters,
  genres,
  guideYear,
  guideDecade,
  guideUnderrated,
  guideGenre,
  guideNetwork,
  networks,
}) => {
  const curYear = new Date().getFullYear();
  const action = guideNetwork
    ? networkChartBasePath(guideNetwork.slug, kind) + networkChartQuery(filters)
    : guideGenre
    ? genreChartBasePath(guideGenre.surface, guideGenre.slug)
    : guideUnderrated
    ? underratedBasePath(kind, filters.genre || undefined)
    : guideDecade != null
      ? tvDecadeGuideBasePath(guideDecade, filters.genre || undefined)
      : guideYear != null
        ? guideBasePath(kind, guideYear, filters.genre || undefined)
        : chartBasePath(kind, filters.genre || undefined);
  const chartLabel = kind === "tv" ? "TV Shows" : "Movies";
  const destination = detectChartDestination({
    kind,
    guideYear,
    guideDecade,
    guideUnderrated,
    guideGenre,
  });
  const destinations = chartDestinationOptions(curYear, guideYear);

  return (
    <div
      class="chart-filter-bar"
      data-chart-kind={kind}
      data-chart-current-year={String(curYear)}
      data-chart-destination={destination}
      {...(guideYear != null ? { "data-chart-guide-year": String(guideYear) } : {})}
      {...(guideDecade != null ? { "data-chart-guide-decade": guideDecade } : {})}
      {...(guideUnderrated ? { "data-chart-guide-underrated": "1" } : {})}
      {...(guideGenre
        ? {
            "data-chart-guide-genre": guideGenre.surface,
            "data-genre-slug": guideGenre.slug,
          }
        : {})}
      {...(guideNetwork ? { "data-chart-guide-network": guideNetwork.slug } : {})}
    >
      {guideNetwork && networks?.length ? (
        <FilterSelect
          label="Network"
          name="network"
          primary
          current={guideNetwork.slug}
          options={networks.map((n) => ({ value: n.slug, text: n.name }))}
        />
      ) : null}
      {!guideNetwork ? (
        <div class="chart-filter-chart watch-field">
          <span class="watch-field-label" id="chart-kind-label">
            Chart
          </span>
          <select data-fancy data-chart-destination aria-labelledby="chart-kind-label">
            {destinations.map((d) => (
              <option value={d.id} selected={d.id === destination}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <form
        method="get"
        action={action}
        class="chart-filter-fields"
        aria-label={`Filter ${chartLabel.toLowerCase()} chart`}
      >
        <FilterSelect
          label="Genre"
          name="genre"
          current={filters.genre}
          options={[
            { value: "", text: "All genre" },
            ...genres.map((g) => ({ value: g, text: g, slug: slugifyName(g) })),
          ]}
        />
        {!guideNetwork ? (
          <FilterSelect
            label="Year"
            name="year"
            current={filters.year != null ? String(filters.year) : ""}
            options={chartYearOptions()}
          />
        ) : null}
        {!guideNetwork ? (
          <FilterSelect
            label="Sort"
            name="sort"
            current={filters.sort}
            options={chartSortOptions.map((o) => ({ value: o.value, text: o.text }))}
          />
        ) : null}
      </form>
      {guideNetwork ? (
        <FilterSelect
          label="Year"
          name="year"
          current={filters.year != null ? String(filters.year) : ""}
          options={chartYearOptions()}
        />
      ) : null}
      {guideNetwork ? (
        <FilterSelect
          label="Sort"
          name="sort"
          current={filters.sort}
          options={chartSortOptions.map((o) => ({ value: o.value, text: o.text }))}
        />
      ) : null}
    </div>
  );
};
