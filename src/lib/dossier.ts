// The match dossier: why each similar show made the list, computed from
// fields already on the row — no new queries, no invented copy. Every
// signal is a verifiable fact; if we can't back it, we don't say it.
import { ShowRow } from "../types";
import { stripHtml } from "./format";
import { providerBrand } from "./providers";

type CastEntry = { n: string; c: string | null; img: string | null };

export type Dossier = {
  /** Genre chyron tokens: matching genres first (bright), flavor after (dim). */
  genreLine: { g: string; hit: boolean }[];
  era: string | null;
  /** Network token for the title line — null when a signal already names it. */
  metaNet: string | null;
  signals: string[];
  pitch: string | null;
  isBlurb: boolean;
};

/** First sentence of a summary (40–220 chars), word-safe when none fits. */
export const firstSentence = (text: string): string | null => {
  const t = text.trim();
  if (!t) return null;
  const m = /^[\s\S]{40,219}?[.!?](?=["')\]]?(\s|$))/.exec(t);
  if (m) return m[0].trim();
  if (t.length <= 220) return t;
  const cut = t.slice(0, 220);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
};

const castNames = (row: ShowRow): string[] =>
  (row.cast_json ? (JSON.parse(row.cast_json) as CastEntry[]) : []).map((p) => p.n);

export function buildDossier(home: ShowRow, s: ShowRow, region: string): Dossier {
  const homeGenres = new Set<string>(home.genres ? JSON.parse(home.genres) : []);
  const genres: string[] = s.genres ? JSON.parse(s.genres) : [];
  const genreLine = [
    ...genres.filter((g) => homeGenres.has(g)).map((g) => ({ g, hit: true })),
    ...genres.filter((g) => !homeGenres.has(g)).map((g) => ({ g, hit: false })),
  ].slice(0, 4);

  const signals: string[] = [];

  // shared cast — the strongest "trust this match" receipt we hold
  const homeCast = new Set(castNames(home).map((n) => n.toLowerCase()));
  const shared = castNames(s).filter((n) => homeCast.has(n.toLowerCase()));
  if (shared.length === 1) signals.push(`${shared[0]} also stars`);
  else if (shared.length > 1) signals.push(`${shared[0]} and ${shared[1]} also star`);

  if (s.network && s.network === home.network) signals.push(`Same network — ${s.network}`);

  // streaming receipt: the visitor's region ONLY — a US fallback here would
  // assert availability the visitor doesn't have
  if (signals.length < 2) {
    const intl: Record<string, string[]> = s.providers_intl ? JSON.parse(s.providers_intl) : {};
    const provs = intl[region] ?? [];
    if (provs.length) {
      // providerBrand() is a lowercase dedupe key — display the shortest raw
      // name of that brand ("Netflix" beats "Netflix Standard with Ads")
      const brand = providerBrand(provs[0]);
      const name = provs
        .filter((p) => providerBrand(p) === brand)
        .reduce((a, b) => (b.trim().length < a.trim().length ? b : a))
        .trim();
      const homeIntl: Record<string, string[]> = home.providers_intl
        ? JSON.parse(home.providers_intl)
        : {};
      const homeBrands = new Set((homeIntl[region] ?? []).map(providerBrand));
      // "Also on" = you can keep watching where you already are
      signals.push(homeBrands.has(brand) ? `Also on ${name}` : `Streaming on ${name}`);
    }
  }

  // the era cluster names the network only when no signal already does —
  // a Netflix original must not read "Netflix · Streaming on Netflix"
  const net = s.network ?? s.web_channel;
  const metaNet =
    net && !signals.some((x) => x.toLowerCase().includes(net.toLowerCase())) ? net : null;

  // the pitch fills quiet rows; rows with two receipts already earn the click
  let pitch: string | null = null;
  let isBlurb = false;
  if (signals.length < 2) {
    if (s.blurb) {
      pitch = s.blurb;
      isBlurb = true;
    } else if (s.summary) {
      pitch = firstSentence(stripHtml(s.summary));
    }
  }

  const era = s.premiered
    ? `${s.premiered.slice(0, 4)}${
        s.ended ? `–${s.ended.slice(0, 4)}` : s.status === "Running" ? "–present" : ""
      }`
    : null;

  return { genreLine, era, metaNet, signals, pitch, isBlurb };
}
