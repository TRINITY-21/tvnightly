// `npm run dev:all` — wrangler dev + the /admin/shorts render helper, together.
// Lets the Export button render videos with zero extra terminal steps. The helper
// is best-effort: if it can't start, wrangler dev still runs.
import { spawn } from "node:child_process";

const procs = [];
const launch = (label, cmd, args) => {
  const p = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  procs.push(p);
  p.on("error", (e) => console.error(`[${label}] ${e.message}`));
  return p;
};

launch("render", "node", ["tools/countdown/render-server.mjs"]);
const wrangler = launch("wrangler", "npx", ["wrangler", "dev"]);

const stop = () => procs.forEach((p) => { try { p.kill("SIGINT"); } catch {} });
process.on("SIGINT", () => { stop(); process.exit(0); });
process.on("SIGTERM", () => { stop(); process.exit(0); });
wrangler.on("exit", (code) => { stop(); process.exit(code ?? 0); });
