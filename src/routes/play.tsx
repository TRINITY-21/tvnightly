import { Hono } from "hono";
import { raw } from "hono/html";
import { Layout } from "../components/Layout";
import { byngeTargetFromPlay } from "../lib/bynge";
import { HonoEnv } from "../types";

const app = new Hono<HonoEnv>();

const clean = (s: string | undefined, max: number) =>
  (s ?? "").replace(/[<>"']/g, "").trim().slice(0, max);

// Branded handoff → Bynge player. Keeps the exit on-brand before the stream opens.
app.get("/play/:segment/:id", async (c) => {
  const segment = c.req.param("segment");
  if (segment !== "movie" && segment !== "show") return c.notFound();

  const id = c.req.param("id");
  const target = byngeTargetFromPlay(segment, id);
  if (!target) return c.notFound();

  const title = clean(c.req.query("t"), 120) || (segment === "movie" ? "This movie" : "This show");
  const poster = clean(c.req.query("p"), 400);
  const safeTarget = target.replace(/"/g, "&quot;");

  c.header("Cache-Control", "no-store");
  return c.html(
    <Layout title={`Watch ${title} | TV Nightly`} noindex bare>
      <div class="bynge-handoff" data-target={target}>
        <div class="bynge-handoff-bg" aria-hidden="true">
          {poster ? <img src={poster} alt="" /> : null}
        </div>
        <div class="bynge-handoff-card">
          <div class="bynge-handoff-poster">
            {poster ? (
              <img src={poster} alt="" width="120" height="180" />
            ) : (
              <span class="bynge-handoff-poster-fallback" aria-hidden="true">
                ▶
              </span>
            )}
          </div>
          <p class="bynge-handoff-kicker">TV Nightly × Bynge</p>
          <h1 class="bynge-handoff-title">{title}</h1>
          <p class="bynge-handoff-dek">Opening the player…</p>
          <div class="bynge-handoff-track" aria-hidden="true">
            <span class="bynge-handoff-bar-fill"></span>
          </div>
          <p class="bynge-handoff-fine">
            <a href={target}>Continue to Bynge</a> if you&apos;re not redirected.
          </p>
        </div>
      </div>
      {raw(`<link rel="prefetch" href="${safeTarget}" />`)}
      <script src="/js/bynge-handoff.js" defer></script>
    </Layout>,
  );
});

export default app;
