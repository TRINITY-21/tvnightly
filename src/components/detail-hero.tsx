// Trakt-style detail hero — title, chips, poster / trailer / credits stage,
// highlights, facts, social actions, and plot.
import { FC, PropsWithChildren } from "hono/jsx";
import { watchUrl } from "../lib/affiliate";
import { networkChartBasePath, type ChartKind } from "../lib/chart-filters";
import { PROVIDER_LOGOS, providerBrand, providerNetworkSlug } from "../lib/providers";
import { RateInline } from "./forms";
import { IconPlayDisc } from "./icons";
import { ShareBar } from "./share";
import { HeroTrailerEmbed } from "./hero-trailer";

type CreditPerson = { name: string; href?: string | null };
type HeroVideo = { key: string; name: string; type: string };

export const PosterRating: FC<{ score: number; label: string }> = ({ score, label }) => {
  const pct = Math.min(100, Math.max(0, Math.round(score)));
  const tier = pct >= 75 ? "high" : pct >= 50 ? "mid" : "low";
  return (
    <span class={`hub-poster-rating hub-poster-rating-${tier}`} title={`${label}: ${pct}%`}>
      <span class="hub-poster-rating-ribbon" aria-hidden="true">
        <span class="hub-poster-rating-val">{pct}%</span>
      </span>
      <span class="sr-only">{label}: {pct}%</span>
    </span>
  );
};

const CreditBlock: FC<{ title: string; people: CreditPerson[] }> = ({ title, people }) =>
  people.length ? (
    <div class="hub-credit-block">
      <h3>{title}</h3>
      <p>
        {people.map((p, i) => (
          <>
            {i > 0 ? ", " : ""}
            {p.href ? <a href={p.href}>{p.name}</a> : p.name}
          </>
        ))}
      </p>
    </div>
  ) : null;

