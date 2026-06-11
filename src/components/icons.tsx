// Drawn glyphs in the brand's line voice — stroke-based, currentColor,
// no emoji. Same drawing language as the logo mark and CSS chevrons.
import { FC } from "hono/jsx";

export const IconCal: FC<{ size?: number }> = ({ size = 15 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect
      x="3.2"
      y="4.8"
      width="17.6"
      height="16"
      rx="2.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
    />
    <path d="M3.2 9.6h17.6" stroke="currentColor" stroke-width="1.8" />
    <path d="M8 2.6v4M16 2.6v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    <circle cx="12" cy="15.2" r="1.6" fill="currentColor" />
  </svg>
);

/* play: the broadcast triangle in a ring, same line weight as the faces */
export const IconPlay: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path d="M10 8.6l5.4 3.4-5.4 3.4z" fill="currentColor" stroke="currentColor" stroke-linejoin="round" />
  </svg>
);

/* verdict faces: one circle, the mouth does the talking */
export const FaceLove: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path
      d="M7.4 9.9c.55-1 1.85-1 2.4 0M14.2 9.9c.55-1 1.85-1 2.4 0"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
    />
    <path
      d="M7.8 13.5c1.1 2.4 2.7 3.5 4.2 3.5s3.1-1.1 4.2-3.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    />
  </svg>
);

export const FaceLike: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
    <circle cx="8.8" cy="9.8" r="1.15" fill="currentColor" />
    <circle cx="15.2" cy="9.8" r="1.15" fill="currentColor" />
    <path
      d="M8.7 14.4c.95 1.3 2.05 1.9 3.3 1.9s2.35-.6 3.3-1.9"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    />
  </svg>
);

export const FaceMeh: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
    <circle cx="8.8" cy="9.8" r="1.15" fill="currentColor" />
    <circle cx="15.2" cy="9.8" r="1.15" fill="currentColor" />
    <path d="M8.6 15.3h6.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
  </svg>
);

/* vote carets: the chevron is the house arrow */
export const ChevUp: FC<{ size?: number }> = ({ size = 13 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M5 15.5l7-7 7 7"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

export const ChevDown: FC<{ size?: number }> = ({ size = 13 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M5 8.5l7 7 7-7"
      fill="none"
      stroke="currentColor"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);
