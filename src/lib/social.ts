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
// Bottom clearance — Shorts/TikTok caption + handle strip. The footer wordmark
// sits at FOOT_Y+96, so SB must keep that (and everything above it) clear of the
// platform's bottom UI (~13–15%). 372 puts the wordmark at ~1644 (≈14% up).
const SB = 372;
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

// Fit a title to a column by shrinking the FONT until the whole thing wraps into
// <= maxLines — long titles never truncate, they just get smaller. Returns the
// wrapped lines plus the fitted font size. `charw` = em-advance of the face used.
function fitLines(text: string, colW: number, capSize: number, maxLines: number, charw = 0.62) {
  const words = text.split(/\s+/).filter(Boolean);
  const longestWord = Math.max(1, ...words.map((w) => w.length));
  const lineCount = (budget: number) => {
    let lines = 1;
    let cur = 0;
    for (const w of words) {
      const add = cur ? cur + 1 + w.length : w.length;
      if (cur && add > budget) {
        lines++;
        cur = w.length;
      } else cur = add;
    }
    return lines;
  };
  const floor = Math.max(20, Math.round(capSize * 0.32));
  let size = capSize;
  for (let i = 0; i < 48 && size > floor; i++) {
    const budget = Math.max(4, Math.floor(colW / (size * charw)));
    if (budget >= longestWord && lineCount(budget) <= maxLines) break;
    size = Math.round(size * 0.94);
  }
  size = Math.max(floor, size);
  const budget = Math.max(4, Math.floor(colW / (size * charw)));
  return { lines: wrap(text, budget, maxLines), size };
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

const studioBrand = (y = 76, showDot = true) => {
  const markH = 28;
  const markW = (markH * 36) / 24;
  const wordX = SM + markW + 12;
  // wordmark advance for "TV NIGHTLY" at size 26 / wdth 118 / ls 2 ≈ 214px; seat
  // the amber dot just past it (was 178 — the dot landed on the Y)
  return (
    `<g opacity="0.92" filter="url(#textGlow)">` +
    studioMark(SM, y - 24, markH) +
    txt(wordX, y, "TV NIGHTLY", { size: 26, fill: TEXT, wght: 800, wdth: 118, ls: 2 }) +
    (showDot ? `<circle cx="${wordX + 218}" cy="${y - 7}" r="5" fill="${AMBER}"/>` : "") +
    `</g>`
  );
};

const studioFooter = (line: string, fy: number = FOOT_Y, H: number = SH) => {
  return (
    `<rect x="0" y="${fy - 100}" width="${SW}" height="${H - fy + 100}" fill="url(#footFade)"/>` +
    `<rect x="${SM}" y="${fy}" width="96" height="4" rx="2" fill="${AMBER}"/>` +
    txt(SM, fy + 44, line, { size: 26, fill: MUTED, wght: 600 }) +
    txt(SM, fy + 96, "tvnightly.com", { size: 46, fill: AMBER, wght: 900, ls: 0.3 })
  );
};

// per-aspect frame. Width is always 1080. 9:16 (story) reserves the platform
// action-rail (right) + caption strip (bottom); 1:1 (square, IG feed) has no
// overlay UI, so it uses even margins and the full width.
function frame(square: boolean) {
  const H = square ? SW : SH; // 1080 or 1920
  const cr = square ? SW - SM : CR;
  return { H, fy: square ? H - 136 : FOOT_Y, cr, cw: cr - SM, square };
}

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

// hero title stack — always anchored in the safe column. Laid out UPWARD from the
// meta baseline so the eyebrow always clears the title's ascenders (a short title
// like "ANDOR" used to collide with a long eyebrow like "RENEWAL STATUS").
const heroTitle = (eyebrow: string, title: string, meta: string, rating: number | null, baseY: number) => {
  const lines = wrap(title.toUpperCase(), 13, 2);
  const sz = lines.length > 1 ? 76 : 92;
  const lead = sz + 6;
  const metaY = baseY;
  const firstTitleY = metaY - 44 - (lines.length - 1) * lead;
  const eyebrowY = firstTitleY - sz * 0.82 - 14;
  let g = `<g filter="url(#textGlow)">`;
  g += txt(SM, eyebrowY, eyebrow, { size: 30, fill: AMBER, wght: 800, wdth: 112, ls: 9 });
  lines.forEach((ln, i) => {
    g += txt(SM, firstTitleY + i * lead, ln, { size: sz, fill: TEXT, wght: 900, wdth: 108 });
  });
  g += txt(SM, metaY, meta, { size: 28, fill: "#e0dcd4", wght: 600 });
  if (rating != null) {
    const mw = meta ? meta.length * 28 * 0.5 + 20 : 0;
    g += studioRatingMark(SM + mw, metaY, 26, rating, GOLD, "start");
  }
  g += `</g>`;
  return g;
};

// three-up poster grid for "watch next" — the visual hook on social. `cw` is the
// content width; `maxPh` caps poster height so the row fits a short (1:1) card.
// `compact` drops the per-poster title/meta (the rank + rating badges already
// label each) — used at 1:1, where small posters would make titles collide.
function picksGrid(
  picks: CardEntry[],
  y0: number,
  cw: number = CW,
  maxPh: number = Infinity,
  compact: boolean = false,
): string {
  const n = Math.min(3, picks.length);
  if (!n) return "";
  const gap = 40;
  let pw = Math.floor((cw - gap * (n - 1)) / n);
  let ph = Math.round(pw * 1.5);
  if (ph > maxPh) {
    ph = Math.round(maxPh);
    pw = Math.round(ph / 1.5);
  }
  const rowW = n * pw + (n - 1) * gap;
  const x0 = SM + Math.round((cw - rowW) / 2);
  const out: string[] = [];
  out.push(txt(SM, y0, "WATCH THESE NEXT", { size: 30, fill: MUTED, wght: 700, ls: 5 }));
  const py = y0 + 52;
  picks.slice(0, n).forEach((e, i) => {
    const px = x0 + i * (pw + gap);
    out.push(poster(e.posterUri, e.name, px, py, pw, ph, `pg-${i}`, { rank: i + 1, rating: e.rating }));
    if (compact) return;
    const title = trunc(e.name, 18);
    out.push(txt(px + pw / 2, py + ph + 36, title, { size: 28, fill: TEXT, wght: 800, anchor: "middle", wdth: 105 }));
    out.push(
      txt(px + pw / 2, py + ph + 70, trunc(metaLine(e), 22), {
        size: 22,
        fill: MUTED,
        anchor: "middle",
        wght: 600,
      }),
    );
  });
  return out.join("");
}

// magazine ranking row: an OVERSIZED amber rank numeral, the poster, the title
// block, and a big gold rating end-anchored — fills the width, no dead gutters.
function magazineRow(e: CardEntry, i: number, y0: number, rowH: number, last: boolean, cr: number = CR): string {
  const out: string[] = [];
  const cy = y0 + rowH / 2;
  // 1 — the oversized rank numeral (the editorial signature)
  const numSize = Math.min(rowH * 0.96, 156);
  const num = String(i + 1).padStart(2, "0");
  out.push(txt(SM - 6, cy + numSize * 0.34, num, { size: numSize, fill: AMBER, wght: 900, wdth: 72, opacity: 0.95 }));
  // 2 — the poster
  const ph = Math.min(Math.round(rowH * 0.9), 236);
  const pw = Math.round(ph * 0.667);
  const px = SM + Math.min(138, numSize * 0.9);
  const py = cy - ph / 2;
  out.push(poster(e.posterUri, e.name, px, py, pw, ph, `mr-${i}`));
  // 3 — title + meta, vertically centered against the poster. Short rows (1:1)
  // force a single line so a two-line title can't overflow into the row above.
  const nx = px + pw + 32;
  const tight = rowH < 150;
  const nameLines = tight ? [e.name] : wrap(e.name, 15, 2);
  const ns = tight ? Math.min(46, Math.round(rowH * 0.34)) : nameLines.length > 1 ? 42 : 50;
  const blockH = nameLines.length * (ns + 6) + 34;
  const ty = cy - blockH / 2 + ns;
  nameLines.forEach((ln, k) =>
    out.push(txt(nx, ty + k * (ns + 6), trunc(ln, 17), { size: ns, fill: TEXT, wght: 900, wdth: 106 })),
  );
  out.push(txt(nx, ty + nameLines.length * (ns + 6) + 2, trunc(metaLine(e), 24), { size: 24, fill: MUTED, wght: 600 }));
  // 4 — big gold rating, hard right
  if (e.rating != null) out.push(studioRatingMark(cr, cy + 14, 42, e.rating, GOLD, "end"));
  if (!last) out.push(`<line x1="${SM}" y1="${y0 + rowH}" x2="${cr}" y2="${y0 + rowH}" stroke="${LINE}" stroke-width="1" opacity="0.5"/>`);
  return out.join("");
}

/** "If you liked" — cinematic hero + three-column pick gallery (no overlap). */
const likedDefs = (fontCss: string | null) =>
  studioDefs(fontCss).replace(
    "</defs>",
    `<linearGradient id="lkHeroScrim" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.92"/><stop offset="0.55" stop-color="${PLATE}" stop-opacity="0.45"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.15"/></linearGradient>` +
      `<linearGradient id="lkHeroFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0"/><stop offset="0.55" stop-color="${PLATE}" stop-opacity="0.35"/><stop offset="1" stop-color="#070709"/></linearGradient>` +
      `<linearGradient id="lkPanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0c10"/><stop offset="1" stop-color="#050506"/></linearGradient>` +
      `<linearGradient id="lkFrame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.7"/><stop offset="0.5" stop-color="rgba(255,255,255,0.22)"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0.45"/></linearGradient>` +
      `<radialGradient id="lkBloom" cx="0.78" cy="0.32" r="0.45"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.14"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>` +
      `</defs>`,
  );

/** Cinematic hero band — backdrop, floating poster, left editorial type. */
const likedHeroBand = (
  backdropUri: string | null,
  posterUri: string | null,
  hero: CardEntry,
  heroH: number,
  cr: number,
) => {
  const out: string[] = [];
  if (backdropUri) {
    out.push(`<image href="${backdropUri}" x="0" y="0" width="${SW}" height="${heroH + 80}" preserveAspectRatio="xMidYMid slice"/>`);
  } else {
    out.push(`<rect x="0" y="0" width="${SW}" height="${heroH + 80}" fill="${PLATE}"/>`);
  }
  out.push(`<rect x="0" y="0" width="${SW}" height="${heroH + 80}" fill="url(#lkHeroScrim)"/>`);
  out.push(`<rect x="0" y="0" width="${SW}" height="${heroH + 80}" fill="url(#lkHeroFade)"/>`);
  out.push(`<rect x="0" y="0" width="${SW}" height="${heroH + 80}" fill="url(#lkBloom)"/>`);

  const floatW = cr < 900 ? 168 : 212;
  const floatH = Math.round(floatW * 1.48);
  const floatX = cr - floatW - 24;
  const floatY = heroH - floatH - (cr < 900 ? 72 : 96);
  if (posterUri || hero.posterUri) {
    const uri = posterUri ?? hero.posterUri;
    out.push(`<g filter="url(#posterShadow)">`);
    out.push(`<rect x="${floatX - 4}" y="${floatY - 4}" width="${floatW + 8}" height="${floatH + 8}" rx="16" fill="none" stroke="url(#lkFrame)" stroke-width="2.5"/>`);
    out.push(poster(uri, hero.name, floatX, floatY, floatW, floatH, "lk-float"));
    out.push(`</g>`);
  }

  out.push(studioBrand(76, true));
  const baseY = heroH - (cr < 900 ? 40 : 52);
  const titleLines = wrap(hero.name.toUpperCase(), cr < 900 ? 11 : 13, 2);
  const sz = titleLines.length > 1 ? (cr < 900 ? 62 : 78) : cr < 900 ? 80 : 100;
  const lead = sz + 6;
  const metaY = baseY;
  const firstTitleY = metaY - 40 - (titleLines.length - 1) * lead;
  const eyebrowY = firstTitleY - sz * 0.7 - 20;

  out.push(`<g filter="url(#textGlow)">`);
  out.push(`<rect x="${SM - 4}" y="${eyebrowY - 28}" width="72" height="4" rx="2" fill="${AMBER}"/>`);
  out.push(txt(SM, eyebrowY, "IF YOU LOVED", { size: 26, fill: AMBER, wght: 800, wdth: 114, ls: 10 }));
  titleLines.forEach((ln, i) => {
    out.push(txt(SM, firstTitleY + i * lead, ln, { size: sz, fill: TEXT, wght: 900, wdth: 108 }));
  });
  out.push(txt(SM, metaY, metaLine(hero), { size: 26, fill: "#ddd8cf", wght: 600 }));
  if (hero.rating != null) {
    const mw = metaLine(hero).length * 13 + 24;
    out.push(studioRatingMark(SM + mw, metaY, 26, hero.rating, GOLD, "start"));
  }
  out.push(`</g>`);
  return out.join("");
};

/** Three fixed columns — poster, title, rating; each in its own lane (no overlap). */
const likedPickGallery = (
  picks: CardEntry[],
  y0: number,
  bottom: number,
  cr: number,
  compact: boolean,
) => {
  const n = Math.min(3, picks.length);
  if (!n) return "";
  const gap = compact ? 28 : 40;
  const colW = Math.floor((cr - SM - gap * (n - 1)) / n);
  const out: string[] = [];
  out.push(
    txt(SM, y0, "YOUR NEXT WATCH", { size: compact ? 24 : 30, fill: TEXT, wght: 800, wdth: 108, ls: 6 }) +
      `<rect x="${SM}" y="${y0 + 12}" width="${compact ? 56 : 72}" height="4" rx="2" fill="${AMBER}"/>`,
  );

  const py = y0 + (compact ? 44 : 56);
  const maxPh = bottom - py - (compact ? 88 : 104);
  let pw = Math.min(colW - 4, compact ? 200 : 248);
  let ph = Math.round(pw * 1.5);
  if (ph > maxPh) {
    ph = Math.max(compact ? 120 : 150, maxPh);
    pw = Math.round(ph / 1.5);
  }

  picks.slice(0, n).forEach((e, i) => {
    const colCx = SM + colW / 2 + i * (colW + gap);
    const px = colCx - pw / 2;

    out.push(`<g filter="url(#posterShadow)">`);
    out.push(`<rect x="${px - 3}" y="${py - 3}" width="${pw + 6}" height="${ph + 6}" rx="14" fill="none" stroke="url(#lkFrame)" stroke-width="1.8"/>`);
    out.push(poster(e.posterUri, e.name, px, py, pw, ph, `lk-col-${i}`, { rank: i + 1, rating: null }));
    out.push(`</g>`);

    const titleY = py + ph + (compact ? 32 : 38);
    const nameLines = wrap(e.name, compact ? 11 : 13, 2);
    const ns = nameLines.length > 1 ? (compact ? 20 : 24) : compact ? 24 : 28;
    nameLines.forEach((ln, k) => {
      out.push(
        txt(colCx, titleY + k * (ns + 4), trunc(ln, compact ? 13 : 15), {
          size: ns,
          fill: TEXT,
          anchor: "middle",
          wght: 800,
          wdth: 104,
        }),
      );
    });
    const metaY = titleY + nameLines.length * (ns + 4) + 6;
    out.push(
      txt(colCx, metaY, trunc(metaLine(e), compact ? 16 : 18), {
        size: compact ? 16 : 19,
        fill: MUTED,
        anchor: "middle",
        wght: 600,
      }),
    );
    if (e.rating != null) {
      out.push(studioRatingMark(colCx, metaY + (compact ? 28 : 32), compact ? 20 : 24, e.rating, GOLD, "middle"));
    }
  });
  return out.join("");
};

/** "If you liked X" — cinematic hero + clean three-column gallery. */
export function buildLikedCard(
  hero: CardEntry,
  picks: CardEntry[],
  fontCss: string | null,
  backdropUri: string | null,
  square: boolean = false,
): string {
  const f = frame(square);
  const heroH = square ? Math.round(f.H * 0.44) : 820;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${f.H}" font-family="Archivo, ${SYS}">`);
  p.push(likedDefs(fontCss));
  p.push(`<rect width="${SW}" height="${f.H}" fill="#050506"/>`);
  p.push(likedHeroBand(backdropUri, hero.posterUri, hero, heroH, f.cr));
  p.push(`<rect x="0" y="${heroH - 8}" width="${SW}" height="${f.fy - heroH + 48}" fill="url(#lkPanel)"/>`);
  const galleryTop = heroH + (square ? 24 : 36);
  p.push(likedPickGallery(picks, galleryTop, f.fy - 8, f.cr, square));
  p.push(studioFooter("Full ranked list & where to stream at", f.fy, f.H));
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
  square?: boolean;
}): string {
  const f = frame(!!o.square);
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${f.H}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(o.fontCss));
  p.push(`<rect width="${SW}" height="${f.H}" fill="url(#bg)"/>`);
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
  const listBottom = f.fy - 32;
  const n = Math.max(1, o.entries.length);
  const rowH = (listBottom - listTop) / n;
  o.entries.forEach((e, i) => p.push(magazineRow(e, i, listTop + i * rowH, rowH, i === n - 1, f.cr)));

  p.push(studioFooter(o.footerLine, f.fy, f.H));
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
  square?: boolean;
}): string {
  const f = frame(!!o.square);
  const heroH = o.square ? 520 : 720;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${f.H}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(o.fontCss));
  p.push(`<rect width="${SW}" height="${f.H}" fill="url(#bg)"/>`);
  p.push(heroBackdrop(o.backdropUri, o.posterUri, o.name, heroH, "st-hero"));
  p.push(studioBrand());
  p.push(heroTitle("RENEWAL STATUS", o.name, o.meta, null, heroH - 36));

  const vLines = wrap(o.verdict.toUpperCase(), 9, 2);
  const vSize = vLines.length > 1 ? 88 : 120;
  const vTop = heroH + (o.square ? 80 : 100);
  vLines.forEach((ln, i) =>
    p.push(txt(SM, vTop + i * (vSize + 6), ln, { size: vSize, fill: o.verdictColor, wght: 900, wdth: 104 })),
  );
  const subLines = wrap(o.subLine, 30, 3);
  const subTop = vTop + vLines.length * (vSize + 6) + 48;
  subLines.forEach((ln, i) => p.push(txt(SM, subTop + i * 44, ln, { size: 32, fill: MUTED, wght: 600 })));

  p.push(studioFooter("Track every renewal & date at", f.fy, f.H));
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
export function buildVsCard(a: VsSide, b: VsSide, verdict: string, fontCss: string | null, square: boolean = false): string {
  const f = frame(square);
  const half = square ? Math.round(f.H * 0.46) : 820;
  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${f.H}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(fontCss));
  p.push(`<rect width="${SW}" height="${f.H}" fill="${PLATE}"/>`);

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

  p.push(band(a, 0, half, "scrim", half - 300));
  p.push(band(b, half, f.H - half, "scrimUp", half + 140));
  p.push(studioBrand());

  const vsX = SM + f.cw / 2;
  p.push(`<circle cx="${vsX}" cy="${half}" r="76" fill="${PLATE}" stroke="${LINE}" stroke-width="2"/>`);
  p.push(`<circle cx="${vsX}" cy="${half}" r="68" fill="${PLATE}" stroke="${AMBER}" stroke-width="3.5"/>`);
  p.push(txt(vsX, half + 22, "VS", { size: 56, fill: AMBER, anchor: "middle", wght: 900, wdth: 100 }));

  p.push(txt(SM, f.fy - 40, trunc(verdict, 40), { size: 28, fill: MUTED, wght: 600 }));
  p.push(studioFooter("Compare episode ratings at", f.fy, f.H));
  p.push(`</svg>`);
  return p.join("");
}

