// 404 — "Off air": the Standby Glow tube with no signal, a search to get
// back on track, and the night's most-used doors. Rendered by app.notFound.
import { FC } from "hono/jsx";
import { Layout } from "./Layout";

const DESTINATIONS: [string, string][] = [
  ["Tonight's schedule", "/tonight"],
  ["What to watch", "/what-to-watch"],
  ["Top TV shows", "/top/tv"],
  ["Top movies", "/movies/best"],
  ["Browse everything", "/lists"],
];

export const NotFoundPage: FC = () => (
  <Layout
    title="Page not found | TV Nightly"
    description="That page is off air. Search TV Nightly or jump back to tonight's lineup."
    noindex
  >
    <section class="nf">
      {/* the screen: powered tube, no signal, standby LED still lit */}
      <div class="nf-screen" aria-hidden="true">
        <span class="nf-scan"></span>
        <span class="nf-sweep"></span>
        <p class="nf-screen-label">No signal</p>
        <p class="nf-code">404</p>
        <span class="nf-led"></span>
      </div>

      <div class="nf-copy">
        <p class="nf-eyebrow">Page not found</p>
        <h1 class="nf-title">We lost the signal</h1>
        <p class="nf-lead">
          That page isn&apos;t in tonight&apos;s lineup — it may have moved, wrapped, or never
          aired. Let&apos;s get you back to something worth watching.
        </p>

        <form class="nf-search" action="/search" method="get" role="search">
          <input
            type="search"
            name="q"
            placeholder="Search shows, movies, people"
            aria-label="Search shows, movies and people"
            autocomplete="off"
            spellcheck={false}
            required
          />
          <button type="submit">Search</button>
        </form>

        <nav class="nf-links" aria-label="Popular destinations">
          {DESTINATIONS.map(([label, href]) => (
            <a class="nf-link" href={href}>
              {label}
            </a>
          ))}
        </nav>

        <a class="nf-home" href="/">
          Back to home
        </a>
      </div>
    </section>
  </Layout>
);
