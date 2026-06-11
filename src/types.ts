// Shared row shapes and app context. The D1 mirror's tables, typed.
import type { Context } from "hono";
import type { SyncEnv } from "./sync";

export type Bindings = SyncEnv;
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
