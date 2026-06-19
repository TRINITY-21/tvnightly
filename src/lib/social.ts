// Short-form social cards — 1080x1920 (9:16) SVGs that rasterize to PNG client
// side, the same pipeline as the ratings chart: inlined poster/backdrop data-
// URIs + the brand font, so the saved image is standalone. Built to stop the
// scroll and carry the TV Nightly lockup on every frame.
import { posterDataUri } from "./signal";

const PLATE = "#0e0e11";
const TEXT = "#f8f6f2";
const MUTED = "#b6b1a9";
const GOLD = "#EAC54F";
const AMBER = "#FFA94D";
const LINE = "#2b2b32";
const PANEL = "#141418";
const PANEL_HI = "#1c1c22";
const SYS = "-apple-system,'Segoe UI',Roboto,sans-serif";

const SW = 1080;
const SH = 1920;
const SM = 56; // left content margin
// Shorts + TikTok action rail (like / comment / share) — keep all readable UI left of this
const SR = 168;
const CR = SW - SR; // right edge of the safe content column (~912px)
const CW = CR - SM; // usable content width (~856px)
// Bottom clearance — Shorts subscribe bar + caption strip (conservative but not crushing layout)
const SB = 300;
const FOOT_Y = SH - SB; // top of the footer block

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const r2 = (n: number) => Math.round(n * 100) / 100;
const trunc = (s: string, n: number) => {
  const a = [...s];
  return a.length > n ? `${a.slice(0, n - 1).join("")}…` : s;
};
// greedy wrap into at most `maxLines` lines of ~`max` chars; last line truncates
function wrap(s: string, max: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of s.split(/\s+/)) {
    if (cur && (cur + " " + w).length > max) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = trunc(kept[maxLines - 1] + " " + lines.slice(maxLines).join(" "), max);
    return kept;
  }
  return lines;
}

interface TextOpts {
  size: number;
  wght?: number;
  wdth?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  ls?: number;
  opacity?: number;
  sys?: boolean;
}
const txt = (x: number, y: number, s: string, o: TextOpts) => {
  const f = o.sys
    ? `font-family="${SYS}" font-weight="${o.wght ?? 700}" style="font-variant-numeric:tabular-nums"`
    : `font-weight="${o.wght ?? 700}" style="font-variation-settings:'wdth' ${o.wdth ?? 105},'wght' ${o.wght ?? 700}"`;
  return `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(o.size)}" ${f} fill="${o.fill ?? MUTED}"${
    o.anchor ? ` text-anchor="${o.anchor}"` : ""
  }${o.ls ? ` letter-spacing="${r2(o.ls)}"` : ""}${o.opacity != null ? ` opacity="${o.opacity}"` : ""}>${esc(s)}</text>`;
};

export interface CardEntry {
  name: string;
  posterUri: string | null; // inlined data-URI (or null -> initial tile)
  rating: number | null;
  genres: string[];
  year: string | null;
}

const metaLine = (e: CardEntry) =>
  [e.genres.slice(0, 2).join(" · "), e.year].filter(Boolean).join(" · ");

// a poster clipped to rounded rect; optional rank + rating badges on the art
function poster(
  uri: string | null,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
  id: string,
  badges?: { rank?: number; rating?: number | null },
) {
  const rx = 14;
  const out: string[] = [];
  if (!uri) {
    out.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="#18181e" stroke="${LINE}"/>` +
        txt(x + w / 2, y + h / 2 + 12, trunc(name, 11), { size: 32, fill: MUTED, anchor: "middle", wght: 800 }),
    );
  } else {
    out.push(
      `<g filter="url(#posterShadow)">` +
        `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/></clipPath>` +
        `<image href="${uri}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` +
        `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${rx}" fill="none" stroke="rgba(255,255,255,0.18)"/>` +
        `</g>`,
    );
  }
  if (badges?.rank != null) {
    const bx = x + 10;
    const by = y + 10;
    out.push(
      `<rect x="${bx}" y="${by}" width="40" height="34" rx="8" fill="${AMBER}"/>` +
        txt(bx + 20, by + 24, String(badges.rank).padStart(2, "0"), {
          size: 20,
          fill: PLATE,
          anchor: "middle",
          wght: 900,
          wdth: 90,
        }),
    );
  }
  if (badges?.rating != null) {
    const chipW = 68;
    const chipH = 30;
    const cx = x + 10;
    const cy = y + h - chipH - 10;
    out.push(
      `<rect x="${cx}" y="${cy}" width="${chipW}" height="${chipH}" rx="15" fill="rgba(0,0,0,0.78)"/>` +
        studioRatingMark(cx + chipW / 2, cy + chipH * 0.7, 19, badges.rating, GOLD, "middle"),
    );
  }
  return out.join("");
}

// vector star path — shared by portrait studio cards and OG cards
function starPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (-90 + i * 36) * (Math.PI / 180);
    const rad = i % 2 === 0 ? r : r * 0.5;
    pts.push(`${r2(cx + rad * Math.cos(ang))} ${r2(cy + rad * Math.sin(ang))}`);
  }
  return `M${pts.join("L")}Z`;
}

