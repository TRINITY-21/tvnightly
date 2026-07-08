// Post-signup "you're in" page — single opt-in, so the subscription is live the
// moment the POST lands. Confirms the exact address, says what arrives next, and
// notes the welcome email (whose unsubscribe link doubles as the escape hatch).
import { FC } from "hono/jsx";
import { Layout } from "./Layout";
import { IconMail } from "./icons";

export const SubscribeWelcome: FC<{
  email: string;
  /** What they subscribed to, e.g. "the TV Nightly daily email". */
  what: string;
  /** What they'll actually get. */
  getsLine: string;
}> = ({ email, what, getsLine }) => (
  <Layout title="You're in | TV Nightly" noindex>
    <div class="confirm-pending">
      <span class="confirm-icon">
        <IconMail size={34} />
      </span>
      <h1 class="confirm-h1">You're in</h1>
      <p class="confirm-lead">
        <strong class="confirm-email">{email}</strong> is now subscribed to <strong>{what}</strong> —{" "}
        {getsLine}
      </p>

      <p class="confirm-note muted">
        We've sent a welcome email so you know what to look for — if it landed in spam or Promotions,
        drag it to your inbox so the good stuff doesn't get lost. Every email has a one-tap
        unsubscribe link, so you can leave any time.
      </p>

      <p>
        <a class="msg-back" href="/">
          <span class="chev-icon chev-icon-prev" aria-hidden="true"></span>
          Back to TV Nightly
        </a>
      </p>
    </div>
  </Layout>
);
