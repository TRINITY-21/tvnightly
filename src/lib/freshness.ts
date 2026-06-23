// Freshness helpers for renewal / schedule pages — "Updated today" when sync
// or a show_events row touched the record on the current UTC day.
import { epochDay } from "./seo";

export const freshEpoch = (...epochs: (number | null | undefined)[]): number | null => {
  const valid = epochs.filter((e): e is number => e != null && e > 0);
  return valid.length ? Math.max(...valid) : null;
};

export const isUpdatedToday = (epochSeconds: number | null | undefined): boolean => {
  const day = epochDay(epochSeconds);
  return day != null && day === new Date().toISOString().slice(0, 10);
};

export const freshLabel = (epochSeconds: number | null | undefined): string | null => {
  if (!isUpdatedToday(epochSeconds)) return null;
  return "Updated today";
};
