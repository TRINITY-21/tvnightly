// The Episode Grid — every episode one cell on the season × episode matrix,
// its code and rating printed once, lit on a single-hue filament ramp:
// barely-lit umber for the duds, white-hot gold for the peak. One builder
// serves the page chart and every saved frame, so the PNG a fan posts IS
// the page, never a cousin of it.
//
// All colors are LITERAL HEX (token names in comments): exports must be
// standalone documents, CSS variables never enter the string.
//
// HONESTY RULES (do not "improve" these away):
// - unrated/unaired slots render as unlit sockets, never as zeros
// - every value prints exactly once: cells carry ratings, the peak/low
//   register lines carry names only, season averages print only in the
//   footer row, the color ramp is an encoding of the printed value
import { EpisodeRow, ShowRow } from "../types";

export type SignalFrame = "page" | "wide" | "square" | "story";

// palette literals (lockstep with 01-tokens.css — do not "fix" to vars)
const PLATE = "#0e0e11"; // --plate: the unlit tube
const LINE = "#2b2b32"; // --line
const SOCKET = "#161619"; // unrated cell: a socket with no filament
const TEXT = "#f8f6f2"; // --text
const MUTED = "#b6b1a9"; // --muted
const GOLD = "#EAC54F"; // --warn: the ratings color
const AMBER = "#FFA94D"; // --accent (page interactions only; JS uses it)
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
    cls?: string;
    sys?: boolean;
  },
) => {
  const f = o.sys
    ? `font-family="${SYS}" font-weight="${o.wght ?? 700}" style="font-variant-numeric:tabular-nums"`
    : `font-weight="${o.wght ?? 700}" style="font-variation-settings:'wdth' ${o.wdth ?? 105},'wght' ${o.wght ?? 700}"`;
  return `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(o.size)}" ${f} fill="${o.fill ?? MUTED}"${
    o.anchor ? ` text-anchor="${o.anchor}"` : ""
  }${o.ls ? ` letter-spacing="${r2(o.ls)}"` : ""}${o.opacity ? ` opacity="${o.opacity}"` : ""}${
    o.cls ? ` class="${o.cls}"` : ""
  }>${esc(s)}</text>`;
};

export interface SignalResult {
  svg: string;
  summary: string;
  island: string | null;
}

// Memoized at module scope — isolates recycle, so treat it as a cache, not
// a guarantee. Chunked btoa: String.fromCharCode has call-stack limits.
let archivoCss: string | null | undefined;

/** The Archivo woff2 as a data-URI @font-face, so export SVGs rasterize
 *  with the brand face anywhere. Page frames never embed it. */
export async function archivoFontCss(assets: Fetcher | undefined): Promise<string | null> {
  if (archivoCss !== undefined) return archivoCss;
  if (!assets) return (archivoCss = null);
  try {
    const res = await assets.fetch(new Request("https://assets.invalid/fonts/archivo-var.woff2"));
    if (!res.ok) return (archivoCss = null);
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 8192)
      bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    archivoCss = `@font-face{font-family:'Archivo';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');font-weight:100 900;font-stretch:62% 125%;font-display:block}`;
  } catch {
    archivoCss = null;
  }
  return archivoCss;
}

interface Cell {
  ep: EpisodeRow;
  col: number; // season column (specials last)
  row: number; // ordinal within the season, 0-based
}

