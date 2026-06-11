// Lateral navigation: show tab rail and sibling-page sub-nav.
import { FC } from "hono/jsx";
import { IconCal } from "./icons";

export const ShowTabs: FC<{ slug: string; current?: string }> = ({ slug, current }) => {
  const tabs: [string, string, string][] = [
    ["overview", "Overview", `/show/${slug}`],
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