// vector star + number for portrait studio cards
const studioRatingMark = (
  x: number,
  y: number,
  size: number,
  value: number,
  fill: string,
  anchor: "start" | "middle" | "end" = "start",
): string => {
  const t = value.toFixed(1);
  const r = size * 0.46;
  const gap = size * 0.3;
  const textW = t.length * size * 0.56;
  const groupW = r * 2 + gap + textW;
  const left = anchor === "start" ? x : anchor === "end" ? x - groupW : x - groupW / 2;
  return (
    `<path d="${starPath(left + r, y - size * 0.33, r)}" fill="${fill}"/>` +
    txt(left + r * 2 + gap, y, t, { size, fill, wght: 800, anchor: "start" })
  );
};

// the "Standby Glow" TV mark — same vector as OG cards, scaled for portrait
const studioMark = (mx: number, my: number, h: number) => {
  const s = h / 24;
  return (
    `<g transform="translate(${r2(mx)},${r2(my)}) scale(${r2(s)})">` +
    `<rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5"/>` +
    `<circle cx="26.5" cy="16.5" r="3.4" fill="${AMBER}" opacity="0.22"/>` +
    `<circle cx="26.5" cy="16.5" r="2.2" fill="${AMBER}"/>` +
    `</g>`
  );
};

const studioBrand = (y = 76) => {
  const markH = 28;
  const markW = (markH * 36) / 24;
  const wordX = SM + markW + 12;
  return (
    `<g opacity="0.92" filter="url(#textGlow)">` +
    studioMark(SM, y - 24, markH) +
    txt(wordX, y, "TV NIGHTLY", { size: 26, fill: TEXT, wght: 800, wdth: 118, ls: 2 }) +
    `<circle cx="${wordX + 178}" cy="${y - 7}" r="5" fill="${AMBER}"/>` +
    `</g>`
  );
};

const studioFooter = (line: string) => {
  const fy = FOOT_Y;
  return (
    `<rect x="0" y="${fy - 100}" width="${SW}" height="${SH - fy + 100}" fill="url(#footFade)"/>` +
    `<rect x="${SM}" y="${fy}" width="96" height="4" rx="2" fill="${AMBER}"/>` +
    txt(SM, fy + 44, line, { size: 26, fill: MUTED, wght: 600 }) +
    txt(SM, fy + 96, "tvnightly.com", { size: 46, fill: AMBER, wght: 900, ls: 0.3 })
  );
};

