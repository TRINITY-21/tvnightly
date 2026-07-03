// Discord community invite — public URL from wrangler vars (DISCORD_INVITE_URL).
let inviteUrl: string | undefined;

/** Wire the invite URL once per request (see index.tsx middleware). */
export const setDiscordInvite = (url?: string) => {
  const trimmed = url?.trim();
  inviteUrl = trimmed || undefined;
};

export const getDiscordInvite = (): string | undefined => inviteUrl;
