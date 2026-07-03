import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { IconPlay, IconStar, ChevLeft, ChevRight } from "../components/icons";
import { fetchTrailerShortsFeed } from "../lib/trailer-shorts-feed";
import { origin } from "../lib/seo";
import { HonoEnv } from "../types";

const app = new Hono<HonoEnv>();

app.get("/shorts", async (c) => {
  const items = await fetchTrailerShortsFeed(c);
  const site = origin(c);
  const startId = c.req.query("v")?.trim() ?? "";

  c.header("Cache-Control", "public, max-age=1800");

  return c.html(
    <Layout
      c={c}
      title="Shorts — trailer previews | TV Nightly"
      description="Swipe through the latest movie and TV trailers — full-screen vertical previews with ratings, synopses, and one-tap watch links."
      canonical={`${site}/shorts`}
      bare
      noSidebar
      scripts={["/js/trailer-shorts.js"]}
    >
      <div class="trailer-shorts" data-trailer-shorts data-start={startId || undefined}>
        <header class="ts-top">
          <a class="ts-back" href="/" aria-label="Back to home">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </a>
          <div class="ts-top-titles">
            <p class="ts-top-kicker">TV Nightly</p>
            <h1 class="ts-top-title">Shorts</h1>
          </div>
        </header>

        {items.length ? (
          <>
            {items.length > 1 ? (
              <div class="ts-nav" aria-label="Browse shorts">
                <button type="button" class="ts-nav-btn" data-ts-prev aria-label="Previous short" disabled>
                  <ChevLeft size={24} />
                </button>
                <button type="button" class="ts-nav-btn" data-ts-next aria-label="Next short">
                  <ChevRight size={24} />
                </button>
              </div>
            ) : null}
            <div class="ts-feed" role="feed" aria-label="Trailer shorts">
            {items.map((item, i) => {
              const shareUrl = `${site}/shorts?v=${encodeURIComponent(item.id)}`;
              const shareTitle = `${item.title}${item.year ? ` (${item.year})` : ""} — trailer on TV Nightly`;
              const titleLine =
                item.year != null ? `${item.title} (${item.year})` : item.title;
              return (
                <article
                  class="ts-slide"
                  role="article"
                  data-ts-slide
                  data-ts-id={item.id}
                  data-ts-index={String(i)}
                  data-ts-candidates={JSON.stringify(item.trailerKeys)}
                  data-share-url={shareUrl}
                  data-share-title={shareTitle}
                  tabindex={-1}
                >
                  <div class="ts-card">
                    <div class="ts-video-wrap">
                      <div class="ts-video-poster" aria-hidden="true">
                        {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" /> : null}
                      </div>
                      <iframe
                        class="ts-video"
                        title={`${item.title} — ${item.trailerName}`}
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                        referrerpolicy="strict-origin-when-cross-origin"
                        allowfullscreen
                      ></iframe>
                      <button type="button" class="ts-tap" aria-label="Play or pause trailer" data-ts-tap></button>
                    </div>

                    <div class="ts-rail" aria-label="Trailer actions">
                        <button type="button" class="ts-rail-btn" data-ts-mute aria-pressed="true">
                          <span class="ts-rail-icon ts-icon-mute" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M11 5L6 9H3v6h3l5 4V5z" />
                              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                              <path d="M17.8 6.2a8.5 8.5 0 0 1 0 11.6" />
                            </svg>
                          </span>
                          <span class="ts-rail-icon ts-icon-unmute" hidden aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M11 5L6 9H3v6h3l5 4V5z" />
                              <line x1="23" y1="9" x2="17" y2="15" />
                              <line x1="17" y1="9" x2="23" y2="15" />
                            </svg>
                          </span>
                          <span class="ts-rail-label" data-ts-mute-label>Unmute</span>
                        </button>
                        <a class="ts-rail-btn ts-rail-poster" href={item.detailHref} title={item.title}>
                          {item.poster ? (
                            <img src={item.poster} alt="" width="44" height="44" loading="lazy" decoding="async" />
                          ) : (
                            <span class="ts-rail-glyph" aria-hidden="true">
                              {item.kind === "movie" ? "🎬" : "📺"}
                            </span>
                          )}
                        </a>
                        <button type="button" class="ts-rail-btn" data-ts-share>
                          <span class="ts-rail-icon" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <path d="M12 3.5v11" />
                              <path d="M8.4 7 12 3.4 15.6 7" />
                              <path d="M6 11H5.2A1.7 1.7 0 0 0 3.5 12.7v6.1A1.7 1.7 0 0 0 5.2 20.5h13.6a1.7 1.7 0 0 0 1.7-1.7v-6.1A1.7 1.7 0 0 0 18.8 11H18" />
                            </svg>
                          </span>
                          <span class="ts-rail-label">Share</span>
                        </button>
                        <a class="ts-rail-btn" href={item.detailHref}>
                          <span class="ts-rail-icon" aria-hidden="true">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                              <circle cx="12" cy="12" r="9" />
                              <path d="M12 10v6" />
                              <path d="M12 7h.01" />
                            </svg>
                          </span>
                      <span class="ts-rail-label">Info</span>
                    </a>
                    </div>

                    <div class="ts-meta">
                      <span class="ts-tag">{item.genreLabel}</span>
                      <h2 class="ts-heading">
                        <a href={item.detailHref}>{titleLine}</a>
                      </h2>
                      {item.rating != null ? (
                        <p class="ts-rating">
                          <IconStar class="ts-star" />
                          <span>{item.rating.toFixed(1)}</span>
                        </p>
                      ) : null}
                      {item.overview ? <p class="ts-dek">{item.overview}</p> : null}
                      <div class="ts-cta-row">
                        {item.watchHref ? (
                          <a class="ts-watch" href={item.watchHref}>
                            <IconPlay size={16} />
                            Watch now
                          </a>
                        ) : (
                          <a class="ts-watch ts-watch-alt" href={item.detailHref}>
                            <IconPlay size={16} />
                            View title
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
            </div>
          </>
        ) : (
          <div class="ts-empty">
            <p>No trailers are available right now. Check back soon.</p>
            <a href="/">Back to home</a>
          </div>
        )}
      </div>
    </Layout>,
  );
});

export default app;