/** Portrait 9:16 episode-ratings card for social — a FIXED 1080×1920 heatmap that
 *  always fits, no matter how many seasons/episodes. Marathon shows (soaps, talk
 *  shows) shrink to a dense texture instead of stretching the canvas to an
 *  unpostable sliver, which is what the page's variable-height ratings.svg does.
 *  Browser dialect (variation fonts via fontCss). */
export function buildRatingsCard(o: {
  name: string;
  episodes: RatingsEp[];
  fontCss: string | null;
  backdropUri?: string | null;
  posterUri?: string | null;
  square?: boolean;
}): string {
  const f = frame(!!o.square);
  const SOCKET = "#161619"; // unrated cell — a socket with no filament
  const eps = o.episodes;

  // season columns ascending, specials (0/null) last; episodes by number
  const seasonNums = [...new Set(eps.map((e) => e.season ?? 0))].sort((a, b) => a - b);
  const ordered = [...seasonNums.filter((s) => s !== 0), ...(seasonNums.includes(0) ? [0] : [])];
  const cols = ordered.map((s) =>
    eps.filter((e) => (e.season ?? 0) === s).sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
  );
  const nCols = Math.max(1, cols.length);
  const nRows = Math.max(1, ...cols.map((c) => c.length));

  const rated = eps.filter((e) => e.rating != null);
  const avg = rated.length ? rated.reduce((s, e) => s + (e.rating as number), 0) / rated.length : null;
  let peak: RatingsEp | null = null;
  for (const e of eps) if (e.rating != null && (!peak || e.rating > (peak.rating as number))) peak = e;
  const padN = (n: number | null) => String(n ?? 0).padStart(2, "0");
  const peakCode = peak ? `S${padN(peak.season)}E${padN(peak.number)}` : null;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${f.H}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(o.fontCss));
  p.push(`<rect width="${SW}" height="${f.H}" fill="url(#bg)"/>`);
  if (o.backdropUri) {
    p.push(
      `<image href="${o.backdropUri}" x="0" y="0" width="${SW}" height="560" preserveAspectRatio="xMidYMid slice" opacity="0.16"/>`,
    );
    p.push(`<rect x="0" y="0" width="${SW}" height="560" fill="url(#heroBot)"/>`);
  }
  p.push(studioBrand());

  // ---- poster, top-right of the header — the concrete show art that anchors the card ----
  const pw = o.square ? 138 : 178;
  const ph = Math.round(pw * 1.5);
  const px = f.cr - pw;
  const py = o.square ? 150 : 172;
  if (o.posterUri) p.push(poster(o.posterUri, o.name, px, py, pw, ph, "rat-poster"));
  const nameRight = (o.posterUri ? px - 28 : f.cr); // keep the title clear of the poster

  // ---- header: eyebrow + show name. 1:1 is vertically tight, so the header is
  // a touch more compact to leave the heatmap enough room for legible numbers. The
  // title is sized to fit the column left of the poster. ----
  p.push(txt(SM, o.square ? 176 : 188, "EPISODE RATINGS", { size: 28, fill: AMBER, wght: 800, wdth: 112, ls: 8 }));
  const nameLines = wrap(o.name.toUpperCase(), o.posterUri ? 11 : 14, 2);
  const baseN = nameLines.length > 1 ? (o.square ? 60 : 72) : o.square ? 80 : 90;
  const longestN = Math.max(1, ...nameLines.map((l) => l.length));
  const nSize = Math.min(baseN, Math.floor((nameRight - SM) / (longestN * 0.56)));
  const nameTop = o.square ? 232 : 256;
  nameLines.forEach((ln, i) =>
    p.push(txt(SM, nameTop + i * (nSize + 6), ln, { size: nSize, fill: TEXT, wght: 900, wdth: 108 })),
  );
  let y = nameTop + nameLines.length * (nSize + 6) + (o.square ? 24 : 36);
  // make sure the stats row clears the bottom of the poster
  if (o.posterUri) y = Math.max(y, py + ph + 18);

  // ---- stats row: series average (left), seasons/rated + peak (right) ----
  if (avg != null) {
    p.push(studioRatingMark(SM, y + 10, 46, avg, GOLD, "start"));
    p.push(txt(SM + 158, y, "SERIES", { size: 19, fill: MUTED, wght: 700, ls: 2 }));
    p.push(txt(SM + 158, y + 22, "AVERAGE", { size: 19, fill: MUTED, wght: 700, ls: 2 }));
  }
  p.push(
    txt(f.cr, y + 4, `${ordered.length} season${ordered.length === 1 ? "" : "s"} · ${rated.length} rated`, {
      size: 26,
      fill: "#e0dcd4",
      wght: 600,
      anchor: "end",
    }),
  );
  if (peakCode && peak)
    p.push(
      txt(f.cr, y + 38, `PEAK ${peakCode} · ${(peak.rating as number).toFixed(1)}`, {
        size: 20,
        fill: MUTED,
        wght: 700,
        anchor: "end",
        ls: 1,
      }),
    );
  y += o.square ? 58 : 74;

  // ---- legend: a compact 12-step ramp chip ----
  const segN = 12;
  const legW = 300;
  const segGap = 3;
  const segW = (legW - segGap * (segN - 1)) / segN;
  p.push(txt(SM, y, "DULL", { size: 16, fill: MUTED, wght: 700, ls: 1.4, opacity: 0.7 }));
  const legX = SM + 64;
  for (let i = 0; i < segN; i++) {
    const v = 5.5 + (4 * (i + 0.5)) / segN;
    p.push(
      `<rect x="${r2(legX + i * (segW + segGap))}" y="${r2(y - 13)}" width="${r2(segW)}" height="14" rx="3" fill="${rampColor(v)}"/>`,
    );
  }
  p.push(txt(legX + legW + 16, y, "BRILLIANT", { size: 16, fill: MUTED, wght: 700, ls: 1.4, opacity: 0.7 }));
  y += o.square ? 30 : 40;

  // ---- the heatmap: cells scaled to FIT a fixed box (never overflow). Right edge
  // is CR (not the frame edge) so a wide grid never tucks under the 9:16 action rail.
  const gx0 = SM;
  const gRight = f.cr;
  const boxTop = y;
  const boxBottom = f.fy - (o.square ? 80 : 96);
  const boxW = gRight - gx0;
  const boxH = boxBottom - boxTop;
  // 9:16 is a TALL frame → keep the grid tall (seasons as columns). 1:1 is wide and
  // short → TRANSPOSE so seasons become rows and episodes run across, filling the
  // width instead of collapsing into a thin vertical strip.
  const transpose = !!o.square;
  const gCols = transpose ? nRows : nCols;
  const gRows = transpose ? nCols : nRows;
  // axis gutters: left column for the row labels, top strip for the column headers
  const lg = 48;
  const tg = 32;
  const gap = gCols > 14 || gRows > 24 ? 2 : 4;
  const cell = Math.min((boxW - lg - (gCols - 1) * gap) / gCols, (boxH - tg - (gRows - 1) * gap) / gRows, 64);
  const gridW = gCols * cell + (gCols - 1) * gap;
  const gridH = gRows * cell + (gRows - 1) * gap;
  const ox = gx0 + lg + (boxW - lg - gridW) / 2;
  const oy = boxTop + tg + (boxH - tg - gridH) / 2;
  const rx = Math.min(6, cell * 0.22);

  // ---- axis labels: seasons (S1…/SP) on one axis, episodes (E1…) on the other.
  // Show EVERY label when there's room; only thin out (every Nth) if labels would
  // physically collide at this cell size. ----
  const seasonLab = (s: number) => (s === 0 ? "SP" : "S" + s);
  const labSize = Math.max(12, Math.min(16, cell * 0.42));
  const pitch = cell + gap;
  const colStep = Math.max(1, Math.ceil((labSize * 2.0) / pitch)); // ~3-char label width
  const rowStep = Math.max(1, Math.ceil((labSize * 1.35) / pitch)); // stacked vertically
  for (let i = 0; i < gCols; i++) {
    if (i % colStep !== 0) continue;
    const lab = transpose ? "E" + (i + 1) : seasonLab(ordered[i]);
    p.push(
      txt(ox + i * pitch + cell / 2, oy - 11, lab, { size: labSize, wdth: 105, ls: 0.4, fill: MUTED, anchor: "middle", opacity: 0.8 }),
    );
  }
  for (let j = 0; j < gRows; j++) {
    if (j % rowStep !== 0) continue;
    const lab = transpose ? seasonLab(ordered[j]) : "E" + (j + 1);
    p.push(
      txt(ox - 13, oy + j * pitch + cell / 2 + labSize * 0.34, lab, { size: labSize, wdth: 105, ls: 0.4, fill: MUTED, anchor: "end", opacity: 0.8 }),
    );
  }
  // Print the rating in each cell when cells are big enough to read. The S/E
  // context now comes from the axis labels, so cells carry only the score (no
  // redundant per-cell code). Marathon shows (tiny cells) stay pure heatmap.
  const showVal = cell >= 22;
  const valSize = Math.max(10.5, Math.min(22, cell * 0.42));
  cols.forEach((colEps, ci) => {
    colEps.forEach((e, ri) => {
      const x = ox + (transpose ? ri : ci) * (cell + gap);
      const yy = oy + (transpose ? ci : ri) * (cell + gap);
      const fill = e.rating != null ? rampColor(e.rating) : SOCKET;
      p.push(
        `<rect x="${r2(x)}" y="${r2(yy)}" width="${r2(cell)}" height="${r2(cell)}" rx="${r2(rx)}" fill="${fill}"${
          e.rating == null ? ` stroke="${LINE}" stroke-width="0.75"` : ""
        }/>`,
      );
      if (e.rating != null && showVal) {
        // dark ink once the filament is bright enough to carry it (matches the page chart)
        const ink = (e.rating - 5.5) / 4 > 0.56 ? "#1f1708" : TEXT;
        p.push(
          txt(x + cell / 2, yy + cell * 0.5 + valSize * 0.34, e.rating.toFixed(1), {
            size: valSize,
            sys: true,
            wght: 700,
            fill: ink,
            anchor: "middle",
          }),
        );
      }
    });
  });

  p.push(studioFooter("Every episode, rated, at", f.fy, f.H));
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

