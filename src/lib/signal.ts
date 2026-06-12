// The Episode Grid — every episode one cell on the season × episode matrix,
// its code and rating printed once, lit on a single-hue filament ramp:
// barely-lit umber for the duds, white-hot gold for the peak. One builder
// serves the page chart and the saved card, so the PNG a fan posts IS the
// page, never a cousin of it. The export is one portrait artifact — no
// aspect menu, just the good-looking card.
//
// All colors are LITERAL HEX (token names in comments): exports must be
// standalone documents, CSS variables never enter the string.
//
// HONESTY RULES (do not "improve" these away):
// - unrated/unaired slots render as unlit sockets, never as zeros
// - every value prints exactly once: cells carry ratings, the peak/low
//   register carries names only, season averages print only in the AVG
//   row, the series average prints only in the poster band, the scale
//   chips are scale, not data
import { EpisodeRow, ShowRow } from "../types";

export type SignalFrame = "page" | "card";

// palette literals (lockstep with 01-tokens.css — do not "fix" to vars)
const PLATE = "#0e0e11"; // --plate: the unlit tube
const LINE = "#2b2b32"; // --line
const SOCKET = "#161619"; // unrated cell: a socket with no filament
const TEXT = "#f8f6f2"; // --text
const MUTED = "#b6b1a9"; // --muted
const GOLD = "#EAC54F"; // --warn: the ratings color
const AMBER = "#FFA94D"; // --accent (the lockup dot; page JS uses it too)
const SYS = "-apple-system, 'Segoe UI', Roboto, sans-serif";

// the filament ramp: one hue, luminance carries the value. Absolute anchors
// (5.5 cold .. 9.5 white-hot) so a 6.1 looks dim on every show, like the
// real ratings scale fans carry in their heads.
const RAMP: [number, [number, number, number]][] = [
  [0, [42, 33, 24]], // #2a2118 cold filament
  [0.35, [107, 74, 35]], // #6b4a23 ember
  [0.7, [192, 138, 62]], // #c08a3e heated amber
  [0.92, [244, 200, 79]], // #f4c84f gold
  [1, [248, 231, 160]], // #f8e7a0 white-hot
];
function rampColor(r: number): string {
  const t = Math.max(0, Math.min(1, (r - 5.5) / (9.5 - 5.5)));
  let i = 0;
  while (i < RAMP.length - 2 && RAMP[i + 1][0] < t) i++;
  const [t0, c0] = RAMP[i];
  const [t1, c1] = RAMP[i + 1];
  const f = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
// numerals flip dark once the filament is bright enough to carry them
const inkFor = (r: number) => ((r - 5.5) / 4 > 0.62 ? "#1f1708" : TEXT);

const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const code = (e: EpisodeRow) =>
  `S${String(e.season ?? 0).padStart(2, "0")}E${String(e.number ?? 0).padStart(2, "0")}`;
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Archivo text node with Safari-proof variation settings. */
const txt = (
  x: number,
  y: number,
  s: string,
  o: {
    size: number;
    wght?: number;
    wdth?: number;
    fill?: string;
    anchor?: "start" | "middle" | "end";
    ls?: number;
    opacity?: number;
    sys?: boolean;
  },
) => {
  const f = o.sys
    ? `font-family="${SYS}" font-weight="${o.wght ?? 700}" style="font-variant-numeric:tabular-nums"`
    : `font-weight="${o.wght ?? 700}" style="font-variation-settings:'wdth' ${o.wdth ?? 105},'wght' ${o.wght ?? 700}"`;
  return `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(o.size)}" ${f} fill="${o.fill ?? MUTED}"${
    o.anchor ? ` text-anchor="${o.anchor}"` : ""
  }${o.ls ? ` letter-spacing="${r2(o.ls)}"` : ""}${o.opacity ? ` opacity="${o.opacity}"` : ""}>${esc(s)}</text>`;
};

export interface SignalResult {
  svg: string;
  summary: string;
  island: string | null;
}

// Memoized at module scope — isolates recycle, so treat it as a cache, not
// a guarantee. Chunked btoa: String.fromCharCode has call-stack limits.
let archivoCss: string | null | undefined;

/** The Archivo woff2 as a data-URI @font-face, so the saved card rasterizes
 *  with the brand face anywhere. The page frame never embeds it. */
export async function archivoFontCss(assets: Fetcher | undefined): Promise<string | null> {
  if (archivoCss !== undefined) return archivoCss;
  if (!assets) return (archivoCss = null);
  try {
    const res = await assets.fetch(new Request("https://assets.invalid/fonts/archivo-var.woff2"));
    if (!res.ok) return (archivoCss = null);
    archivoCss = `@font-face{font-family:'Archivo';src:url(${await dataUri(res, "font/woff2")}) format('woff2');font-weight:100 900;font-stretch:62% 125%;font-display:block}`;
  } catch {
    archivoCss = null;
  }
  return archivoCss;
}

async function dataUri(res: Response, fallbackMime: string): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 8192)
    bin += String.fromCharCode(...buf.subarray(i, i + 8192));
  return `data:${res.headers.get("content-type") ?? fallbackMime};base64,${btoa(bin)}`;
}