// shared <defs> for portrait studio cards
const studioDefs = (fontCss: string | null) =>
  `<defs>${fontCss ? `<style>${fontCss}</style>` : ""}` +
  `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#121218"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
  `<linearGradient id="heroTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.75"/><stop offset="0.4" stop-color="${PLATE}" stop-opacity="0.15"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0"/></linearGradient>` +
  `<linearGradient id="heroBot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0"/><stop offset="0.55" stop-color="${PLATE}" stop-opacity="0.7"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
  `<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.12"/><stop offset="0.55" stop-color="${PLATE}" stop-opacity="0.5"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
  `<linearGradient id="scrimUp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}"/><stop offset="0.55" stop-color="${PLATE}" stop-opacity="0.5"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.08"/></linearGradient>` +
  `<filter id="textGlow" x="-30%" y="-30%" width="160%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="8" flood-color="#000" flood-opacity="0.75"/></filter>` +
  `<filter id="posterShadow" x="-12%" y="-8%" width="124%" height="130%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000" flood-opacity="0.65"/></filter>` +
  `<linearGradient id="footFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
  `</defs>`;

// cinematic backdrop block — full width art + scrims (hero image is decorative; text stays in safe column)
const heroBackdrop = (uri: string | null, posterUri: string | null, name: string, heroH: number, id: string) => {
  const out: string[] = [];
  if (uri) {
    out.push(`<image href="${uri}" x="0" y="0" width="${SW}" height="${heroH}" preserveAspectRatio="xMidYMid slice"/>`);
    out.push(`<rect x="0" y="0" width="${SW}" height="${heroH}" fill="url(#scrim)"/>`);
    out.push(`<rect x="0" y="0" width="${SW}" height="${heroH * 0.42}" fill="url(#heroTop)"/>`);
    out.push(`<rect x="0" y="${heroH - 340}" width="${SW}" height="340" fill="url(#heroBot)"/>`);
  } else {
    out.push(poster(posterUri, name, SM + 40, 120, 200, 300, id));
    out.push(`<rect x="0" y="0" width="${SW}" height="${heroH}" fill="url(#heroBot)"/>`);
  }
  return out.join("");
};

// hero title stack — always anchored in the safe column
const heroTitle = (eyebrow: string, title: string, meta: string, rating: number | null, baseY: number) => {
  const lines = wrap(title.toUpperCase(), 13, 2);
  const sz = lines.length > 1 ? 76 : 92;
  const top = baseY - lines.length * (sz + 6) - 48;
  let g = `<g filter="url(#textGlow)">`;
  g += txt(SM, top - 8, eyebrow, { size: 30, fill: AMBER, wght: 800, wdth: 112, ls: 9 });
  lines.forEach((ln, i) => {
    g += txt(SM, top + 44 + i * (sz + 6), ln, { size: sz, fill: TEXT, wght: 900, wdth: 108 });
  });
  g += txt(SM, baseY, meta, { size: 28, fill: "#e0dcd4", wght: 600 });
  if (rating != null) {
    const mw = meta ? meta.length * 28 * 0.5 + 20 : 0;
    g += studioRatingMark(SM + mw, baseY, 26, rating, GOLD, "start");
  }
  g += `</g>`;
  return g;
};

// three-up poster grid for "watch next" — the visual hook on social
function picksGrid(picks: CardEntry[], y0: number): string {
  const n = Math.min(3, picks.length);
  if (!n) return "";
  const gap = 40;
  const pw = Math.floor((CW - gap * (n - 1)) / n);
  const ph = Math.round(pw * 1.5);
  const out: string[] = [];
  out.push(txt(SM, y0, "WATCH THESE NEXT", { size: 30, fill: MUTED, wght: 700, ls: 5 }));
  const py = y0 + 52;
  picks.slice(0, n).forEach((e, i) => {
    const px = SM + i * (pw + gap);
    out.push(poster(e.posterUri, e.name, px, py, pw, ph, `pg-${i}`, { rank: i + 1, rating: e.rating }));
    const title = trunc(e.name, 18);
    out.push(txt(px + pw / 2, py + ph + 36, title, { size: 30, fill: TEXT, wght: 800, anchor: "middle", wdth: 105 }));
    out.push(
      txt(px + pw / 2, py + ph + 72, trunc(metaLine(e), 22), {
        size: 22,
        fill: MUTED,
        anchor: "middle",
        wght: 600,
      }),
    );
  });
  return out.join("");
}

// vertical pick row for ranked lists (4–5 items) — poster-led, no boxes
function pickRow(e: CardEntry, i: number, y0: number, rowH: number, last: boolean): string {
  const ph = Math.min(Math.round(rowH * 0.82), 210);
  const pw = Math.round(ph * 0.667);
  const px = SM;
  const py = y0 + (rowH - ph) / 2;
  const nx = px + pw + 28;
  const out: string[] = [];
  out.push(poster(e.posterUri, e.name, px, py, pw, ph, `pr-${i}`, { rank: i + 1, rating: e.rating }));
  const nameLines = wrap(e.name, 15, 2);
  const ns = nameLines.length > 1 ? 36 : 40;
  const ty = py + ph / 2 - (nameLines.length === 2 ? ns * 0.4 : -4);
  nameLines.forEach((ln, k) => out.push(txt(nx, ty + k * (ns + 8), ln, { size: ns, fill: TEXT, wght: 800, wdth: 105 })));
  out.push(txt(nx, ty + nameLines.length * (ns + 8) + 6, trunc(metaLine(e), 26), { size: 24, fill: MUTED, wght: 600 }));
  if (!last) out.push(`<line x1="${SM}" y1="${y0 + rowH - 1}" x2="${CR}" y2="${y0 + rowH - 1}" stroke="${LINE}" stroke-width="1" opacity="0.6"/>`);
  return out.join("");
}

/** "If you liked X, watch these next" — cinematic hero + three-up poster grid. */
export function buildLikedCard(
  hero: CardEntry,
  picks: CardEntry[],
  fontCss: string | null,
  backdropUri: string | null,
): string {
  const heroH = 900;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(fontCss));
  p.push(`<rect width="${SW}" height="${SH}" fill="url(#bg)"/>`);
  p.push(heroBackdrop(backdropUri, hero.posterUri, hero.name, heroH, "ph-hero"));
  p.push(studioBrand());
  p.push(heroTitle("IF YOU LIKED", hero.name, metaLine(hero), hero.rating, heroH - 36));
  p.push(picksGrid(picks, heroH + 44));
  p.push(studioFooter("Full ranked list & where to stream at"));
  p.push(`</svg>`);
  return p.join("");
}

/** A ranked-list card — typographic header + poster rows. */
export function buildListCard(o: {
  eyebrow: string;
  title: string;
  entries: CardEntry[];
  footerLine: string;
  fontCss: string | null;
}): string {
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(o.fontCss));
  p.push(`<rect width="${SW}" height="${SH}" fill="url(#bg)"/>`);
  p.push(studioBrand());

  const titleLines = wrap(o.title.toUpperCase(), 13, 2);
  const titleSize = titleLines.length > 1 ? 64 : 76;
  p.push(txt(SM, 188, o.eyebrow, { size: 28, fill: AMBER, wght: 800, wdth: 112, ls: 8 }));
  const titleTop = 252;
  titleLines.forEach((ln, i) =>
    p.push(txt(SM, titleTop + i * (titleSize + 8), ln, { size: titleSize, fill: TEXT, wght: 900, wdth: 108 })),
  );
  const headEnd = titleTop + titleLines.length * (titleSize + 8) + 20;

  const listTop = headEnd + 36;
  const listBottom = FOOT_Y - 32;
  const n = Math.max(1, o.entries.length);
  const rowH = (listBottom - listTop) / n;
  o.entries.forEach((e, i) => p.push(pickRow(e, i, listTop + i * rowH, rowH, i === n - 1)));

  p.push(studioFooter(o.footerLine));
  p.push(`</svg>`);
  return p.join("");
}

/** Renewed / cancelled status card. */
export function buildStatusCard(o: {
  name: string;
  meta: string;
  verdict: string;
  verdictColor: string;
  subLine: string;
  backdropUri: string | null;
  posterUri: string | null;
  fontCss: string | null;
}): string {
  const heroH = 720;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(o.fontCss));
  p.push(`<rect width="${SW}" height="${SH}" fill="url(#bg)"/>`);
  p.push(heroBackdrop(o.backdropUri, o.posterUri, o.name, heroH, "st-hero"));
  p.push(studioBrand());
  p.push(heroTitle("RENEWAL STATUS", o.name, o.meta, null, heroH - 36));

  const vLines = wrap(o.verdict.toUpperCase(), 9, 2);
  const vSize = vLines.length > 1 ? 88 : 120;
  const vTop = heroH + 100;
  vLines.forEach((ln, i) =>
    p.push(txt(SM, vTop + i * (vSize + 6), ln, { size: vSize, fill: o.verdictColor, wght: 900, wdth: 104 })),
  );
  const subLines = wrap(o.subLine, 30, 3);
  const subTop = vTop + vLines.length * (vSize + 6) + 48;
  subLines.forEach((ln, i) => p.push(txt(SM, subTop + i * 44, ln, { size: 32, fill: MUTED, wght: 600 })));

  p.push(studioFooter("Track every renewal & date at"));
  p.push(`</svg>`);
  return p.join("");
}

export interface VsSide {
  name: string;
  rating: number | null;
  backdropUri: string | null;
  posterUri: string | null;
}

/** Head-to-head: split-screen backdrops, VS medallion. */
export function buildVsCard(a: VsSide, b: VsSide, verdict: string, fontCss: string | null): string {
  const half = 820;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${SH}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(fontCss));
  p.push(`<rect width="${SW}" height="${SH}" fill="${PLATE}"/>`);

  const band = (t: VsSide, y0: number, h: number, scrimId: string, nameY: number) => {
    let s = "";
    if (t.backdropUri) {
      s += `<image href="${t.backdropUri}" x="0" y="${y0}" width="${SW}" height="${h}" preserveAspectRatio="xMidYMid slice"/>`;
      s += `<rect x="0" y="${y0}" width="${SW}" height="${h}" fill="url(#${scrimId})"/>`;
    } else if (t.posterUri) {
      s += poster(t.posterUri, t.name, SM + 80, y0 + (h - 280) / 2, 186, 280, `vs-${scrimId}`);
    }
    const nameLines = wrap(t.name.toUpperCase(), 12, 2);
    const nsize = nameLines.length > 1 ? 52 : 64;
    let g = `<g filter="url(#textGlow)">`;
    nameLines.forEach((ln, i) =>
      (g += txt(SM, nameY + i * (nsize + 4), ln, { size: nsize, fill: TEXT, wght: 900, wdth: 106 })),
    );
    if (t.rating != null) {
      const ly = nameY + (nameLines.length - 1) * (nsize + 4);
      g += studioRatingMark(SM, ly + nsize + 22, 26, t.rating, GOLD, "start");
    }
    g += `</g>`;
    return s + g;
  };

  p.push(band(a, 0, half, "scrim", 520));
  p.push(band(b, half, half, "scrimUp", half + 140));
  p.push(studioBrand());

  const vsX = SM + CW / 2;
  p.push(`<circle cx="${vsX}" cy="${half}" r="76" fill="${PLATE}" stroke="${LINE}" stroke-width="2"/>`);
  p.push(`<circle cx="${vsX}" cy="${half}" r="68" fill="${PLATE}" stroke="${AMBER}" stroke-width="3.5"/>`);
  p.push(txt(vsX, half + 22, "VS", { size: 56, fill: AMBER, anchor: "middle", wght: 900, wdth: 100 }));

  p.push(txt(SM, FOOT_Y - 40, trunc(verdict, 40), { size: 28, fill: MUTED, wght: 600 }));
  p.push(studioFooter("Compare episode ratings at"));
  p.push(`</svg>`);
  return p.join("");
}

/** Inline a ShowRow-ish record's poster into a CardEntry. */
export async function toCardEntry(s: {
  name: string;
  poster_url: string | null;
  image_url: string | null;
  rating: number | null;
  genres: string | null;
  premiered: string | null;
}): Promise<CardEntry> {
  const url = (s.poster_url ?? s.image_url)?.replace("/w342/", "/w500/") ?? null;
  return {
    name: s.name,
    posterUri: await posterDataUri(url),
    rating: s.rating,
    genres: s.genres ? (JSON.parse(s.genres) as string[]) : [],
    year: s.premiered ? s.premiered.slice(0, 4) : null,
  };
}

// ============================================================================
// Open Graph cards — 1200×630 LANDSCAPE PNGs (rasterized server-side by
// src/lib/render.ts) so a pasted link unfurls as a branded card, not a cropped
// poster thumbnail. A separate dialect from the portrait save-cards above:
// resvg can't do @font-face or variable axes, so text goes through txtR(),
// which picks weight by FAMILY NAME (the static instances in
// public/fonts/archivo-*.ttf) instead of font-variation-settings.
// ============================================================================

const OG_W = 1200;
const OG_H = 630;
const OG_M = 64;

// per-weight family names — must match the name tables in public/fonts/*.ttf
const FAM = {
  reg: "Archivo",
  semi: "Archivo SemiBold",
  bold: "Archivo Bold",
  black: "Archivo Black",
} as const;
type OgWeight = keyof typeof FAM;

interface TxtROpts {
  size: number;
  w?: OgWeight;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  ls?: number;
  opacity?: number;
}
// resvg-safe text: the weight IS the font-family, never a variation axis
const txtR = (x: number, y: number, s: string, o: TxtROpts) =>
  `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(o.size)}" font-family="${FAM[o.w ?? "bold"]}" fill="${
    o.fill ?? MUTED
  }"${o.anchor ? ` text-anchor="${o.anchor}"` : ""}${o.ls ? ` letter-spacing="${r2(o.ls)}"` : ""}${
    o.opacity != null ? ` opacity="${o.opacity}"` : ""
  } style="font-variant-numeric:tabular-nums">${esc(s)}</text>`;

// "★ 9.3" as a vector star + number for OG cards (resvg-safe txtR)
const ratingMark = (
  x: number,
  y: number,
  size: number,
  value: number,
  fill: string,
  anchor: "start" | "middle" | "end" = "start",
): string => {
  const t = value.toFixed(1);
  const r = size * 0.46;
  const gap = size * 0.3;
  const textW = t.length * size * 0.56;
  const groupW = r * 2 + gap + textW;
  const left = anchor === "start" ? x : anchor === "end" ? x - groupW : x - groupW / 2;
  return (
    `<path d="${starPath(left + r, y - size * 0.33, r)}" fill="${fill}"/>` +
    txtR(left + r * 2 + gap, y, t, { size, w: "black", fill, anchor: "start" })
  );
};

// shared <defs>: plate gradient, horizontal + vertical scrims, poster shadow
const ogDefs = () =>
  `<defs>` +
  `<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#17171c"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
  `<linearGradient id="hscrim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.97"/><stop offset="0.46" stop-color="${PLATE}" stop-opacity="0.82"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.4"/></linearGradient>` +
  `<linearGradient id="vscrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0"/><stop offset="0.7" stop-color="${PLATE}" stop-opacity="0"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.75"/></linearGradient>` +
  `<filter id="ds" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="8" stdDeviation="24" flood-color="#000" flood-opacity="0.55"/></filter>` +
  `</defs>`;