export function buildSignalSvg(
  epsIn: EpisodeRow[],
  show: ShowRow,
  opts: { frame: SignalFrame; season: number | null; slug: string; fontCss?: string },
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

  // ---- frame geometry: the grid fits its box; cells set the page height
  const isExport = opts.frame !== "page";
  const W = opts.frame === "wide" ? 1920 : 1080;
  const m = opts.frame === "wide" ? 96 : opts.frame === "page" ? 28 : 64;
  const headerH = opts.frame === "wide" ? 220 : opts.frame === "square" ? 190 : opts.frame === "story" ? 330 : 0;
  const footerH = isExport ? 168 : 0; // lockup + the discrete scale legend

  const GAP = 5;
  const labelGutter = 44; // E-row labels
  const registerH = 56; // THE PEAK / THE LOW line above the grid
  const colHeadH = 30;
  const avgRowH = 44;

  const gridLeft = m + labelGutter;
  const gridRight = W - m;
  let cellW = (gridRight - gridLeft - GAP * (S - 1)) / S;
  let xOff = 0;
  if (cellW > 124) {
    // a 3-season show shouldn't render fat bricks — cap and center
    cellW = 124;
    xOff = (gridRight - gridLeft - (cellW * S + GAP * (S - 1))) / 2;
  }

  let cellH: number;
  let H: number;
  const fixedH = opts.frame === "wide" ? 1080 : opts.frame === "square" ? 1080 : 1920;
  if (isExport) {
    const avail = fixedH - headerH - footerH - registerH - colHeadH - avgRowH - 24;
    // the story frame fills its column — short grids grow into the space
    const capH = opts.frame === "story" ? 96 : 64;
    cellH = Math.min(capH, Math.max(13, (avail - GAP * (R - 1)) / R));
    H = fixedH;
  } else {
    cellH = Math.min(50, Math.max(26, cellW * 0.62));
    H = registerH + colHeadH + R * (cellH + GAP) + avgRowH + 20;
  }
  const gridTop = (isExport ? headerH : 0) + registerH + colHeadH;
  const cx = (col: number) => gridLeft + xOff + col * (cellW + GAP);
  const cy = (row: number) => gridTop + row * (cellH + GAP);

  // level of detail: what fits, prints; what doesn't, yields honestly
  const showCode = cellW >= 56 && cellH >= 30;
  const valSize = Math.max(9, Math.min(22, cellH * (showCode ? 0.4 : 0.52)));
  const codeSize = Math.max(8, Math.min(11, cellW * 0.14));
  const showVal = cellH >= 14;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${r2(H)}" font-family="Archivo, ${SYS}"${
      isExport ? "" : ` aria-hidden="true" focusable="false"`
    }>`,
  );
  if (opts.fontCss) parts.push(`<defs><style>${opts.fontCss}</style></defs>`);
  if (isExport) {
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${PLATE}"/>`);
    parts.push(exportHeader(show, opts.season, W, m, opts.frame));
  } else {
    parts.push(
      `<rect x="0.5" y="0.5" width="${W - 1}" height="${r2(H - 1)}" rx="14" fill="${PLATE}" stroke="${LINE}" stroke-width="1"/>`,
    );
  }

  // ---- the register line: names only — the values live in the ringed cells.
  // One text per side, label and name as tspans: no width math to get wrong.
  const regY = (isExport ? headerH : 0) + 34;
  const regFs = opts.frame === "wide" ? 16 : 13;
  const regLine = (
    x: number,
    anchor: "start" | "end",
    label: string,
    ep: EpisodeRow,
    nameFill: string,
    labelOpacity: number,
  ) =>
    `<text x="${r2(x)}" y="${r2(regY)}"${anchor === "end" ? ` text-anchor="end"` : ""}>` +
    `<tspan font-size="${r2(regFs * 0.82)}" font-weight="700" style="font-variation-settings:'wdth' 105,'wght' 700" letter-spacing="${r2(regFs * 0.12)}" fill="${MUTED}" opacity="${labelOpacity}">${label}</tspan>` +
    `<tspan font-size="${regFs}" font-weight="700" style="font-variation-settings:'wdth' 105,'wght' 700" letter-spacing="1" fill="${nameFill}"> ${esc(trunc((ep.name ?? code(ep)).toUpperCase(), 26))} · ${code(ep)}</tspan>` +
    `</text>`;
  parts.push(regLine(m, "start", "THE PEAK", peakEp, TEXT, 0.8));
  if (!lowSuppressed) parts.push(regLine(gridRight, "end", "THE LOW", lowEp, MUTED, 0.55));

  // ---- column heads (page links them into the season filter)
  seasonList.forEach((s, col) => {
    const label = s === 0 ? "SP" : `S${s}`;
    const t = txt(cx(col) + cellW / 2, gridTop - 10, label, {
      size: Math.min(13, Math.max(10, cellW * 0.18)),
      wdth: 105,
      ls: 1.6,
      anchor: "middle",
    });
    parts.push(!isExport ? `<a href="?season=${s}">${t}</a>` : t);
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
            ls: 0.8,
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
    txt(gridLeft + xOff - 12, avgY, "AVG", {
      size: 9,
      wdth: 105,
      ls: 1.2,
      anchor: "end",
      opacity: 0.6,
    }),
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

  if (!isExport) parts.push(`<g id="sig-cursor"></g>`);
  if (isExport) parts.push(exportFooter(W, H, m));
  parts.push("</svg>");

  // data island (page only): the server ships the layout, JS computes nothing
  let island: string | null = null;
  if (!isExport) {
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

// ---- export chrome -------------------------------------------------------

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

function exportHeader(show: ShowRow, season: number | null, W: number, m: number, frame: SignalFrame): string {
  const years = show.premiered
    ? `${show.premiered.slice(0, 4)}–${show.ended ? show.ended.slice(0, 4) : ""}`
    : null;
  const chyron = [
    "EPISODE RATINGS",
    show.network?.toUpperCase() ?? null,
    years,
    season != null ? `SEASON ${season}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const chyronFs = frame === "wide" ? 20 : frame === "story" ? 22 : 18;
  const chyronY = frame === "wide" ? 92 : frame === "story" ? 132 : 80;
  const nameMax = frame === "wide" ? 76 : frame === "story" ? 64 : 56;
  const nameY = frame === "wide" ? 176 : frame === "story" ? 214 : 150;
  const fit = fitName(show.name.toUpperCase(), nameMax, 40, W - m * 2);
  const out = [
    txt(m, chyronY, chyron, { size: chyronFs, wdth: 105, ls: chyronFs * 0.14 }),
    txt(m, nameY, fit.lines[0], { size: fit.size, wght: 800, wdth: 110, fill: TEXT, ls: fit.size * 0.01 }),
  ];
  if (fit.lines[1])
    out.push(txt(m, nameY + fit.size * 0.95, fit.lines[1], { size: fit.size, wght: 800, wdth: 110, fill: TEXT }));
  return out.join("");
}

function exportFooter(W: number, H: number, m: number): string {
  const hairY = H - 96;
  const baseY = H - 48;
  const wfs = W === 1920 ? 30 : 28;
  const cfs = W === 1920 ? 18 : 16;
  const cfs2 = Math.round(cfs * 0.6);
  const wordW = "TV NIGHTLY".length * wfs * 0.68;
  // the scale, as discrete chips — a legend is scale, not data (and never
  // a gradient bar)
  const chips = [6.0, 7.0, 8.0, 9.0, 9.5];
  const chipW = 52;
  const chipH = 24;
  const legendY = hairY - 38;
  const legend = [
    txt(m, legendY + chipH / 2 + 3.5, "SCALE", { size: 10, wdth: 105, ls: 1.4, opacity: 0.6 }),
    ...chips.map((v, i) => {
      const x = m + 64 + i * (chipW + 6);
      return (
        `<rect x="${x}" y="${legendY}" width="${chipW}" height="${chipH}" rx="5" fill="${rampColor(v)}"/>` +
        txt(x + chipW / 2, legendY + chipH / 2 + 4, v.toFixed(1), {
          size: 12,
          sys: true,
          wght: 700,
          fill: inkFor(v),
          anchor: "middle",
        })
      );
    }),
  ].join("");
  return [
    legend,
    `<line x1="${m}" y1="${hairY}" x2="${W - m}" y2="${hairY}" stroke="${LINE}" stroke-width="1"/>`,
    txt(m, baseY, "TV NIGHTLY", { size: wfs, wght: 800, wdth: 120, fill: TEXT, ls: wfs * 0.02 }),
    `<circle cx="${r2(m + wordW + 0.3 * wfs)}" cy="${r2(baseY - 0.08 * wfs)}" r="${r2(0.085 * wfs)}" fill="${AMBER}"/>`,
    txt(W - m, baseY - cfs2 - 6, "TVNIGHTLY.COM", { size: cfs, wdth: 105, ls: cfs * 0.14, anchor: "end" }),
    txt(W - m, baseY, "DATA · TVMAZE", { size: cfs2, wdth: 105, ls: cfs2 * 0.14, anchor: "end", opacity: 0.6 }),
  ].join("");
}
