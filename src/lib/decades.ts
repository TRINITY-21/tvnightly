/** Parse a decade slug like "2010s" → { start: 2010, end: 2019, label: "2010s" }. */
export function parseDecadeSlug(raw: string): { start: number; end: number; label: string } | null {
  const m = /^(\d{4})s$/.exec(raw);
  if (!m) return null;
  const start = Number(m[1]);
  if (!Number.isInteger(start) || start < 1950 || start > 2030) return null;
  return { start, end: start + 9, label: raw };
}

export const TV_DECADES = ["1980s", "1990s", "2000s", "2010s", "2020s"] as const;
