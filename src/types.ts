// Shared row shapes and app context. The D1 mirror's tables, typed.
import type { Context } from "hono";
import type { SyncEnv } from "./sync";

// ASSETS: the static-assets fetcher — the chart export embeds the Archivo
// woff2 from it so saved SVGs are standalone documents.
// CF_BEACON_TOKEN: Cloudflare Web Analytics token (public); when set, Layout
// renders the beacon. Unset locally so dev pages stay clean.
// AMAZON_ASSOC_TAG / APPLE_AFFILIATE_TOKEN: affiliate ids (public); when set,
// Prime Video / Apple TV "watch" links carry them. Empty = plain links.
export type Bindings = SyncEnv & {
  ASSETS: Fetcher;
  CF_BEACON_TOKEN?: string;
  GTM_ID?: string; // Google Tag Manager container (public); when set, Layout injects GTM
  AMAZON_ASSOC_TAG?: string;
  APPLE_AFFILIATE_TOKEN?: string;
  // where /feedback submissions are emailed; falls back to EMAIL_FROM. Unset = D1 only.
  FEEDBACK_TO?: string;
  // Reply-To on outbound mail — a monitored inbox so replies reach a human, not the
  // alerts sender. Forwarded to the team inbox via Cloudflare Email Routing.
  EMAIL_REPLY_TO?: string;
  // Basic-auth password for /admin/* (username "admin"). Unset = admin disabled.
  ADMIN_KEY?: string;
  // Workers Rate Limiting (account-local, best-effort, per-colo; see wrangler.jsonc).
  // FEEDBACK_LIMIT throttles the public /feedback write+email; ADMIN_LIMIT throttles
  // failed /admin auth. Optional so an unconfigured env degrades quietly.
  FEEDBACK_LIMIT?: RateLimiter;
  ADMIN_LIMIT?: RateLimiter;
  // Cloudflare Turnstile anti-spam on /feedback. TURNSTILE_SITE_KEY is public
  // (rendered into the form); TURNSTILE_SECRET_KEY is a secret (server siteverify).
  // Both unset = widget hidden and the check skipped (honeypot + rate limit remain).
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
};
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
export type AppContext = Context<{ Bindings: Bindings }>;

export interface ShowRow {
  id: number;
  slug: string;
  name: string;
  status: string | null;
  premiered: string | null;
  ended: string | null;
  network: string | null;
  web_channel: string | null;
  rating: number | null;
  weight: number;
  image_url: string | null;
  poster_url: string | null; // TMDB top-voted one-sheet (w342 URL); image_url is the fallback
  summary: string | null;
  imdb_id: string | null;
  blurb: string | null;
  genres: string | null; // JSON string array, e.g. '["Drama","Crime"]'
  runtime: number | null;
  cast_json: string | null; // JSON array: {n: name, c: character, img: headshot}
  providers_intl: string | null; // JSON object: country code -> service names
  tmdb_id: number | null; // bridged from TVmaze external ids (provider patrol)
  type: string | null; // TVmaze classification: Scripted, Animation, Reality, Talk Show, News, …
}

export interface EpisodeRow {
  id: number;
  show_id: number;
  season: number | null;
  number: number | null;
  name: string | null;
  airdate: string | null;
  airstamp: string | null;
  runtime: number | null;
  rating: number | null;
  image_url: string | null;
  summary: string | null;
}

export type TonightRow = EpisodeRow & {
  show_name: string;
  show_slug: string;
  network: string | null;
  show_poster: string | null;
  show_image: string | null;
};

export interface MovieRow {
  imdb_id: string;
  slug: string;
  title: string;
  year: number | null;
  release_date: string | null;
  overview: string | null;
  genres: string | null; // JSON string array
  runtime: number | null;
  rating: number | null;
  votes: number | null;
  popularity: number | null;
  poster_url: string | null;
  tmdb_id: number | null;
  providers: string | null; // JSON string array of US streaming services
  providers_intl: string | null; // JSON object: country code -> service names
}

export interface CastEntry {
  id?: number; // TVmaze person id — present after the v3 backfill
  n: string;
  c: string | null;
  img: string | null;
  b?: string; // birthday YYYY-MM-DD
  d?: string; // deathday
  cn?: string; // country
  v?: boolean; // voice role
}

export interface PersonRow {
  id: number;
  name: string;
  birthday: string | null;
  deathday: string | null;
  country: string | null;
  image_url: string | null;
  bio: string | null;
  birthplace: string | null;
  known_dept: string | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  homepage: string | null;
  socials: string | null; // JSON {ig, tw}
}

export interface EventRow {
  type: string;
  season: number | null;
  old_value: string | null;
  new_value: string | null;
  detected_at: number;
  name: string;
  slug: string;
}