// the "Standby Glow" logo mark (cf. LogoMark in components/Layout.tsx): a TV on
// standby — thin 16:9 frame + one amber LED. Pure vector, so resvg draws it.
// (mx, my) is the top-left; h is the rendered height.
function ogMark(mx: number, my: number, h: number): string {
  const s = h / 24;
  return (
    `<g transform="translate(${r2(mx)},${r2(my)}) scale(${r2(s)})">` +
    `<rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5"/>` +
    `<circle cx="26.5" cy="16.5" r="3.4" fill="${AMBER}" opacity="0.22"/>` +
    `<circle cx="26.5" cy="16.5" r="2.2" fill="${AMBER}"/>` +
    `</g>`
  );
}

// the full lockup: mark + TV NIGHTLY wordmark + the amber dot. (x,y) is the
// wordmark baseline; the mark sits to its left, vertically centered on the caps.
const ogBrand = (x = OG_M, y = 92) => {
  const markH = 30;
  const markW = (markH * 36) / 24; // 16:9-ish frame, 45px wide
  const wordX = x + markW + 15;
  return (
    ogMark(x, y - 25, markH) +
    txtR(wordX, y, "TV NIGHTLY", { size: 29, w: "black", fill: TEXT, ls: 1.2 }) +
    // wordmark advance is ~206px (measured); seat the dot just past it with a gap
    `<circle cx="${r2(wordX + 220)}" cy="${r2(y - 8)}" r="6" fill="${AMBER}"/>`
  );
};

