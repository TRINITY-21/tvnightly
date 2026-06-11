// Where-to-watch rendering: logo tiles and text chips.
import { FC } from "hono/jsx";
import { PROVIDER_LOGOS, providersFor, providerBrand } from "../lib/providers";

// The where-to-watch answer is the conversion moment of every detail page:
// recognizable platform logos instead of a wall of text chips, deduped by
// brand. An empty result still answers (fallbackHref) instead of a silent gap.
export const ProviderLine: FC<{
  row: { providers_intl: string | null };
  region: string;
  fallbackHref?: string;
  pickerType?: "tv" | "movie";
  allHref?: string; // the dedicated where-to-watch page, when one exists
}> = ({ row, region, fallbackHref, pickerType, allHref }) => {
  const prov = providersFor(row, region);
  if (!prov.names.length) {
    return fallbackHref ? (
      <p class="provs">
        <span class="muted">Not streaming in your region —</span>{" "}
        <a class="chev-after" href={allHref ?? fallbackHref}>
          {allHref
            ? "see every region's options"
            : fallbackHref.startsWith("/what-to-watch")
              ? "find one that is streaming"
              : "check the release date"}
        </a>
      </p>
    ) : null;
  }
  const seen = new Set<string>();
  const entries: { name: string; logo?: string }[] = [];
  for (const name of prov.names) {
    const brand = providerBrand(name);
    if (seen.has(brand)) continue;
    seen.add(brand);
    entries.push({ name, logo: PROVIDER_LOGOS[name] });
  }
  const shown = entries.slice(0, 8);
  const extra = entries.length - shown.length;
  return (
    <p class="provs">
      <span class="muted">
        Streaming on{prov.region !== region ? ` (${prov.region} — not on your region's services)` : ` (${prov.region})`}
      </span>{" "}
      {shown.map(({ name, logo }) => {
        const inner = logo ? (
          <img src={logo} alt={name} width="34" height="34" loading="lazy" />
        ) : null;
        // tiles are real controls on detail pages: each opens the picker
        // pre-filtered to that service ("more like this, same subscription")
        return logo ? (
          pickerType ? (
            <a
              class="prov-tile"
              href={`/what-to-watch?type=${pickerType}&service=${encodeURIComponent(name)}`}
              title={`${name} — more on this service`}
            >
              {inner}
            </a>
          ) : (
            <span class="prov-tile" title={name}>
              {inner}
            </span>
          )
        ) : (
          <span class="prov">{name}</span>
        );
      })}
      {extra > 0 ? <span class="muted">+{extra} more</span> : null}
      {allHref ? (
        <a class="chev-after provs-all" href={allHref}>
          See all
        </a>
      ) : null}
    </p>
  );
};

export const ProviderChips: FC<{
  row: { providers_intl: string | null };
  region: string;
  max?: number;
}> = ({ row, region, max = 4 }) => {
  const prov = providersFor(row, region);
  if (!prov.names.length) return <span class="muted shortlist-nostream">Not streaming</span>;
  const seen = new Set<string>();
  const entries: { name: string; logo?: string }[] = [];
  for (const name of prov.names) {
    const brand = providerBrand(name);
    if (seen.has(brand)) continue;
    seen.add(brand);
    entries.push({ name, logo: PROVIDER_LOGOS[name] });
  }
  const shown = entries.slice(0, max);
  const extra = entries.length - shown.length;
  return (
    <div class="shortlist-provs">
      {shown.map(({ name, logo }) =>
        logo ? (
          <span class="prov-tile" title={name}>
            <img src={logo} alt={name} width="28" height="28" loading="lazy" />
          </span>
        ) : (
          <span class="prov">{name}</span>
        ),
      )}
      {extra > 0 ? <span class="muted shortlist-more">+{extra}</span> : null}
    </div>
  );
};
