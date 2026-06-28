// Poster cards, badges, explore tiles, the 3-line synopsis clamp.
import { FC, PropsWithChildren } from "hono/jsx";
import type { ExploreArt } from "../lib/explore-art";
import { heroBg, posterImg, posterSrc } from "../lib/format";
import { MovieRow, ShowRow } from "../types";
import { IconPlayDisc, IconStar, IconStarBadge } from "./icons";

// A live title too new to have a stable rating (we hide flukey low-vote averages)
// still deserves a badge — show "NEW" so the slot reads intentional, not missing.
const CUR_YEAR = new Date().getFullYear();
const isFreshYear = (year: number | null): boolean => year != null && year >= CUR_YEAR - 1;
const showYearNum = (s: ShowRow): number | null =>
  s.premiered ? Number(s.premiered.slice(0, 4)) || null : null;

// Long synopses clamp to 3 lines with a pure-CSS show more/less toggle
// (hidden checkbox — no JS; the label is the control).
export const ClampSummary: FC<PropsWithChildren<{ id: string }>> = ({ id, children }) => (
  <div class="summary clampable">
    <input type="checkbox" id={id} class="clamp-toggle" />
    <div class="summary-text">{children}</div>
    <label for={id} class="clamp-label" aria-label="Toggle full synopsis"></label>
  </div>
);

export const StatusBadge: FC<{ status: string | null }> = ({ status }) => {
  if (!status) return null; // no badge beats an "Unknown" one (e.g. live-TMDB rows)
  const cls = status === "Running" ? "ok" : status === "Ended" ? "ended" : "tbd";
  return <span class={`badge ${cls}`}>{status}</span>;
};

// Play-trailer disc layered over a poster. The card is a link to the title page;
// this control intercepts the click (media-video.js) and fetches the title's
// YouTube trailer key on demand, then opens it in the on-page modal — so the
// homepage never pays for trailers nobody plays. A <span role="button"> (valid
// inside the card <a>); keyboard-activated by the same script. Rendered only when
// the row carries a tmdb_id (the key needed to look the trailer up).
export const CardPlay: FC<{ type: "tv" | "movie"; id: number; name: string }> = ({ type, id, name }) => (
  <span
    class="card-play"
    role="button"
    tabindex={0}
    aria-label={`Play ${name} trailer`}
    data-trailer-type={type}
    data-trailer-id={id}
    data-trailer-name={name}
  >
    <IconPlayDisc />
  </span>
);

// width/height match the CSS `aspect-ratio: 2/2.8` so the poster box is reserved
// before the image loads (no CLS even if styles are slow); `eager` opts a known
// above-the-fold card out of lazy-loading so it isn't deferred when it's the LCP.
export const ShowCard: FC<{ show: ShowRow; eager?: boolean }> = ({ show, eager }) => (
  <a class={show.tmdb_id != null ? "card has-play" : "card"} href={`/show/${show.slug}`}>
    <div class="card-media">
      {(() => {
        const p = posterSrc(show);
        return p ? (
          <img
            src={p.src}
            srcset={p.srcset}
            alt={show.name}
            width="200"
            height="280"
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            {...(eager ? { fetchpriority: "high" } : {})}
          />
        ) : (
          <div class="card-fallback">{show.name}</div>
        );
      })()}
      {show.tmdb_id != null ? <CardPlay type="tv" id={show.tmdb_id} name={show.name} /> : null}
      {show.rating != null ? (
        <span class="card-rating">
          <IconStarBadge class="card-rating-star" />
          {show.rating.toFixed(1)}
        </span>
      ) : isFreshYear(showYearNum(show)) ? (
        <span class="card-rating card-new">NEW</span>
      ) : null}
      <span class="card-hover-title" aria-hidden="true">{show.name}</span>
    </div>
    <div class="card-body">
      <span class="card-title">{show.name}</span>
    </div>
  </a>
);

export const MovieCard: FC<{ movie: MovieRow; eager?: boolean }> = ({ movie, eager }) => (
  <a class={movie.tmdb_id != null ? "card has-play" : "card"} href={`/movie/${movie.slug}`}>
    <div class="card-media">
      {(() => {
        const p = posterImg(movie.poster_url, "card");
        return p ? (
          <img
            {...p}
            alt={movie.title}
            width="200"
            height="280"
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            {...(eager ? { fetchpriority: "high" } : {})}
          />
        ) : (
          <div class="card-fallback">{movie.title}</div>
        );
      })()}
      {movie.tmdb_id != null ? <CardPlay type="movie" id={movie.tmdb_id} name={movie.title} /> : null}
      {movie.rating != null ? (
        <span class="card-rating">
          <IconStarBadge class="card-rating-star" />
          {movie.rating.toFixed(1)}
        </span>
      ) : isFreshYear(movie.year) ? (
        <span class="card-rating card-new">NEW</span>
      ) : null}
      <span class="card-hover-title" aria-hidden="true">{movie.title}</span>
    </div>
    <div class="card-body">
      <span class="card-title">{movie.title}</span>
    </div>
  </a>
);

// A destination slate in the lower-third voice: kicker word up top with the
// house chevron, confident display title, one quiet line of why-go.
export const ExploreCard: FC<{
  icon: string;
  title: string;
  desc: string;
  href: string;
  rating?: number;
  backdrop?: ExploreArt;
}> = ({ icon, title, desc, href, rating, backdrop }) => (
  <a class={backdrop ? "explore-card explore-card-art" : "explore-card"} href={href}>
    {backdrop ? (
      <span class="explore-frame" style={heroBg(backdrop.x1, backdrop.x2)} aria-hidden="true"></span>
    ) : null}
    <span class="explore-body">
      <span class="explore-kicker">
        {icon}
        {rating != null ? (
          <span class="rating explore-rating">
            <IconStar class="rating-star" />
            {rating.toFixed(1)}
          </span>
        ) : null}
        <span class="chev-icon explore-arrow" aria-hidden="true"></span>
      </span>
      <strong class="explore-title">{title}</strong>
      <p class="muted">{desc}</p>
    </span>
  </a>
);
