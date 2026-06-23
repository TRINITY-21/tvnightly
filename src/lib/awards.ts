// Editorial Emmy tracker pages — category slugs resolve against D1 at render time.
// Nominee lists are curated editorially and updated each awards season.

export interface EmmyCategory {
  name: string;
  /** Show slugs we expect in the mirror; missing titles are skipped silently. */
  slugs: string[];
  note?: string;
}

export interface EmmySeason {
  year: number;
  ceremony: string;
  intro: string;
  categories: EmmyCategory[];
}

export type AwardsSeason = EmmySeason;

const EMMY_SEASONS: Record<number, EmmySeason> = {
  2026: {
    year: 2026,
    ceremony: "78th Primetime Emmy Awards",
    intro:
      "The 2026 Emmy race is shaping up around the same prestige dramas and half-hour standouts that dominate our ratings charts — Severance, The Bear, Shōgun, and the returning HBO giants. We track every frontrunner with episode rankings, renewal status, and where to stream each contender in your country.",
    categories: [
      {
        name: "Outstanding Drama Series",
        slugs: [
          "severance",
          "the-bear",
          "slow-horses",
          "shogun",
          "house-of-the-dragon",
          "the-last-of-us",
          "yellowjackets",
          "andor",
        ],
        note: "Drama series with the strongest viewer ratings and buzz heading into nominations.",
      },
      {
        name: "Outstanding Comedy Series",
        slugs: [
          "the-bear",
          "ted-lasso",
          "abbott-elementary",
          "hacks",
          "only-murders-in-the-building",
          "what-we-do-in-the-shadows",
          "brooklyn-nine-nine",
        ],
        note: "Half-hours that cleared the comedy bar — some straddle drama categories in real life.",
      },
      {
        name: "Outstanding Limited or Anthology Series",
        slugs: [
          "the-white-lotus",
          "fargo",
          "true-detective",
          "beef",
          "monarch-legacy-of-monsters",
          "the-night-manager",
        ],
      },
      {
        name: "Outstanding Lead Actor — Drama",
        slugs: ["slow-horses", "severance", "shogun", "the-last-of-us", "mr-robot"],
        note: "Shows carrying a single lead performance — open the show page for cast and episode peaks.",
      },
      {
        name: "Outstanding Lead Actress — Drama",
        slugs: ["severance", "yellowjackets", "the-crown", "outlander", "the-killing"],
      },
    ],
  },
};

const GOLDEN_GLOBE_SEASONS: Record<number, EmmySeason> = {
  2026: {
    year: 2026,
    ceremony: "83rd Golden Globe Awards",
    intro:
      "The 2026 Golden Globe race spans prestige TV and the year's biggest films — The Bear, Shōgun, Anora, and the streaming dramas that dominated the fall. We track every frontrunner with ratings, episode guides, and where to stream each contender in your country.",
    categories: [
      {
        name: "Best Television Series — Drama",
        slugs: [
          "severance",
          "slow-horses",
          "shogun",
          "the-last-of-us",
          "yellowjackets",
          "house-of-the-dragon",
          "andor",
        ],
      },
      {
        name: "Best Television Series — Musical or Comedy",
        slugs: [
          "the-bear",
          "hacks",
          "abbott-elementary",
          "only-murders-in-the-building",
          "what-we-do-in-the-shadows",
          "ted-lasso",
        ],
      },
      {
        name: "Best Limited Series, Anthology Series, or TV Movie",
        slugs: [
          "the-white-lotus",
          "beef",
          "fargo",
          "true-detective",
          "the-night-manager",
          "monarch-legacy-of-monsters",
        ],
      },
      {
        name: "Best Performance in a TV Series — Drama",
        slugs: ["severance", "slow-horses", "shogun", "the-last-of-us", "mr-robot"],
        note: "Lead performances on the drama series above — open each show for cast and peak episodes.",
      },
      {
        name: "Best Performance in a TV Series — Musical or Comedy",
        slugs: ["the-bear", "hacks", "abbott-elementary", "only-murders-in-the-building", "ted-lasso"],
      },
    ],
  },
};

export function emmySeason(year: number): EmmySeason | null {
  return EMMY_SEASONS[year] ?? null;
}

export function goldenGlobeSeason(year: number): EmmySeason | null {
  return GOLDEN_GLOBE_SEASONS[year] ?? null;
}