// thin rule + the wordmark, anchored to the lower-left
const ogFooter = (rightX: number) =>
  `<line x1="${OG_M}" y1="${OG_H - 74}" x2="${r2(rightX)}" y2="${OG_H - 74}" stroke="${LINE}"/>` +
  txtR(OG_M, OG_H - 36, "tvnightly.com", { size: 25, w: "black", fill: AMBER, ls: 0.5 });

// a gold "★ 9.3" pill half-overlapping the poster's top-left corner
const ogRatingBadge = (rating: number, px: number, py: number) => {
  const bw = 122;
  const bh = 54;
  const bx = px - 22;
  const by = py + 26;
  return (
    `<g filter="url(#ds)">` +
    `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${PLATE}" stroke="${LINE}"/>` +
    ratingMark(bx + bw / 2, by + 36, 30, rating, GOLD, "middle") +
    `</g>`
  );
};

export interface OgCardData {
  kicker: string; // eyebrow: "TV SERIES" | "MOVIE" | "SEASON 2 · EPISODE 8"
  title: string;
  meta?: string | null; // "Drama · Crime · 2002"
  rating?: number | null;
  note?: string | null; // "Streaming on Max", a recap hook, etc.
  posterUri?: string | null;
  backdropUri?: string | null;
}

/** The flagship single-subject card: backdrop + scrim across the frame, poster
 *  on the right, the title block vertically centered in the left column. Used
 *  for shows, movies, and episodes. */
