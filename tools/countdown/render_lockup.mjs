// Render the TV Nightly brand lockup (standby mark + "TV NIGHTLY" + amber dot)
// to a transparent high-res PNG, mirroring ogBrand() in src/lib/social.ts.
import { Resvg } from "@cf-wasm/resvg";
import { readFileSync, writeFileSync } from "node:fs";

const AMBER = "#FFA94D", TEXT = "#f8f6f2";
const r2 = (n) => Math.round(n * 100) / 100;
function ogMark(mx, my, h) {
  const s = h / 24;
  return `<g transform="translate(${r2(mx)},${r2(my)}) scale(${r2(s)})">` +
    `<rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5"/>` +
    `<circle cx="26.5" cy="16.5" r="3.4" fill="${AMBER}" opacity="0.22"/>` +
    `<circle cx="26.5" cy="16.5" r="2.2" fill="${AMBER}"/></g>`;
}
const W = 304, H = 42, baseY = 30, markH = 30, mx = 2, markW = (markH * 36) / 24, wordX = mx + markW + 15;
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  ogMark(mx, baseY - 25, markH) +
  `<text x="${r2(wordX)}" y="${baseY}" font-size="29" font-family="Archivo Black" fill="${TEXT}" letter-spacing="1.2" style="font-variant-numeric:tabular-nums">TV NIGHTLY</text>` +
  `<circle cx="${r2(wordX + 218)}" cy="${r2(baseY - 8)}" r="6" fill="${AMBER}"/>` +
  `</svg>`;
const fonts = ["archivo-regular.ttf", "archivo-semibold.ttf", "archivo-bold.ttf", "archivo-black.ttf"]
  .map((f) => new Uint8Array(readFileSync(`public/fonts/${f}`)));
const resvg = await Resvg.async(svg, {
  fitTo: { mode: "width", value: 912 },               // 3× for crispness
  font: { fontBuffers: fonts, defaultFontFamily: "Archivo Black", loadSystemFonts: false },
});
const png = resvg.render().asPng();
resvg.free();
writeFileSync("tools/countdown/logo_lockup.png", png);
console.log("wrote tools/countdown/logo_lockup.png", png.length, "bytes");