// ============================================================================
// Showcase card — 1080×1350 (4:5) "scroll-stopper" in the streaming-ad idiom:
// a dual-poster hero up top, then a premium dark panel with a brushed-chrome
// headline + the brand lockup. Resvg-safe (txtR + static Archivo, gradient fills
// on text are supported). Modeled on the HBO Max promo language but on-brand.
// ============================================================================

const SHOWCASE_W = 1080;
const SHOWCASE_H = 1350;

export interface ShowcaseSide {
  imageUri: string | null; // backdrop/poster, cover-cropped to fill the half
  logoUri?: string | null; // transparent title logo (PNG) overlaid near the foot
  name: string; // fallback title when no logo art exists
}
export interface ShowcaseCardData {
  topStrip?: string | null; // thin top banner, e.g. "TV NIGHTLY · WHAT TO WATCH"
  left: ShowcaseSide;
  right: ShowcaseSide;
  panelKicker: string; // amber tracked label above the headline
  headline: string; // the big brushed-chrome line
  subline?: string | null; // muted support line
  footer?: string | null; // fine print at the very bottom
}

// a full-bleed cover image clipped to a rect (no rounded corners — edge-to-edge
// like the reference). Falls back to an amber initial plate when art is missing.
function coverImg(uri: string | null, name: string, x: number, y: number, w: number, h: number, id: string): string {
  if (!uri)
    return (
      `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="#17171c"/>` +
      txtR(x + w / 2, y + h / 2, trunc(name, 12), { size: 56, w: "black", fill: AMBER, anchor: "middle" })
    );
  return (
    `<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"/></clipPath>` +
    `<image href="${uri}" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>`
  );
}

export function buildShowcaseCard(d: ShowcaseCardData): string {
  const W = SHOWCASE_W;
  const H = SHOWCASE_H;
  const stripH = d.topStrip ? 64 : 0;
  const postersTop = stripH;
  const panelTop = 858; // posters fill stripH..858, the dark panel runs to H
  const colW = W / 2;
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(
    `<defs>` +
      // brushed chrome: bright top, dark mid band, bright again — the metal sheen
      `<linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#d4d8dd"/><stop offset="0.5" stop-color="#8a8f96"/><stop offset="0.54" stop-color="#6e747b"/><stop offset="0.72" stop-color="#eef1f4"/><stop offset="1" stop-color="#a9adb3"/></linearGradient>` +
      `<linearGradient id="panel" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="#20242c"/><stop offset="1" stop-color="#0b0b0e"/></linearGradient>` +
      // scrim that fades the bottom of the posters into the panel
      `<linearGradient id="blend" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0"/><stop offset="1" stop-color="#15171c" stop-opacity="1"/></linearGradient>` +
      // soft sheen sweeping across the panel for a touch of texture
      `<linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.3"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.05"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
      // per-half scrim so an overlaid logo reads on bright art
      `<linearGradient id="half" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.55" stop-color="#000" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.78"/></linearGradient>` +
      `<filter id="csh" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="0" dy="6" stdDeviation="14" flood-color="#000" flood-opacity="0.6"/></filter>` +
      `<filter id="lsh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="#000" flood-opacity="0.7"/></filter>` +
      `</defs>`,
  );
  p.push(`<rect width="${W}" height="${H}" fill="${PLATE}"/>`);

  // ---- dual hero: a cover image per half + the show's logo overlaid near its foot ----
  const ph = panelTop - postersTop;
  const half = (s: ShowcaseSide, x: number, id: string) => {
    p.push(coverImg(s.imageUri, s.name, x, postersTop, colW, ph, `${id}-img`));
    // darken the lower half so the logo/title pops
    p.push(`<rect x="${r2(x)}" y="${postersTop}" width="${colW}" height="${ph}" fill="url(#half)"/>`);
    // overlay the transparent logo only in backdrop mode; a poster carries its
    // own title art, and coverImg() names the true no-art fallback plate.
    if (s.logoUri) {
      const boxW = colW * 0.74;
      const boxH = 132;
      const bx = x + (colW - boxW) / 2;
      const by = panelTop - 52 - boxH;
      p.push(
        `<image href="${s.logoUri}" x="${r2(bx)}" y="${r2(by)}" width="${r2(boxW)}" height="${boxH}" preserveAspectRatio="xMidYMid meet" filter="url(#lsh)"/>`,
      );
    }
  };
  half(d.left, 0, "sc-a");
  half(d.right, colW, "sc-b");
  p.push(`<rect x="${r2(colW - 1.5)}" y="${postersTop}" width="3" height="${ph}" fill="#000" opacity="0.45"/>`);
  // blend the hero feet into the panel
  p.push(`<rect x="0" y="${panelTop - 140}" width="${W}" height="140" fill="url(#blend)"/>`);

  // ---- top strip ----
  if (d.topStrip) {
    p.push(`<rect width="${W}" height="${stripH}" fill="#0a0a0c"/>`);
    p.push(txtR(W / 2, stripH * 0.65, d.topStrip.toUpperCase(), { size: 24, w: "black", fill: TEXT, ls: 4, anchor: "middle" }));
  }

  // ---- premium panel ----
  p.push(`<rect x="0" y="${panelTop}" width="${W}" height="${H - panelTop}" fill="url(#panel)"/>`);
  p.push(`<rect x="0" y="${panelTop}" width="${W}" height="${H - panelTop}" fill="url(#sheen)"/>`);
  p.push(`<rect x="0" y="${panelTop}" width="${W}" height="2" fill="#ffffff" opacity="0.06"/>`);

  // panel kicker (amber, tracked)
  let y = panelTop + 78;
  p.push(txtR(W / 2, y, d.panelKicker.toUpperCase(), { size: 27, w: "bold", fill: AMBER, ls: 4, anchor: "middle" }));

  // big brushed-chrome headline — sized to fit one or two lines
  const CHARW = 0.6;
  const cap = 132;
  const hLines = wrap(d.headline.toUpperCase(), 16, 2);
  const longest = Math.max(1, ...hLines.map((l) => l.length));
  const hSize = Math.min(cap, Math.floor((W - 120) / (longest * CHARW)));
  y += 34;
  for (const ln of hLines) {
    y += hSize;
    p.push(
      `<text x="${r2(W / 2)}" y="${r2(y)}" font-size="${hSize}" font-family="${FAM.black}" fill="url(#chrome)" text-anchor="middle" filter="url(#csh)">${esc(ln)}</text>`,
    );
    y += Math.round(hSize * 0.04);
  }

  // subline
  if (d.subline) {
    y += 50;
    p.push(txtR(W / 2, y, d.subline, { size: 30, w: "semi", fill: MUTED, anchor: "middle" }));
  }

  // ---- brand lockup, centered near the bottom (mark + wordmark + dot) ----
  const lockY = H - (d.footer ? 116 : 84);
  const markH = 40;
  const markW = (markH * 36) / 24;
  const word = "TV NIGHTLY";
  const wordSize = 40;
  const wordW = word.length * wordSize * 0.62;
  const groupW = markW + 18 + wordW + 26;
  const gx = (W - groupW) / 2;
  p.push(ogMark(gx, lockY - markH + 6, markH));
  p.push(txtR(gx + markW + 18, lockY, word, { size: wordSize, w: "black", fill: TEXT, ls: 1.5 }));
  p.push(`<circle cx="${r2(gx + markW + 18 + wordW + 12)}" cy="${r2(lockY - 11)}" r="8" fill="${AMBER}"/>`);

  // fine print
  if (d.footer) {
    p.push(txtR(W / 2, H - 46, d.footer, { size: 20, w: "semi", fill: "#7c7d82", anchor: "middle" }));
  }

  p.push(`</svg>`);
  return p.join("");
}

// ============================================================================
// Pinterest pin — 1000×1500 (2:3) PORTRAIT PNG for a show's "Shows like X" page.
// Pinterest is a visual search engine that ranks tall 2:3 pins, and "shows like
// {X}" is one of its most-saved query shapes — so this is the branded, evergreen
// artifact a pinner saves. Same resvg-safe dialect as the OG cards above (txtR /
// static Archivo families, no @font-face or variation axes) so it rasterizes
// server-side via src/lib/render.ts at width=1000.
// ============================================================================

const PIN_W = 1000;
const PIN_H = 1500;
const PIN_M = 64;
const PIN_CW = PIN_W - PIN_M * 2; // usable content width (872)

export interface SimilarPinEntry {
  name: string;
  posterUri: string | null; // inlined data-URI; null falls back to an initial tile
  rating: number | null;
}
export interface SimilarPinData {
  sourceTitle: string; // the show the pin is "more like"
  totalCount: number; // how many matches the page ranks (drives the footer count)
  backdropUri: string | null; // ambient hero art (source show backdrop)
  featured: SimilarPinEntry[]; // up to 3, shown as posters in the hero row
  rest: { name: string; rating: number | null }[]; // positions 4..8, text rows
}

// a gold "★ 9.3" pill seated in a poster's bottom-left corner
const pinRatingChip = (px: number, py: number, ph: number, rating: number): string => {
  const w = 78;
  const h = 32;
  const x = px + 10;
  const y = py + ph - h - 10;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="rgba(0,0,0,0.8)"/>` +
    ratingMark(x + w / 2, y + h * 0.68, 20, rating, GOLD, "middle")
  );
};

// the amber rank chip ("01"/"02") on a poster's top-left — reinforces "ranked"
const pinRankChip = (px: number, py: number, rank: number): string => {
  const w = 44;
  const h = 34;
  const x = px + 10;
  const y = py + 10;
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${AMBER}"/>` +
    txtR(x + w / 2, y + 24, String(rank).padStart(2, "0"), { size: 20, w: "black", fill: PLATE, anchor: "middle" })
  );
};

/** The "Shows like {X}" Pinterest pin: source backdrop + brand lockup up top, a
 *  three-poster hero row of the closest matches, then a ranked text list of the
 *  rest, capped by the wordmark + match count. */
