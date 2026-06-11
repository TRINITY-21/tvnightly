// Lateral navigation: show tab rail and sibling-page sub-nav.
import { FC } from "hono/jsx";

// One line, no horizontal scrolling: every cut tab kept a door elsewhere —
// where-to-watch via the hero's "See all", next-episode via the overview
// answer card, worst/essential via Best-episodes cross-links and the
// Shortcut slate, the calendar via next-episode/release-date pages.
export const ShowTabs: FC<{ slug: string; current?: string }> = ({ slug, current }) => {
  const tabs: [string, string, string][] = [
    ["overview", "Overview", `/show/${slug}`],
    ["similar", "Similar shows", `/show/${slug}/similar`],
    ["media", "Media", `/show/${slug}/media`],
    ["best", "Best episodes", `/show/${slug}/best-episodes`],
    ["ratings", "Ratings graph", `/show/${slug}/ratings`],
    // Compare is a doorway, not a place you're "on" — it only shows from
    // the main details page
    ...(current === "overview"
      ? ([["compare", "Compare", `/compare?a=${slug}`]] as [string, string, string][])
      : []),
    // next-episode is reached through the overview answer card; when you're
    // there, the rail shows where you are
    ...(current === "next"
      ? ([["next", "Next episode", `/show/${slug}/next-episode`]] as [string, string, string][])
      : []),
    ["release", "Release date", `/show/${slug}/release-date`],
    ["cast", "Cast", `/show/${slug}/cast`],
  ];
  return (
    <nav class="subnav subnav-scroll">
      {tabs.map(([key, label, href]) => (
        <a href={href} class={key === current ? "active" : ""}>
          {label}
        </a>
      ))}
    </nav>
  );
};

// Movie pages get the same lateral rail as shows — fewer questions, same voice.
export const MovieTabs: FC<{ slug: string; current?: string }> = ({ slug, current }) => {
  const tabs: [string, string, string][] = [
    ["overview", "Overview", `/movie/${slug}`],
    ["similar", "Similar movies", `/movie/${slug}/similar`],
    // same rule as shows: Compare only from the main details page — and on
    // the compare doorway itself, where it's the active tab
    ...(current === "overview" || current === "compare"
      ? ([["compare", "Compare", `/movie/${slug}/compare`]] as [string, string, string][])
      : []),
    ["media", "Media", `/movie/${slug}/media`],
    ["cast", "Cast", `/movie/${slug}/cast`],
  ];
  return (
    <nav class="subnav subnav-scroll">
      {tabs.map(([key, label, href]) => (
        <a href={href} class={key === current ? "active" : ""}>
          {label}
        </a>
      ))}
    </nav>
  );
};

// Inside a season, the rail stays in that season: every tab carries the
// ?season filter. "All seasons" drops the filter, not the page — it lands
// on the unfiltered variant of wherever you stand. Only the overview exits
// to the show page, because no all-seasons overview page exists.
export const SeasonTabs: FC<{
  slug: string;
  season: number;
  current?: string;
  latest?: boolean;
}> = ({ slug, season, current, latest }) => {
  const q = `?season=${season}`;
  const allSeasons: Record<string, string> = {
    best: `/show/${slug}/best-episodes`,
    worst: `/show/${slug}/worst-episodes`,
    essential: `/show/${slug}/essential`,
    ratings: `/show/${slug}/ratings`,
    cast: `/show/${slug}/cast`,
  };
  const tabs: [string, string, string][] = [
    ["overview", `Season ${season} overview`, `/show/${slug}/season/${season}`],
    ["best", "Best episodes", `/show/${slug}/best-episodes${q}`],
    ["worst", "Worst", `/show/${slug}/worst-episodes${q}`],
    ["essential", "Essential", `/show/${slug}/essential${q}`],
    ["ratings", "Ratings graph", `/show/${slug}/ratings${q}`],
    ["cast", "Cast", `/show/${slug}/cast${q}`],
    // the latest season's next-episode and release-date questions ARE the
    // show-level answers — only there can these tabs tell the truth
    ...(latest
      ? ([
          ["next", "Next episode", `/show/${slug}/next-episode`],
          ["release", "Release date", `/show/${slug}/release-date`],
        ] as [string, string, string][])
      : []),
  ];
  return (
    <nav class="subnav subnav-scroll">
      {tabs.map(([key, label, href]) => (
        <a href={href} class={key === current ? "active" : ""}>
          {label}
        </a>
      ))}
      <a class="chev-after" href={allSeasons[current ?? ""] ?? `/show/${slug}`}>
        All seasons
      </a>
    </nav>
  );
};

// Sibling pages get tabs, not nav slots.
export const SubNav: FC<{ items: [string, string][]; current: string }> = ({ items, current }) => (
  <nav class="subnav">
    {items.map(([label, href]) => (
      <a href={href} class={href === current ? "active" : ""}>
        {label}
      </a>
    ))}
  </nav>
);
export const SCHEDULE_TABS: [string, string][] = [
  ["Tonight", "/tonight"],
  ["This week", "/calendar"],
  ["Premieres", "/premieres"],
];
export const NEWS_TABS: [string, string][] = [
  ["Streaming news", "/whats-new"],
  ["Renewals & dates", "/renewals"],
];
