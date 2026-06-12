// Lateral navigation: show tab rail and sibling-page sub-nav.
import { FC } from "hono/jsx";

// One line, no horizontal scrolling: every cut tab kept a door elsewhere —
// where-to-watch via the hero's "See all", next-episode via the overview
// answer card, worst/essential via Best-episodes cross-links and the
// Shortcut slate, the calendar via next-episode/release-date pages.
export const ShowTabs: FC<{ slug: string; current?: string }> = ({ slug, current }) => {
  // ordered by essence: the schedule questions fans ask daily, then the
  // money content, then the explore tail
  const tabs: [string, string, string][] = [
    ["overview", "Overview", `/show/${slug}`],
    ["next", "Next episode", `/show/${slug}/next-episode`],
    ["release", "Release date", `/show/${slug}/release-date`],
    ["best", "Best episodes", `/show/${slug}/best-episodes`],
    ["ratings", "Ratings graph", `/show/${slug}/ratings`],
    ["similar", "Similar shows", `/show/${slug}/similar`],
    ["cast", "Cast", `/show/${slug}/cast`],
    // Media rides the rail on the main details page only — and on itself,
    // so the page you're on never vanishes from its own rail
    ...(current === "overview" || current === "media"
      ? ([["media", "Media", `/show/${slug}/media`]] as [string, string, string][])
      : []),
    // Compare lives in Keep exploring, not the rail
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
    // Compare lives in Keep exploring, not the rail
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
// ?season filter. Same essence order as the show rail; next-episode and
// release-date are show-level answers and always one tap away.
export const SeasonTabs: FC<{
  slug: string;
  season: number;
  current?: string;
  latest?: boolean;
}> = ({ slug, season, current }) => {
  const q = `?season=${season}`;
  // the show rail's main set, season-scoped where a season variant exists;
  // Worst/Essential live on as cross-links under Best episodes, not tabs
  const tabs: [string, string, string][] = [
    ["overview", `Season ${season} overview`, `/show/${slug}/season/${season}`],
    ["next", "Next episode", `/show/${slug}/next-episode`],
    ["release", "Release date", `/show/${slug}/release-date`],
    ["best", "Best episodes", `/show/${slug}/best-episodes${q}`],
    ["ratings", "Ratings graph", `/show/${slug}/ratings${q}`],
    ["similar", "Similar shows", `/show/${slug}/similar`],
    ["cast", "Cast", `/show/${slug}/cast${q}`],
    ["media", "Media", `/show/${slug}/media`],
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