export function buildSimilarPin(d: SimilarPinData): string {
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(
    `<defs>` +
      `<linearGradient id="pinbg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#17171c"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      `<linearGradient id="pinscrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.15"/><stop offset="0.5" stop-color="${PLATE}" stop-opacity="0.22"/><stop offset="0.84" stop-color="${PLATE}" stop-opacity="0.86"/><stop offset="1" stop-color="${PLATE}" stop-opacity="1"/></linearGradient>` +
      `<filter id="pshadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="22" flood-color="#000" flood-opacity="0.62"/></filter>` +
      `<filter id="ksh" x="-20%" y="-60%" width="140%" height="220%"><feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#000" flood-opacity="0.6"/></filter>` +
      `</defs>`,
  );
  p.push(`<rect width="${PIN_W}" height="${PIN_H}" fill="url(#pinbg)"/>`);

  // ---- hero band: ambient source backdrop scrimmed down into the plate ----
  const HERO = 560;
  if (d.backdropUri) {
    p.push(
      `<image href="${d.backdropUri}" x="0" y="0" width="${PIN_W}" height="${HERO}" preserveAspectRatio="xMidYMid slice" opacity="0.9"/>`,
    );
    p.push(`<rect width="${PIN_W}" height="${HERO}" fill="${PLATE}" opacity="0.32"/>`);
  }
  p.push(`<rect width="${PIN_W}" height="${HERO}" fill="url(#pinscrim)"/>`);

  // brand lockup + the editorial kicker
  p.push(ogBrand(PIN_M, 96));
  p.push(kickerBlock("More like this", PIN_M, 292, 34, 26));

  // ---- title: "SHOWS LIKE" eyebrow + the source name, sized to fit ----
  const CHARW = 0.62; // Archivo Black runs wide (~0.62–0.65 em/char) — size to fit
  const cap = 72;
  // wrap loosely (≈22 ch/line) so the font shrinks to fit the whole title rather
  // than truncating a long line; nSize then sizes to the longest resulting line
  const nameLines = wrap(d.sourceTitle.toUpperCase(), 22, 2);
  const longest = Math.max(1, ...nameLines.map((l) => l.length));
  const nSize = Math.min(cap, Math.floor(PIN_CW / (longest * CHARW)));
  const eyeSize = Math.max(30, Math.round(nSize * 0.4));
  p.push(txtR(PIN_M, 360, "SHOWS LIKE", { size: eyeSize, w: "black", fill: AMBER, ls: 2 }));
  let ty = 360 + 24 + nSize;
  for (const ln of nameLines) {
    p.push(txtR(PIN_M, ty, ln, { size: nSize, w: "black", fill: TEXT }));
    ty += Math.round(nSize * 1.02);
  }

  // ---- featured poster row (up to 3 closest matches) ----
  const cols = Math.min(3, d.featured.length) || 1;
  const gap = 28;
  const pw = Math.floor((PIN_CW - gap * (cols - 1)) / cols);
  const ph = Math.round(pw * 1.5);
  const rowY = 600;
  d.featured.slice(0, cols).forEach((e, i) => {
    const px = PIN_M + i * (pw + gap);
    p.push(posterHero(e.posterUri, e.name, px, rowY, pw, ph, `pin-p${i}`));
    p.push(pinRankChip(px, rowY, i + 1));
    if (e.rating != null) p.push(pinRatingChip(px, rowY, ph, e.rating));
    p.push(
      txtR(px + pw / 2, rowY + ph + 36, trunc(e.name, 16), { size: 24, w: "bold", fill: TEXT, anchor: "middle" }),
    );
  });

  // ---- ranked text list of the remaining matches ----
  let ly = rowY + ph + 96;
  d.rest.slice(0, 5).forEach((e, i) => {
    const rank = cols + i + 1;
    p.push(txtR(PIN_M, ly, String(rank).padStart(2, "0"), { size: 30, w: "black", fill: AMBER }));
    p.push(txtR(PIN_M + 66, ly, trunc(e.name, 26), { size: 30, w: "semi", fill: TEXT }));
    if (e.rating != null) p.push(ratingMark(PIN_W - PIN_M, ly, 24, e.rating, GOLD, "end"));
    p.push(`<line x1="${PIN_M}" y1="${ly + 20}" x2="${PIN_W - PIN_M}" y2="${ly + 20}" stroke="${LINE}"/>`);
    ly += 58;
  });

  // ---- footer: rule + wordmark + match count ----
  p.push(`<line x1="${PIN_M}" y1="${PIN_H - 92}" x2="${PIN_W - PIN_M}" y2="${PIN_H - 92}" stroke="${LINE}"/>`);
  p.push(txtR(PIN_M, PIN_H - 48, "tvnightly.com", { size: 30, w: "black", fill: AMBER, ls: 0.5 }));
  if (d.totalCount > cols)
    p.push(
      txtR(PIN_W - PIN_M, PIN_H - 48, `All ${d.totalCount} matches ranked`, {
        size: 22,
        w: "semi",
        fill: MUTED,
        anchor: "end",
      }),
    );
  p.push(`</svg>`);
  return p.join("");
}

const SIMP_W = 1080;
const SIMP_H = 1350; // 4:5 — poster-forward, renders large in iMessage/WhatsApp/FB

export interface SimilarPosterEntry {
  name: string;
  posterUri: string | null; // inlined data-URI; null falls back to an initial tile
  rating: number | null;
}
export interface SimilarPosterData {
  kicker: string; // "Shows like" | "Movies like"
  sourceTitle: string; // the show/movie the page is "more like"
  totalCount: number;
  posterUri: string | null; // SOURCE poster — the full-bleed hero
  backdropUri?: string | null; // fallback hero when no poster art
  picks: SimilarPosterEntry[]; // up to 4 ranked matches, overlaid at the foot
}

/** "Shows/Movies like X" POSTER card (1080×1350). The source poster IS the hero,
 *  full-bleed — the recognizable art people expect — with a row of the closest
 *  ranked matches as smaller posters overlaid across the bottom. The teaser is
 *  literal: "here's the poster you know, and here's what's like it." */
export function buildSimilarPosterCard(d: SimilarPosterData): string {
  const W = SIMP_W;
  const H = SIMP_H;
  const M = 52;
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Archivo, ${SYS}">`,
  );

  // ---- geometry (compute first so the amber bloom can be centered on the row) ----
  const n = Math.min(4, d.picks.length) || 1;
  const gap = 24;
  let pw = Math.floor((W - 2 * M - gap * (n - 1)) / n);
  let ph = Math.round(pw * 1.5);
  const maxPh = 306;
  if (ph > maxPh) {
    ph = maxPh;
    pw = Math.round(ph / 1.5);
  }
  const rowW = n * pw + (n - 1) * gap;
  const x0 = Math.round((W - rowW) / 2);
  const rowBottom = H - 56;
  const py = rowBottom - ph;
  const labelY = py - 40;
  const bandTop = labelY - 96;
  const bloomCy = (py + ph / 2 - 40) / H;

  p.push(
    `<defs>` +
      `<linearGradient id="spbg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#17171c"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      // cinematic vignette — darken the frame edges so the hero art centers the eye
      `<radialGradient id="spvig" cx="0.5" cy="0.4" r="0.75"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.5"/></radialGradient>` +
      // top scrim so the brand lockup holds over bright art
      `<linearGradient id="sptop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.85"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0"/></linearGradient>` +
      // deep bottom band — a premium dark shelf the row sits on
      `<linearGradient id="spbot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0"/><stop offset="0.34" stop-color="${PLATE}" stop-opacity="0.72"/><stop offset="0.62" stop-color="#08080b" stop-opacity="0.97"/><stop offset="1" stop-color="#050506"/></linearGradient>` +
      // warm amber bloom that "lights" the shelf, centered on the poster row
      `<radialGradient id="spbloom" cx="0.5" cy="${r2(bloomCy)}" r="0.5"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.17"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>` +
      // deep soft shadow so the mini posters float like jewels on the shelf
      `<filter id="ds" x="-45%" y="-45%" width="190%" height="200%"><feDropShadow dx="0" dy="16" stdDeviation="30" flood-color="#000" flood-opacity="0.72"/></filter>` +
      // crisp glow keeps type legible over any art
      `<filter id="spGlow" x="-30%" y="-40%" width="160%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="9" flood-color="#000" flood-opacity="0.8"/></filter>` +
      `</defs>`,
  );
  p.push(`<rect width="${W}" height="${H}" fill="url(#spbg)"/>`);

  // ---- the source poster, full-bleed (cover) — the hero ----
  const hero = d.posterUri ?? d.backdropUri ?? null;
  if (hero) {
    p.push(`<image href="${hero}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`);
  }
  // vignette + scrims layered over the art
  p.push(`<rect width="${W}" height="${H}" fill="url(#spvig)"/>`);
  p.push(`<rect x="0" y="0" width="${W}" height="260" fill="url(#sptop)"/>`);
  p.push(`<rect x="0" y="${bandTop}" width="${W}" height="${H - bandTop}" fill="url(#spbot)"/>`);
  p.push(`<rect x="0" y="${bandTop}" width="${W}" height="${H - bandTop}" fill="url(#spbloom)"/>`);

  // ---- brand top-left + match count top-right (both lifted off the art) ----
  p.push(`<g filter="url(#spGlow)">`);
  p.push(ogBrand(M, 98));
  p.push(txtR(W - M, 98, `${d.totalCount} SIMILAR · RANKED`, { size: 24, w: "black", fill: "#efe9df", anchor: "end", ls: 1.5 }));
  p.push(`</g>`);

  // ---- the "SHOWS LIKE {name}" label: amber accent bar + kicker + name ----
  p.push(`<g filter="url(#spGlow)">`);
  const kick = d.kicker.toUpperCase();
  const kickSize = 31;
  const barW = 46;
  p.push(`<rect x="${M}" y="${labelY - kickSize + 4}" width="${barW}" height="6" rx="3" fill="${AMBER}"/>`);
  const kickX = M + barW + 22;
  p.push(txtR(kickX, labelY, kick, { size: kickSize, w: "black", fill: AMBER, ls: 2 }));
  const kickW = kick.length * kickSize * 0.7 + (kick.length - 1) * 2; // over-estimate → clear gap before the name
  p.push(txtR(kickX + kickW + 22, labelY, trunc(d.sourceTitle.toUpperCase(), 15), { size: kickSize, w: "black", fill: TEXT }));
  p.push(`</g>`);

  // ---- the ranked pick posters (the payoff), floating on the shelf ----
  d.picks.slice(0, n).forEach((e, i) => {
    const px = x0 + i * (pw + gap);
    p.push(posterHero(e.posterUri, e.name, px, py, pw, ph, `smp-${i}`, "ds"));
    p.push(pinRankChip(px, py, i + 1));
    if (e.rating != null) p.push(pinRatingChip(px, py, ph, e.rating));
  });

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

export interface PromoCardData {
  kicker: string; // the moment badge: "TRENDING NOW" | "JUST RENEWED" | "ON TONIGHT" …
  title: string;
  rating?: number | null;
  note?: string | null; // the hook: "Season 3 confirmed" | "Now on Netflix" | "9:00 PM tonight"
  meta?: string | null; // "Drama · Crime · 2002"
  posterUri?: string | null;
  backdropUri?: string | null;
}

// a crisp poster (2:3) with a drop shadow + thin light edge — the magazine hero.
// resvg-safe: pure rect/image, shadow filter id passed in. Falls back to an amber
// initial plate when no art arrived.
function posterHero(uri: string | null, name: string, x: number, y: number, w: number, h: number, id: string, shadow = "pshadow") {
  const rx = Math.round(w * 0.045);
  if (!uri)
    return (
      `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${rx}" fill="#17171c" stroke="${LINE}"/>` +
      txtR(x + w / 2, y + h / 2 + 18, trunc(name, 10), { size: w * 0.13, w: "black", fill: AMBER, anchor: "middle" })
    );
  return (
    `<g filter="url(#${shadow})">` +
    `<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${rx}"/></clipPath>` +
    `<image href="${uri}" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id})"/>` +
    `<rect x="${r2(x + 0.75)}" y="${r2(y + 0.75)}" width="${r2(w - 1.5)}" height="${r2(h - 1.5)}" rx="${rx}" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="1.5"/>` +
    `</g>`
  );
}

// the moment kicker: editorial, not a button. A single amber LED dot + the label
// in tracked amber Archivo Black, lifted off the art by a crisp shadow. No box,
// no glow — the restraint is the point. Left-anchored at x; width via kickerBlockW
// so a centered kicker self-centers.
const KB = { dotR: 0.3, gap: 0.55, ls: 0.2 } as const;
function kickerBlock(text: string, x: number, y: number, h: number, size: number): string {
  const label = text.toUpperCase();
  const dotR = size * KB.dotR;
  const cy = y + h / 2;
  const dotCx = x + dotR;
  const tx = dotCx + dotR + size * KB.gap;
  return (
    `<g filter="url(#ksh)">` +
    `<circle cx="${r2(dotCx)}" cy="${r2(cy)}" r="${r2(dotR)}" fill="${AMBER}"/>` +
    txtR(tx, cy + size * 0.36, label, { size, w: "black", fill: AMBER, anchor: "start", ls: size * KB.ls }) +
    `</g>`
  );
}

