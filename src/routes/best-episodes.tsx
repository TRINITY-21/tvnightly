import { Hono } from "hono";
import { IconStar } from "../components/icons";
import { Layout } from "../components/Layout";
import { ExploreCard } from "../components/cards";
import { epCode, epHref, largeStill, longDate, stripHtml } from "../lib/format";
import { canonical, origin } from "../lib/seo";
import { Bindings, EpisodeRow } from "../types";

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

  const anyStill = results.some((e) => e.image_url);
  const plates = 3;

  c.header("Cache-Control", "public, max-age=3600");
  return c.html(
    <Layout
      title="Best TV Episodes of All Time — Top 100 Ranked | TV Nightly"
      description={`The best TV episodes of all time, ranked by viewer rating across every tracked show${
        results[0] ? ` — led by ${results[0].show_name}'s "${results[0].name ?? epCode(results[0])}"` : ""
      }. At most three episodes per series.`}
      canonical={canonical(c)}
      ogImage={results[0]?.image_url ? largeStill(results[0].image_url) : undefined}
      ogImageLarge={!!results[0]?.image_url}
      ld={[
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: "The highest-rated TV episodes of all time",
          itemListElement: results.slice(0, 25).map((e, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${e.show_name}: ${e.name ?? epCode(e)} (${epCode(e)})`,
            // link to the specific episode, not the show's chart page
            url: `${origin(c)}${epHref(e.show_slug, e)}`,
          })),
        },
      ]}
    >
      <article class="chart-page">
        <header class="chart-head">
          <p class="section-eyebrow">The all-time 100</p>
          <h1 class="chart-h1">Best TV episodes of all time</h1>
          <p class="section-lead">
            The 100 highest-rated single episodes across television — ranked by viewer rating, weighted
            against one-vote flukes, with at most three entries per show.
          </p>
          {results.length ? (
            <p class="chart-statline">
              <span class="chart-statline-main">
                <strong>{results.length}</strong> episodes
              </span>
              <span class="chart-statline-links">
                <a class="chev-after" href="/tv/best/2010s">
                  Best of the 2010s
                </a>
                <a class="chev-after" href="/top/tv">
                  Top TV shows
                </a>
                <a class="chev-after" href="/compare">
                  Compare shows
                </a>
              </span>
            </p>
          ) : null}
        </header>

        {results.length === 0 ? (
          <p class="muted">Ratings are still loading — check back soon.</p>
        ) : (
          <>
            <ol class={anyStill ? "epreg chart-epreg" : "epreg epreg--textonly chart-epreg"}>
              {results.map((e, i) => (
                <li class={i < plates ? "epreg-plate" : undefined}>
                  <span class="epreg-num">{String(i + 1).padStart(2, "0")}</span>
                  {anyStill ? (
                    <a
                      class="epreg-still-link"
                      href={`/show/${e.show_slug}/best-episodes`}
                      tabindex={-1}
                      aria-hidden="true"
                    >
                      {e.image_url ? (
                        <img
                          class="epreg-still"
                          src={e.image_url}
                          // medium for 1x, the bounded large_landscape sibling for
                          // 2x — never TVmaze's unbounded original for a ≤256px slot.
                          srcset={`${e.image_url} 1x, ${largeStill(e.image_url)} 2x`}
                          width={i < plates ? 256 : 168}
                          height={i < plates ? 144 : 95}
                          alt={`${e.show_name} ${epCode(e)}`}
                          loading={i === 0 ? "eager" : "lazy"}
                          fetchpriority={i === 0 ? "high" : undefined}
                          decoding="async"
                        />
                      ) : (
                        <span class="epreg-still--empty">{epCode(e)}</span>
                      )}
                    </a>
                  ) : null}
                  <span class="epreg-main">
                    <p class="epreg-meta">
                      <a class="chart-show" href={`/show/${e.show_slug}`}>
                        {e.show_name}
                      </a>
                      <span class="sep"> · </span>
                      <span class="epreg-code">{epCode(e)}</span>
                      {e.airdate ? (
                        <>
                          <span class="sep"> · </span>
                          <span class="epreg-date">{longDate(e.airdate)}</span>
                        </>
                      ) : null}
                    </p>
                    <p class="epreg-line">
                      <a class="epreg-name" href={`/show/${e.show_slug}/best-episodes`}>
                        {e.name ?? epCode(e)}
                      </a>
                      <span class="epreg-leader"></span>
                      <span class="rating"><IconStar class="rating-star" />{e.rating!.toFixed(1)}</span>
                    </p>
                    {e.summary ? <p class="epreg-sum">{stripHtml(e.summary)}</p> : null}
                  </span>
                </li>
              ))}
            </ol>

            <section class="wo-doors">
              <h2>Keep exploring</h2>
              <div class="explore-grid">
                <ExploreCard
                  icon="Charts"
                  title="Best TV of the 2010s"
                  desc="The highest-rated series that premiered during peak-TV decade."
                  href="/tv/best/2010s"
                />
                <ExploreCard
                  icon="Premieres"
                  title="Upcoming TV"
                  desc="In-development series and dated premieres for the year ahead."
                  href="/upcoming"
                />
                <ExploreCard
                  icon="Shortcut"
                  title="Emmy Awards"
                  desc="Frontrunners by category with episode ratings and streaming links."
                  href={`/awards/emmys/${new Date().getFullYear()}`}
                />
              </div>
            </section>
          </>
        )}
      </article>
    </Layout>,
  );
});

// ---------------------------------------------------------------- show hub

export default app;
