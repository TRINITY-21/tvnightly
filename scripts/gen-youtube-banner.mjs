// TV Nightly YouTube channel banner (2560×1440). Brand lockup centered inside
// YouTube's "safe area" (1546×423, visible on every device), over a full-width
// wall of real poster art that fans across the frame and is vignetted dark in
// the middle so the wordmark + tagline always read. Posters: /tmp/yt-posters.txt.
import { Resvg } from "@cf-wasm/resvg";
import { readFileSync, writeFileSync } from "node:fs";

const W = 2560, H = 1440, CX = W / 2, CY = H / 2;
const PLATE = "#0e0e11", AMBER = "#FFA94D", TEXT = "#f8f6f2", MUTED = "#b6b1a9";
const FAM = { reg: "Archivo", semi: "Archivo SemiBold", bold: "Archivo Bold", black: "Archivo Black" };
const r2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const txt = (x, y, s, { size, w = "bold", fill = MUTED, anchor, ls }) =>
  `<text x="${r2(x)}" y="${r2(y)}" font-size="${r2(size)}" font-family="${FAM[w]}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ""}${ls ? ` letter-spacing="${r2(ls)}"` : ""}>${esc(s)}</text>`;
const ogMark = (mx, my, h) => {
  const s = h / 24;
  return `<g transform="translate(${r2(mx)},${r2(my)}) scale(${r2(s)})"><rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5"/><circle cx="26.5" cy="16.5" r="3.4" fill="${AMBER}" opacity="0.22"/><circle cx="26.5" cy="16.5" r="2.2" fill="${AMBER}"/></g>`;
};

async function dataUri(url) {
  const res = await fetch(url.replace("/w342/", "/w500/"));
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  return `data:${res.headers.get("content-type") || "image/jpeg"};base64,${b64}`;
}

const urls = readFileSync("/tmp/yt-posters.txt", "utf8").trim().split("\n").filter(Boolean);
const uris = [];
for (const u of urls) { try { uris.push(await dataUri(u)); } catch (e) { console.warn("skip", e.message); } }
console.log(`embedded ${uris.length} posters`);

// --- poster wall: full-width tilted strip across the middle band ---
const PW = 286, PH = 520, ANG = -7, STEP = 244, X0 = -360, PY = 430;
let wall = "";
uris.forEach((uri, i) => {
  const px = X0 + i * STEP, cx = px + PW / 2, cy = PY + PH / 2;
  wall +=
    `<g transform="rotate(${ANG} ${r2(cx)} ${r2(cy)})" filter="url(#pds)">` +
    `<clipPath id="pc${i}"><rect x="${px}" y="${PY}" width="${PW}" height="${PH}" rx="16"/></clipPath>` +
    `<image x="${px}" y="${PY}" width="${PW}" height="${PH}" href="${uri}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pc${i})"/>` +
    `<rect x="${px}" y="${PY}" width="${PW}" height="${PH}" rx="16" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>` +
    `</g>`;
});

// --- centered brand lockup (mark + wordmark as one unit) ---
const wordSize = 100, wordLS = 3.4, markH = 76, markW = (markH * 36) / 24, gap = 28;
// glyph-only width of "TV NIGHTLY" scaled from the measured 206px @29px (which
// included 9 gaps of 1.2 letter-spacing), then add THIS banner's letter-spacing
const wordW = (206 - 9 * 1.2) * (wordSize / 29) + 9 * wordLS;
const totalW = markW + gap + wordW;
const lx = CX - totalW / 2;
const baseY = 668;
const capTop = baseY - 0.72 * wordSize;
const markY = capTop + (0.72 * wordSize - markH) / 2;
const wordX = lx + markW + gap;

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<defs>` +
  `<linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#18181d"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
  `<radialGradient id="glow" cx="0.5" cy="0.16" r="0.55"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.12"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>` +
  // center vignette: clears the safe area for text, lets posters show at the edges
  `<radialGradient id="vig" cx="0.5" cy="0.5" r="0.62"><stop offset="0" stop-color="${PLATE}" stop-opacity="0.97"/><stop offset="0.4" stop-color="${PLATE}" stop-opacity="0.93"/><stop offset="0.72" stop-color="${PLATE}" stop-opacity="0.45"/><stop offset="1" stop-color="${PLATE}" stop-opacity="0"/></radialGradient>` +
  `<filter id="pds" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="22" flood-color="#000" flood-opacity="0.55"/></filter>` +
  `</defs>` +
  `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
  wall +
  `<rect width="${W}" height="${H}" fill="${PLATE}" opacity="0.22"/>` +
  `<rect width="${W}" height="${H}" fill="url(#vig)"/>` +
  `<rect width="${W}" height="${H}" fill="url(#glow)"/>` +
  `<rect x="0" y="0" width="${W}" height="3" fill="${AMBER}" opacity="0.5"/>` +
  ogMark(lx, markY, markH) +
  txt(wordX, baseY, "TV NIGHTLY", { size: wordSize, w: "black", fill: TEXT, ls: wordLS }) +
  txt(CX, 758, "Tonight, decided.", { size: 50, w: "semi", fill: TEXT, anchor: "middle", ls: 0.2 }) +
  txt(CX, 818, "Episode rankings · release dates · where to stream", { size: 29, w: "reg", fill: MUTED, anchor: "middle", ls: 0.4 }) +
  txt(CX, 874, "tvnightly.com", { size: 28, w: "black", fill: AMBER, anchor: "middle", ls: 0.6 }) +
  `</svg>`;

const fonts = ["regular", "semibold", "bold", "black"].map((w) => new Uint8Array(readFileSync(`public/fonts/archivo-${w}.ttf`)));
const resvg = await Resvg.async(svg, { fitTo: { mode: "width", value: W }, font: { fontBuffers: fonts, defaultFontFamily: "Archivo" }, shapeRendering: 2, textRendering: 1 });
const png = resvg.render().asPng();
resvg.free();
writeFileSync("tvnightly-youtube-banner.png", png);
console.log(`wrote tvnightly-youtube-banner.png — ${W}x${H}, ${(png.length / 1024).toFixed(0)} KB`);
