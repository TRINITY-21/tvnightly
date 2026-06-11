import { Hono } from "hono";
import { raw } from "hono/html";
import { Bindings, EpisodeRow } from "../types";
import { stripHtml, epCode } from "../lib/format";
import { origin, canonical } from "../lib/seo";
import { Layout } from "../components/Layout";

const app = new Hono<{ Bindings: Bindings }>();

// ------------------------------------------- all-time best episodes (global)

app.get("/best-episodes", async (c) => {
  // TVmaze exposes no episode vote counts, so raw averages include one-voter
  // 10.0s. Shrink each episode toward its show's overall rating (Bayesian-ish
  // prior) and cap each show at 3 entries to keep the list honest and varied.
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM (
       SELECT e.*, s.name AS show_name, s.slug AS show_slug, s.image_url AS show_img,
              (e.rating + 2.0 * s.rating) / 3.0 AS score,
              ROW_NUMBER() OVER (PARTITION BY e.show_id ORDER BY e.rating DESC) AS rn
       FROM episodes e JOIN shows s ON s.id = e.show_id
       WHERE e.rating IS NOT NULL AND s.rating IS NOT NULL AND s.weight >= 75
     ) WHERE rn <= 3 ORDER BY score DESC, id LIMIT 100`,
  ).all<EpisodeRow & { show_name: string; show_slug: string; show_img: string | null }>();

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="The 100 highest-rated TV episodes of all time | TV Nightly"
      description={`The best single episodes of television ever made, ranked by viewer rating${
        results[0] ? `, starting with ${results[0].show_name}'s "${results[0].name}"` : ""
      }.`}
      canonical={canonical(c)}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "The highest-rated TV episodes of all time",
          itemListElement: results.slice(0, 25).map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${e.show_name}: ${e.name ?? epCode(e)} (${epCode(e)})`,
            url: `${origin(c)}/show/${e.show_slug}/best-episodes`,
          })),
        },
      ]}
    >
      <header class="chart-head">
        <p class="chart-kicker">The All-Time 100</p>
        <h1>The highest-rated TV episodes of all time</h1>
        <p class="chart-intro">
          Ranked by viewer rating, weighted against each show's overall score so tiny-sample
          outliers don't game the list. Maximum three entries per show.
        </p>
        {results.length ? (
          <p class="chart-statline">
            <span>
              <strong>{results.length}</strong> episodes
            </span>
            <span class="sep">·</span>
            <span>
              from <strong>{new Set(results.map((e) => e.show_slug)).size}</strong> shows
            </span>
            <span class="sep">·</span>
            <span>
              top score <strong>{results[0].rating!.toFixed(1)}</strong>
            </span>
            <span class="sep">·</span>
            <span>max 3 per show</span>
          </p>
        ) : null}
      </header>
      {results.length === 0 ? (
        <p class="muted">Ratings are still loading — check back soon.</p>
      ) : (
        (() => {
          // TVmaze stills are stored at medium_landscape (250px). The lone #1
          // earns the full-res original; the runners-up take the 400px variant;
          // the ledger thumbs keep the small stored size. (Verified live: only
          // original_untouched / large_landscape resolve — /original/ 404s.)
          const heroSrc = (url: string | null) =>
            url ? url.replace("/medium_landscape/", "/original_untouched/") : null;
          const midSrc = (url: string | null) =>
            url ? url.replace("/medium_landscape/", "/large_landscape/") : null;
          const year = (e: EpisodeRow) => (e.airdate ? e.airdate.slice(0, 4) : null);
          const initials = (name: string) =>
            name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0] ?? "")
              .join("")
              .toUpperCase();

          const hero = results[0];
          const podium = results.slice(1, 3);
          const rest = results.slice(3);

          return (
            <>
              {/* #1 — the lone cinematic moment */}
              <a class="chart-hero" href={`/show/${hero.show_slug}/best-episodes`}>
                {hero.image_url ? (
                  <img
                    class="chart-still"
                    src={heroSrc(hero.image_url)!}
                    alt={`${hero.show_name}: ${hero.name ?? epCode(hero)}`}
                    width="960"
                    height="540"
                    fetchpriority="high"
                    decoding="async"
                  />
                ) : null}
                <span class="card-rating chart-rating">★ {hero.rating!.toFixed(1)}</span>
                <div class="chart-hero__bill">
                  {hero.show_img ? (
                    <img
                      class="chart-hero__poster"
                      src={hero.show_img}
                      alt=""
                      width="116"
                      height="174"
                      loading="lazy"
                    />
                  ) : null}
                  <span class="chart-hero__rank">1</span>
                  <div class="chart-hero__text">
                    <span class="chart-hero__show">{hero.show_name}</span>
                    <h2 class="chart-hero__title">{hero.name ?? epCode(hero)}</h2>
                    <p class="chart-hero__meta">
                      <span>{epCode(hero)}</span>
                      {year(hero) ? (
                        <>
                          <span class="sep">·</span>
                          <span>{year(hero)}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>
              </a>

              {/* the runners-up — ranks 2 & 3 */}
              {podium.length ? (
                <div class="chart-podium">
                  {podium.map((e, i) => (
                    <a class="chart-podium-card" href={`/show/${e.show_slug}/best-episodes`}>
                      {e.image_url ? (
                        <img
                          class="chart-still"
                          src={midSrc(e.image_url)!}
                          alt={`${e.show_name}: ${e.name ?? epCode(e)}`}
                          width="460"
                          height="259"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : null}
                      <span class="card-rating chart-rating">★ {e.rating!.toFixed(1)}</span>
                      <div class="chart-podium__bill">
                        <span class="chart-podium__rank">{i + 2}</span>
                        <div class="chart-podium__text">
                          <span class="chart-podium__show">{e.show_name}</span>
                          <h2 class="chart-podium__title">{e.name ?? epCode(e)}</h2>
                          <p class="chart-podium__meta">
                            <span>{epCode(e)}</span>
                            {year(e) ? (
                              <>
                                <span class="sep">·</span>
                                <span>{year(e)}</span>
                              </>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              ) : null}

              {/* the ledger — ranks 4..100 */}
              {rest.length ? (
                <ol class="chart-list" start={4}>
                  {rest.map((e, i) => (
                    <li>
                      <a class="chart-row" href={`/show/${e.show_slug}/best-episodes`}>
                        <span class="chart-row__rank">{i + 4}</span>
                        <span class="chart-row__thumb">
                          {e.image_url ? (
                            <img src={e.image_url} alt="" width="116" height="65" loading="lazy" />
                          ) : (
                            <span class="chart-row__thumb--empty" aria-hidden="true">
                              {initials(e.show_name)}
                            </span>
                          )}
                        </span>
                        <div class="chart-row__body">
                          <p class="chart-row__head">
                            <span class="chart-row__show">{e.show_name}</span>
                            <span class="muted">: </span>
                            <span class="chart-row__title">{e.name ?? epCode(e)}</span>
                          </p>
                          <p class="chart-row__meta">
                            <span>{epCode(e)}</span>
                            <span class="sep">·</span>
                            <span class="rating">★ {e.rating!.toFixed(1)}</span>
                            {year(e) ? (
                              <>
                                <span class="sep">·</span>
                                <span>{year(e)}</span>
                              </>
                            ) : null}
                          </p>
                          {e.summary ? (
                            <p class="chart-row__summary">{stripHtml(e.summary)}</p>
                          ) : null}
                        </div>
                      </a>
                    </li>
                  ))}
                </ol>
              ) : null}
            </>
          );
        })()
      )}
    </Layout>,
  );
});

// ---------------------------------------------------------------- show hub

export default app;
