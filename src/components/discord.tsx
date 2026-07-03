import { FC } from "hono/jsx";
import { getDiscordInvite } from "../lib/discord";
import { IconDiscord } from "./icons";

export const DiscordJoinButton: FC<{ class?: string; label?: string }> = ({
  class: className = "",
  label = "Join Discord",
}) => {
  const url = getDiscordInvite();
  if (!url) return null;
  return (
    <a
      class={`discord-join-btn ${className}`.trim()}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      <IconDiscord size={20} />
      <span>{label}</span>
    </a>
  );
};

/** Right-rail community card — matches the welcome-modal voice. */
export const DiscordSidebarCard: FC = () => {
  const url = getDiscordInvite();
  if (!url) return null;
  return (
    <section class="side-card side-discord" aria-labelledby="side-discord-title">
      <div class="discord-card-hero" aria-hidden="true"></div>
      <div class="discord-card-body">
        <h2 class="discord-card-title" id="side-discord-title">
          Join our Discord
        </h2>
        <p class="discord-card-dek">
          Chat with movie lovers, get updates, and share what you&apos;re watching.
        </p>
        <DiscordJoinButton />
      </div>
    </section>
  );
};

/** First-visit welcome modal — revealed by /js/discord-modal.js. */
export const DiscordWelcomeModal: FC = () => {
  const url = getDiscordInvite();
  if (!url) return null;
  return (
    <div id="discord-welcome" class="discord-modal" hidden role="presentation">
      <div
        class="discord-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discord-welcome-title"
      >
        <button type="button" class="discord-modal-x" data-discord-close aria-label="Close">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <div class="discord-modal-hero" aria-hidden="true"></div>
        <div class="discord-modal-body">
          <h2 class="discord-modal-title" id="discord-welcome-title">
            Join our Discord
          </h2>
          <p class="discord-modal-dek">
            Chat with movie lovers, get updates, and share what you&apos;re watching.
          </p>
          <DiscordJoinButton label="Join Discord" />
        </div>
      </div>
    </div>
  );
};
