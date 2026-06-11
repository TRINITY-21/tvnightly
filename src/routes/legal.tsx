import { Hono } from "hono";
import { Bindings } from "../types";
import { canonical } from "../lib/seo";
import { Layout } from "../components/Layout";

const app = new Hono<{ Bindings: Bindings }>();

// ----------------------------------------------------------------- legal

app.get("/terms", (c) =>
  c.html(
    <Layout title="Terms of Service | TV Nightly" canonical={canonical(c)}>
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
        <a href="https://www.tvmaze.com">TVmaze.com</a>, CC BY-SA) and is provided "as is" without
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
    <Layout title="Privacy Policy | TV Nightly" canonical={canonical(c)}>
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

export default app;
