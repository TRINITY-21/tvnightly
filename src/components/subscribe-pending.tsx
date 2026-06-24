// Post-signup "check your inbox" page — the moment right after a subscribe POST.
// Shows the exact address, the exact subject line to look for, the three steps,
// and a "didn't get it" path, so the double-opt-in confirm rate stays high.
import { FC } from "hono/jsx";
import { Layout } from "./Layout";
import { IconMail } from "./icons";

export const SubscribePending: FC<{
  email: string;
  /** Matches the email subject "Confirm: {what}" so people know what to look for. */
  what: string;
  /** What they'll actually get once confirmed. */
  getsLine: string;
}> = ({ email, what, getsLine }) => (
  <Layout title="Almost there | TV Nightly" noindex>
    <div class="confirm-pending">
      <span class="confirm-icon">
        <IconMail size={34} />
      </span>
      <h1 class="confirm-h1">Almost there</h1>
      <p class="confirm-lead">
        We just emailed a confirmation link to <strong class="confirm-email">{email}</strong>. One tap and
        your alerts are live — nothing sends until you confirm.
      </p>

      <ol class="confirm-steps">
        <li>
          <span class="confirm-step-n">1</span>
          <span>
            Open the email — subject <strong>“Confirm: {what}”</strong> from <strong>TV Nightly</strong>{" "}
            <span class="muted">(alerts@tvnightly.com)</span>.
          </span>
        </li>
        <li>
          <span class="confirm-step-n">2</span>
          <span>
            Tap <strong>Confirm subscription</strong>.
          </span>
        </li>
        <li>
          <span class="confirm-step-n">3</span>
          <span>You're in — {getsLine}</span>
        </li>
      </ol>

      <p class="confirm-note muted">
        Didn't get it? Check your spam or Promotions tab — it can take a minute to arrive. Still nothing?
        Re-enter your email on the page you came from and we'll resend it.
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
