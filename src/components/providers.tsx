// Where-to-watch rendering: logo tiles and text chips.
import { FC } from "hono/jsx";
import { PROVIDER_LOGOS, providersFor, providerBrand } from "../lib/providers";
import { watchUrl } from "../lib/affiliate";
import { slugifyName } from "../lib/format";

// The where-to-watch answer is the conversion moment of every detail page:
// recognizable platform logos instead of a wall of text chips, deduped by
// brand. An empty result still answers (fallbackHref) instead of a silent gap.
export const ProviderLine: FC<{
  row: { providers_intl: string | null };
  region: string;
  title?: string; // the show/film title — needed for outbound "watch" links
  fallbackHref?: string;
  pickerType?: "tv" | "movie";
  allHref?: string; // the dedicated where-to-watch page, when one exists
}> = ({ row, region, title, fallbackHref, pickerType, allHref }) => {
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
        if (!logo) return <span class="prov">{name}</span>;
        const inner = <img src={logo} alt={name} width="34" height="34" loading="lazy" />;
        // providers with a real affiliate program (Prime Video, Apple TV) become
        // outbound, sponsor-tagged "watch" links — the conversion moment
        const watch = title ? watchUrl(name, title, prov.region) : null;
        if (watch) {
          return (
            <a
              class="prov-tile"
              href={watch.href}
              target="_blank"
              rel="sponsored noopener"
              title={`Watch ${title} on ${name}`}
            >
              {inner}
            </a>
          );
        }
        // the rest stay internal: each opens the picker pre-filtered to that
        // service ("more like this, same subscription")
        return pickerType ? (
          <a
            class="prov-tile"
            href={`/network/${slugifyName(providerBrand(name))}/${pickerType === "movie" ? "movies" : "shows"}`}
            title={`${name} — the top ${name} ${pickerType === "movie" ? "movies" : "shows"}`}
          >
            {inner}
          </a>
        ) : (
          <span class="prov-tile" title={name}>
            {inner}
          </span>
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