/** A marketing card for a "post-worthy moment", rendered at ANY aspect ratio:
 *  1080² (IG feed), 1080×1920 (IG story / TikTok), 1920×1080 (X). POSTER-MAGAZINE
 *  treatment: the title art blurs full-bleed as an ambient ground, the crisp poster
 *  stands as the hero, and big Archivo-Black type + an amber kicker block carry the
 *  moment. Resvg-safe dialect, so it rasterizes server-side. */
export function buildPromoCard(d: PromoCardData, W: number, H: number): string {
  const landscape = W / H > 1.3;
  const isReel = H / W > 1.6; // true 9:16 → dodge TikTok's right rail + caption strip
  const MIN = Math.min(W, H);
  const M = Math.round(MIN * 0.075);
  const ambient = d.backdropUri ?? d.posterUri ?? null;
  const heroPoster = d.posterUri ?? d.backdropUri ?? null;
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(
    `<defs>` +
      `<linearGradient id="pbg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#141419"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      `<filter id="pblur" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="${Math.round(MIN * 0.05)}"/></filter>` +
      // deep poster/pill shadow — the "lift off the art" pop
      `<filter id="pcard" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="${Math.round(MIN * 0.018)}" stdDeviation="${Math.round(MIN * 0.05)}" flood-color="#000" flood-opacity="0.88"/></filter>` +
      // amber spotlight behind the hero
      `<radialGradient id="pspot" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.5"/><stop offset="0.5" stop-color="${AMBER}" stop-opacity="0.13"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="pvs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.2"/><stop offset="0.4" stop-color="${PLATE}" stop-opacity="0.04"/><stop offset="0.7" stop-color="${PLATE}" stop-opacity="0.72"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.99"/></linearGradient>` +
      `<linearGradient id="phs" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.08"/><stop offset="0.42" stop-color="${PLATE}" stop-opacity="0.5"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.98"/></linearGradient>` +
      `<filter id="ptsh" x="-25%" y="-45%" width="150%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="7" flood-color="#000" flood-opacity="0.75"/></filter>` +
      `</defs>`,
  );

  // 1) base plate + full-bleed cinematic art
  p.push(`<rect width="${W}" height="${H}" fill="url(#pbg)"/>`);
  if (ambient) {
    const over = Math.round(MIN * 0.1);
    p.push(
      `<image href="${ambient}" x="${-over}" y="${-over}" width="${W + over * 2}" height="${H + over * 2}" preserveAspectRatio="xMidYMid slice" filter="url(#pblur)" opacity="0.7"/>`,
    );
    p.push(`<rect width="${W}" height="${H}" fill="${PLATE}" opacity="0.34"/>`);
  }
  // 2) amber spotlight behind the poster
  const spotCx = landscape ? W * 0.29 : W * 0.5;
  const spotCy = landscape ? H * 0.5 : H * (isReel ? 0.34 : 0.4);
  const spotR = Math.round(MIN * 0.66);
  p.push(`<ellipse cx="${r2(spotCx)}" cy="${r2(spotCy)}" rx="${spotR}" ry="${spotR}" fill="url(#pspot)"/>`);
  // 3) legibility scrim + 4) amber signature spine
  p.push(`<rect width="${W}" height="${H}" fill="url(#${landscape ? "phs" : "pvs"})"/>`);
  p.push(`<rect x="0" y="0" width="${r2(MIN * 0.013)}" height="${H}" fill="${AMBER}"/>`);
  p.push(ogBrand(M, M + 26));

  // a filled amber kicker pill (dark text) — the catchy badge
  const kPad = (s: number) => Math.round(s * 0.55);
  const pillH = (s: number) => s + kPad(s) * 2;
  const kickerPill = (cx: number, topY: number, text: string, s: number, anchor: "middle" | "start"): string => {
    const label = text.toUpperCase();
    const ls = s * 0.1;
    const tw = label.length * s * 0.64 + Math.max(0, label.length - 1) * ls;
    const w = tw + s * 1.4;
    const h = pillH(s);
    const x = anchor === "middle" ? cx - w / 2 : cx;
    return (
      `<rect x="${r2(x)}" y="${r2(topY)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(h / 2)}" fill="${AMBER}"/>` +
      txtR(x + w / 2, topY + h / 2 + s * 0.34, label, { size: s, w: "black", fill: "#1c1305", anchor: "middle", ls })
    );
  };

  // a gold rating pill that sits on a poster corner (right edge = rightX)
  const ratingBadge = (rightX: number, topY: number, s: number, value: number): string => {
    const t = value.toFixed(1);
    const groupW = s * 0.92 + s * 0.3 + t.length * s * 0.58;
    const w = groupW + s * 1.0;
    const h = s + Math.round(s * 0.8);
    const x = rightX - w;
    return (
      `<g filter="url(#pcard)"><rect x="${r2(x)}" y="${r2(topY)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(h / 2)}" fill="${GOLD}"/></g>` +
      ratingMark(x + w / 2, topY + h / 2 + s * 0.34, s, value, "#1c1305", "middle")
    );
  };

  // the text stack, laid out bottom-up so nothing ever collides with the domain
  const textStack = (cx: number, colW: number, anchor: "middle" | "start", minTopY: number, domainY: number, capPx: number) => {
    const CHARW = 0.62; // Archivo Black caps advance — conservative so titles never clip
    const cap = capPx;
    const maxCh = Math.max(7, Math.floor(colW / (cap * CHARW)));
    const titleLines = wrap(d.title.toUpperCase(), maxCh, 3);
    const longest = Math.max(1, ...titleLines.map((l) => l.length));
    const tSize = Math.max(30, Math.min(cap, Math.floor(colW / (longest * CHARW))));
    const lead = Math.round(tSize * 1.0);
    const kSize = Math.max(19, Math.round(tSize * 0.28));
    const ns = d.note ? Math.round(W * (landscape ? 0.028 : 0.032)) : 0;
    const noteLines = d.note ? wrap(d.note, Math.max(10, Math.floor(colW / (ns * 0.53))), 2) : [];
    const ms = Math.round(W * 0.019);

    const kH = pillH(kSize);
    const gapK = Math.round(tSize * 0.4);
    const gapT = Math.round(tSize * 0.44);
    const gapN = Math.round(ns * 0.9);
    const titleH = titleLines.length * lead;
    const noteH = noteLines.length * Math.round(ns * 1.28);
    const metaH = d.meta ? Math.round(ms * 1.6) : 0;
    const total = kH + gapK + titleH + (noteLines.length ? gapT + noteH : 0) + (metaH ? gapN + metaH : 0);

    let y = Math.max(minTopY, domainY - Math.round(MIN * 0.055) - total);
    p.push(kickerPill(cx, y, d.kicker || "TV Nightly", kSize, anchor));
    y += kH + gapK;
    for (const ln of titleLines) {
      y += tSize;
      p.push(`<g filter="url(#ptsh)">` + txtR(cx, y, ln, { size: tSize, w: "black", fill: TEXT, anchor }) + `</g>`);
      y += lead - tSize;
    }
    if (noteLines.length) {
      y += gapT - (lead - tSize);
      for (const ln of noteLines) {
        y += ns;
        p.push(txtR(cx, y, ln, { size: ns, w: "semi", fill: "#e9e3d8", anchor }));
        y += Math.round(ns * 1.28) - ns;
      }
    }
    if (d.meta) {
      y += noteLines.length ? gapN : gapT;
      y += ms;
      p.push(
        txtR(cx, y, trunc(String(d.meta).toUpperCase(), Math.floor(colW / (ms * 0.62))), {
          size: ms,
          w: "bold",
          fill: MUTED,
          anchor,
          ls: ms * 0.14,
        }),
      );
    }
  };

  if (!landscape) {
    // portrait — a centered, poster-forward "cover"
    const rail = isReel ? 0.14 : 0;
    const capStrip = isReel ? 0.12 : 0.055;
    const safeR = W - Math.round(W * rail);
    const safeB = H - Math.round(H * capStrip);
    const cx = Math.round((M + safeR) / 2);
    const colW = safeR - M - Math.round(MIN * 0.02);
    const tall = H / W >= 1.35; // 2:3 pin & 9:16 have room for a big poster; 1:1 doesn't
    const ph = Math.round(H * (isReel ? 0.4 : tall ? 0.47 : 0.38));
    const pw = Math.round(ph * 0.667);
    const px = cx - Math.round(pw / 2);
    const py = Math.round(H * (isReel ? 0.085 : tall ? 0.075 : 0.07));
    p.push(posterHero(heroPoster, d.title, px, py, pw, ph, "ph-promo", "pcard"));
    if (d.rating != null) {
      p.push(ratingBadge(px + pw + Math.round(pw * 0.05), py - Math.round(ph * 0.028), Math.round(pw * 0.13), d.rating));
    }
    const domainY = safeB - Math.round(MIN * 0.008);
    p.push(txtR(cx, domainY, "tvnightly.com", { size: Math.round(W * 0.03), w: "black", fill: AMBER, ls: 1, anchor: "middle" }));
    const capPx = Math.round(W * (isReel ? 0.112 : tall ? 0.1 : 0.078));
    textStack(cx, colW, "middle", py + ph + Math.round(MIN * 0.035), domainY - Math.round(W * 0.05), capPx);
  } else {
    // landscape — poster left, text right
    const ph = Math.round(H * 0.78);
    const pw = Math.round(ph * 0.667);
    const px = M + Math.round(MIN * 0.03);
    const py = Math.round((H - ph) / 2);
    p.push(posterHero(heroPoster, d.title, px, py, pw, ph, "ph-promo", "pcard"));
    if (d.rating != null) {
      p.push(ratingBadge(px + pw + Math.round(pw * 0.05), py - Math.round(ph * 0.02), Math.round(pw * 0.12), d.rating));
    }
    const tx = px + pw + Math.round(M * 1.4);
    const colW = W - tx - M;
    const domainY = H - Math.round(M * 0.9);
    p.push(txtR(tx, domainY, "tvnightly.com", { size: Math.round(H * 0.048), w: "black", fill: AMBER, ls: 1 }));
    textStack(tx, colW, "start", Math.round(H * 0.16), domainY - Math.round(H * 0.06), Math.round(H * 0.11));
  }

  p.push(`</svg>`);
  return p.join("");
}

/** A season's episode ratings as a shareable card: color-coded score chips over a
 *  cinematic full-bleed hero, the show title + season, and a season-average/peak
 *  line. Green ≥8 · yellow ≥7 · orange ≥6 · red <6 · grey "?" for unaired. Renders
 *  at any aspect ratio (chip column beside the hero for wide/square; a chip grid
 *  under the title for 9:16 / 2:3). resvg-safe. */
