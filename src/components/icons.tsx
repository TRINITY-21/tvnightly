// Drawn glyphs in the brand's line voice — stroke-based, currentColor,
// no emoji. Same drawing language as the logo mark and CSS chevrons.
import { FC } from "hono/jsx";
import { raw } from "hono/html";

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

/* picker-dial: Layout: dial centered at (60,50), r=40, six 60-degree pie wedges with vertices at (60,10), */
export const IconDial: FC<{ size?: number }> = ({ size = 64 }) => (
  <svg
    class="icon"
    width={size}
    height={(size * 100.0) / 120.0}
    viewBox="0 0 120 100"
    fill="none"
    aria-hidden="true"
  >
    {raw(`<path d="M60 50 L60 10 A40 40 0 0 1 94.6 30 Z" fill="#ffa94d"/><path d="M60 50 L94.6 30 A40 40 0 0 1 94.6 70 Z" fill="#232328"/><path d="M60 50 L94.6 70 A40 40 0 0 1 60 90 Z" fill="#ff5c8a"/><path d="M60 50 L60 90 A40 40 0 0 1 25.4 70 Z" fill="#eac54f"/><path d="M60 50 L25.4 70 A40 40 0 0 1 25.4 30 Z" fill="#232328"/><path d="M60 50 L25.4 30 A40 40 0 0 1 60 10 Z" fill="#b6b1a9"/><circle cx="60" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="3"/><path d="M60 6 V3 M104 50 H107 M60 94 V97 M16 50 H13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="50" r="10" fill="#232328" stroke="currentColor" stroke-width="3"/><path d="M75 24 L65.2 53 L54 60.4 L54.8 47 Z" fill="#f8f6f2" stroke="#f8f6f2" stroke-width="2" stroke-linejoin="round"/><circle cx="60" cy="50" r="2.5" fill="#232328"/>`)}
  </svg>
);

/* clapperboard: Layout: an 80x40 slate board (x22 y46, rx5) with three take lines, a 78x12 clapper bar hin */
export const IconClapper: FC<{ size?: number }> = ({ size = 64 }) => (
  <svg
    class="icon"
    width={size}
    height={(size * 100.0) / 120.0}
    viewBox="0 0 120 100"
    fill="none"
    aria-hidden="true"
  >
    {raw(`<g transform="rotate(-6 62 60)"><rect x="22" y="46" width="80" height="40" rx="5" fill="#232328" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M30 56 H80 M30 65 H66 M30 74 H74" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><g transform="rotate(-20 25 46)"><rect x="25" y="34" width="78" height="12" rx="3" fill="#232328"/><path d="M30 46 L38 34 L46 34 L38 46 Z" fill="#f8f6f2"/><path d="M46 46 L54 34 L62 34 L54 46 Z" fill="#f8f6f2"/><path d="M62 46 L70 34 L78 34 L70 46 Z" fill="#f8f6f2"/><path d="M78 46 L86 34 L94 34 L86 46 Z" fill="#f8f6f2"/><rect x="25" y="34" width="78" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></g><circle cx="25" cy="46" r="3.5" fill="currentColor"/></g>`)}
  </svg>
);

/* loved-cluster: Layout: 36u pink heart anchors bottom-left (tip 34,86), amber mitten thumbs-up (rect fist  */
export const IconHearts: FC<{ size?: number }> = ({ size = 64 }) => (
  <svg
    class="icon"
    width={size}
    height={(size * 96.0) / 120.0}
    viewBox="0 0 120 96"
    fill="none"
    aria-hidden="true"
  >
    {raw(`<path d="M34 86C21 76 16 70 16 66C16 61 20 58 25 58C30 58 33 60 34 63C35 60 38 58 43 58C48 58 52 61 52 66C52 70 47 76 34 86Z" fill="#ff5c8a"/><g transform="rotate(-8 80 66)"><rect x="70" y="60" width="22" height="18" rx="5" fill="#ffa94d"/><path d="M75 65Q73 56 68 50" fill="none" stroke="#ffa94d" stroke-width="7" stroke-linecap="round"/></g><polygon points="38,14 41.5,23 51,24 43.7,30 46,39 38,34 30,39 32.3,30 25,24 34.5,23" fill="#eac54f"/><path d="M75 38C66 31.5 63 28 63 24.5C63 21 65.5 19 69 19C72 19 74 21 75 23C76 21 78 19 81 19C84.5 19 87 21 87 24.5C87 28 84 31.5 75 38Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" transform="rotate(8 75 28)"/><path d="M102 22C97 18 95 15.5 95 13.5C95 11.5 96.5 10 98.5 10C100 10 101.5 11 102 12.5C102.5 11 104 10 105.5 10C107.5 10 109 11.5 109 13.5C109 15.5 107 18 102 22Z" fill="#ff5c8a" transform="rotate(-10 102 16)"/>`)}
  </svg>
);