/** The show poster inlined as a data URI — SVG-as-image rasterization
 *  cannot fetch external resources, so the card must carry its own art. */
export async function posterDataUri(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, { headers: { accept: "image/*" } });
    if (!res.ok) return null;
    return await dataUri(res, "image/jpeg");
  } catch {
    return null;
  }
}

interface Cell {
  ep: EpisodeRow;
  col: number; // season column (specials last)
  row: number; // ordinal within the season, 0-based
}

export function buildSignalSvg(
  epsIn: EpisodeRow[],
  show: ShowRow,
  opts: {
    frame: SignalFrame;
    season: number | null;
    slug: string;
    fontCss?: string;
    poster?: string | null;
    /** the show backdrop behind the masthead band — life over the data */
    backdrop?: string | null;
  },
): SignalResult | null {
  // ---- the matrix: season columns ascending, specials ("SP") last;
  // within a season by number, null numbers appended in airdate order
  const seasonsRaw = [...new Set(epsIn.map((e) => e.season ?? 0))].sort((a, b) => a - b);
  const seasonList = [...seasonsRaw.filter((s) => s !== 0), ...(seasonsRaw.includes(0) ? [0] : [])];
  const rated = epsIn.filter((e) => e.rating != null);
  if (rated.length === 0) return null;

  const cells: Cell[] = [];
  seasonList.forEach((s, col) => {
    const rows = epsIn.filter((e) => (e.season ?? 0) === s);
    const numbered = rows.filter((e) => e.number != null).sort((a, b) => a.number! - b.number!);
    const unnumbered = rows
      .filter((e) => e.number == null)
      .sort((a, b) => (a.airdate ?? "").localeCompare(b.airdate ?? ""));
    [...numbered, ...unnumbered].forEach((ep, row) => cells.push({ ep, col, row }));
  });
  const S = seasonList.length;
  const R = Math.max(...seasonList.map((_, c) => cells.filter((x) => x.col === c).length));

  const rMin = Math.min(...rated.map((e) => e.rating!));
  const rMax = Math.max(...rated.map((e) => e.rating!));
  const seriesAvg = rated.reduce((t, e) => t + e.rating!, 0) / rated.length;
  // peak/low: rating, then earlier airdate, then lower id (TVmaze exposes
  // no episode vote counts — never tie-break on votes)
  const byRank = (dir: 1 | -1) => (a: EpisodeRow, b: EpisodeRow) =>
    dir * (b.rating! - a.rating!) ||
    (a.airdate ?? "9999").localeCompare(b.airdate ?? "9999") ||
    a.id - b.id;
  const peakEp = [...rated].sort(byRank(1))[0];
  const lowEp = [...rated].sort(byRank(-1))[0];
  const lowSuppressed = rated.length < 4 || rMax === rMin;

  const summary =
    `Episode ratings grid for ${show.name}${opts.season != null ? `, Season ${opts.season}` : ""}: ` +
    `${rated.length} rated episodes across ${S} season${S === 1 ? "" : "s"}, ratings ${rMin.toFixed(1)}–${rMax.toFixed(1)}. ` +
    `Peak: ${code(peakEp)} ${peakEp.name ?? ""}, ${peakEp.rating!.toFixed(1)}.`;

  // ---- geometry: one portrait card; the page is the same card minus the
  // masthead, scale and lockup (the site chrome carries those jobs)
  const isCard = opts.frame === "card";
  const W = 1080;
  const m = isCard ? 64 : 28;
  const GAP = 5;
  const labelGutter = 44;
  const colHeadH = 30;
  const avgRowH = 44;

  // masthead (card only)
  const mastH = isCard ? 190 : 0;
  // the poster band: art left, the register right
  const posterW = isCard ? 168 : 132;
  const posterH = Math.round(posterW * 1.5);
  const bandPad = isCard ? 26 : 18;
  const bandTop = mastH + (isCard ? 8 : 16);
  // the band always sizes to the poster slot — the top-five list needs the
  // same room whether or not the art arrived
  const bandH = posterH + bandPad;

  const gridLeft = m + labelGutter;
  const gridRight = W - m;
  let cellW = (gridRight - gridLeft - GAP * (S - 1)) / S;
  let xOff = 0;
  if (cellW > 124) {
    cellW = 124;
    xOff = (gridRight - gridLeft - (cellW * S + GAP * (S - 1))) / 2;
  }
  const cellH = Math.min(50, Math.max(isCard ? 22 : 26, cellW * 0.62));

  const gridTop = bandTop + bandH + colHeadH;
  const scaleRowH = 104; // the full-width rating-scale band, both frames
  const footH = isCard ? 110 : 0;
  const H = gridTop + R * (cellH + GAP) + avgRowH + scaleRowH + footH + (isCard ? 8 : 16);
  const cx = (col: number) => gridLeft + xOff + col * (cellW + GAP);
  const cy = (row: number) => gridTop + row * (cellH + GAP);

  // level of detail: the card always prints codes ("this is the artifact");
  // the page may drop them — hover carries the detail there
  const showCode = isCard ? cellH >= 18 : cellW >= 56 && cellH >= 30;
  const codeSize = Math.max(6.5, Math.min(11, cellW * 0.14));
  const valSize = Math.max(9, Math.min(22, cellH * (showCode ? 0.4 : 0.52)));
  const showVal = cellH >= 14;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${r2(H)}" font-family="Archivo, ${SYS}"${
      isCard ? "" : ` aria-hidden="true" focusable="false"`
    }>`,
  );
  const bandBottom = bandTop + bandH;
  parts.push(
    "<defs>",
    opts.fontCss ? `<style>${opts.fontCss}</style>` : "",
    `<clipPath id="sig-poster"><rect x="${m}" y="${bandTop}" width="${posterW}" height="${posterH}" rx="10"/></clipPath>`,
    // the scrim: house frame-hero grammar — the art dissolves into the plate
    // before the data starts; never a decorative edge, always a frame
    `<linearGradient id="sig-scrim" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${PLATE}" stop-opacity="0.66"/>` +
      `<stop offset="0.62" stop-color="${PLATE}" stop-opacity="0.88"/>` +
      `<stop offset="1" stop-color="${PLATE}" stop-opacity="1"/>` +
      `</linearGradient>`,
    `<clipPath id="sig-plate"><rect x="0.5" y="0.5" width="${W - 1}" height="${r2(H - 1)}" rx="14"/></clipPath>`,
    "</defs>",
  );
  const backdropBlock = () => {
    if (!opts.backdrop) return "";
    const bh = r2(bandBottom + 36);
    return (
      `<g clip-path="url(#sig-plate)">` +
      `<image href="${esc(opts.backdrop)}" x="0" y="0" width="${W}" height="${bh}" preserveAspectRatio="xMidYMid slice"/>` +
      `<rect x="0" y="0" width="${W}" height="${bh}" fill="url(#sig-scrim)"/>` +
      `</g>`
    );
  };
  if (isCard) {
    parts.push(`<rect x="0" y="0" width="${W}" height="${r2(H)}" fill="${PLATE}"/>`);
    parts.push(backdropBlock());
    // masthead
    const years = show.premiered
      ? `${show.premiered.slice(0, 4)}–${show.ended ? show.ended.slice(0, 4) : ""}`
      : null;
    const chyron = [
      "EPISODE RATINGS",
      show.network?.toUpperCase() ?? null,
      years,
      opts.season != null ? `SEASON ${opts.season}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const fit = fitName(show.name.toUpperCase(), 64, 36, W - m * 2);
    parts.push(
      txt(m, 84, chyron, { size: 19, wdth: 105, ls: 2.7 }),
      txt(m, 152, fit.lines[0], { size: fit.size, wght: 800, wdth: 110, fill: TEXT, ls: fit.size * 0.01 }),
    );
    if (fit.lines[1]) parts.push(txt(m, 152 + fit.size * 0.95, fit.lines[1], { size: fit.size, wght: 800, wdth: 110, fill: TEXT }));
  } else {
    parts.push(
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${r2(H - 1)}" rx="14" fill="${PLATE}" stroke="${LINE}" stroke-width="1"/>`,
    );
    parts.push(backdropBlock());
  }

  // ---- the poster band: the art, then THE TOP FIVE — the index a stranger
  // argues with. The list reprints five cell values by design: a 300-cell
  // wall needs its summary; the low needs none (its dashed ring carries it).
  let regX = m;
  if (opts.poster) {
    parts.push(
      `<image href="${esc(opts.poster)}" x="${m}" y="${bandTop}" width="${posterW}" height="${posterH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#sig-poster)"/>`,
      `<rect x="${m + 0.5}" y="${bandTop + 0.5}" width="${posterW - 1}" height="${posterH - 1}" rx="10" fill="none" stroke="${LINE}" stroke-width="1"/>`,
    );
    regX = m + posterW + (isCard ? 34 : 26);
  }
  const top5 = [...rated].sort(byRank(1)).slice(0, 5);
  const colAvgs = seasonList.map((s, col) => {
    const colRated = cells.filter((x) => x.col === col && x.ep.rating != null);
    return colRated.length >= 2
      ? colRated.reduce((t, x) => t + x.ep.rating!, 0) / colRated.length
      : null;
  });
  let bestSeason: number | null = null;
  colAvgs.forEach((a, i) => {
    if (a != null && (bestSeason == null || a > colAvgs[seasonList.indexOf(bestSeason)]!))
      bestSeason = seasonList[i];
  });
  const listFs = isCard ? 14 : 12;
  const headY = bandTop + (isCard ? 24 : 22);
  const rowsY0 = headY + (isCard ? 30 : 26);
  const rowH = (posterH - (rowsY0 - bandTop) - 26) / 5;
  parts.push(
    txt(regX, headY, "THE TOP FIVE", { size: listFs * 0.78, wdth: 105, ls: listFs * 0.13, opacity: 0.8 }),
  );
  top5.forEach((ep, i) => {
    const y = rowsY0 + rowH * i + rowH / 2;
    parts.push(
      `<text x="${r2(regX)}" y="${r2(y)}">` +
        `<tspan font-size="${r2(listFs * 1.15)}" font-weight="800" style="font-variation-settings:'wdth' 62,'wght' 800" fill="${TEXT}" opacity="0.3">${String(i + 1).padStart(2, "0")}</tspan>` +
        `<tspan font-size="${listFs}" font-weight="700" style="font-variation-settings:'wdth' 105,'wght' 700" letter-spacing="0.8" fill="${TEXT}">  ${esc(trunc((ep.name ?? code(ep)).toUpperCase(), isCard ? 26 : 30))}</tspan>` +
        `<tspan font-size="${r2(listFs * 0.82)}" font-weight="700" style="font-variation-settings:'wdth' 105,'wght' 700" letter-spacing="1" fill="${MUTED}">  ${code(ep)} · </tspan>` +
        `<tspan font-size="${r2(listFs * 1.1)}" font-family="${SYS}" font-weight="700" fill="${GOLD}" style="font-variant-numeric:tabular-nums">${ep.rating!.toFixed(1)}</tspan>` +
        `</text>`,
    );
  });
  // the band's right column: quiet stats, end-anchored, clear of the list
  {
    const statRow = (y: number, label: string, body: string, bodyFill: string, bodySys = false) =>
      `<text x="${r2(gridRight)}" y="${r2(y)}" text-anchor="end">` +
      `<tspan font-size="${r2(listFs * 0.78)}" font-weight="700" style="font-variation-settings:'wdth' 105,'wght' 700" letter-spacing="${r2(listFs * 0.13)}" fill="${MUTED}" opacity="0.55">${label}</tspan>` +
      (bodySys
        ? `<tspan font-size="${r2(listFs * 1.1)}" font-family="${SYS}" font-weight="700" fill="${bodyFill}" style="font-variant-numeric:tabular-nums">  ${esc(body)}</tspan>`
        : `<tspan font-size="${r2(listFs * 0.95)}" font-weight="700" style="font-variation-settings:'wdth' 105,'wght' 700" letter-spacing="1" fill="${bodyFill}">  ${esc(body)}</tspan>`) +
      `</text>`;
    const stats: [string, string, string, boolean][] = [];
    if (!lowSuppressed)
      stats.push(["THE LOW", `${trunc((lowEp.name ?? code(lowEp)).toUpperCase(), 18)} · ${code(lowEp)}`, MUTED, false]);
    stats.push(["SERIES AVG", seriesAvg.toFixed(1), GOLD, true]);
    if (bestSeason != null)
      stats.push(["BEST SEASON", bestSeason === 0 ? "SP" : `S${bestSeason}`, TEXT, false]);
    if (S > 1) stats.push(["SEASONS", String(S), TEXT, false]);
    stats.forEach(([label, body, fill, sys], i) =>
      parts.push(statRow(rowsY0 + rowH * (i * 1.3 + 0.4), label, body, fill, sys)),
    );
  }

  // ---- column heads (page links them into the season filter)
  seasonList.forEach((s, col) => {
    const label = s === 0 ? "SP" : `S${s}`;
    const t = txt(cx(col) + cellW / 2, gridTop - 10, label, {
      size: Math.min(13, Math.max(10, cellW * 0.18)),
      wdth: 105,
      ls: 1.6,
      anchor: "middle",
    });
    parts.push(!isCard ? `<a href="?season=${s}">${t}</a>` : t);
  });

  // ---- row labels: E1.. every row while they fit, every 5th when they don't
  const rowEvery = cellH >= 18 ? 1 : 5;
  for (let r = 0; r < R; r++) {
    if (r % rowEvery !== 0 && r !== R - 1) continue;
    parts.push(
      txt(gridLeft + xOff - 12, cy(r) + cellH / 2 + 4, `E${r + 1}`, {
        size: Math.min(12, Math.max(9, cellH * 0.3)),
        sys: true,
        wght: 600,
        anchor: "end",
        opacity: 0.7,
      }),
    );
  }

  // ---- the cells
  for (const cell of cells) {
    const { ep } = cell;
    const x = cx(cell.col);
    const y = cy(cell.row);
    const rt = ep.rating;
    const fill = rt != null ? rampColor(rt) : SOCKET;
    const rx = Math.min(8, cellH * 0.18);
    parts.push(
      `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(cellW)}" height="${r2(cellH)}" rx="${r2(rx)}" fill="${fill}"${
        rt == null ? ` stroke="${LINE}" stroke-width="1"` : ""
      }><title>${esc(`${code(ep)} ${ep.name ?? ""}${rt != null ? ` — ${rt.toFixed(1)}` : " — unrated"}`)}</title></rect>`,
    );
    if (rt != null && showVal) {
      const ink = inkFor(rt);
      if (showCode)
        parts.push(
          txt(x + cellW / 2, y + cellH * 0.36, code(ep), {
            size: codeSize,
            wdth: 105,
            ls: 0.6,
            fill: ink,
            anchor: "middle",
            opacity: 0.72,
          }),
        );
      parts.push(
        txt(x + cellW / 2, y + cellH * (showCode ? 0.78 : 0.5) + (showCode ? 0 : valSize * 0.36), rt.toFixed(1), {
          size: valSize,
          sys: true,
          wght: 700,
          fill: ink,
          anchor: "middle",
        }),
      );
    }
  }

  // peak: the only paper-white stroke in the frame; low: a quiet muted ring
  const ring = (ep: EpisodeRow, stroke: string, widthPx: number, dash?: string) => {
    const cell = cells.find((x) => x.ep.id === ep.id)!;
    return `<rect x="${r2(cx(cell.col) - 1.5)}" y="${r2(cy(cell.row) - 1.5)}" width="${r2(cellW + 3)}" height="${r2(cellH + 3)}" rx="${r2(Math.min(9, cellH * 0.2))}" fill="none" stroke="${stroke}" stroke-width="${widthPx}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>`;
  };
  parts.push(ring(peakEp, TEXT, 2));
  if (!lowSuppressed) parts.push(ring(lowEp, MUTED, 1.2, "3 3"));

  // ---- season averages: printed once, gold, under each column
  const avgY = cy(R - 1) + cellH + 30;
  parts.push(
    txt(gridLeft + xOff - 12, avgY, "AVG", { size: 9, wdth: 105, ls: 1.2, anchor: "end", opacity: 0.6 }),
  );
  seasonList.forEach((s, col) => {
    const colRated = cells.filter((x) => x.col === col && x.ep.rating != null);
    if (colRated.length < 2) return;
    const avg = colRated.reduce((t, x) => t + x.ep.rating!, 0) / colRated.length;
    parts.push(
      txt(cx(col) + cellW / 2, avgY, avg.toFixed(1), {
        size: Math.min(15, Math.max(10, cellW * 0.2)),
        sys: true,
        wght: 700,
        fill: GOLD,
        anchor: "middle",
      }),
    );
  });

  // ---- the rating scale: a full-width discrete band — twelve filament
  // steps, never a gradient. Values above are scale anchors, not data.
  {
    const y0 = avgY + 30;
    const segN = 12;
    const segGap = 3;
    const bandW = W - m * 2;
    const segW = (bandW - segGap * (segN - 1)) / segN;
    const bandY = y0 + 24;
    parts.push(txt(m, y0, "RATING SCALE", { size: 11, wdth: 105, ls: 1.6, opacity: 0.65 }));
    parts.push(
      txt(m, bandY - 8, "5.5", { size: 12, sys: true, wght: 700, opacity: 0.8 }),
      txt(W / 2, bandY - 8, "7.5", { size: 12, sys: true, wght: 700, anchor: "middle", opacity: 0.8 }),
      txt(W - m, bandY - 8, "9.5", { size: 12, sys: true, wght: 700, anchor: "end", opacity: 0.8 }),
    );
    for (let i = 0; i < segN; i++) {
      const v = 5.5 + (4 * (i + 0.5)) / segN;
      parts.push(
        `<rect x="${r2(m + i * (segW + segGap))}" y="${bandY}" width="${r2(segW)}" height="14" rx="3" fill="${rampColor(v)}"/>`,
      );
    }
    parts.push(
      txt(m, bandY + 36, "LOWEST RATED", { size: 10, wdth: 105, ls: 1.4, opacity: 0.6 }),
      txt(W - m, bandY + 36, "HIGHEST RATED", { size: 10, wdth: 105, ls: 1.4, anchor: "end", opacity: 0.6 }),
    );
  }

  if (!isCard) parts.push(`<g id="sig-cursor"></g>`);
  if (isCard) {
    // lockup: the standby mark (header geometry, 36x24), wordmark, LED dot
    const hairY = H - 86;
    const baseY = H - 40;
    const wfs = 28;
    const markScale = 26 / 24;
    const markW = 36 * markScale;
    const wordX = m + markW + 14;
    const wordW = "TV NIGHTLY".length * wfs * 0.6;
    parts.push(
      `<line x1="${m}" y1="${r2(hairY)}" x2="${W - m}" y2="${r2(hairY)}" stroke="${LINE}" stroke-width="1"/>`,
      `<g transform="translate(${m}, ${r2(baseY - 22)}) scale(${r2(markScale)})">` +
        `<rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5"/>` +
        `<circle cx="26.5" cy="16.5" r="3.4" fill="${AMBER}" opacity="0.22"/>` +
        `<circle cx="26.5" cy="16.5" r="2.2" fill="${AMBER}"/>` +
        `</g>`,
      txt(wordX, baseY, "TV NIGHTLY", { size: wfs, wght: 800, wdth: 120, fill: TEXT, ls: wfs * 0.02 }),
      `<circle cx="${r2(wordX + wordW + 0.14 * wfs)}" cy="${r2(baseY - 0.08 * wfs)}" r="${r2(0.085 * wfs)}" fill="${AMBER}"/>`,
      txt(W - m, baseY - 4, "TVNIGHTLY.COM", { size: 16, wdth: 105, ls: 2.2, anchor: "end" }),
    );
  }
  parts.push("</svg>");

  // data island (page only): the server ships the layout, JS computes nothing
  let island: string | null = null;
  if (!isCard) {
    island = JSON.stringify({
      rows: cells.map((cell) => ({
        c: code(cell.ep),
        n: cell.ep.name ?? code(cell.ep),
        r: cell.ep.rating,
        d: cell.ep.airdate,
        h: `/show/${opts.slug}/s${String(cell.ep.season ?? 0).padStart(2, "0")}e${String(cell.ep.number ?? 0).padStart(2, "0")}`,
      })),
      x: cells.map((cell) => r2(cx(cell.col) + cellW / 2)),
      y: cells.map((cell) => r2(cy(cell.row) + cellH / 2)),
      cw: r2(cellW),
      ch: r2(cellH),
      peak: cells.findIndex((x) => x.ep.id === peakEp.id),
      low: lowSuppressed ? null : cells.findIndex((x) => x.ep.id === lowEp.id),
    }).replaceAll("<", "\\u003C");
  }

  return { svg: parts.join(""), summary, island };
}

function fitName(name: string, maxSize: number, minSize: number, maxW: number): { size: number; lines: string[] } {
  const est = (s: string, fs: number) => s.length * fs * 0.68;
  let size = maxSize;
  while (size > minSize && est(name, size) > maxW) size -= 2;
  if (est(name, size) <= maxW) return { size, lines: [name] };
  const words = name.split(" ");
  let l1 = "";
  let best = name.length;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const d = Math.abs(a.length - (name.length - a.length));
    if (d < best) {
      best = d;
      l1 = a;
    }
  }
  const l2 = name.slice(l1.length).trim();
  size = maxSize;
  while (size > minSize && Math.max(est(l1, size), est(l2, size)) > maxW) size -= 2;
  return { size, lines: l1 ? [l1, l2] : [name] };
}
