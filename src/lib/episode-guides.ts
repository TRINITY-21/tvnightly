import guidesData from "../../data/episode-guides.json";

export interface EpisodeGuide {
  slug: string;
  showSlug: string;
  h1: string;
  title: string;
  description: string;
  intro: string;
}
export const EPISODE_GUIDES = guidesData as EpisodeGuide[];
export const EPISODE_GUIDE_BY_SLUG = new Map(EPISODE_GUIDES.map((g) => [g.slug, g]));
export const EPISODE_GUIDE_BY_SHOW = new Map(EPISODE_GUIDES.map((g) => [g.showSlug, g]));
