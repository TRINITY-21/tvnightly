// The versus card: two titles' backdrops split the card and merge in the
// middle, posters lean toward each other around the VS badge. Shared by the
// show and movie head-to-head sections and the movie compare hub.
import { FC } from "hono/jsx";

// No ratings on the card: printing both scores would settle the matchup
// before the click — the chart is the payoff.
export type VsSide = {
  name: string;
  poster: string | null; // w342-class url
  backdrop: string | null; // w780-class url
};

export const VsCard: FC<{ href: string; a: VsSide; b: VsSide; cta: string }> = ({
  href,
  a,
  b,
  cta,
}) => (
  <a class="vs-card" href={href}>
    <span class="vs-bg" aria-hidden="true">
      {a.backdrop ? (
        <span class="vs-bg-a" style={`background-image:url('${a.backdrop}')`}></span>
      ) : null}
      {b.backdrop ? (
        <span class="vs-bg-b" style={`background-image:url('${b.backdrop}')`}></span>
      ) : null}
    </span>
    <span class="vs-posters" aria-hidden="true">
      {a.poster ? (
        <img class="vs-p vs-p-a" src={a.poster} alt="" width="64" height="96" loading="lazy" />
      ) : null}
      <span class="vs-badge">VS</span>
      {b.poster ? (
        <img class="vs-p vs-p-b" src={b.poster} alt="" width="64" height="96" loading="lazy" />
      ) : null}
    </span>
    <span class="vs-names">
      {a.name} <span class="vs-v">vs</span> {b.name}
    </span>
    <span class="vs-cta chev-after">{cta}</span>
  </a>
);