export function buildOgCard(d: OgCardData): string {
  const pw = 300;
  const ph = 450;
  const px = OG_W - OG_M - pw;
  const py = Math.round((OG_H - ph) / 2);
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(ogDefs());
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>`);
  if (d.backdropUri) {
    p.push(
      `<image href="${d.backdropUri}" x="0" y="0" width="${OG_W}" height="${OG_H}" preserveAspectRatio="xMidYMid slice" opacity="0.92"/>`,
    );
    p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#vscrim)"/>`);
    p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#hscrim)"/>`);
  }
  p.push(`<g filter="url(#ds)">${poster(d.posterUri ?? null, d.title, px, py, pw, ph, "og-poster")}</g>`);
  if (d.rating != null) p.push(ogRatingBadge(d.rating, px, py));
  p.push(ogBrand());

  // ---- text block, vertically centered in the left column ----
  const titleLines = wrap(d.title.toUpperCase(), 16, 3);
  const tSize = titleLines.length >= 3 ? 50 : titleLines.length === 2 ? 62 : 72;
  const lead = tSize + 10;
  const blockH = 38 + titleLines.length * lead + (d.meta ? 44 : 0) + (d.note ? 48 : 0);
  const regionTop = 150;
  const regionBot = OG_H - 96;
  const top = regionTop + Math.max(0, (regionBot - regionTop - blockH) / 2);

  let by = top + 24;
  p.push(txtR(OG_M, by, d.kicker.toUpperCase(), { size: 23, w: "bold", fill: AMBER, ls: 3.6 }));
  by += 16;
  for (const ln of titleLines) {
    by += tSize;
    p.push(txtR(OG_M, by, ln, { size: tSize, w: "black", fill: TEXT }));
    by += lead - tSize;
  }
  by += 6;
  if (d.meta) {
    by += 30;
    p.push(txtR(OG_M, by, trunc(d.meta, 46), { size: 27, w: "semi", fill: "#e7e3db" }));
  }
  if (d.note) {
    by += 42;
    p.push(`<circle cx="${OG_M + 7}" cy="${r2(by - 9)}" r="5" fill="${AMBER}"/>`);
    p.push(txtR(OG_M + 24, by, trunc(d.note, 44), { size: 24, w: "semi", fill: MUTED }));
  }

  p.push(ogFooter(px - 40));
  p.push(`</svg>`);
  return p.join("");
}

/** The default share card used as a sitewide og:image fallback for pages with
 *  no subject image of their own (home, listings, hubs). Brand lockup + the
 *  house tagline on the plate gradient — no poster. */
export function buildBrandOgCard(): string {
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(ogDefs());
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>`);
  p.push(ogBrand(OG_M, 108));
  // hero tagline — "Tonight, decided." with the amber logo-dot motif
  let y = 332;
  p.push(txtR(OG_M, y, "TONIGHT,", { size: 104, w: "black", fill: TEXT }));
  y += 110;
  p.push(txtR(OG_M, y, "DECIDED", { size: 104, w: "black", fill: TEXT }));
  p.push(`<circle cx="${OG_M + 472}" cy="${r2(y - 14)}" r="13" fill="${AMBER}"/>`);
  y += 70;
  p.push(
    txtR(OG_M, y, "Episode rankings, release dates & where to stream.", {
      size: 30,
      w: "semi",
      fill: MUTED,
    }),
  );
  p.push(ogFooter(OG_W - OG_M));
  p.push(`</svg>`);
  return p.join("");
}

/** Square brand mark for Organization.logo — Google's logo rich result wants a
 *  raster image, not the SVG favicon. App-icon treatment: the standby mark
 *  centered on the plate in a rounded square. */
// `maskable` renders the full-bleed variant for PWA adaptive icons: a square
// (un-rounded) plate so the launcher's own mask shape isn't fighting our corner
// radius, with the mark left at 0.42 height — well inside the central-80% safe
// zone every mask preserves.
export function buildLogoSvg(size = 512, maskable = false): string {
  const markH = Math.round(size * 0.42);
  const markW = (markH * 36) / 24;
  const mx = (size - markW) / 2;
  const my = (size - markH) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${maskable ? 0 : r2(size * 0.2)}" fill="${PLATE}"/>` +
    ogMark(mx, my, markH) +
    `</svg>`
  );
}

export interface OgSide {
  name: string;
  posterUri: string | null;
  backdropUri: string | null;
  rating: number | null;
}

/** Head-to-head VS card: two backdrops split down the middle, a VS medallion on
 *  the seam, each title anchored to its own bottom corner. For /compare. */
