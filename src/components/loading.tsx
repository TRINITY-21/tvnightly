// Loading primitives. The CSS lives in styles/28-loading.css; the same
// `.spinner` / `.skeleton` classes are used by the client scripts, so these
// components and the JS share one visual language.
import { FC, PropsWithChildren } from "hono/jsx";

// The brand ring. Size via `size` (sm | md | lg); announces itself politely.
export const Spinner: FC<{ size?: "sm" | "md" | "lg"; label?: string }> = ({ size = "md", label }) => (
  <span
    class={`spinner${size === "sm" ? " spinner-sm" : size === "lg" ? " spinner-lg" : ""}`}
    role="status"
    aria-label={label ?? "Loading"}
  ></span>
);

// Centered spinner + caption for a panel that's still fetching.
export const LoadingState: FC<{ label?: string }> = ({ label = "Loading…" }) => (
  <div class="loading-state" role="status">
    <Spinner />
    <span>{label}</span>
  </div>
);

// Shimmering placeholder block — a text line (.skeleton-line) or any sized box.
export const Skeleton: FC<PropsWithChildren<{ class?: string }>> = ({ class: cls, children }) => (
  <span class={`skeleton${cls ? " " + cls : ""}`} aria-hidden="true">
    {children}
  </span>
);