export function buildSeasonRatingsCard(
  d: {
    name: string;
    season: number;
    episodes: { number: number; rating: number | null }[];
    backdropUri: string | null;
    posterUri: string | null;
  },
  W: number,
  H: number,
): string {
  const landscape = W / H > 1.3;
  const isReel = H / W > 1.6;
  const tall = !landscape && H / W >= 1.05; // 9:16 & 2:3 stack; 1:1 uses the column
  const MIN = Math.min(W, H);
  const M = Math.round(MIN * 0.075);
  const hero = d.backdropUri ?? d.posterUri ?? null;
  const eps = d.episodes.slice(0, 24);
  const rated = eps.filter((e): e is { number: number; rating: number } => e.rating != null);
  const avg = rated.length ? rated.reduce((s, e) => s + e.rating, 0) / rated.length : null;
  let peak: { number: number; rating: number } | null = null;
  for (const e of rated) if (!peak || e.rating > peak.rating) peak = e;
  const scoreColor = (r: number | null) =>
    r == null ? "#34343d" : r >= 8 ? "#46c46a" : r >= 7 ? "#e6c144" : r >= 6 ? "#e2913c" : "#e0574a";

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Archivo, ${SYS}">`);
  p.push(
    `<defs>` +
      `<linearGradient id="rbg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#141419"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      `<linearGradient id="rleft" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.97"/><stop offset="0.46" stop-color="${PLATE}" stop-opacity="0.66"/><stop offset="0.8" stop-color="${PLATE}" stop-opacity="0.16"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.03"/></linearGradient>` +
      `<linearGradient id="rbot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.06"/><stop offset="0.4" stop-color="${PLATE}" stop-opacity="0.12"/><stop offset="0.72" stop-color="${PLATE}" stop-opacity="0.84"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.99"/></linearGradient>` +
      `<filter id="rtsh" x="-25%" y="-45%" width="150%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="7" flood-color="#000" flood-opacity="0.82"/></filter>` +
      `<filter id="rchip" x="-45%" y="-45%" width="190%" height="190%"><feDropShadow dx="0" dy="3" stdDeviation="9" flood-color="#000" flood-opacity="0.5"/></filter>` +
      `</defs>`,
  );
  p.push(`<rect width="${W}" height="${H}" fill="url(#rbg)"/>`);
  if (hero) p.push(`<image href="${hero}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" opacity="0.96"/>`);
  p.push(`<rect width="${W}" height="${H}" fill="url(#${tall ? "rbot" : "rleft"})"/>`);
  p.push(`<rect x="0" y="0" width="${r2(MIN * 0.013)}" height="${H}" fill="${AMBER}"/>`);
  p.push(ogBrand(M, M + 26));

  const scorePill = (x: number, y: number, w: number, h: number, r: number | null): string => {
    const s = Math.round(h * 0.52);
    return (
      `<g filter="url(#rchip)"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r2(Math.min(h * 0.3, 16))}" fill="${scoreColor(r)}"/></g>` +
      txtR(x + w / 2, y + h / 2 + s * 0.34, r == null ? "?" : r.toFixed(1), {
        size: s,
        w: "black",
        fill: r == null ? "#c9c9d2" : "#141100",
        anchor: "middle",
      })
    );
  };
  const eyebrow = `SEASON ${d.season} · EPISODE RATINGS`;
  const titleUp = d.name.toUpperCase();
  const summary =
    avg != null ? `SEASON AVG ${avg.toFixed(1)}${peak ? `   ·   PEAK E${peak.number} · ${peak.rating.toFixed(1)}` : ""}` : null;

  if (!tall) {
    // ---- wide + square: chip column on the left, title along the bottom ----
    const colX = M;
    const labelW = Math.round(MIN * 0.085);
    const pillW = Math.round(MIN * 0.15);
    const eyeY = M + Math.round(MIN * 0.14);
    // domain up in the header (right of the brand) so it never collides with the title
    p.push(txtR(W - M, M + 26, "tvnightly.com", { size: Math.round(MIN * 0.03), w: "black", fill: AMBER, anchor: "end", ls: 1 }));

    // title stack, sized to fit and anchored to the bottom-left
    const capT = Math.round(W * (landscape ? 0.078 : 0.092));
    const titleColW = W - colX - M;
    const { lines: titleLines, size: tSize } = fitLines(titleUp, titleColW, capT, 2, 0.7);
    const lead = Math.round(tSize * 1.02);
    const titleBaseY = H - M - Math.round(MIN * 0.015);
    let by = titleBaseY - (titleLines.length - 1) * lead;
    const firstLineTop = by - tSize;
    if (summary) p.push(txtR(colX, firstLineTop - Math.round(MIN * 0.02), summary, { size: Math.round(MIN * 0.026), w: "bold", fill: "#e9e3d8", ls: MIN * 0.002 }));
    for (const ln of titleLines) {
      p.push(`<g filter="url(#rtsh)">` + txtR(colX, by, ln, { size: tSize, w: "black", fill: TEXT }) + `</g>`);
      by += lead;
    }

    // the chip column occupies the band between the eyebrow and the title
    const contentTop = eyeY + Math.round(MIN * 0.03);
    const contentBottom = firstLineTop - (summary ? Math.round(MIN * 0.05) : Math.round(MIN * 0.02));
    const availH = Math.max(1, contentBottom - contentTop);

    p.push(txtR(colX, eyeY, eyebrow, { size: Math.round(MIN * 0.026), w: "black", fill: AMBER, ls: MIN * 0.003 }));
    const n = Math.max(1, eps.length);
    const rowH = Math.min(Math.round(MIN * 0.11), availH / n);
    const gap = Math.max(2, Math.round(rowH * 0.16));
    const pillH = rowH - gap;
    eps.forEach((e, i) => {
      const y = contentTop + i * rowH;
      p.push(txtR(colX, y + pillH / 2 + pillH * 0.19, `E${e.number}`, { size: Math.round(pillH * 0.5), w: "bold", fill: "#cfcbc2" }));
      p.push(scorePill(colX + labelW, y, pillW, pillH, e.rating));
    });
  } else {
    // ---- tall (9:16 / 2:3): poster up top, then eyebrow + title + a chip grid ----
    const capStrip = isReel ? 0.12 : 0.05;
    const safeB = H - Math.round(H * capStrip);
    const cx = M;
    const colW = W - 2 * M - (isReel ? Math.round(W * 0.14) : 0);
    const n = Math.max(1, eps.length);
    const gcols = n <= 5 ? n : n <= 12 ? Math.ceil(n / 2) : Math.ceil(n / 3);
    const grows = Math.ceil(n / gcols);
    const cellGap = Math.round(MIN * 0.022);
    const cellW = (colW - (gcols - 1) * cellGap) / gcols;
    const pillH = Math.round(cellW * 0.6);
    const lblH = Math.round(MIN * 0.03);
    const cellH = lblH + Math.round(MIN * 0.012) + pillH + cellGap;
    const gridH = grows * cellH - cellGap;
    const domainY = safeB - Math.round(MIN * 0.006);
    p.push(txtR(cx, domainY, "tvnightly.com", { size: Math.round(W * 0.03), w: "black", fill: AMBER, ls: 1 }));
    const gridTop = domainY - Math.round(MIN * 0.06) - gridH;
    const capT = Math.round(W * (isReel ? 0.088 : 0.082));
    const { lines: titleLines, size: tSize } = fitLines(titleUp, colW, capT, 2, 0.7);
    let ty = gridTop - Math.round(MIN * (summary ? 0.09 : 0.055)) - titleLines.length * Math.round(tSize * 1.02);
    const eyebrowY = ty - Math.round(MIN * 0.032);
    p.push(txtR(cx, eyebrowY, eyebrow, { size: Math.round(MIN * 0.028), w: "black", fill: AMBER, ls: MIN * 0.003 }));
    for (const ln of titleLines) {
      ty += tSize;
      p.push(`<g filter="url(#rtsh)">` + txtR(cx, ty, ln, { size: tSize, w: "black", fill: TEXT }) + `</g>`);
      ty += Math.round(tSize * 1.02) - tSize;
    }
    if (summary) p.push(txtR(cx, gridTop - Math.round(MIN * 0.03), summary, { size: Math.round(MIN * 0.026), w: "bold", fill: "#e9e3d8", ls: MIN * 0.002 }));
    eps.forEach((e, i) => {
      const r = Math.floor(i / gcols);
      const c = i % gcols;
      const x = cx + c * (cellW + cellGap);
      const y = gridTop + r * cellH;
      p.push(txtR(x + cellW / 2, y + lblH * 0.78, `E${e.number}`, { size: Math.round(lblH * 0.86), w: "bold", fill: "#cfcbc2", anchor: "middle" }));
      p.push(scorePill(x, y + lblH + Math.round(MIN * 0.012), cellW, pillH, e.rating));
    });
  }

  p.push(`</svg>`);
  return p.join("");
}

// shared rating→colour ramp for the new resvg-safe cards (chips + heatmap)
const ratingColor = (r: number | null) =>
  r == null ? "#34343d" : r >= 8 ? "#46c46a" : r >= 7 ? "#e6c144" : r >= 6 ? "#e2913c" : r >= 5 ? "#e0754a" : "#e0574a";

/** "Shows like {X}": the source backdrop as a cinematic ground, then a grid of the
 *  closest matches as posters with a rating chip + name. Great Pinterest / group-chat
 *  fuel. resvg-safe, renders at any aspect ratio. */
export function buildSimilarCard(
  d: {
    sourceTitle: string;
    backdropUri: string | null;
    sourcePosterUri?: string | null;
    items: { name: string; rating: number | null; posterUri: string | null }[];
  },
  W: number,
  H: number,
): string {
  const landscape = W / H > 1.3;
  const isReel = H / W > 1.6;
  const square = !landscape && H / W < 1.15;
  const MIN = Math.min(W, H);
  const M = Math.round(MIN * 0.075);
  const cols = landscape ? Math.min(Math.max(1, d.items.length), 4) : 3;
  const items = d.items.slice(0, landscape ? 4 : square ? 3 : 6);
  const rows = Math.max(1, Math.ceil(items.length / cols));

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Archivo, ${SYS}">`);
  p.push(
    `<defs>` +
      `<linearGradient id="qbg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#141419"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      `<filter id="qblur" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="${Math.round(MIN * 0.055)}"/></filter>` +
      `<filter id="qph" x="-45%" y="-45%" width="190%" height="190%"><feDropShadow dx="0" dy="${Math.round(MIN * 0.014)}" stdDeviation="${Math.round(MIN * 0.04)}" flood-color="#000" flood-opacity="0.82"/></filter>` +
      `<linearGradient id="qv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.35"/><stop offset="0.5" stop-color="${PLATE}" stop-opacity="0.5"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.88"/></linearGradient>` +
      `<filter id="qtsh" x="-25%" y="-45%" width="150%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="7" flood-color="#000" flood-opacity="0.8"/></filter>` +
      `</defs>`,
  );
  p.push(`<rect width="${W}" height="${H}" fill="url(#qbg)"/>`);
  if (d.backdropUri) {
    const over = Math.round(MIN * 0.1);
    p.push(`<image href="${d.backdropUri}" x="${-over}" y="${-over}" width="${W + over * 2}" height="${H + over * 2}" preserveAspectRatio="xMidYMid slice" filter="url(#qblur)" opacity="0.5"/>`);
  }
  p.push(`<rect width="${W}" height="${H}" fill="url(#qv)"/>`);
  p.push(`<rect x="0" y="0" width="${r2(MIN * 0.013)}" height="${H}" fill="${AMBER}"/>`);
  p.push(ogBrand(M, M + 26));
  p.push(txtR(W - M, M + 26, "tvnightly.com", { size: Math.round(MIN * 0.03), w: "black", fill: AMBER, anchor: "end", ls: 1 }));

  // ---- header lockup: the source show's poster on the left, "IF YOU LIKED {title}"
  //      to its right (left-anchored editorial), then "WATCH THESE NEXT" ----
  const headTop = M + Math.round(MIN * 0.13);
  const eyeSize = Math.round(MIN * 0.03);
  let tx = M;
  let ph = 0;
  if (d.sourcePosterUri) {
    ph = Math.round(MIN * (landscape ? 0.22 : isReel ? 0.3 : square ? 0.2 : 0.26));
    const pw = Math.round(ph / 1.5);
    p.push(posterHero(d.sourcePosterUri, d.sourceTitle, M, headTop, pw, ph, "sim-src", "qph"));
    tx = M + pw + Math.round(MIN * 0.045);
  }
  // shrink-to-fit title against the room right of the poster — long names shrink, never clip
  const titleColW = W - M - tx;
  const capT = Math.round(W * (landscape ? 0.055 : isReel ? 0.082 : 0.066));
  const { lines: tLines, size: tSize } = fitLines(d.sourceTitle.toUpperCase(), titleColW, capT, 2, 0.7);
  const lead = Math.round(tSize * 1.02);
  const eyeGap = Math.round(MIN * 0.02);
  const textBlockH = eyeSize + eyeGap + tLines.length * lead;
  const blockTop = ph > textBlockH ? headTop + Math.round((ph - textBlockH) / 2) : headTop;
  p.push(txtR(tx, blockTop + eyeSize, "IF YOU LIKED", { size: eyeSize, w: "black", fill: AMBER, ls: MIN * 0.004, anchor: "start" }));
  let ty = blockTop + eyeSize + eyeGap;
  for (const ln of tLines) {
    ty += tSize;
    p.push(`<g filter="url(#qtsh)">` + txtR(tx, ty, ln, { size: tSize, w: "black", fill: TEXT, anchor: "start" }) + `</g>`);
    ty += lead - tSize;
  }
  const lockupBottom = Math.max(ty, headTop + ph);
  p.push(txtR(M, lockupBottom + Math.round(MIN * 0.055), "WATCH THESE NEXT", { size: Math.round(MIN * 0.026), w: "bold", fill: "#e9e3d8", ls: MIN * 0.003, anchor: "start" }));

  // ---- poster grid (fits both width and height) ----
  const gridTop = lockupBottom + Math.round(MIN * (isReel ? 0.12 : landscape ? 0.1 : square ? 0.06 : 0.1));
  const gRight = W - M;
  const gLeft = M;
  const gBottom = H - Math.round(MIN * (isReel ? 0.11 : 0.045));
  const gap = Math.round(MIN * 0.028);
  const nameH = Math.round(MIN * 0.05);
  const availW = gRight - gLeft;
  const availH = gBottom - gridTop;
  const posterH = Math.max(
    40,
    Math.min(((availW - (cols - 1) * gap) / cols) * 1.5, (availH - (rows - 1) * gap) / rows - nameH),
  );
  const cellW = posterH / 1.5;
  const cellH = posterH + nameH + gap;
  const gridW = cols * cellW + (cols - 1) * gap;
  const ox = gLeft + (availW - gridW) / 2;
  items.forEach((it, i) => {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = ox + c * (cellW + gap);
    const y = gridTop + r * cellH;
    p.push(posterHero(it.posterUri ?? null, it.name, x, y, cellW, posterH, `qp${i}`, "qph"));
    if (it.rating != null) p.push(pinRatingChip(x, y, posterH, it.rating));
    const ns = Math.round(nameH * 0.46);
    p.push(txtR(x + cellW / 2, y + posterH + nameH * 0.62, trunc(it.name, Math.floor(cellW / (ns * 0.56))), { size: ns, w: "bold", fill: "#efe9df", anchor: "middle" }));
  });

  p.push(`</svg>`);
  return p.join("");
}

/** Full-series episode heatmap: every episode of every season as a colour cell
 *  (green→red), with numbers when the cells are big enough. "Whole series in one
 *  image" — strong screenshot bait. resvg-safe, any aspect ratio. */