export function buildCompareOgCard(a: OgSide, b: OgSide): string {
  const mid = OG_W / 2;
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(
    `<defs>` +
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17171c"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      // dark at top (brand/label) and bottom (titles), clear through the middle band
      `<linearGradient id="vscrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.78"/><stop offset="0.28" stop-color="${PLATE}" stop-opacity="0.04"/><stop offset="0.62" stop-color="${PLATE}" stop-opacity="0.04"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.94"/></linearGradient>` +
      `<filter id="ds" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="18" flood-color="#000" flood-opacity="0.6"/></filter>` +
      `</defs>`,
  );
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>`);
  // each side's art fills its own half — no clip needed, slice handles the crop
  const side = (s: OgSide, ox: number) => {
    const art = s.backdropUri ?? s.posterUri;
    if (art)
      p.push(
        `<image href="${art}" x="${ox}" y="0" width="${mid}" height="${OG_H}" preserveAspectRatio="xMidYMid slice"/>`,
      );
  };
  side(a, 0);
  side(b, mid);
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#vscrim)"/>`);
  p.push(`<rect x="${mid - 1.5}" y="0" width="3" height="${OG_H}" fill="${PLATE}"/>`);
  p.push(
    `<g filter="url(#ds)"><circle cx="${mid}" cy="${OG_H / 2}" r="56" fill="${PLATE}" stroke="${AMBER}" stroke-width="2.5"/></g>`,
  );
  p.push(txtR(mid, OG_H / 2 + 17, "VS", { size: 46, w: "black", fill: AMBER, anchor: "middle", ls: 1 }));

  const nameBlock = (s: OgSide, anchor: "start" | "end", edgeX: number) => {
    const lines = wrap(s.name.toUpperCase(), 13, 2);
    const sz = lines.length > 1 ? 42 : 50;
    let yy = OG_H - 150 - (lines.length - 1) * (sz + 4);
    lines.forEach((ln) => {
      p.push(txtR(edgeX, yy, ln, { size: sz, w: "black", fill: TEXT, anchor }));
      yy += sz + 4;
    });
    if (s.rating != null) p.push(ratingMark(edgeX, yy + 18, 30, s.rating, GOLD, anchor));
  };
  nameBlock(a, "start", OG_M);
  nameBlock(b, "end", OG_W - OG_M);

  p.push(ogBrand(OG_M, 92));
  p.push(
    txtR(OG_W - OG_M, 92, "EPISODE RATINGS COMPARED", { size: 20, w: "bold", fill: MUTED, anchor: "end", ls: 2.5 }),
  );
  p.push(txtR(OG_W / 2, OG_H - 36, "tvnightly.com", { size: 25, w: "black", fill: AMBER, anchor: "middle", ls: 0.5 }));
  p.push(`</svg>`);
  return p.join("");
}

/** "If you liked X" landscape card: the hook + hero name up top, a row of the
 *  top picks across the bottom. For the /recommend share + unfurl. */
export function buildLikedOgCard(hero: CardEntry, picks: CardEntry[], backdropUri: string | null): string {
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(ogDefs());
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>`);
  if (backdropUri) {
    p.push(
      `<image href="${backdropUri}" x="0" y="0" width="${OG_W}" height="${OG_H}" preserveAspectRatio="xMidYMid slice" opacity="0.5"/>`,
    );
    p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#vscrim)"/>`);
  }
  p.push(ogBrand());

  const nameLines = wrap(hero.name.toUpperCase(), 22, 2);
  const sz = nameLines.length > 1 ? 56 : 66;
  p.push(txtR(OG_M, 196, "IF YOU LIKED", { size: 26, w: "bold", fill: AMBER, ls: 5 }));
  let ty = 196 + 40;
  nameLines.forEach((ln) => {
    ty += sz;
    p.push(txtR(OG_M, ty, ln, { size: sz, w: "black", fill: TEXT }));
    ty += 6;
  });

  p.push(txtR(OG_M, OG_H - 290, "WATCH THESE NEXT", { size: 24, w: "bold", fill: TEXT, ls: 2.5 }));
  p.push(`<rect x="${OG_M}" y="${OG_H - 278}" width="64" height="5" rx="2.5" fill="${AMBER}"/>`);
  const pw = 152;
  const ph = 200;
  const gap = 28;
  const rowY = OG_H - 252;
  picks.slice(0, 4).forEach((e, i) => {
    const x = OG_M + i * (pw + gap);
    p.push(poster(e.posterUri, e.name, x, rowY, pw, ph, `lk-${i}`));
    p.push(txtR(x, rowY + ph + 28, trunc(e.name, 16), { size: 21, w: "bold", fill: "#e7e3db" }));
    if (e.rating != null) p.push(ratingMark(x, rowY + ph + 52, 19, e.rating, GOLD, "start"));
  });

  p.push(txtR(OG_W - OG_M, OG_H - 36, "tvnightly.com", { size: 25, w: "black", fill: AMBER, anchor: "end", ls: 0.5 }));
  p.push(`</svg>`);
  return p.join("");
}

