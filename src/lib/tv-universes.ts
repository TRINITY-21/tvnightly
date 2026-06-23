import tvUniversesData from "../../data/tv-universes.json";

export interface TvUniverseEntry {
  showSlug: string;
  order: number;
  note?: string;
}
export interface TvUniverse {
  slug: string;
  name: string;
  aka?: string;
  intro: string;
  entries: TvUniverseEntry[];
}
export const TV_UNIVERSES = tvUniversesData as TvUniverse[];
export const TV_UNIVERSE_BY_SLUG = new Map(TV_UNIVERSES.map((u) => [u.slug, u]));
