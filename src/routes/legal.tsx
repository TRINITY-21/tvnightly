import { Hono } from "hono";
import { Bindings, HonoEnv } from "../types";
import { aboutPageLd, canonical, origin } from "../lib/seo";
import { Layout } from "../components/Layout";

const app = new Hono<HonoEnv>();

// ----------------------------------------------------------------- legal

app.get("/terms", (c) =>
  c.html(
    <Layout c={c}
      title="Terms of Service | TV Nightly"
      description="The terms for using TV Nightly: what we provide, acceptable use, email alerts, data sourcing and attribution, and liability."
      canonical={canonical(c)}
    >
      <h1>Terms of Service</h1>
      <p class="muted">Last updated: June 10, 2026</p>
      <p>
        By using TV Nightly ("the site") you agree to these terms. If you do not agree, please do
        not use the site.
      </p>
      <h2>What we provide</h2>
      <p>
        TV Nightly provides TV schedule, episode, and renewal information for personal,
        informational purposes only. Data is sourced from third parties (primarily{" "}
        <a href="https://www.tvmaze.com" rel="noopener">TVmaze.com</a>, CC BY-SA) and is provided "as is" without
        warranty of accuracy, completeness, or timeliness. Air dates and statuses change without
        notice.
      </p>
      <h2>Acceptable use</h2>
      <p>
        You may not scrape the site at abusive rates, attempt to disrupt the service, or use it for
        unlawful purposes. Rankings and data derived from TVmaze are reusable under CC BY-SA with
        attribution.
      </p>
      <h2>Email alerts</h2>
      <p>
        Alert subscriptions are double opt-in and you can unsubscribe at any time via the link in
        every email. We may discontinue alerts at any time.
      </p>
      <h2>Liability</h2>
      <p>
        To the maximum extent permitted by law, TV Nightly is not liable for any damages arising
        from use of the site or reliance on its data.
      </p>
      <h2>Changes</h2>
      <p>We may update these terms; continued use after changes constitutes acceptance.</p>
    </Layout>,
  ),
);

app.get("/privacy", (c) =>
  c.html(
    <Layout c={c}
      title="Privacy Policy | TV Nightly"
      description="How TV Nightly handles your data: what we collect, anonymous community ratings, email subscriptions, cookies and analytics, and your choices."
      canonical={canonical(c)}
    >
      <h1>Privacy Policy</h1>
      <p class="muted">Last updated: June 10, 2026</p>
      <h2>What we collect</h2>
      <p>
        <strong>Email addresses</strong> you submit for show alerts or the daily email — used only
        to send what you signed up for. Subscriptions are double opt-in; every email includes an
        unsubscribe link that deletes your address for that list.
      </p>
      <p>
        <strong>Aggregate analytics</strong> via Cloudflare Web Analytics — privacy-first,
        cookie-less, and not tied to your identity. We do not use tracking cookies and we do not
        sell or share personal data.
      </p>
      <h2>Local storage</h2>
      <p>
        After you vote on an episode, a small flag is kept in your browser's local storage purely
        to prevent double-voting. It contains no identity, is never transmitted, and clearing your
        browser data removes it.
      </p>
      <h2>Advertising</h2>
      <p>
        If we introduce advertising, this policy will be updated first, and any ad partner's
        cookie/consent requirements will be disclosed here.
      </p>
      <h2>Contact</h2>
      <p>Questions or deletion requests: contact@tvnightly.com.</p>
    </Layout>,
  ),
);

// ------------------------------------------------------------- about / E-E-A-T

app.get("/about", (c) =>
  c.html(
    <Layout c={c}
      title="About TV Nightly — independent TV & movie guide"
      description="TV Nightly is an independent guide to what's worth watching tonight: episode rankings, release dates, renewal status and where to stream."
      canonical={canonical(c)}
      ld={[aboutPageLd(origin(c))]}
    >
      <h1>About TV Nightly</h1>
      <p>
        TV Nightly is an independent guide built to answer one question well:{" "}
        <strong>what's worth watching tonight?</strong> We track episode rankings, season release
        dates, renewal status, cast and crew, and where every title streams — refreshed around the
        clock and localized to your country.
      </p>
      <h2>Independent and reader-first</h2>
      <p>
        We are not affiliated with any network, studio, or streaming service, and no one pays us for
        placement or coverage. Rankings come from data and from our readers — never from a sales
        deal. How that works is spelled out in our{" "}
        <a href="/editorial-policy">editorial and independence policy</a>.
      </p>
      <h2>Where our data comes from</h2>
      <p>
        Show, episode, and schedule information is sourced primarily from{" "}
        <a href="https://www.tvmaze.com" rel="noopener">
          TVmaze
        </a>{" "}
        (CC BY-SA); film data, cast, and streaming availability from{" "}
        <a href="https://www.themoviedb.org" rel="noopener">
          TMDB
        </a>
        . Air times are converted to your local timezone, and streaming availability is checked
        continuously so "where to watch" stays current. The full method is on our{" "}
        <a href="/how-we-pick">how we pick &amp; rank</a> page.
      </p>
      <h2>What you'll find here</h2>
      <p>
        Start with the <a href="/best-episodes">best episodes of every show</a>, get a{" "}
        <a href="/recommend">personalized recommendation</a>, see <a href="/tonight">what's on tonight</a>,
        or <a href="/lists">browse the full directory</a> of shows, movies, genres, and networks.
      </p>
      <h2>Contact</h2>
      <p>
        Spotted an error or have a suggestion? <a href="/feedback">Send feedback</a> or email{" "}
        contact@tvnightly.com — we read everything.
      </p>
    </Layout>,
  ),
);

