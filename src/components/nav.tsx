// Lateral navigation: show tab rail and sibling-page sub-nav.
import { FC } from "hono/jsx";
import { IconCal } from "./icons";

export const ShowTabs: FC<{ slug: string; current?: string }> = ({ slug, current }) => {
  const tabs: [string, string, string][] = [
    ["overview", "Overview", `/show/${slug}`],
    ["watch", "Where to watch", `/show/${slug}/where-to-watch`],
    ["similar", "Similar shows", `/show/${slug}/similar`],
    ["best", "Best episodes", `/show/${slug}/best-episodes`],
    ["worst", "Worst", `/show/${slug}/worst-episodes`],
    ["essential", "Essential", `/show/${slug}/essential`],
    ["ratings", "Ratings graph", `/show/${slug}/ratings`],
    ["next", "Next episode", `/show/${slug}/next-episode`],
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
      <a href={`/show/${slug}/calendar.ics`}>
        <IconCal /> Calendar
      </a>
    </nav>
  );
};

// Inside a season, the rail stays in that season: every tab carries the
// ?season filter, and "All seasons" is the one exit back to show level.
// Show-level-only concepts (next episode, release date, cast) don't appear.
export const SeasonTabs: FC<{
  slug: string;
  season: number;
  current?: string;
  latest?: boolean;
}> = ({ slug, season, current, latest }) => {
  const q = `?season=${season}`;
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
      <a class="chev-after" href={`/show/${slug}`}>
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
