// Editorial voice — original blurbs that render on show hubs and ranking pages.
import { FC } from "hono/jsx";

export const ShowBlurb: FC<{ text: string }> = ({ text }) => (
  <aside class="blurb">
    <span class="blurb-label">The TV Nightly take</span>
    <p>{text}</p>
  </aside>
);
