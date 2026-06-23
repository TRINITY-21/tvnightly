import { FC } from "hono/jsx";
import { freshLabel } from "../lib/freshness";

/** Visible freshness signal for renewal / premiere pages. */
export const FreshBadge: FC<{ epoch: number | null | undefined }> = ({ epoch }) => {
  const label = freshLabel(epoch);
  return label ? <span class="fresh-badge">{label}</span> : null;
};
