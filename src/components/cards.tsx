// Poster cards, badges, explore tiles, the 3-line synopsis clamp.
import { FC, PropsWithChildren } from "hono/jsx";
import { ShowRow, MovieRow } from "../types";

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
  const cls = status === "Running" ? "ok" : status === "Ended" ? "ended" : "tbd";
  return <span class={`badge ${cls}`}>{status ?? "Unknown"}</span>;
};

export const ShowCard: FC<{ show: ShowRow }> = ({ show }) => (
  <a class="card" href={`/show/${show.slug}`}>
    <div class="card-media">
      {show.image_url ? (
        <img src={show.image_url} alt={show.name} loading="lazy" />
      ) : (
        <div class="card-fallback">{show.name}</div>
      )}
      {show.rating != null ? <span class="card-rating">★ {show.rating.toFixed(1)}</span> : null}
    </div>
    <div class="card-body">
      <span class="card-title">{show.name}</span>
    </div>
  </a>
);

export const MovieCard: FC<{ movie: MovieRow }> = ({ movie }) => (
  <a class="card" href={`/movie/${movie.slug}`}>
    <div class="card-media">
      {movie.poster_url ? (
        <img src={movie.poster_url} alt={movie.title} loading="lazy" />
      ) : (
        <div class="card-fallback">{movie.title}</div>
      )}
      {movie.rating != null ? <span class="card-rating">★ {movie.rating.toFixed(1)}</span> : null}
    </div>
    <div class="card-body">
      <span class="card-title">{movie.title}</span>
    </div>
  </a>
);

export const ExploreCard: FC<{ icon: string; title: string; desc: string; href: string }> = ({
  icon,
  title,
  desc,
  href,
}) => (
  <a class="explore-card" href={href}>
    <span class="explore-icon">{icon}</span>
    <span>
      <strong>{title}</strong>
      <p class="muted">{desc}</p>
    </span>
    <span class="chev-icon explore-arrow" aria-hidden="true"></span>
  </a>
);
