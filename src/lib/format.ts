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

/** Networks + streamers with enough mirrored shows to deserve a page. */

export const comparePathFor = (a: string, b: string) =>
  a.localeCompare(b) <= 0 ? `/compare/${a}-vs-${b}` : `/compare/${b}-vs-${a}`;

export const fmtMarathon = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`;
