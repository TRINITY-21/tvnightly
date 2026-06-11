#!/usr/bin/env node
// Concatenates src/styles/*.css (numeric filename order) into
// public/styles.css — the single served stylesheet (one request, no
// framework, no build dependency). Edit the partials, never the output.
//   node scripts/build-css.mjs           build once
//   node scripts/build-css.mjs --watch   rebuild on change (dev)
import { readdirSync, readFileSync, writeFileSync, watch } from "node:fs";

const SRC = "src/styles";
const OUT = "public/styles.css";
const BANNER = `/* GENERATED from ${SRC}/*.css — edit the partials, not this file.
   Rebuild: npm run css */
`;

function build() {
  const parts = readdirSync(SRC).filter((f) => f.endsWith(".css")).sort();
  const css = parts.map((f) => readFileSync(`${SRC}/${f}`, "utf8")).join("");
  writeFileSync(OUT, BANNER + css);
  console.log(`${OUT} <- ${parts.length} partials (${css.length} bytes)`);
}

build();
if (process.argv.includes("--watch")) {
  let timer;
  watch(SRC, () => {
    clearTimeout(timer);
    timer = setTimeout(build, 60); // editors fire several events per save
  });
  console.log(`watching ${SRC}/ …`);
}