export const DetailHero: FC<{
  kind: "tv" | "movie";
  title: string;
  yearLabel?: string | null;
  shareTitle: string;
  shareUrl: string;
  typeLabel: string;
  typeHref: string;
  network?: string | null;
  networkHref?: string | null;
  tmdbScore?: number | null;
  communityScore?: number | null;
  poster: PropsWithChildren["children"];
  trailer: HeroVideo | null;
  /** Full ordered candidate list for the autoplayer to fall through; main = [0].
   *  Defaults to just `trailer` when omitted. */
  trailerCandidates?: HeroVideo[];
  highlights: HeroVideo[];
  starring: CreditPerson[];
  directors: CreditPerson[];
  writers: CreditPerson[];
  watchProvider?: { name: string; logo?: string; href?: string | null; chartHref?: string | null } | null;
  metaBadge?: string | null;
  genres: { name: string; href: string }[];
  metaExtra?: string | null;
  metaExtraHref?: string | null;
  plot?: string | null;
  blurb?: string | null;
  rateKind: "tv" | "movie";
  rateRef: string;
  rateStat: string | null;
  mediaHref: string;
  fallbackBackdrop?: { x1: string; x2?: string } | null;
  introExtra?: PropsWithChildren["children"];
  ariaLabel?: string;
}> = ({
  kind,
  title,
  yearLabel,
  shareTitle,
  shareUrl,
  typeLabel,
  typeHref,
  network,
  networkHref,
  tmdbScore,
  communityScore,
  poster,
  trailer,
  trailerCandidates,
  highlights,
  starring,
  directors,
  writers,
  watchProvider,
  metaBadge,
  genres,
  metaExtra,
  metaExtraHref,
  plot,
  blurb,
  rateKind,
  rateRef,
  rateStat,
  mediaHref,
  fallbackBackdrop,
  introExtra,
  ariaLabel,
}) => {
  const posterScore = tmdbScore ?? communityScore ?? null;
  const posterScoreLabel = tmdbScore != null ? "Review score" : "Audience score";

  return (
    <header class="hub-hero" aria-label={ariaLabel ?? `${title} overview`}>
      <div class="hub-hero-inner">
        <div class="hub-hero-head">
          <h1 class="hub-hero-title">
            {title}
            {yearLabel ? <span class="hub-hero-years">{yearLabel}</span> : null}
          </h1>
        </div>

        <div class="hub-hero-intro">
          <div class="hub-hero-chips">
            <a class="hub-hero-type" href={typeHref}>
              {typeLabel}
            </a>
            {metaBadge ? <span class="hub-hero-badge">{metaBadge}</span> : null}
            {watchProvider?.logo ? (
              watchProvider.chartHref ? (
                <a
                  class="hub-hero-chip hub-hero-chip-logo"
                  href={watchProvider.chartHref}
                  title={`Top ${watchProvider.name} ${kind === "movie" ? "movies" : "shows"}`}
                >
                  <img src={watchProvider.logo} alt="" width="18" height="18" loading="lazy" />
                  {watchProvider.name}
                </a>
              ) : (
                <span class="hub-hero-chip hub-hero-chip-logo">
                  <img src={watchProvider.logo} alt="" width="18" height="18" loading="lazy" />
                  {watchProvider.name}
                </span>
              )
            ) : network ? (
              networkHref ? (
                <a class="hub-hero-chip" href={networkHref}>
                  {network}
                </a>
              ) : (
                <span class="hub-hero-chip">{network}</span>
              )
            ) : null}
            {genres.length ? (
              <span class="hub-hero-fact hub-hero-genres">
                {genres.map((g, i) => (
                  <>
                    {i > 0 ? ", " : ""}
                    <a href={g.href}>{g.name}</a>
                  </>
                ))}
              </span>
            ) : null}
            {metaExtra ? (
              <span class="hub-hero-fact">
                {metaExtraHref ? <a href={metaExtraHref}>{metaExtra}</a> : metaExtra}
              </span>
            ) : null}
          </div>
          {introExtra ? <div class="hub-hero-extra">{introExtra}</div> : null}
        </div>

        <div class="hub-hero-stage">
          <div class="hub-hero-poster">
            {poster}
            {posterScore != null ? <PosterRating score={posterScore} label={posterScoreLabel} /> : null}
          </div>
          <div class="hub-hero-player" data-hero-pip>
            {trailer ? (
              <HeroTrailerEmbed
                href={mediaHref}
                title={title}
                candidates={trailerCandidates ?? [trailer]}
                fallbackBackdrop={fallbackBackdrop}
              />
            ) : fallbackBackdrop ? (
              <a class="hub-hero-video hub-hero-video-backdrop" href={mediaHref}>
                <img
                  src={fallbackBackdrop.x1}
                  {...(fallbackBackdrop.x2
                    ? { srcset: `${fallbackBackdrop.x1} 1x, ${fallbackBackdrop.x2} 2x` }
                    : {})}
                  alt=""
                  loading="eager"
                  decoding="async"
                />
              </a>
            ) : (
              <a class="hub-hero-video hub-hero-video-empty" href={mediaHref}>
                <span class="hub-hero-video-fallback">Trailers &amp; clips</span>
              </a>
            )}
          </div>
          <aside class="hub-hero-credits" aria-label="Cast and crew">
            <div class="hub-hero-credits-body">
              <CreditBlock title="Starring" people={starring} />
              <CreditBlock title="Directors" people={directors} />
              <CreditBlock title="Writers" people={writers} />
            </div>
            <div class="hub-hero-credits-foot">
              {watchProvider ? (
                <a
                  class="hub-hero-watch"
                  href={watchProvider.href ?? "#"}
                  {...(watchProvider.href?.startsWith("http")
                    ? { target: "_blank", rel: "sponsored noopener" }
                    : {})}
                >
                  {watchProvider.logo ? (
                    <img src={watchProvider.logo} alt="" width="28" height="28" loading="lazy" />
                  ) : null}
                  <span>
                    Watch on <strong>{watchProvider.name}</strong>
                  </span>
                </a>
              ) : null}
              <ShareBar url={shareUrl} title={shareTitle} />
              <RateInline kind={rateKind} refId={rateRef} stat={rateStat} />
            </div>
          </aside>
        </div>

        {highlights.length ? (
          <section class="hub-hero-highlights" aria-label={`${title} video highlights`}>
            <h2 class="hub-hero-section-label">
              {title} <span>highlights</span>
            </h2>
            <div class="hub-hero-vidrow">
              {highlights.map((v) => (
                <a
                  class="hub-hero-vid"
                  href={`https://www.youtube.com/watch?v=${v.key}`}
                  target="_blank"
                  rel="noopener"
                  data-video-key={v.key}
                  data-video-name={v.name}
                  aria-label={`Play ${v.name}`}
                >
                  <span class="hub-hero-vid-thumb">
                    <img
                      src={`https://i.ytimg.com/vi/${v.key}/mqdefault.jpg`}
                      alt=""
                      width="160"
                      height="90"
                      loading="lazy"
                      decoding="async"
                    />
                    <IconPlayDisc size={30} />
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {plot || blurb ? (
          <section class="hub-hero-plot">
            <h2 class="hub-hero-plot-label">Plot</h2>
            <div class="hub-hero-plot-body">
              {plot ? <p class="hub-hero-plot-text">{plot}</p> : null}
              {blurb ? <p class="hub-hero-blurb">{blurb}</p> : null}
            </div>
          </section>
        ) : null}
      </div>
    </header>
  );
};

/** First streaming provider with logo + optional affiliate watch link. */
export function heroWatchProvider(
  names: string[],
  title: string,
  region: string,
  kind: ChartKind,
): { name: string; logo?: string; href?: string | null; chartHref: string } | null {
  if (!names.length) return null;
  const name = names[0];
  const logo = PROVIDER_LOGOS[name];
  const watch = watchUrl(name, title, region);
  const brand = providerBrand(name);
  return {
    name: brand,
    logo,
    href: watch?.href ?? null,
    chartHref: networkChartBasePath(providerNetworkSlug(name), kind),
  };
}
export const tmdbRingScore = (rating: number | null | undefined): number | null =>
  rating != null ? Math.round(rating * 10) : null;

/** Community verdict columns → 0–100 ring value. */
export const communityRingScore = (
  counts: { loved: number; liked: number; meh: number; awful: number } | null,
): number | null => {
  if (!counts) return null;
  const n = counts.loved + counts.liked + counts.meh + counts.awful;
  if (n < 2) return null;
  const avg = (5 * counts.loved + 4 * counts.liked + 2 * counts.meh + counts.awful) / n;
  return Math.round((avg / 5) * 100);
};
