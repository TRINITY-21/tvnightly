#!/usr/bin/env node
// Concatenates src/styles/*.css (numeric filename order) into
// public/styles.css — the single served stylesheet (one request, no
// framework). Minifies with esbuild when available. Edit the partials,
// never the output.
//   node scripts/build-css.mjs           build once
//   node scripts/build-css.mjs --watch   rebuild on change (dev)
import { readdirSync, readFileSync, writeFileSync, watch } from "node:fs";

const SRC = "src/styles";
const OUT = "public/styles.css";
const BANNER = `/* GENERATED from ${SRC}/*.css — edit the partials, not this file. Rebuild: npm run css */\n`;

// esbuild ships transitively with wrangler; use it to minify the served sheet
// (a proper CSS parser, so gradients/calc/content strings survive). It's not a
// declared dependency, so if it ever disappears we fall back to plain
// concatenation and the build still succeeds — just larger.
let minify = null;
try {
  const esbuild = await import("esbuild");
  minify = async (css) => (await esbuild.transform(css, { loader: "css", minify: true })).code;
} catch {
  console.warn("[css] esbuild not found — writing unminified");
}

async function build() {
  const parts = readdirSync(SRC).filter((f) => f.endsWith(".css")).sort();
  const raw = parts.map((f) => readFileSync(`${SRC}/${f}`, "utf8")).join("");
  let css = raw;
  if (minify) {
    try {
      css = await minify(raw);
    } catch (e) {
      console.warn(`[css] minify failed (${e.message}) — writing unminified`);
      css = raw;
    }
  }
  writeFileSync(OUT, BANNER + css);
  console.log(
    `${OUT} <- ${parts.length} partials (${raw.length} -> ${css.length} bytes${minify ? ", minified" : ""})`,
  );
}

await build();
if (process.argv.includes("--watch")) {
  let timer;
  watch(SRC, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 60); // editors fire several events per save
  });
  console.log(`watching ${SRC}/ …`);
}
