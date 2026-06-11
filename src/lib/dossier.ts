// The match dossier: why each similar title made the list, computed from
// fields already on the row — no new queries, no invented copy. Every
// signal is a verifiable fact; if we can't back it, we don't say it.
import { MovieRow, ShowRow } from "../types";
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

const genreTokens = (
  homeGenres: string | null,
  ownGenres: string | null,
): { g: string; hit: boolean }[] => {
  const home = new Set<string>(homeGenres ? JSON.parse(homeGenres) : []);
  const own: string[] = ownGenres ? JSON.parse(ownGenres) : [];
  return [
    ...own.filter((g) => home.has(g)).map((g) => ({ g, hit: true })),
    ...own.filter((g) => !home.has(g)).map((g) => ({ g, hit: false })),
  ].slice(0, 4);
};

/** Streaming receipt for the visitor's region ONLY — a US fallback here
 *  would assert availability the visitor doesn't have. */
const streamingSignal = (
  home: { providers_intl: string | null },
  s: { providers_intl: string | null },
  region: string,
): string | null => {
  const intl: Record<string, string[]> = s.providers_intl ? JSON.parse(s.providers_intl) : {};
  const provs = intl[region] ?? [];
  if (!provs.length) return null;
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
  return homeBrands.has(brand) ? `Also on ${name}` : `Streaming on ${name}`;
};

export function buildDossier(home: ShowRow, s: ShowRow, region: string): Dossier {
  const genreLine = genreTokens(home.genres, s.genres);

  const signals: string[] = [];

  // shared cast — the strongest "trust this match" receipt we hold
  const homeCast = new Set(castNames(home).map((n) => n.toLowerCase()));
  const shared = castNames(s).filter((n) => homeCast.has(n.toLowerCase()));
  if (shared.length === 1) signals.push(`${shared[0]} also stars`);
  else if (shared.length > 1) signals.push(`${shared[0]} and ${shared[1]} also star`);

  if (s.network && s.network === home.network) signals.push(`Same network — ${s.network}`);

  if (signals.length < 2) {
    const sig = streamingSignal(home, s, region);
    if (sig) signals.push(sig);
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

/** Movie variant: no cast mirror, no networks, no editorial blurbs —
 *  genres, year, the streaming receipt, and the overview's first sentence. */
export function buildMovieDossier(home: MovieRow, m: MovieRow, region: string): Dossier {
  const signals: string[] = [];
  const sig = streamingSignal(home, m, region);
  if (sig) signals.push(sig);
  return {
    genreLine: genreTokens(home.genres, m.genres),
    era: m.year != null ? String(m.year) : null,
    metaNet: null,
    signals,
    pitch: m.overview ? firstSentence(stripHtml(m.overview)) : null,
    isBlurb: false,
  };
}