export function buildHeatmapCard(
  d: {
    name: string;
    backdropUri: string | null;
    posterUri?: string | null;
    episodes: { season: number; number: number; rating: number | null }[];
  },
  W: number,
  H: number,
): string {
  const MIN = Math.min(W, H);
  const landscape = W / H > 1.3;
  const isReel = H / W > 1.6;
  const M = Math.round(MIN * 0.075);
  const seasons = [...new Set(d.episodes.map((e) => e.season))].filter((s) => s > 0).sort((a, b) => a - b);
  const cols = seasons.map((s) =>
    d.episodes.filter((e) => e.season === s && e.number != null).sort((a, b) => a.number - b.number),
  );
  const nCols = Math.max(1, cols.length);
  const nRows = Math.max(1, ...cols.map((c) => c.length));
  const ratedArr = d.episodes.filter((e) => e.rating != null).map((e) => e.rating as number);
  const avg = ratedArr.length ? ratedArr.reduce((s, r) => s + r, 0) / ratedArr.length : null;

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Archivo, ${SYS}">`);
  p.push(
    `<defs>` +
      `<linearGradient id="hbg" x1="0" y1="0" x2="0.5" y2="1"><stop offset="0" stop-color="#15151b"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      `<filter id="hblur" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="${Math.round(MIN * 0.06)}"/></filter>` +
      `<filter id="htsh" x="-25%" y="-45%" width="150%" height="190%"><feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#000" flood-opacity="0.75"/></filter>` +
      `</defs>`,
  );
  p.push(`<rect width="${W}" height="${H}" fill="url(#hbg)"/>`);
  if (d.backdropUri) {
    p.push(`<image href="${d.backdropUri}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" filter="url(#hblur)" opacity="0.2"/>`);
    p.push(`<rect width="${W}" height="${H}" fill="${PLATE}" opacity="0.42"/>`);
  }
  p.push(`<rect x="0" y="0" width="${r2(MIN * 0.013)}" height="${H}" fill="${AMBER}"/>`);
  p.push(ogBrand(M, M + 26));
  p.push(txtR(W - M, M + 26, "tvnightly.com", { size: Math.round(MIN * 0.03), w: "black", fill: AMBER, anchor: "end", ls: 1 }));

  const headTop = M + Math.round(MIN * 0.14);
  p.push(txtR(M, headTop, "EVERY EPISODE · RATED", { size: Math.round(MIN * 0.028), w: "black", fill: AMBER, ls: MIN * 0.004 }));
  const tSize = Math.round(W * (landscape ? 0.055 : isReel ? 0.082 : 0.066));
  // the poster sits top-right in the header band — keep the title clear of it
  const tReserve = d.posterUri ? Math.round(MIN * 0.24) : 0;
  const tLines = wrap(d.name.toUpperCase(), Math.max(8, Math.floor((W - 2 * M - tReserve) / (tSize * 0.62))), 2);
  let ty = headTop + Math.round(MIN * 0.015);
  for (const ln of tLines) {
    ty += tSize;
    p.push(`<g filter="url(#htsh)">` + txtR(M, ty, ln, { size: tSize, w: "black", fill: TEXT }) + `</g>`);
    ty += Math.round(tSize * 1.02) - tSize;
  }
  if (avg != null)
    p.push(
      txtR(M, ty + Math.round(MIN * 0.05), `${seasons.length} SEASON${seasons.length === 1 ? "" : "S"} · ${ratedArr.length} EPISODES · AVG ${avg.toFixed(1)}`, {
        size: Math.round(MIN * 0.026),
        w: "bold",
        fill: "#e9e3d8",
        ls: MIN * 0.002,
      }),
    );

  // show poster, top-right in the header band (skipped when the band is too
  // shallow to render it legibly — e.g. compact landscape headers)
  if (d.posterUri) {
    const pTop = M + Math.round(MIN * 0.075);
    const pBot = ty + Math.round(MIN * 0.11) - Math.round(MIN * 0.025);
    const ph = Math.min(pBot - pTop, Math.round(MIN * 0.3));
    if (ph >= MIN * 0.14) {
      const pw = Math.round(ph * (2 / 3));
      const px = W - M - pw;
      const prx = r2(Math.min(14, ph * 0.06));
      p.push(
        `<clipPath id="hposter"><rect x="${px}" y="${pTop}" width="${pw}" height="${r2(ph)}" rx="${prx}"/></clipPath>` +
          `<g filter="url(#htsh)"><image href="${d.posterUri}" x="${px}" y="${pTop}" width="${pw}" height="${r2(ph)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#hposter)"/></g>` +
          `<rect x="${px + 0.5}" y="${pTop + 0.5}" width="${pw - 1}" height="${r2(ph - 1)}" rx="${prx}" fill="none" stroke="rgba(255,255,255,0.18)"/>`,
      );
    }
  }

  const gridTop = ty + Math.round(MIN * 0.11);
  const boxLeft = M;
  const boxBottom = H - Math.round(MIN * (isReel ? 0.14 : 0.06));
  const lg = Math.round(MIN * 0.05);
  const tg = Math.round(MIN * 0.038);
  const boxW = W - M - boxLeft;
  const boxH = boxBottom - gridTop;
  // wide → episodes run ACROSS, seasons DOWN (fills the width); tall keeps it upright
  const transpose = landscape;
  const gCols = transpose ? nRows : nCols;
  const gRows = transpose ? nCols : nRows;
  const gap = gCols > 10 || gRows > 16 ? Math.round(MIN * 0.004) : Math.round(MIN * 0.008);
  const cell = Math.min((boxW - lg - (gCols - 1) * gap) / gCols, (boxH - tg - (gRows - 1) * gap) / gRows, Math.round(MIN * 0.085));
  const gridW = gCols * cell + (gCols - 1) * gap;
  const gridH = gRows * cell + (gRows - 1) * gap;
  const ox = boxLeft + lg + Math.max(0, (boxW - lg - gridW) / 2);
  const oy = gridTop + tg + Math.max(0, (boxH - tg - gridH) / 2);
  const rx = Math.min(6, cell * 0.18);
  const showNum = cell >= Math.round(MIN * 0.048);
  const numSize = Math.round(cell * 0.42);
  const hSize = Math.round(MIN * 0.02);
  const colEvery = transpose && gCols > 12 ? 5 : 1;
  for (let gc = 0; gc < gCols; gc++) {
    if (gc % colEvery !== 0 && gc !== gCols - 1) continue;
    p.push(txtR(ox + gc * (cell + gap) + cell / 2, oy - Math.round(tg * 0.32), transpose ? `E${gc + 1}` : `S${seasons[gc]}`, { size: hSize, w: "black", fill: MUTED, anchor: "middle" }));
  }
  const rowEvery = !transpose && gRows > 14 ? 5 : 1;
  for (let gr = 0; gr < gRows; gr++) {
    if (gr % rowEvery !== 0 && gr !== gRows - 1) continue;
    p.push(txtR(ox - Math.round(lg * 0.28), oy + gr * (cell + gap) + cell / 2 + Math.round(hSize * 0.34), transpose ? `S${seasons[gr]}` : `E${gr + 1}`, { size: hSize, w: "bold", fill: MUTED, anchor: "end" }));
  }
  for (let gc = 0; gc < gCols; gc++)
    for (let gr = 0; gr < gRows; gr++) {
      const ep = transpose ? cols[gr][gc] : cols[gc][gr];
      const x = ox + gc * (cell + gap);
      const y = oy + gr * (cell + gap);
      p.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(cell)}" height="${r2(cell)}" rx="${r2(rx)}" fill="${ep ? ratingColor(ep.rating) : "#1b1b20"}"/>`);
      if (ep && showNum)
        p.push(
          txtR(x + cell / 2, y + cell / 2 + numSize * 0.34, ep.rating != null ? ep.rating.toFixed(1) : "·", {
            size: numSize,
            w: "bold",
            fill: ep.rating != null ? "#141100" : "#6a6a72",
            anchor: "middle",
          }),
        );
    }
  p.push(`</svg>`);
  return p.join("");
}

/** Head-to-head: two shows split-screen with poster, name, rating, and a WINNER
 *  pill on whichever scores higher, with a VS medallion at the seam. Debate bait.
 *  resvg-safe; splits left/right for wide+square, top/bottom for 9:16 / 2:3. */
export function buildVersusCard(
  a: { name: string; rating: number | null; posterUri: string | null; backdropUri: string | null },
  b: { name: string; rating: number | null; posterUri: string | null; backdropUri: string | null },
  W: number,
  H: number,
): string {
  const MIN = Math.min(W, H);
  const landscape = W / H > 1.3;
  const vert = !landscape && H / W >= 1.15; // tall → top/bottom
  const winA = (a.rating ?? -1) > (b.rating ?? -1);
  const winB = (b.rating ?? -1) > (a.rating ?? -1);
  const halfW = vert ? W : Math.round(W / 2);
  const halfH = vert ? Math.round(H / 2) : H;
  const ph = Math.round(Math.min(halfH * (vert ? 0.4 : 0.5), halfW * 0.6));
  const pw = Math.round(ph * 0.667);
  const pyRel = Math.round(halfH * (vert ? 0.11 : 0.14));

  const p: string[] = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Archivo, ${SYS}">`);
  p.push(
    `<defs>` +
      `<filter id="vblur" x="-15%" y="-15%" width="130%" height="130%"><feGaussianBlur stdDeviation="${Math.round(MIN * 0.045)}"/></filter>` +
      `<filter id="vph" x="-45%" y="-45%" width="190%" height="190%"><feDropShadow dx="0" dy="${Math.round(MIN * 0.014)}" stdDeviation="${Math.round(MIN * 0.04)}" flood-color="#000" flood-opacity="0.85"/></filter>` +
      `<radialGradient id="vsh" cx="0.5" cy="0.4" r="0.7"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.12"/><stop offset="0.68" stop-color="${PLATE}" stop-opacity="0.55"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.94"/></radialGradient>` +
      `<clipPath id="cA"><rect x="0" y="0" width="${halfW}" height="${halfH}"/></clipPath>` +
      `<clipPath id="cB"><rect x="${vert ? 0 : halfW}" y="${vert ? halfH : 0}" width="${halfW}" height="${halfH}"/></clipPath>` +
      `</defs>`,
  );
  p.push(`<rect width="${W}" height="${H}" fill="${PLATE}"/>`);

  const panel = (s: typeof a, X: number, Y: number, clip: string, win: boolean) => {
    const parts: string[] = [];
    const art = s.backdropUri ?? s.posterUri;
    if (art)
      parts.push(
        `<g clip-path="url(#${clip})"><image href="${art}" x="${X}" y="${Y}" width="${halfW}" height="${halfH}" preserveAspectRatio="xMidYMid slice" filter="url(#vblur)" opacity="0.78"/><rect x="${X}" y="${Y}" width="${halfW}" height="${halfH}" fill="url(#vsh)"/></g>`,
      );
    if (win)
      parts.push(
        `<g clip-path="url(#${clip})"><rect x="${X}" y="${Y}" width="${halfW}" height="${halfH}" fill="none" stroke="${GOLD}" stroke-width="${Math.round(MIN * 0.014)}"/></g>`,
      );
    const pcx = X + halfW / 2;
    const py = Y + pyRel;
    parts.push(posterHero(s.posterUri ?? s.backdropUri ?? null, s.name, pcx - pw / 2, py, pw, ph, `vp-${clip}`, "vph"));
    const nSize = Math.round(MIN * (vert ? 0.05 : 0.044));
    const nLines = wrap(s.name.toUpperCase(), Math.max(6, Math.floor((halfW - MIN * 0.16) / (nSize * 0.62))), 2);
    let ny = py + ph + Math.round(MIN * 0.04);
    for (const ln of nLines) {
      ny += nSize;
      parts.push(`<g filter="url(#vph)">` + txtR(pcx, ny, ln, { size: nSize, w: "black", fill: TEXT, anchor: "middle" }) + `</g>`);
      ny += Math.round(nSize * 1.02) - nSize;
    }
    if (s.rating != null) parts.push(ratingMark(pcx, ny + Math.round(MIN * 0.055), Math.round(MIN * 0.07), s.rating, win ? GOLD : "#e9e3d8", "middle"));
    // WINNER pill at the panel foot — clear of the brand + the medallion
    if (win) {
      const label = "WINNER";
      const ws = Math.round(MIN * 0.025);
      const wpw = label.length * ws * 0.64 + ws * 1.4;
      const wph = ws * 2;
      const wy = ny + Math.round(MIN * (s.rating != null ? 0.11 : 0.04));
      parts.push(`<g filter="url(#vph)"><rect x="${r2(pcx - wpw / 2)}" y="${r2(wy)}" width="${r2(wpw)}" height="${r2(wph)}" rx="${r2(wph / 2)}" fill="${GOLD}"/></g>`);
      parts.push(txtR(pcx, wy + wph / 2 + ws * 0.34, label, { size: ws, w: "black", fill: "#1c1305", anchor: "middle", ls: ws * 0.12 }));
    }
    return parts.join("");
  };
  p.push(panel(a, 0, 0, "cA", winA));
  p.push(panel(b, vert ? 0 : halfW, vert ? halfH : 0, "cB", winB));

  p.push(ogBrand(Math.round(MIN * 0.055), Math.round(MIN * 0.055) + 24));
  const cx = W / 2;
  const cy = vert ? Math.round(H / 2) : Math.round(pyRel + ph / 2);
  const rMed = Math.round(MIN * 0.095);
  p.push(`<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(rMed)}" fill="${PLATE}" stroke="${AMBER}" stroke-width="${Math.round(MIN * 0.007)}"/>`);
  p.push(txtR(cx, cy + rMed * 0.36, "VS", { size: Math.round(rMed * 0.95), w: "black", fill: AMBER, anchor: "middle" }));
  p.push(`</svg>`);
  return p.join("");
}

