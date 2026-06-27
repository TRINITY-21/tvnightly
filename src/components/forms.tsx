// Interactive fragments: verdict buttons, alert signup, filter dropdowns.
import { FC } from "hono/jsx";
import { Honeypot } from "./Layout";
import { FaceAwful, FaceLike, FaceLove, FaceMeh } from "./icons";
import { regionFlagEmoji } from "../lib/providers";

/** One-tap verdict buttons + community stat — every title page collects data.
 *  rate.js intercepts the submit and records the verdict in place (no nav). */
export const RateInline: FC<{ kind: string; refId: string; stat?: string | null }> = ({
  kind,
  refId,
  stat = null,
}) => (
  <div class="rate-inline">
    <span class="rate-inline-label muted">{stat ?? "Seen it?"}</span>
    {(
      [
        ["love", "Loved it", FaceLove],
        ["like", "Good", FaceLike],
        ["meh", "Meh", FaceMeh],
        ["awful", "Awful", FaceAwful],
      ] as const
    ).map(([value, label, Face]) => (
      <form method="post" action="/recommend" class="verdict-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="ref" value={refId} />
        <input type="hidden" name="verdict" value={value} />
        <button type="submit" class="vote-btn" data-verdict={value} data-label={label} aria-label={label}>
          <Face />
        </button>
      </form>
    ))}
  </div>
);

export const SubscribeForm: FC<{ showId: number; label: string }> = ({ showId, label }) => (
  <form action="/subscribe" method="post" class="sub-form inline">
    <input type="hidden" name="kind" value="renewal" />
    <input type="hidden" name="show_id" value={String(showId)} />
    <div class="sub-copy">
      <span class="sub-kicker">Alerts</span>
      {/* one SubscribeForm per page, so a fixed id is safe */}
      <label class="sub-title" for="sub-email">
        {label}
      </label>
      <span class="sub-note">
        Renewal news, premiere dates and streaming moves. One confirmation email first —
        unsubscribe any time.
      </span>
    </div>
    <div class="sub-controls">
      <input id="sub-email" type="email" name="email" placeholder="you@example.com" required />
      <button type="submit">Notify me</button>
    </div>
    <Honeypot />
  </form>
);

/** Compact alert capture for above-the-fold conversion bands on show pages. */
export const SubscribeCompact: FC<{ showId: number; showName: string; kicker?: string }> = ({
  showId,
  showName,
  kicker,
}) => (
  <form action="/subscribe" method="post" class="sub-form sub-compact">
    <input type="hidden" name="kind" value="renewal" />
    <input type="hidden" name="show_id" value={String(showId)} />
    <span class="sub-compact-kicker">{kicker ?? `Email me when ${showName} returns`}</span>
    <div class="sub-controls">
      <input type="email" name="email" placeholder="you@example.com" required autocomplete="email" />
      <button type="submit">Notify me</button>
    </div>
    <Honeypot />
  </form>
);

export const FilterSelect: FC<{
  label: string;
  name: string;
  current: string;
  /** Primary chart-bar picker — amber accent (Chart, Network). */
  primary?: boolean;
  // `cc` (ISO 3166-1 alpha-2) opts an option into a flag: emoji in the native
  // <option> (mobile picker), and a crisp /flags/<cc>.png in the desktop combobox
  // (dropdown.js reads data-cc / data-label). `title` is the hover/a11y name.
  options: { value: string; text: string; cc?: string; title?: string; slug?: string }[];
}> = ({ label, name, current, options, primary }) => {
  const id = `${name}-label`;
  return (
    <div class={primary ? "chart-filter-chart watch-field" : "watch-field"}>
      <span class="watch-field-label" id={id}>
        {label}
      </span>
      <select name={name} data-fancy aria-labelledby={id}>
        {options.map((o) => (
          <option
            value={o.value}
            selected={o.value === current}
            data-cc={o.cc}
            data-label={o.cc ? o.text : undefined}
            data-slug={o.slug}
            title={o.title}
          >
            {o.cc ? `${regionFlagEmoji(o.cc)} ${o.text}` : o.text}
          </option>
        ))}
      </select>
    </div>
  );
};
