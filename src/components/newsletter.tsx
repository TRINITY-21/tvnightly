// Homepage newsletter band — the daily "what's on tonight" email capture, in
// the brand's amber-on-dark voice (not a borrowed teal bar).
import { FC } from "hono/jsx";
import { Honeypot } from "./Layout";
import { IconMail } from "./icons";

export const NewsletterBand: FC = () => (
  <section class="news-band" aria-labelledby="news-band-title">
    <div class="news-band-inner">
      <span class="news-band-glow" aria-hidden="true"></span>
      <div class="news-band-copy">
        <p class="news-band-kicker">
          <IconMail size={15} />
          The TV Nightly newsletter
        </p>
        <h2 class="news-band-title" id="news-band-title">
          Tonight&apos;s best TV, in your inbox
        </h2>
        <p class="news-band-sub">
          One short email each evening — what&apos;s on, ranked, and actually worth your time.
        </p>
      </div>
      <div class="news-band-action">
        <form action="/subscribe" method="post" class="news-band-form">
          <input type="hidden" name="kind" value="daily" />
          <input
            type="email"
            name="email"
            placeholder="you@example.com"
            required
            autocomplete="email"
            aria-label="Email address"
          />
          <button type="submit">Sign up free</button>
          <Honeypot />
        </form>
        <p class="news-band-fine">Free · one email · unsubscribe anytime</p>
      </div>
    </div>
  </section>
);
