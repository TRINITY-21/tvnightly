// Drawn glyphs in the brand's line voice — stroke-based, currentColor,
// no emoji. Same drawing language as the logo mark and CSS chevrons.
import { raw } from "hono/html";
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

/* envelope — confirmation / email-capture moments */
export const IconMail: FC<{ size?: number }> = ({ size = 40 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2.5" y="5" width="19" height="14" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path
      d="M3.4 6.6 12 12.8l8.6-6.2"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
);

/* two-spark glyph for "what's new / just added" */
export const IconSparkle: FC<{ size?: number }> = ({ size = 48 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M10 3 L11.7 8.3 L17 10 L11.7 11.7 L10 17 L8.3 11.7 L3 10 L8.3 8.3 Z"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linejoin="round"
    />
    <path d="M18 14 L18.9 16.6 L21.5 17.5 L18.9 18.4 L18 21 L17.1 18.4 L14.5 17.5 L17.1 16.6 Z" fill="#ffa94d" />
  </svg>
);

/* sequence-path glyph for "watch orders" — node, route, node */
export const IconRoute: FC<{ size?: number }> = ({ size = 50 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="6" cy="5.8" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7" />
    <circle cx="18" cy="18.2" r="2.5" fill="none" stroke="currentColor" stroke-width="1.7" />
    <path d="M6 8.3 v3.5 a3.4 3.4 0 0 0 3.4 3.4 h5.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
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
    {raw(`<circle cx="60" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="3"/><path d="M60 6 V3 M104 50 H107 M60 94 V97 M16 50 H13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="60" cy="50" r="9" fill="none" stroke="currentColor" stroke-width="3"/><path d="M60 50 L80 27" stroke="#ffa94d" stroke-width="4" stroke-linecap="round"/><circle cx="60" cy="50" r="3" fill="currentColor"/>`)}
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
    {raw(`<g transform="rotate(-6 62 60)"><rect x="22" y="46" width="80" height="40" rx="5" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M30 58 H80 M30 67 H64 M30 76 H72" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><g transform="rotate(-20 25 46)"><rect x="25" y="34" width="78" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M40 34 L34 46 M55 34 L49 46 M70 34 L64 46 M85 34 L79 46" stroke="currentColor" stroke-width="2"/></g><circle cx="25" cy="46" r="3.5" fill="#ffa94d"/></g>`)}
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
    {raw(`<path d="M60 84 C30 64 18 52 18 38 C18 27 27 20 37 20 C46 20 54 25 60 34 C66 25 74 20 83 20 C93 20 102 27 102 38 C102 52 90 64 60 84 Z" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linejoin="round"/><path d="M97 7 L100 15 L108 18 L100 21 L97 29 L94 21 L86 18 L94 15 Z" fill="#ffa94d"/>`)}
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
    {raw(`<rect x="22" y="25" width="36" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="3" transform="rotate(10 40 50)"/><rect x="62" y="25" width="36" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="3" transform="rotate(-10 80 50)"/><circle cx="60" cy="50" r="20" fill="#232328" stroke="#ffa94d" stroke-width="3"/><text x="60" y="56" font-family="inherit" font-weight="800" font-size="15" fill="currentColor" text-anchor="middle">VS</text>`)}
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

/* rating star: the one solid glyph — a filled five-point star with rounded
   joins, for the poster rating badge. Sizes to 1em so it scales with the
   badge text; fill is currentColor so it takes the badge's ink color. */
export const IconStar: FC<{ class?: string }> = ({ class: cls }) => (
  <svg class={cls} width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.6l2.74 5.55 6.13.9-4.44 4.32 1.05 6.11L12 16.69l-5.48 2.79 1.05-6.11L3.13 9.05l6.13-.9z"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
    />
  </svg>
);

/* badge star: a fuller, friendlier five-point star with softly rounded points —
   the chunky cut for the poster rating chip (.card-rating). Heavier inner radius
   than IconStar so it reads as a bold mark beside the score, streaming-app style. */
export const IconStarBadge: FC<{ class?: string }> = ({ class: cls }) => (
  <svg class={cls} width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 3 14.82 9.12 21.51 9.91 16.57 14.48 17.88 21.09 12 17.8 6.12 21.09 7.43 14.48 2.49 9.91 9.18 9.12Z"
      fill="currentColor"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linejoin="round"
    />
  </svg>
);

/* play: the broadcast triangle in a ring, same line weight as the faces */
export const IconPlay: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
    <path d="M10 8.6l5.4 3.4-5.4 3.4z" fill="currentColor" stroke="currentColor" stroke-linejoin="round" />
  </svg>
);

/* poster / trailer overlay: thick white ring + semi-transparent play triangle */
export const IconPlayDisc: FC<{ size?: number; class?: string }> = ({ size = 44, class: cls }) => (
  <svg class={cls} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <circle cx="24" cy="24" r="19.5" fill="none" stroke="#fff" stroke-opacity="0.88" stroke-width="3.5" />
    <path
      d="M18.4 14.2v19.6l15.2-9.8z"
      fill="#fff"
      fill-opacity="0.55"
      stroke="#fff"
      stroke-opacity="0.55"
      stroke-width="0.75"
      stroke-linejoin="round"
    />
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

export const FaceAwful: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg class="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" />
    <circle cx="8.8" cy="9.8" r="1.15" fill="currentColor" />
    <circle cx="15.2" cy="9.8" r="1.15" fill="currentColor" />
    {/* downturned mouth — the only face whose curve dips at the corners */}
    <path
      d="M8.3 16c1-2 2.4-3 3.7-3s2.7 1 3.7 3"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
    />
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

/* ---- social / external brand marks (used on person pages) ---- */
/* IMDb keeps its own identity — the yellow wordmark badge */
export const IconIMDb: FC<{ size?: number }> = ({ size = 22 }) => (
  <svg width={size * 1.6} height={size} viewBox="0 0 64 32" aria-hidden="true">
    <rect width="64" height="32" rx="6" fill="#f5c518" />
    <text
      x="32"
      y="22"
      text-anchor="middle"
      font-family="Archivo, Helvetica, Arial, sans-serif"
      font-size="16"
      font-weight="800"
      letter-spacing="-0.5"
      fill="#000"
    >
      IMDb
    </text>
  </svg>
);
export const IconInstagram: FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="1.8" />
    <circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8" />
    <circle cx="17.2" cy="6.8" r="1.3" fill="currentColor" />
  </svg>
);
export const IconX: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M3 3h4.6l5 6.7L18.2 3H21l-7.1 8.3L21.6 21H17l-5.3-7.1L5.5 21H2.7l7.5-8.7L3 3z"
      fill="currentColor"
    />
  </svg>
);
export const IconTikTok: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M16.6 3h-2.9v11.65a2.62 2.62 0 1 1-2.62-2.62c.26 0 .5.04.74.11V9.18A5.6 5.6 0 1 0 16.74 14.6V8.86a6.95 6.95 0 0 0 4.16 1.38V7.32a4.18 4.18 0 0 1-3.03-1.3A4.18 4.18 0 0 1 16.6 3z"
      fill="currentColor"
    />
  </svg>
);
export const IconFacebook: FC<{ size?: number }> = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M13.5 21v-8h2.6l.4-3.1h-3V7.9c0-.9.25-1.5 1.55-1.5H16.6V3.65A21 21 0 0 0 14.3 3.5c-2.27 0-3.8 1.39-3.8 3.94v2.46H7.9V13h2.6v8h3z"
      fill="currentColor"
    />
  </svg>
);
export const IconGlobe: FC<{ size?: number }> = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
    <path
      d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"
      stroke="currentColor"
      stroke-width="1.8"
      fill="none"
    />
  </svg>
);
