import type { Pick, TasteProfile } from "../lib/recommend";
import { GenreIcon } from "./genre-icons";
import { IconStar } from "./icons";

/** Compact on-page taste profile — story PNG is for social; this is the in-app view. */
export function TasteProfileShare(props: {
  tasteProfile: TasteProfile;
  primary: Pick;
  tasteShareUrl: string;
  tasteCardUrl?: string;
  /** Beside the match hero on results — drops the redundant next-watch row. */
  sidecar?: boolean;
}) {
  const { tasteProfile, primary, tasteShareUrl, tasteCardUrl, sidecar } = props;
  const heroHref = primary.kind === "tv" ? `/show/${primary.slug}` : `/movie/${primary.slug}`;
  const meta = [primary.genres.slice(0, 2).join(" · "), primary.year].filter(Boolean).join(" · ");

  return (
    <section class={`rec-taste-share${sidecar ? " rec-taste-sidecar" : ""}`}>
      <header class="rec-taste-head">
        {sidecar ? <p class="section-eyebrow">Your taste</p> : null}
        <h2 class="rec-taste-title">{sidecar ? "Taste profile" : "Your TV taste profile"}</h2>
        {tasteProfile.era ? <p class="rec-taste-era-line muted">Sweet spot · {tasteProfile.era}</p> : null}
      </header>

      <ul class="rec-taste-rows">
        {tasteProfile.slices.slice(0, 3).map((s, i) => (
          <li class={`rec-taste-row${i === 0 ? " rec-taste-row-top" : ""}`}>
            <span class="rec-taste-row-icon" aria-hidden="true">
              <GenreIcon genre={s.label} size={17} />
            </span>
            <div class="rec-taste-row-main">
              <span class="rec-taste-row-label">{s.label}</span>
              <span class="rec-taste-row-bar" aria-hidden="true">
                <span class="rec-taste-row-fill" style={`width:${s.pct}%`}></span>
              </span>
            </div>
            <span class="rec-taste-row-pct">{s.pct}%</span>
          </li>
        ))}
      </ul>

      {!sidecar ? (
        <div class="rec-taste-pick">
          <p class="rec-why-head">Next watch</p>
          <a class="rec-taste-pick-row" href={heroHref}>
            {primary.poster ? (
              <img
                class="rec-taste-pick-poster"
                src={primary.poster}
                alt=""
                width="52"
                height="78"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span class="rec-taste-pick-poster rec-taste-pick-blank" aria-hidden="true">
                {primary.name.slice(0, 1)}
              </span>
            )}
            <span class="rec-taste-pick-info">
              <span class="rec-taste-pick-name">{primary.name}</span>
              {meta ? <span class="rec-taste-pick-meta muted">{meta}</span> : null}
              {primary.rating != null ? (
                <span class="rating rec-taste-pick-rating">
                  <IconStar class="rating-star" />
                  {primary.rating.toFixed(1)}
                </span>
              ) : null}
            </span>
          </a>
        </div>
      ) : null}

      <footer class="rec-taste-foot">
        <button
          type="button"
          class="verdict-btn rec-profile-share"
          data-share-url={tasteShareUrl}
          data-share-title={`My TV taste: ${tasteProfile.summary}`}
        >
          Share profile
        </button>
        <div class="rec-taste-secondary">
          <button type="button" class="btn-ghost rec-copy-taste" data-url={tasteShareUrl} data-copied="Link copied">
            Copy link
          </button>
          {tasteCardUrl ? (
            <a class="btn-ghost rec-taste-card-link" href={tasteCardUrl} target="_blank" rel="noopener">
              Story card ↗
            </a>
          ) : null}
        </div>
        <p class="rec-taste-share-note muted">
          Friends who open your link see your taste — then <a href="/recommend">make their own</a>.
        </p>
      </footer>
    </section>
  );
}