app.get("/how-we-pick", (c) =>
  c.html(
    <Layout c={c}
      title="How we pick & rank — TV Nightly methodology"
      description="How TV Nightly ranks episodes, builds recommendations, and tracks where to stream — using episode-level ratings, anonymous community verdicts, and continuously refreshed data."
      canonical={canonical(c)}
    >
      <h1>How we pick &amp; rank</h1>
      <p>
        Every ranking and recommendation on TV Nightly is built from data, not opinion-for-hire.
        Here's exactly how the pages you read are put together.
      </p>
      <h2>Episode rankings</h2>
      <p>
        Our <a href="/best-episodes">best</a> and worst-episode lists are ordered by aggregated,
        episode-level audience ratings from TVmaze, weighted so that an episode needs a meaningful
        number of votes before it can top a list. That keeps a single outlier rating from distorting
        a show's standout episodes.
      </p>
      <h2>Community verdicts</h2>
      <p>
        Readers can rate any title <em>Loved</em>, <em>Good</em>, <em>Meh</em>, or <em>Awful</em>.
        These verdicts are anonymous — there are no accounts, and we record only an irreversibly
        hashed fingerprint to keep one rating per person per title. They power the agreement line you
        see on each title ("X% of N raters loved or liked this") and feed the recommender below. Star
        ratings shown in search results, where present, are drawn only from these first-party
        verdicts — never republished from third-party sources.
      </p>
      <h2>Personalized recommendations</h2>
      <p>
        The <a href="/recommend">recommendation flow</a> asks you to rate a few things you've seen.
        Each verdict becomes a signed weight across genres and eras — a <em>Loved</em> pulls toward
        its qualities, an <em>Awful</em> pulls away — and we pick your next watch from the highest
        net match. Your rating trail lives in the page URL, so it's shareable and never stored to an
        account.
      </p>
      <h2>"Best of", "underrated" &amp; "similar" pages</h2>
      <p>
        Year-based and genre guides combine rating strength with popularity thresholds so a list is
        both well-reviewed and substantial; "underrated" inverts that to surface high-rated titles
        with smaller audiences. <a href="/compare">Similar and head-to-head</a> pages are matched on
        genre, era, cast, and reception.
      </p>
      <h2>Where to stream</h2>
      <p>
        Streaming availability comes from TMDB and is localized to your country. A background check
        runs continuously, so a title moving on or off a service is reflected quickly on its page and
        in <a href="/whats-new">what's new on streaming</a>.
      </p>
      <h2>Freshness &amp; corrections</h2>
      <p>
        The catalog is fetched live, so titles and details are always current; schedules, ratings and
        streaming availability for tracked shows refresh on a continuous loop. If something's wrong,{" "}
        <a href="/feedback">tell us</a> and we'll fix it.
      </p>
    </Layout>,
  ),
);

app.get("/editorial-policy", (c) =>
  c.html(
    <Layout c={c}
      title="Editorial & independence policy | TV Nightly"
      description="TV Nightly's editorial standards: no paid placement, transparent affiliate disclosure, algorithmic and community-driven rankings, and how we handle accuracy and corrections."
      canonical={canonical(c)}
    >
      <h1>Editorial &amp; independence policy</h1>
      <p class="muted">Last updated: June 17, 2026</p>
      <h2>No paid placement</h2>
      <p>
        No network, studio, or streaming service can pay to appear, rank higher, or be recommended
        on TV Nightly. Rankings are produced algorithmically from public ratings data and our
        readers' <a href="/how-we-pick">community verdicts</a>. We accept no sponsored rankings,
        "pay-to-play" lists, or undisclosed promotional content.
      </p>
      <h2>Affiliate disclosure</h2>
      <p>
        Some outbound "watch" links may be affiliate-tagged — currently Amazon Prime Video (Amazon
        Associates) and Apple TV. If you start a subscription or purchase through one of those links,
        we may earn a small commission at no extra cost to you. Most providers (including Netflix,
        Max, Disney+, and Hulu) run no such program and are plain links. Affiliate relationships{" "}
        <strong>never</strong> influence our rankings, recommendations, or which services we show —
        availability is determined purely by where a title actually streams.
      </p>
      <h2>Accuracy &amp; corrections</h2>
      <p>
        Our data is aggregated from third parties (primarily{" "}
        <a href="https://www.tvmaze.com" rel="noopener">
          TVmaze
        </a>{" "}
        and{" "}
        <a href="https://www.themoviedb.org" rel="noopener">
          TMDB
        </a>
        ) and is provided as-is; release dates and statuses change without notice. We refresh
        continuously and correct errors promptly when they're reported. Found one?{" "}
        <a href="/feedback">Let us know</a>.
      </p>
      <h2>Automation &amp; transparency</h2>
      <p>
        Rankings, similarity matches, and short factual summaries are generated from structured data
        and reader verdicts rather than written as paid reviews. We aim to make the basis for every
        list legible — that's the point of our <a href="/how-we-pick">methodology page</a>.
      </p>
      <h2>Privacy</h2>
      <p>
        We collect as little as possible and use privacy-first, cookieless analytics. Details are in
        our <a href="/privacy">privacy policy</a>.
      </p>
    </Layout>,
  ),
);

export default app;
