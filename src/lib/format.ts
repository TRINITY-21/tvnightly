// Pure formatting helpers: text, dates, slugs, episode codes.
import { EpisodeRow, CastEntry } from "../types";

export const stripHtml = (s: string | null) => (s ?? "").replace(/<[^>]*>/g, "").trim();

/** Zero-pad a season/episode number to two digits (null → "00"). */
export const pad2 = (n: number | null) => String(n ?? 0).padStart(2, "0");

export const epCode = (e: EpisodeRow) => `S${pad2(e.season)}E${pad2(e.number)}`;
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

/** epoch seconds → "Jun 12" — the date chyron on wire rows and shelf chips */
export const shortDate = (ts: number) =>
  new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric" });

export const slugifyName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    // drop apostrophes/quotes and acronym dots BEFORE hyphenating so they join
    // their word: "Marvel's S.H.I.E.L.D." \u2192 marvels-shield (not marvel-s-s-h-i-e-l-d),
    // "Schindler's List" \u2192 schindlers-list, "Colin O'Donoghue" \u2192 colin-odonoghue
    .replace(/['\u2018\u2019"\u201c\u201d.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Canonical episode page path: /show/{slug}/s05e01 */
export const epHref = (slug: string, e: EpisodeRow) => `/show/${slug}/${epCode(e).toLowerCase()}`;

/* The mirror stores TVmaze's medium renditions (210x295 posters, 250x140
   stills) — fine for thumbnails, mush at hero scale. TVmaze serves the full
   original at a predictable sibling URL, so we derive instead of re-seeding. */
export const hiRes = (url: string | null): string | null =>
  url ? url.replace(/\/medium_(portrait|landscape)\//, "/original_untouched/") : null;

/** TVmaze only offers medium (~210px) and original_untouched (unbounded,
 *  often 2000–3500px). For poster-card slots (~252px), the original is
 *  massively oversized on retina displays — 6 MB+ wasted per page. No
 *  intermediate rendition exists, so we skip the 2x srcset; the medium
 *  is sharp enough for every poster slot. */
export const retinaSet = (_url: string | null): string | undefined => undefined;

/** Bounded retina still for register slots (~400w): a 168–256px slot wants
 *  large_landscape, never the unbounded original_untouched. */
export const largeStill = (url: string): string =>
  url.replace("/medium_landscape/", "/large_landscape/");

/** Episode still for slate-scale slots (~300–400w). TMDB mirrors store w300;
 *  upgrade to w500/w780 so the next-episode hero stays sharp on retina. */
export const stillSrc = (url: string): { src: string; srcset: string } => {
  if (/\/t\/p\/w\d+\//.test(url)) {
    const at = (s: string) => url.replace(/\/t\/p\/w\d+\//, `/t/p/${s}/`);
    return { src: at("w500"), srcset: `${at("w500")} 1x, ${at("w780")} 2x` };
  }
  const large = largeStill(url);
  return { src: url, srcset: `${url} 1x, ${large} 2x` };
};

/** A person headshot at the right resolution for its slot. Both sources cap low
 *  (TVmaze `medium` ~210px, TMDB `w185`), so large slots upscale to mush. We
 *  derive the sharp sibling instead of re-seeding: TMDB resizes cleanly
 *  (w342 + an h632 retina), TVmaze only has the unbounded original — worth it for
 *  the single hero headshot, too heavy per thumbnail (so thumbs keep the medium).
 *  `big` marks the hero/poster slot. */
export const headshot = (
  url: string | null,
  big = false,
): { src: string; srcset?: string } | null => {
  if (!url) return null;
  if (/\/t\/p\/w\d+\//.test(url)) {
    const at = (s: string) => url.replace(/\/t\/p\/w\d+\//, `/t/p/${s}/`);
    return big
      ? { src: at("w342"), srcset: `${at("w342")} 1x, ${at("h632")} 2x` }
      : { src: at("w185"), srcset: `${at("w185")} 1x, ${at("w342")} 2x` };
  }
  if (url.includes("/medium_portrait/"))
    return big ? { src: url.replace("/medium_portrait/", "/original_untouched/") } : { src: url };
  return { src: url };
};

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
// A title from this year or last is "new" — used to show a NEW badge where a
// rating is hidden (too few votes for a stable average) instead of a blank slot.
export const isNewYear = (year: number | null | undefined): boolean =>
  year != null && !Number.isNaN(year) && year >= new Date().getFullYear() - 1;

export const heroBg = (x1: string, x2?: string): string =>
  x2 && x2 !== x1
    ? `background-image:url('${x2}');` +
      `background-image:-webkit-image-set(url('${x1}') 1x, url('${x2}') 2x);` +
      `background-image:image-set(url('${x1}') 1x, url('${x2}') 2x)`
    : `background-image:url('${x1}')`;

export const comparePathFor = (a: string, b: string) =>
  a.localeCompare(b) <= 0 ? `/compare/${a}-vs-${b}` : `/compare/${b}-vs-${a}`;

/** Movie matchups live under /compare/movie/, same alphabetical canonical. */
export const movieComparePathFor = (a: string, b: string) =>
  a.localeCompare(b) <= 0 ? `/compare/movie/${a}-vs-${b}` : `/compare/movie/${b}-vs-${a}`;

export const fmtMarathon = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;

/** Runtime in the films idiom: "2h 22m", "2h", "47m" — drops the empty part. */
export const fmtRuntime = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
};
