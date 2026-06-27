// Top chart pages: head lockup + #1 spotlight (poster + autoplay trailer).
import { FC, PropsWithChildren } from "hono/jsx";
import { PosterRating, tmdbRingScore } from "./detail-hero";
import { HeroTrailerEmbed } from "./hero-trailer";

export type ChartHeroFeatured = {
  href: string;
  name: string;
  poster: { src: string; srcset?: string } | null;
  trailer: { key: string; name: string } | null;
  /** Shown behind the trailer iframe while it loads, or when no trailer exists. */
  fallbackBackdrop: { x1: string; x2?: string } | null;
  /** Viewer rating on a 0–10 scale (TMDB-style). */
  rating: number | null;
};

/** Eyebrow, title, intro, and CTA row — full width above the chart grid. */
export const ChartHeroHead: FC<{
  eyebrow: string;
  title: string;
  intro: string;
  children?: PropsWithChildren["children"];
}> = ({ eyebrow, title, intro, children }) => (
  <header class="chart-hero-head">
    <div class="chart-hero-head-inner">
      <p class="section-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p class="chart-hero-intro">{intro}</p>
      {children ? <p class="hub-actions">{children}</p> : null}
    </div>
  </header>
);

/** #1 pick: poster + autoplay trailer — same stage as show detail, without credits sidebar. */
export const ChartSpotlight: FC<{ featured: ChartHeroFeatured }> = ({ featured }) => {
  const score = featured.rating != null ? tmdbRingScore(featured.rating) : null;

  return (
    <section class="chart-hero-spotlight" aria-label={`#1 — ${featured.name}`}>
      <div class="chart-hero-stage">
        <a class="chart-hero-poster" href={featured.href}>
          <span class="chart-hero-rank" aria-hidden="true">
            #1
          </span>
          {featured.poster ? (
            <img
              class="poster"
              src={featured.poster.src}
              {...(featured.poster.srcset ? { srcset: featured.poster.srcset } : {})}
              alt={`${featured.name} poster`}
              width="280"
              height="420"
              fetchpriority="high"
              decoding="async"
            />
          ) : (
            <span class="card-fallback chart-hero-poster-fallback">{featured.name}</span>
          )}
          {score != null ? <PosterRating score={score} label="Viewer rating" /> : null}
        </a>
        <div class="chart-hero-player hub-hero-player" data-hero-pip>
          {featured.trailer ? (
            <HeroTrailerEmbed
              href={featured.href}
              title={featured.name}
              trailerKey={featured.trailer.key}
              trailerName={featured.trailer.name}
              fallbackBackdrop={featured.fallbackBackdrop}
              videoClass="chart-hero-video hub-hero-video"
              frameClass="chart-hero-video-frame hub-hero-video-frame"
            />
          ) : featured.fallbackBackdrop ? (
            <a
              class="chart-hero-video hub-hero-video hub-hero-video-backdrop"
              href={featured.href}
            >
              <img
                src={featured.fallbackBackdrop.x1}
                {...(featured.fallbackBackdrop.x2
                  ? { srcset: `${featured.fallbackBackdrop.x1} 1x, ${featured.fallbackBackdrop.x2} 2x` }
                  : {})}
                alt=""
                loading="eager"
                decoding="async"
              />
              <span class="sr-only">{featured.name}</span>
            </a>
          ) : (
            <a class="chart-hero-video hub-hero-video chart-hero-video-empty hub-hero-video-empty" href={featured.href}>
              <span class="hub-hero-video-fallback">Watch {featured.name}</span>
            </a>
          )}
        </div>
      </div>
    </section>
  );
};

/** @deprecated Use ChartHeroHead + ChartSpotlight in a home-main-grid instead. */
export const ChartHero: FC<{
  eyebrow: string;
  title: string;
  intro: string;
  featured?: ChartHeroFeatured | null;
  children?: PropsWithChildren["children"];
}> = ({ eyebrow, title, intro, featured, children }) => (
  <>
    <ChartHeroHead eyebrow={eyebrow} title={title} intro={intro}>
      {children}
    </ChartHeroHead>
    {featured ? <ChartSpotlight featured={featured} /> : null}
  </>
);
