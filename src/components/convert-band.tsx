// Shared above-the-fold "keep going" band shell for show + movie pages:
// community-proof line, similar-title chips, and the one-tap rate /
// renewal-alert foot. The show- and movie-specific wrappers compute context
// and hand it here so the markup and proof copy live in exactly one place.
import { FC } from "hono/jsx";
import { RateInline, SubscribeCompact } from "./forms";

export interface ConvertSimilar {
  label: string;
  items: { href: string; text: string }[];
  allHref: string;
}

export const ConvertBand: FC<{
  ariaName: string;
  stat: string | null;
  raterCount: number;
  similar?: ConvertSimilar | null;
  rate: { kind: "tv" | "movie"; refId: string };
  /** Renewal email capture in the foot (shows only — movies have no alerts). */
  subscribe?: { showId: number; showName: string; kicker: string } | null;
}> = ({ ariaName, stat, raterCount, similar = null, rate, subscribe = null }) => {
  const proof: string[] = [];
  if (raterCount > 0) {
    proof.push(`${raterCount.toLocaleString()} ${raterCount === 1 ? "person" : "people"} rated this`);
  }
  if (stat) proof.push(stat);

  return (
    <aside class="show-convert" aria-label={`More about ${ariaName}`}>
      {proof.length ? (
        <p class="show-convert-proof muted">
          {proof.map((line, i) => (
            <>
              {i > 0 ? <span class="sep"> · </span> : null}
              <span>{line}</span>
            </>
          ))}
        </p>
      ) : null}

      {similar?.items.length ? (
        <div class="show-convert-block show-convert-similar">
          <p class="show-convert-label">{similar.label}</p>
          <div class="show-convert-similar-chips">
            {similar.items.slice(0, 3).map((it) => (
              <a class="show-convert-tag" href={it.href}>
                {it.text}
              </a>
            ))}
            <a class="show-convert-tag show-convert-tag-ghost chev-after" href={similar.allHref}>
              All similar
            </a>
          </div>
        </div>
      ) : null}

      <div class="show-convert-foot">
        <RateInline kind={rate.kind} refId={rate.refId} />
        {subscribe ? (
          <SubscribeCompact showId={subscribe.showId} showName={subscribe.showName} kicker={subscribe.kicker} />
        ) : null}
      </div>
    </aside>
  );
};
