// ShareBar — a single "Share" control. With JS it opens the native OS share
// sheet (navigator.share); where that doesn't exist (desktop Firefox, some
// Chrome) it falls back to copying the link, so the one button always works.
// Server ships it hidden — the URL is still shareable from the address bar.
// Icon is stroke-based / currentColor, in the same line voice as components/icons.tsx.
import { FC } from "hono/jsx";

const IconShare: FC = () => (
  <svg class="icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    <path d="M8.4 7 12 3.4 15.6 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M6 11H5.2A1.7 1.7 0 0 0 3.5 12.7v6.1A1.7 1.7 0 0 0 5.2 20.5h13.6a1.7 1.7 0 0 0 1.7-1.7v-6.1A1.7 1.7 0 0 0 18.8 11H18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

export const ShareBar: FC<{
  /** Absolute URL to share. */
  url: string;
  /** Share title / text. */
  title: string;
}> = ({ url, title }) => (
  <div class="share-bar" hidden data-share-url={url} data-share-title={title}>
    <button type="button" class="share-btn share-native" data-copied="Link copied">
      <IconShare />
      <span class="share-btn-t">Share</span>
    </button>
  </div>
);
