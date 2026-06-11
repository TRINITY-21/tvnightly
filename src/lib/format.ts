// Pure formatting helpers: text, dates, slugs, episode codes.
import { EpisodeRow, CastEntry } from "../types";

export const stripHtml = (s: string | null) => (s ?? "").replace(/<[^>]*>/g, "").trim();

export const epCode = (e: EpisodeRow) =>
  `S${String(e.season ?? 0).padStart(2, "0")}E${String(e.number ?? 0).padStart(2, "0")}`;
export const airTime = (airstamp: string | null) =>
  airstamp ? new Date(airstamp).toISOString().slice(11, 16) : null;
export const premiereDateParts = (airdate: string | null) => {
  if (!airdate) return { day: "—", month: "" };
  const d = new Date(`${airdate}T12:00:00`);
  return {
    day: String(d.getUTCDate()),
    month: d.toLocaleString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase(),
  };
};
export const homeDateline = () => {
  const d = new Date();
  const weekday = d.toLocaleString("en-US", { weekday: "long" });
  const monthDay = d.toLocaleString("en-US", { month: "long", day: "numeric" });
  return `${weekday} · ${monthDay}`;
};

export const personHref = (p: CastEntry) => (p.id ? `/person/${slugifyName(p.n)}-${p.id}` : null);

export const ageOf = (b?: string, d?: string): number | null => {
  if (!b) return null;
  const end = d ? new Date(d) : new Date();
  const born = new Date(b);
  let a = end.getFullYear() - born.getFullYear();
  const m = end.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < born.getDate())) a--;
  return a;
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const longDate = (iso: string): string => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
};

export const slugifyName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Canonical episode page path: /show/{slug}/s05e01 */
export const epHref = (slug: string, e: EpisodeRow) => `/show/${slug}/${epCode(e).toLowerCase()}`;

/* The mirror stores TVmaze's medium renditions (210x295 posters, 250x140
   stills) — fine for thumbnails, mush at hero scale. TVmaze serves the full
   original at a predictable sibling URL, so we derive instead of re-seeding. */
export const hiRes = (url: string | null): string | null =>
  url ? url.replace(/\/medium_(portrait|landscape)\//, "/original_untouched/") : null;

/** 1x/2x srcset: medium for standard screens, the original only for dense ones. */
export const retinaSet = (url: string | null): string | undefined =>
  url && /\/medium_(portrait|landscape)\//.test(url)
    ? `${url} 1x, ${url.replace(/\/medium_(portrait|landscape)\//, "/original_untouched/")} 2x`
    : undefined;

/** ONE poster per show, everywhere: the backfilled TMDB one-sheet when the
 *  bridge exists, the TVmaze poster otherwise — same art on cards, heroes,
 *  and ledger rows. */
export const posterSrc = (
  s: { poster_url: string | null; image_url: string | null },
): { src: string; srcset?: string } | null =>
  s.poster_url
    ? { src: s.poster_url, srcset: `${s.poster_url} 1x, ${s.poster_url.replace("/w342/", "/w780/")} 2x` }
    : s.image_url
      ? { src: s.image_url, srcset: retinaSet(s.image_url) }
      : null;

/** Inline style for a hero backdrop: image-set picks the heavy rendition
 *  only on dense screens (a CSS background can never use srcset). */
export const heroBg = (x1: string, x2?: string): string =>
  x2 && x2 !== x1
    ? `background-image:url('${x2}');` +
      `background-image:-webkit-image-set(url('${x1}') 1x, url('${x2}') 2x);` +
      `background-image:image-set(url('${x1}') 1x, url('${x2}') 2x)`
    : `background-image:url('${x1}')`;

export const comparePathFor = (a: string, b: string) =>
  a.localeCompare(b) <= 0 ? `/compare/${a}-vs-${b}` : `/compare/${b}-vs-${a}`;

export const fmtMarathon = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;