/* the-audience: Layout: three head circles at (34,42), (86,42) r12 muted and (60,28) r15 amber, each over  */
export const IconAudience: FC<{ size?: number }> = ({ size = 64 }) => (
  <svg
    class="icon"
    width={size}
    height={(size * 100.0) / 120.0}
    viewBox="0 0 120 100"
    fill="none"
    aria-hidden="true"
  >
    {raw(`<path d="M16 95 V78 A18 18 0 0 1 52 78 V95 Z" fill="#b6b1a9"/><circle cx="34" cy="42" r="12" fill="#b6b1a9"/><path d="M68 95 V78 A18 18 0 0 1 104 78 V95 Z" fill="#b6b1a9"/><circle cx="86" cy="42" r="12" fill="#b6b1a9"/><path d="M38 95 V72 A22 22 0 0 1 82 72 V95 Z" fill="#ffa94d"/><circle cx="60" cy="28" r="15" fill="#ffa94d"/>`)}
  </svg>
);

/* the-set: Layout: 96x60 body (12-108 x 30-90, rx 10) with an 8-unit bezel and a 10-unit bottom strip */
export const IconTvPlay: FC<{ size?: number }> = ({ size = 64 }) => (
  <svg
    class="icon"
    width={size}
    height={(size * 100.0) / 120.0}
    viewBox="0 0 120 100"
    fill="none"
    aria-hidden="true"
  >
    {raw(`<path d="M50 30 L36 10 M70 30 L84 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/><rect x="12" y="30" width="96" height="60" rx="10" stroke="currentColor" stroke-width="3" stroke-linejoin="round" fill="none"/><rect x="20" y="38" width="80" height="42" rx="5" fill="#232328"/><path d="M55 51 L69 59 L55 67 Z" fill="#ffa94d" stroke="#ffa94d" stroke-width="3" stroke-linejoin="round"/><circle cx="96" cy="85" r="2.5" fill="#ffa94d"/>`)}
  </svg>
);

/* matchup-badge: Layout: two 36x50 portrait cards centered at (40,50) and (80,50) rotated +/-10deg so their */
export const IconVs: FC<{ size?: number }> = ({ size = 64 }) => (
  <svg
    class="icon"
    width={size}
    height={(size * 100.0) / 120.0}
    viewBox="0 0 120 100"
    fill="none"
    aria-hidden="true"
  >
    {raw(`<line x1="74" y1="6" x2="46" y2="94" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="22" y="25" width="36" height="50" rx="6" fill="#ffa94d" transform="rotate(10 40 50)"/><rect x="62" y="25" width="36" height="50" rx="6" fill="#ff5c8a" transform="rotate(-10 80 50)"/><circle cx="60" cy="50" r="21" fill="#232328" stroke="currentColor" stroke-width="3"/><text x="60" y="56" font-family="inherit" font-weight="800" font-size="16" fill="#f8f6f2" text-anchor="middle">VS</text>`)}
  </svg>
);

/* film reel: the big watermark glyph — a rim, five spool holes, and a strip
   of sprocketed film running out the side. Drawn, never stock. */
export const IconReel: FC<{ size?: number }> = ({ size = 120 }) => (
  <svg
    class="icon icon-reel"
    width={size}
    height={(size * 100) / 132}
    viewBox="0 0 132 100"
    fill="none"
    stroke="currentColor"
    stroke-width="3"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <circle cx="46" cy="48" r="40" />
    <circle cx="46" cy="48" r="6.5" fill="currentColor" stroke="none" />
    <circle cx="46" cy="25" r="9.5" />
    <circle cx="68" cy="41" r="9.5" />
    <circle cx="59.5" cy="67" r="9.5" />
    <circle cx="32.5" cy="67" r="9.5" />
    <circle cx="24" cy="41" r="9.5" />
    <path d="M83 56h45" />
    <path d="M85 72h43" />
    <rect x="94" y="61" width="6" height="6" rx="1" />
    <rect x="108" y="61" width="6" height="6" rx="1" />
    <rect x="122" y="61" width="6" height="6" rx="1" />
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
