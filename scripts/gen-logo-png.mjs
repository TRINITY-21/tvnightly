// One-off: rasterize the TV Nightly standby mark to high-res PNGs for social
// avatars / uploads. Pure shapes (no fonts), so resvg renders it crisp at any
// size. Mirrors buildLogoSvg() in src/lib/social.ts.
import { Resvg } from "@cf-wasm/resvg";
import { writeFileSync } from "node:fs";

const PLATE = "#0e0e11";
const AMBER = "#FFA94D";
const r2 = (n) => Math.round(n * 100) / 100;

function ogMark(mx, my, h) {
  const s = h / 24;
  return (
    `<g transform="translate(${r2(mx)},${r2(my)}) scale(${r2(s)})">` +
    `<rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5"/>` +
    `<circle cx="26.5" cy="16.5" r="3.4" fill="${AMBER}" opacity="0.22"/>` +
    `<circle cx="26.5" cy="16.5" r="2.2" fill="${AMBER}"/>` +
    `</g>`
  );
}

function buildLogoSvg(size, maskable) {
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

async function png(svg, size, out) {
  const resvg = await Resvg.async(svg, { fitTo: { mode: "width", value: size } });
  const data = resvg.render().asPng();
  resvg.free();
  writeFileSync(out, data);
  console.log(`  wrote ${out}  —  ${size}x${size}, ${(data.length / 1024).toFixed(0)} KB`);
}

const SIZE = 4096;
console.log("rendering TV Nightly logo @ 4K…");
await png(buildLogoSvg(SIZE, true), SIZE, "tvnightly-avatar-4k.png"); // full-bleed → best for circle-crop avatars
await png(buildLogoSvg(SIZE, false), SIZE, "tvnightly-icon-4k.png"); // rounded squircle → app-icon look
console.log("done.");
