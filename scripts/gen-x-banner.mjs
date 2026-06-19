// TV Nightly X/Twitter header (1500×500). Brand lockup on the left over the dark
// plate; a tilted wall of REAL poster art fanning in from the right, fading into
// the plate. Posters pulled from /tmp/posters.txt (remote catalog). Bottom-left
// kept clear for the avatar X overlays there.
import { Resvg } from "@cf-wasm/resvg";
import { readFileSync, writeFileSync } from "node:fs";

const W = 1500, H = 500;
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

const urls = readFileSync("/tmp/posters.txt", "utf8").trim().split("\n").slice(0, 7);
const uris = [];
for (const u of urls) { try { uris.push(await dataUri(u)); } catch (e) { console.warn("skip", e.message); } }
console.log(`embedded ${uris.length} posters`);

// --- poster wall: tilted strip fanning off the right edge ---
const PW = 196, PH = 294, ANG = -7, STEP = 152, X0 = 612, PY = 103;
let wall = "";
uris.forEach((uri, i) => {
  const px = X0 + i * STEP, cx = px + PW / 2, cy = PY + PH / 2;
  wall +=
    `<g transform="rotate(${ANG} ${r2(cx)} ${r2(cy)})" filter="url(#pds)">` +
    `<clipPath id="pc${i}"><rect x="${px}" y="${PY}" width="${PW}" height="${PH}" rx="11"/></clipPath>` +
    `<image x="${px}" y="${PY}" width="${PW}" height="${PH}" href="${uri}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pc${i})"/>` +
    `<rect x="${px}" y="${PY}" width="${PW}" height="${PH}" rx="11" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>` +
    `</g>`;
});

// --- left lockup ---
const wordSize = 60, wordLS = 2.6, markH = 46, markW = (markH * 36) / 24;
const lx = 72, baseY = 168;
const capTop = baseY - 0.72 * wordSize;
const markY = capTop + (0.72 * wordSize - markH) / 2;
const wordX = lx + markW + 16;
// glyph-only width of "TV NIGHTLY" scaled from the measured 206px @29px (which
// included 9 gaps of 1.2 letter-spacing), then add THIS banner's letter-spacing
const wordW = (206 - 9 * 1.2) * (wordSize / 29) + 9 * wordLS;

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<defs>` +
  `<linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#18181d"/><stop offset="1" stop-color="${PLATE}"/></linearGradient>` +
  `<radialGradient id="glow" cx="0.28" cy="0.4" r="0.5"><stop offset="0" stop-color="${AMBER}" stop-opacity="0.10"/><stop offset="1" stop-color="${AMBER}" stop-opacity="0"/></radialGradient>` +
  `<linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${PLATE}" stop-opacity="1"/><stop offset="0.34" stop-color="${PLATE}" stop-opacity="0.97"/><stop offset="0.52" stop-color="${PLATE}" stop-opacity="0.55"/><stop offset="0.72" stop-color="${PLATE}" stop-opacity="0"/></linearGradient>` +
  `<filter id="pds" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#000" flood-opacity="0.55"/></filter>` +
  `</defs>` +
  `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
  wall +
  `<rect width="${W}" height="${H}" fill="url(#fade)"/>` +
  `<rect width="${W}" height="${H}" fill="url(#glow)"/>` +
  `<rect x="0" y="0" width="${W}" height="2" fill="${AMBER}" opacity="0.5"/>` +
  ogMark(lx, markY, markH) +
  txt(wordX, baseY, "TV NIGHTLY", { size: wordSize, w: "black", fill: TEXT, ls: wordLS }) +
  txt(lx, 238, "Tonight, decided.", { size: 33, w: "semi", fill: TEXT, ls: 0.2 }) +
  txt(lx + 1, 286, "Episode rankings · release dates · where to stream", { size: 21, w: "reg", fill: MUTED, ls: 0.3 }) +
  txt(lx + 1, 326, "tvnightly.com", { size: 20, w: "black", fill: AMBER, ls: 0.4 }) +
  `</svg>`;

const fonts = ["regular", "semibold", "bold", "black"].map((w) => new Uint8Array(readFileSync(`public/fonts/archivo-${w}.ttf`)));
const resvg = await Resvg.async(svg, { fitTo: { mode: "width", value: W }, font: { fontBuffers: fonts, defaultFontFamily: "Archivo" }, shapeRendering: 2, textRendering: 1 });
const png = resvg.render().asPng();
resvg.free();
writeFileSync("tvnightly-x-banner.png", png);
console.log(`wrote tvnightly-x-banner.png — ${W}x${H}, ${(png.length / 1024).toFixed(0)} KB`);
