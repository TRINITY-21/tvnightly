// Live-TMDB detail page — rendered for any title that isn't in the D1 mirror
// yet (the hybrid catalog). Reuses the detail-hero / cast styles so it reads as
// a native page; SSR'd and indexable, canonical pointing at the clean URL.
import { FC } from "hono/jsx";
import { Layout } from "./Layout";
import { IconStar } from "./icons";
import { heroBg, stripHtml } from "../lib/format";
import { PROVIDER_LOGOS } from "../lib/providers";
import { RateInline } from "./forms";
import type { TmdbTitle } from "../lib/tmdb";

const tmdbImg = (path: string | null, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

export const TmdbTitlePage: FC<{
  t: TmdbTitle;
  providers: string[];
  region: string;
  stat: string | null;
  ratingLd: Record<string, unknown> | null;
  canonical: string;
}> = ({ t, providers, region, stat, ratingLd, canonical }) => {
  const isTv = t.kind === "tv";
  const dek = t.overview ? stripHtml(t.overview) : "";
  const metaType = isTv ? "TV" : "Movie";
  const ld = {
    "@context": "https://schema.org",
    "@type": isTv ? "TVSeries" : "Movie",
    name: t.name,
    url: canonical,
    ...(t.poster ? { image: t.poster.x2 } : {}),
    ...(dek ? { description: dek.slice(0, 300) } : {}),
    ...(t.genres.length ? { genre: t.genres } : {}),
    ...(t.year ? { datePublished: t.year } : {}),
    // only OUR first-party community verdicts go in structured data — never the
    // third-party TMDB score (matches the policy in lib/ratings.ts).
    ...(ratingLd ? { aggregateRating: ratingLd } : {}),
  };

  return (
    <Layout
      title={`${t.name}${t.year ? ` (${t.year})` : ""} — where to watch | TV Nightly`}
      description={
        dek
          ? dek.slice(0, 155)
          : `Where to stream ${t.name}${t.year ? ` (${t.year})` : ""}, cast, ratings and details.`
      }
      canonical={canonical}
      ld={[ld]}
      ogImage={t.backdrop?.x2 ?? t.poster?.x2 ?? undefined}
      preloadImage={t.backdrop ?? undefined}
    >
      <article class="show-hub">
        <header class="detail-hero">
          {t.backdrop ? (
            <div class="hero-backdrop" style={heroBg(t.backdrop.x1, t.backdrop.x2)} aria-hidden="true"></div>
          ) : null}
          <div class="detail-head">
            <div class="detail-side">
              {t.poster ? (
                <img
                  class="poster"
                  src={t.poster.x1}
                  srcset={`${t.poster.x1} 1x, ${t.poster.x2} 2x`}
                  alt={t.name}
                  width="232"
                  height="348"
                  fetchpriority="high"
                />
              ) : (
                <div class="poster card-fallback">{t.name}</div>
              )}
            </div>
            <div class="detail-info">
              <h1 class="detail-title">{t.name}</h1>
              <p class="meta-strip">
                <span>{metaType}</span>
                {t.status ? (
                  <>
                    <span class="sep">·</span>
                    <span>{t.status}</span>
                  </>
                ) : null}
                {t.year ? (
                  <>
                    <span class="sep">·</span>
                    <span>{t.year}</span>
                  </>
                ) : null}
                {isTv && t.seasons ? (
                  <>
                    <span class="sep">·</span>
                    <span>
                      {t.seasons} season{t.seasons === 1 ? "" : "s"}
                    </span>
                  </>
                ) : null}
                {t.genres.length ? (
                  <>
                    <span class="sep">·</span>
                    <span>{t.genres.slice(0, 3).join(", ")}</span>
                  </>
                ) : null}
                {t.rating != null ? (
                  <>
                    <span class="sep">·</span>
                    <span class="rating">
                      <IconStar class="rating-star" />
                      {t.rating.toFixed(1)}
                    </span>
                  </>
                ) : null}
              </p>
              {dek ? <p class="summary">{dek}</p> : null}

              {providers.length ? (
                <div class="tmdb-watch">
                  <span class="tmdb-watch-label">Streaming on ({region})</span>
                  <span class="tmdb-watch-provs">
                    {providers.slice(0, 6).map((name) =>
                      PROVIDER_LOGOS[name] ? (
                        <img src={PROVIDER_LOGOS[name]} alt={name} title={name} width="34" height="34" loading="lazy" />
                      ) : (
                        <span class="tmdb-watch-name">{name}</span>
                      ),
                    )}
                  </span>
                </div>
              ) : null}

              <p class="spot-actions">
                {t.trailerKey ? (
                  <a
                    class="btn-ghost chev-after"
                    href={`https://www.youtube.com/watch?v=${t.trailerKey}`}
                    target="_blank"
                    rel="noopener"
                  >
                    Watch trailer
                  </a>
                ) : null}
                {t.imdbId ? (
                  <a class="more" href={`https://www.imdb.com/title/${t.imdbId}/`} target="_blank" rel="noopener">
                    IMDb ↗
                  </a>
                ) : null}
              </p>
              <RateInline kind={t.kind} refId={`t${t.tmdbId}`} stat={stat} />
            </div>
          </div>
        </header>

        {t.cast.length ? (
          <section>
            <h2>Cast</h2>
            <div class="cast-grid">
              {t.cast.map((p) => {
                const img = tmdbImg(p.profilePath, "w185");
                return (
                  <div class="cast-tile" key={p.id}>
                    {img ? (
                      <img src={img} alt={p.name} loading="lazy" />
                    ) : (
                      <div class="cast-fallback">{p.name}</div>
                    )}
                    <div class="cast-tile-body">
                      <strong>{p.name}</strong>
                      {p.character ? <span class="cast-char">as {p.character}</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <p class="muted tmdb-note">
          Pulled live from our catalog — rate it above and it joins the community charts.{" "}
          <a href={`/search?q=${encodeURIComponent(t.name)}`}>Search more</a> ·{" "}
          <a href="/recommend">Get a personal pick</a>
        </p>
      </article>
    </Layout>
  );
};