// rating → filament color, umber→gold, anchored 5.5..9.5 (lockstep with the
// page chart's ramp in signal.ts — a 6.1 reads dim on every show).
const RATING_RAMP: [number, [number, number, number]][] = [
  [0, [42, 33, 24]],
  [0.35, [107, 74, 35]],
  [0.7, [192, 138, 62]],
  [0.92, [244, 200, 79]],
  [1, [248, 231, 160]],
];
function rampColor(r: number): string {
  const t = Math.max(0, Math.min(1, (r - 5.5) / 4));
  let i = 0;
  while (i < RATING_RAMP.length - 2 && RATING_RAMP[i + 1][0] < t) i++;
  const [t0, c0] = RATING_RAMP[i];
  const [t1, c1] = RATING_RAMP[i + 1];
  const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

export interface RatingsEp {
  season: number | null;
  number: number | null;
  rating: number | null;
}

/** Ratings-graph card: show identity + stats on the left, the episode heatmap
 *  on the right (season columns × episodes, lit on the filament ramp). The grid
 *  texture is the story — no per-cell numbers at this size. For /show/:slug/ratings. */
export function buildRatingsOgCard(o: {
  name: string;
  kicker: string; // "EPISODE RATINGS"
  episodes: RatingsEp[];
  backdropUri?: string | null;
}): string {
  const SOCKET = "#161619"; // unrated cell — a socket with no filament
  const p: string[] = [];

  // season columns: ascending, specials (0/null) last; episodes by number
  const seasonNums = [...new Set(o.episodes.map((e) => e.season ?? 0))].sort((a, b) => a - b);
  const ordered = [...seasonNums.filter((s) => s !== 0), ...(seasonNums.includes(0) ? [0] : [])];
  const cols = ordered.map((s) =>
    o.episodes.filter((e) => (e.season ?? 0) === s).sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
  );
  const nCols = Math.max(1, cols.length);
  const nRows = Math.max(1, ...cols.map((c) => c.length));

  const ratedVals = o.episodes.filter((e) => e.rating != null);
  const avg = ratedVals.length
    ? ratedVals.reduce((s, e) => s + (e.rating as number), 0) / ratedVals.length
    : null;
  let peak: RatingsEp | null = null;
  for (const e of o.episodes)
    if (e.rating != null && (!peak || e.rating > (peak.rating as number))) peak = e;
  const padN = (n: number | null) => String(n ?? 0).padStart(2, "0");
  const peakCode = peak ? `S${padN(peak.season)}E${padN(peak.number)}` : null;

  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(ogDefs());
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>`);
  if (o.backdropUri) {
    // faint life behind the left column; the grid keeps the right half clean
    p.push(
      `<image href="${o.backdropUri}" x="0" y="0" width="${Math.round(OG_W * 0.52)}" height="${OG_H}" preserveAspectRatio="xMidYMid slice" opacity="0.13"/>`,
    );
  }
  p.push(ogBrand());

  // ---- left column: identity + stats ----
  const colX = OG_M;
  const nameLines = wrap(o.name.toUpperCase(), 14, 2);
  const nSize = nameLines.length > 1 ? 54 : 64;
  p.push(txtR(colX, 192, o.kicker.toUpperCase(), { size: 23, w: "bold", fill: AMBER, ls: 3.6 }));
  let ty = 192 + 26;
  nameLines.forEach((ln) => {
    ty += nSize;
    p.push(txtR(colX, ty, ln, { size: nSize, w: "black", fill: TEXT }));
    ty += 4;
  });

  ty += 46;
  p.push(
    txtR(
      colX,
      ty,
      `${o.episodes.length} episode${o.episodes.length === 1 ? "" : "s"} · ${ordered.length} season${
        ordered.length === 1 ? "" : "s"
      }`,
      { size: 26, w: "semi", fill: "#e7e3db" },
    ),
  );
  ty += 56;
  if (avg != null) {
    p.push(ratingMark(colX, ty, 46, avg, GOLD, "start"));
    p.push(txtR(colX + 158, ty - 4, "SERIES", { size: 19, w: "bold", fill: MUTED, ls: 2 }));
    p.push(txtR(colX + 158, ty + 18, "AVERAGE", { size: 19, w: "bold", fill: MUTED, ls: 2 }));
    ty += 60;
  }
  if (peakCode && peak) {
    p.push(txtR(colX, ty, `${peakCode} · ${(peak.rating as number).toFixed(1)}`, { size: 28, w: "black", fill: TEXT }));
    p.push(txtR(colX, ty + 24, "HIGHEST-RATED EPISODE", { size: 18, w: "bold", fill: MUTED, ls: 2 }));
  }

  p.push(`<line x1="${OG_M}" y1="${OG_H - 74}" x2="480" y2="${OG_H - 74}" stroke="${LINE}"/>`);
  p.push(txtR(OG_M, OG_H - 36, "tvnightly.com", { size: 25, w: "black", fill: AMBER, ls: 0.5 }));

  // ---- right column: the episode heatmap ----
  const gx0 = 556;
  const gy0 = 128;
  const gw = OG_W - OG_M - gx0;
  const gh = OG_H - 116 - gy0;
  const gap = nCols > 14 || nRows > 18 ? 2 : 3;
  const cell = Math.min((gw - (nCols - 1) * gap) / nCols, (gh - (nRows - 1) * gap) / nRows, 42);
  const gridW = nCols * cell + (nCols - 1) * gap;
  const gridH = nRows * cell + (nRows - 1) * gap;
  const ox = gx0 + (gw - gridW) / 2;
  const oy = gy0 + (gh - gridH) / 2;
  const rx = Math.min(4, cell * 0.22);
  cols.forEach((colEps, ci) => {
    const x = ox + ci * (cell + gap);
    colEps.forEach((e, ri) => {
      const y = oy + ri * (cell + gap);
      const fill = e.rating != null ? rampColor(e.rating) : SOCKET;
      p.push(
        `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(cell)}" height="${r2(cell)}" rx="${r2(rx)}" fill="${fill}"${
          e.rating == null ? ` stroke="${LINE}" stroke-width="0.75"` : ""
        }/>`,
      );
    });
  });

  p.push(`</svg>`);
  return p.join("");
}
