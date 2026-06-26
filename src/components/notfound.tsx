// 404 / 500 — "Off air" Standby Glow tube: no signal, search to get back on
// track, and the night's most-used doors. Rendered by app.notFound / app.onError.
import { FC } from "hono/jsx";
import { Layout } from "./Layout";

const DESTINATIONS: [string, string][] = [
  ["Tonight's schedule", "/tonight"],
  ["What to watch", "/what-to-watch"],
  ["Top TV shows", "/top/tv"],
  ["Top movies", "/movies/best"],
  ["Browse everything", "/lists"],
];

type StandbyVariant = "404" | "500";

const STANDBY: Record<
  StandbyVariant,
  {
    title: string;
    description: string;
    screenLabel: string;
    code: string;
    eyebrow: string;
    heading: string;
    lead: string;
  }
> = {
  "404": {
    title: "Page not found | TV Nightly",
    description: "That page is off air. Search TV Nightly or jump back to tonight's lineup.",
    screenLabel: "No signal",
    code: "404",
    eyebrow: "Page not found",
    heading: "We lost the signal",
    lead:
      "That page isn't in tonight's lineup — it may have moved, wrapped, or never aired. Let's get you back to something worth watching.",
  },
  "500": {
    title: "Something went wrong | TV Nightly",
    description: "A glitch on our end. Refresh, or jump back to tonight's lineup.",
    screenLabel: "Signal dropped",
    code: "500",
    eyebrow: "Something went wrong",
    heading: "A glitch on our end",
    lead:
      "That wasn't you — something broke while loading this page. Try a refresh, or head somewhere that's definitely on the air.",
  },
};

const StandbyPage: FC<{ variant: StandbyVariant }> = ({ variant }) => {
  const v = STANDBY[variant];
  return (
    <Layout noSidebar title={v.title} description={v.description} noindex>
      <section class="nf">
        <div class="nf-screen" aria-hidden="true">
          <span class="nf-scan"></span>
          <span class="nf-sweep"></span>
          <p class="nf-screen-label">{v.screenLabel}</p>
          <p class="nf-code">{v.code}</p>
          <span class="nf-led"></span>
        </div>

        <div class="nf-copy">
          <p class="nf-eyebrow">{v.eyebrow}</p>
          <h1 class="nf-title">{v.heading}</h1>
          <p class="nf-lead">{v.lead}</p>

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
};

export const NotFoundPage: FC = () => <StandbyPage variant="404" />;

export const ErrorPage: FC = () => <StandbyPage variant="500" />;