// kicker block width, shared so a centered block can self-center
const kickerBlockW = (text: string, _h: number, size: number) => {
  const label = text.toUpperCase();
  return size * KB.dotR * 2 + size * KB.gap + label.length * (size * 0.62 + size * KB.ls);
};

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

/** "What to watch" landscape OG — two show backdrops side by side (no VS
 *  framing), for generic discovery pages (what-to-watch, …) so shared links
 *  unfurl with a dual-show "tonight's picks" card, not the brand default. */
export function buildShowcaseOgCard(a: OgSide, b: OgSide, label = "WHAT TO WATCH TONIGHT"): string {
  const mid = OG_W / 2;
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(
    `<defs>` +
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17171c"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
      `<linearGradient id="vscrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.78"/><stop offset="0.28" stop-color="${PLATE}" stop-opacity="0.04"/><stop offset="0.62" stop-color="${PLATE}" stop-opacity="0.04"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0.94"/></linearGradient>` +
      `</defs>`,
  );
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>`);
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
  p.push(`<rect x="${mid - 1.5}" y="0" width="3" height="${OG_H}" fill="${PLATE}" opacity="0.55"/>`);

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
  p.push(txtR(OG_W - OG_M, 92, label, { size: 20, w: "bold", fill: MUTED, anchor: "end", ls: 2.5 }));
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

export interface TasteProfileCardData {
  slices: { label: string; pct: number }[];
  era: string | null;
  nextName: string;
  nextMeta: string | null;
  nextRating: number | null;
  posterUri: string | null;
  backdropUri: string | null;
}

const TASTE_LABEL = "#f5f1e8"; // section heads — bright enough after PNG raster
const TASTE_META = "#e2dcd0"; // secondary lines, louder than site muted on image cards
const TASTE_PAD = 36;

const tasteCardDefs = () =>
  `<linearGradient id="tastePanel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1b20"/><stop offset="1" stop-color="#131316"/></linearGradient>` +
  `<linearGradient id="tasteBar0" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff8f2e"/><stop offset="1" stop-color="#ffb86a"/></linearGradient>` +
  `<linearGradient id="tasteBar1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${GOLD}"/><stop offset="1" stop-color="#f5d87a"/></linearGradient>` +
  `<linearGradient id="tasteBar2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#cdb24a"/><stop offset="1" stop-color="#e7c76a"/></linearGradient>` +
  `<filter id="tasteCardShadow" x="-6%" y="-3%" width="112%" height="108%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000" flood-opacity="0.42"/></filter>`;

const tasteSectionTick = (x: number, y: number, w = 64) =>
  `<rect x="${x}" y="${y}" width="${w}" height="4" rx="2" fill="${AMBER}"/>`;

const tasteCardHeader = (x: number, y: number, pad: number, title: string, titleFill: string) =>
  tasteSectionTick(x + pad, y + 28) + txt(x + pad, y + 64, title, { size: 26, fill: titleFill, wght: 900, wdth: 82, ls: 5.5 });

function tasteDonut(cx: number, cy: number, r: number, strokeW: number, slices: { label: string; pct: number }[]): string {
  const circ = 2 * Math.PI * r;
  const gap = 6;
  let offset = 0;
  const out: string[] = [];
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${PANEL_HI}" stroke-width="${strokeW}"/>`);
  slices.slice(0, 3).forEach((s, i) => {
    const dash = (s.pct / 100) * circ;
    const seg = Math.max(1, dash - gap);
    out.push(
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#tasteBar${i})" stroke-width="${strokeW}"` +
        ` stroke-linecap="butt" stroke-dasharray="${r2(seg)} ${r2(circ - seg)}" stroke-dashoffset="${r2(-offset)}"` +
        ` transform="rotate(-90 ${cx} ${cy})"/>`,
    );
    offset += dash;
  });
  const top = slices[0];
  if (top) {
    out.push(txt(cx, cy - 8, `${top.pct}%`, { size: 54, fill: TEXT, anchor: "middle", wght: 900, wdth: 104 }));
    out.push(
      txt(cx, cy + 36, trunc(top.label.toUpperCase(), 11), {
        size: 20,
        fill: TASTE_LABEL,
        anchor: "middle",
        wght: 800,
        ls: 2.5,
        wdth: 88,
      }),
    );
  }
  return out.join("");
}

function tasteLegendRow(x: number, y: number, w: number, label: string, pct: number, i: number): string {
  const barH = 14;
  const fillW = Math.max(barH, Math.round((pct / 100) * w));
  const pctFill = i === 0 ? AMBER : TEXT;
  return (
    `<g filter="url(#textGlow)">` +
    `<circle cx="${x + 8}" cy="${y - 4}" r="7" fill="url(#tasteBar${i})"/>` +
    txt(x + 28, y, label.toUpperCase(), { size: 28, fill: TEXT, wght: 900, ls: 1.1, wdth: 90 }) +
    txt(x + w, y, `${pct}%`, { size: 34, fill: pctFill, wght: 900, anchor: "end", wdth: 92 }) +
    `<rect x="${x}" y="${y + 20}" width="${w}" height="${barH}" rx="${barH / 2}" fill="#050506"/>` +
    `<rect x="${x}" y="${y + 20}" width="${fillW}" height="${barH}" rx="${barH / 2}" fill="url(#tasteBar${i})"/>` +
    `</g>`
  );
}

function tasteBreakdownCard(x: number, y: number, w: number, h: number, d: TasteProfileCardData): string {
  const pad = TASTE_PAD;
  const out: string[] = [];
  out.push(
    `<g filter="url(#tasteCardShadow)">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="url(#tastePanel)" stroke="#34343c"/>` +
      `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="23" fill="none" stroke="rgba(255,255,255,0.035)"/>` +
      `</g>`,
  );
  out.push(tasteCardHeader(x, y, pad, "WHAT YOU WATCH", TASTE_LABEL));

  const contentY = y + 112;
  const donutCol = 272;
  const colGap = 34;
  const legendX = x + pad + donutCol + colGap;
  const legendW = w - pad * 2 - donutCol - colGap;
  const rowPitch = 92;
  const rowsTop = contentY + 24;
  const blockH = rowPitch * Math.min(d.slices.length, 3);
  const donutCx = x + pad + donutCol / 2;
  const donutCy = rowsTop + blockH / 2;
  out.push(tasteDonut(donutCx, donutCy, 112, 28, d.slices));

  d.slices.slice(0, 3).forEach((s, i) => {
    out.push(tasteLegendRow(legendX, rowsTop + 28 + i * rowPitch, legendW, s.label, s.pct, i));
  });

  if (d.era) {
    const sy = y + h - pad;
    out.push(
      `<line x1="${x + pad}" y1="${sy - 34}" x2="${x + w - pad}" y2="${sy - 34}" stroke="#303037"/>` +
        txt(x + pad, sy, "SWEET SPOT", { size: 24, fill: TASTE_LABEL, wght: 900, ls: 4, wdth: 80 }) +
        txt(x + w - pad, sy, d.era.toUpperCase(), { size: 24, fill: AMBER, wght: 900, ls: 2, anchor: "end", wdth: 90 }),
    );
  }
  return out.join("");
}

function tasteNextWatchCard(x: number, y: number, w: number, h: number, d: TasteProfileCardData): string {
  const pad = TASTE_PAD;
  const out: string[] = [];
  out.push(
    `<g filter="url(#tasteCardShadow)">` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="url(#tastePanel)" stroke="#34343c"/>` +
      `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" rx="23" fill="none" stroke="rgba(255,255,255,0.035)"/>` +
      `</g>`,
  );
  out.push(tasteCardHeader(x, y, pad, "NEXT WATCH", AMBER));

  const contentY = y + 94;
  const pw = 116;
  const ph = 174;
  const px = x + pad;
  const py = contentY;
  out.push(poster(d.posterUri, d.nextName, px, py, pw, ph, "tp-next"));
  const tx = px + pw + 32;
  const textTop = py + 8;
  const nameLines = wrap(d.nextName.toUpperCase(), 14, 2);
  const ns = nameLines.length > 1 ? 44 : 54;
  nameLines.forEach((ln, i) => {
    out.push(txt(tx, textTop + 36 + i * (ns + 8), ln, { size: ns, fill: TEXT, wght: 900, wdth: 106 }));
  });
  const metaY = textTop + 36 + nameLines.length * (ns + 8) + 14;
  if (d.nextMeta) out.push(txt(tx, metaY, trunc(d.nextMeta, 28), { size: 26, fill: TASTE_META, wght: 800 }));
  if (d.nextRating != null) {
    const chipY = metaY + 32;
    out.push(
      `<rect x="${tx - 2}" y="${chipY}" width="104" height="44" rx="12" fill="${PANEL_HI}" stroke="${LINE}"/>` +
        studioRatingMark(tx + 18, chipY + 31, 26, d.nextRating, GOLD, "start"),
    );
  }
  return out.join("");
}

/** Portrait taste story card — wrapped-style share frame. */
export function buildTasteProfileCard(d: TasteProfileCardData, fontCss: string | null = null): string {
  const f = frame(false);
  const heroH = 520;
  const cardX = 64;
  const cardW = SW - cardX * 2;
  const card1Y = heroH + 36;
  const card1H = 560;
  const card2Y = card1Y + card1H + 40;
  const card2H = 286;
  const p: string[] = [];

  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SW} ${f.H}" font-family="Archivo, ${SYS}">`);
  p.push(studioDefs(fontCss).replace("</defs>", tasteCardDefs() + "</defs>"));
  p.push(`<rect width="${SW}" height="${f.H}" fill="url(#bg)"/>`);
  p.push(heroBackdrop(d.backdropUri, d.posterUri, d.nextName, heroH, "tp-hero"));
  p.push(studioBrand(76, false));

  p.push(
    `<g filter="url(#textGlow)">` +
      txt(SM, heroH - 96, "MY TV TASTE", { size: 30, fill: AMBER, wght: 900, wdth: 112, ls: 8 }) +
      txt(SM, heroH - 18, "PROFILE", { size: 110, fill: TEXT, wght: 900, wdth: 108, ls: 1 }) +
      `</g>`,
  );

  p.push(tasteBreakdownCard(cardX, card1Y, cardW, card1H, d));
  p.push(tasteNextWatchCard(cardX, card2Y, cardW, card2H, d));
  p.push(studioFooter("Rate a few shows · get yours at", f.fy, f.H));
  p.push(`</svg>`);
  return p.join("");
}

/** Landscape unfurl for /recommend/taste share links. */
export function buildTasteProfileOgCard(d: TasteProfileCardData): string {
  const p: string[] = [];
  p.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" font-family="Archivo, ${SYS}">`,
  );
  p.push(ogDefs());
  p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#bg)"/>`);
  if (d.backdropUri) {
    p.push(
      `<image href="${d.backdropUri}" x="0" y="0" width="${OG_W}" height="${OG_H}" preserveAspectRatio="xMidYMid slice" opacity="0.55"/>`,
    );
    p.push(`<rect width="${OG_W}" height="${OG_H}" fill="url(#vscrim)"/>`);
  }
  p.push(ogBrand());
  p.push(txtR(OG_M, 176, "MY TV TASTE", { size: 22, w: "bold", fill: AMBER, ls: 6 }));
  p.push(txtR(OG_M, 228, "PROFILE", { size: 56, w: "black", fill: TEXT, ls: 1 }));

  const summary = d.slices.map((s) => `${s.pct}% ${s.label}`).join(" · ");
  p.push(txtR(OG_M, 296, trunc(summary, 48), { size: 32, w: "black", fill: TEXT }));
  if (d.era) p.push(txtR(OG_M, 340, `Sweet spot · ${d.era}`, { size: 22, w: "semi", fill: MUTED }));

  p.push(txtR(OG_M, 396, "NEXT WATCH", { size: 20, w: "bold", fill: AMBER, ls: 3 }));
  const titleLines = wrap(d.nextName.toUpperCase(), 18, 2);
  const ts = titleLines.length > 1 ? 44 : 52;
  let ty = 432;
  titleLines.forEach((ln) => {
    ty += ts;
    p.push(txtR(OG_M, ty, ln, { size: ts, w: "black", fill: TEXT }));
    ty += 6;
  });
  if (d.nextMeta) p.push(txtR(OG_M, ty + 16, trunc(d.nextMeta, 36), { size: 22, w: "semi", fill: MUTED }));
  if (d.nextRating != null) p.push(ratingMark(OG_M, ty + 50, 28, d.nextRating, GOLD, "start"));

  const pw = 200;
  const ph = 300;
  const px = OG_W - OG_M - pw;
  const py = Math.round((OG_H - ph) / 2);
  p.push(`<g filter="url(#ds)">${poster(d.posterUri ?? null, d.nextName, px, py, pw, ph, "tp-og")}</g>`);

  p.push(ogFooter(px - 48));
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
