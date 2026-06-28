// Inline hero trailer. Carries the full ordered list of trailer candidates so
// the client player (hero-trailer-fallback.js) can advance past any that won't
// play in the viewer's country, and only falls back to the title's backdrop
// once every candidate has been exhausted.
import { FC } from "hono/jsx";

export type HeroTrailerBackdrop = { x1: string; x2?: string };
export type HeroTrailerCandidate = { key: string; name: string };

export const HeroTrailerEmbed: FC<{
  href: string;
  title: string;
  /** Ordered, playable-first. The player tries each in turn; [0] is embedded. */
  candidates: HeroTrailerCandidate[];
  fallbackBackdrop?: HeroTrailerBackdrop | null;
  videoClass?: string;
  frameClass?: string;
}> = ({
  href,
  title,
  candidates,
  fallbackBackdrop,
  videoClass = "hub-hero-video",
  frameClass = "hub-hero-video-frame",
}) => {
  const first = candidates[0];
  if (!first) return null;
  // Only ever embed real 11-char YouTube ids (defense-in-depth) and hand the
  // client a clean key list to walk on error.
  const keys = candidates.map((v) => v.key).filter((k) => /^[\w-]{11}$/.test(k));
  const trailerSrc =
    `https://www.youtube-nocookie.com/embed/${first.key}` +
    `?autoplay=1&mute=1&loop=1&playlist=${first.key}` +
    `&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;

  return (
    <div
      class={`${videoClass} hub-hero-video-trailer`}
      data-hero-trailer
      data-trailer-href={href}
      data-trailer-candidates={JSON.stringify(keys)}
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
        title={`${title} — ${first.name}`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        loading="eager"
        referrerpolicy="strict-origin-when-cross-origin"
        allowfullscreen
      ></iframe>
    </div>
  );
};
