// Inline hero trailer with a backdrop fallback when the embed cannot play.
import { FC } from "hono/jsx";

export type HeroTrailerBackdrop = { x1: string; x2?: string };

export const HeroTrailerEmbed: FC<{
  href: string;
  title: string;
  trailerKey: string;
  trailerName: string;
  fallbackBackdrop?: HeroTrailerBackdrop | null;
  videoClass?: string;
  frameClass?: string;
}> = ({
  href,
  title,
  trailerKey,
  trailerName,
  fallbackBackdrop,
  videoClass = "hub-hero-video",
  frameClass = "hub-hero-video-frame",
}) => {
  const trailerSrc =
    `https://www.youtube-nocookie.com/embed/${trailerKey}` +
    `?autoplay=1&mute=1&loop=1&playlist=${trailerKey}` +
    `&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;

  return (
    <div
      class={`${videoClass} hub-hero-video-trailer`}
      data-hero-trailer
      data-trailer-href={href}
    >
      {fallbackBackdrop ? (
        <a
          class="hub-hero-video-backdrop hub-hero-video-backdrop-layer"
          href={href}
          tabindex={-1}
          aria-hidden="true"
        >
          <img
            src={fallbackBackdrop.x1}
            {...(fallbackBackdrop.x2
              ? { srcset: `${fallbackBackdrop.x1} 1x, ${fallbackBackdrop.x2} 2x` }
              : {})}
            alt=""
            loading="eager"
            decoding="async"
          />
          <span class="sr-only">{title}</span>
        </a>
      ) : null}
      <iframe
        class={frameClass}
        src={trailerSrc}
        title={`${title} — ${trailerName}`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        loading="eager"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
      ></iframe>
    </div>
  );
};
