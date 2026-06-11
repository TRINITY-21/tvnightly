// Interactive fragments: verdict buttons, alert signup, filter dropdowns.
import { FC } from "hono/jsx";
import { FaceLove, FaceLike, FaceMeh } from "./icons";

/** One-tap verdict buttons + community stat — every title page collects data. */
export const RateInline: FC<{ kind: string; refId: string; stat: string | null }> = ({ kind, refId, stat }) => (
  <div class="rate-inline">
    <span class="muted">{stat ?? "Seen it?"}</span>
    {(
      [
        ["love", "Loved it", FaceLove],
        ["like", "Liked it", FaceLike],
        ["meh", "Not for me", FaceMeh],
      ] as const
    ).map(([value, label, Face]) => (
      <form method="post" action="/recommend" class="verdict-form">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="ref" value={refId} />
        <input type="hidden" name="verdict" value={value} />
        <button type="submit" class="vote-btn" aria-label={label} title={label}>
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
    {/* id-less wrapping label = programmatic association without unique ids */}
    <label>
      {label}
      <input type="email" name="email" placeholder="you@example.com" required />
    </label>
    <button type="submit">Notify me</button>
  </form>
);

export const FilterSelect: FC<{
  label: string;
  name: string;
  current: string;
  options: { value: string; text: string }[];
}> = ({ label, name, current, options }) => {
  const id = `${name}-label`;
  return (
    <div class="watch-field">
      <span class="watch-field-label" id={id}>
        {label}
      </span>
      <select name={name} data-fancy aria-labelledby={id}>
        {options.map((o) => (
          <option value={o.value} selected={o.value === current}>
            {o.text}
          </option>
        ))}
      </select>
    </div>
  );
};
