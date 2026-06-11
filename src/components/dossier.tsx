// The match-dossier ledger row: a recommendation with its receipts.
// Shared by show + movie similar sections and their dedicated pages.
import { FC } from "hono/jsx";
import { Dossier } from "../lib/dossier";
import { slugifyName } from "../lib/format";

export const DossierRow: FC<{
  i: number;
  href: string;
  name: string;
  d: Dossier;
  rating: number | null;
  poster: { src: string; srcset?: string } | null;
  compare?: { href: string; label: string };
}> = ({ i, href, name, d, rating, poster, compare }) => (
  <li class="dossier-row">
    <span class="dossier-num">{String(i + 1).padStart(2, "0")}</span>
    <a class="dossier-poster" href={href} tabindex={-1} aria-hidden="true">
      {poster ? (
        <img
          src={poster.src}
          srcset={poster.srcset}
          width="64"
          height="90"
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span class="dossier-poster-empty"></span>
      )}
    </a>
    <span class="dossier-main">
      {d.genreLine.length ? (
        <span class="dossier-genres">
          {d.genreLine.map((t, j) => (
            <>
              {j > 0 ? <span class="g-sep">·</span> : null}
              <a class={t.hit ? undefined : "g-dim"} href={`/genre/${slugifyName(t.g)}`}>
                {t.g}
              </a>
            </>
          ))}
        </span>
      ) : null}
      <span class="dossier-line">
        <a class="dossier-name" href={href}>
          {name}
        </a>
        <span class="dossier-leader"></span>
        {d.era ? (
          <span class="dossier-era">
            {d.era}
            {d.metaNet ? (
              <>
                <span class="sep">·</span>
                <a href={`/network/${slugifyName(d.metaNet)}`}>{d.metaNet}</a>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      {d.signals.length || d.stream ? (
        <span class="dossier-receipt">
          {d.signals.map((sig, j) => {
            const net = sig.startsWith("Same network — ")
              ? sig.slice("Same network — ".length)
              : null;
            return (
              <>
                {j > 0 ? <span class="sep">·</span> : null}
                {net ? (
                  <>
                    Same network — <a href={`/network/${slugifyName(net)}`}>{net}</a>
                  </>
                ) : (
                  sig
                )}
              </>
            );
          })}
          {d.stream ? (
            <>
              {d.signals.length ? <span class="sep">·</span> : null}
              {d.stream.logo ? (
                <img
                  class="prov-mini"
                  src={d.stream.logo}
                  width="20"
                  height="20"
                  alt={`${d.stream.also ? "Also on" : "Streaming on"} ${d.stream.name}`}
                  title={`${d.stream.also ? "Also on" : "Streaming on"} ${d.stream.name}`}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                `${d.stream.also ? "Also on" : "Streaming on"} ${d.stream.name}`
              )}
            </>
          ) : null}
        </span>
      ) : null}
      {d.pitch ? (
        <span class={d.isBlurb ? "dossier-pitch is-blurb" : "dossier-pitch"}>{d.pitch}</span>
      ) : null}
    </span>
    <span class="dossier-score">
      {rating != null ? <span class="rating">★ {rating.toFixed(1)}</span> : null}
      {compare ? (
        <a class="dossier-compare chev-after" href={compare.href} aria-label={compare.label}>
          Compare
        </a>
      ) : null}
    </span>
  </li>
);
