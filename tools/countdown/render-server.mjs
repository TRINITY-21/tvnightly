// =============================================================================
// TV Nightly — local render helper for /admin/shorts.
//
// Cloudflare Workers can't run ffmpeg/DepthFlow, so this tiny localhost-only
// daemon does. The Export button in /admin/shorts POSTs the generated render
// script here; we run it and stream back the finished MP4 (also saving a named
// copy to ./exports). Start once (`npm run render`, or it's launched by
// `npm run dev`) and leave it running — then Export just works, no terminal.
//
// No dependencies. Binds 127.0.0.1 only.
// =============================================================================
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url)); // tools/countdown
const PORT = Number(process.env.SHORTS_RENDER_PORT || 7788);
let busy = false;

const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Expose-Headers", "x-saved-path");
};

const server = createServer((req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  if (req.method === "GET" && req.url === "/health") {
    return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, busy }));
  }
  if (req.method !== "POST" || req.url !== "/render") return res.writeHead(404).end("not found");
  if (busy) return res.writeHead(409, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: "A render is already running — wait for it to finish." }));

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let data;
    try { data = JSON.parse(body); } catch { return res.writeHead(400).end("bad json"); }
    if (!data.script) return res.writeHead(400).end("no script");
    const safe = String(data.filename || "render_short.sh").replace(/[^a-zA-Z0-9._-]/g, "_");
    const mp4Name = safe.replace(/\.sh$/, "") + ".mp4";

    const scriptPath = join(DIR, "render_short.sh");
    writeFileSync(scriptPath, data.script, { mode: 0o755 });

    busy = true;
    const t0 = Date.now();
    console.log(`\n▶ render: ${mp4Name}`);
    const proc = spawn("bash", [scriptPath], { cwd: DIR });
    let log = "";
    const tap = (d) => { log += d; process.stdout.write(d); };
    proc.stdout.on("data", tap);
    proc.stderr.on("data", tap);
    proc.on("close", (code) => {
      busy = false;
      const out = join(DIR, "out", "countdown_depth.mp4");
      if (code !== 0 || !existsSync(out)) {
        console.log(`✗ render failed (exit ${code})`);
        return res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, code, log: log.slice(-3000) }));
      }
      mkdirSync(join(DIR, "exports"), { recursive: true });
      const saved = join(DIR, "exports", mp4Name);
      const buf = readFileSync(out);
      writeFileSync(saved, buf);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`✓ ${mp4Name} (${(buf.length / 1e6).toFixed(1)} MB, ${secs}s) → ${saved}`);
      res.writeHead(200, { "content-type": "video/mp4", "x-saved-path": saved });
      res.end(buf);
    });
  });
});

// renders take minutes — never time the socket out.
server.timeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, "127.0.0.1", () =>
  console.log(`TV Nightly render helper → http://localhost:${PORT}\nLeave this running; click Export in /admin/shorts and the video renders + saves to tools/countdown/exports/.`),
);
