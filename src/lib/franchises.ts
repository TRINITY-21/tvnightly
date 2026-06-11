// Franchise watch-order data, indexed by slug and by member title.
import franchisesData from "../../data/franchises.json";

export interface FranchiseEntry {
  title: string;
  year: number;
  chrono: number;
  note?: string;
}
export interface Franchise {
  slug: string;
  name: string;
  aka?: string;
  intro: string;
  chronoNote?: string;
  entries: FranchiseEntry[];
}
export const FRANCHISES = franchisesData as Franchise[];
export const FRANCHISE_BY_SLUG = new Map(FRANCHISES.map((f) => [f.slug, f]));
// Reverse index for movie pages: "title|year" -> franchise (year fuzz handled at lookup).
export const FRANCHISE_OF_TITLE = new Map<string, { slug: string; name: string }>();
for (const f of FRANCHISES) {
  for (const e of f.entries) {
    FRANCHISE_OF_TITLE.set(`${e.title.toLowerCase()}|${e.year}`, { slug: f.slug, name: f.name });
  }
}
export const franchiseOfMovie = (m: { title: string; year: number | null }) =>
  m.year
    ? (FRANCHISE_OF_TITLE.get(`${m.title.toLowerCase()}|${m.year}`) ??
      FRANCHISE_OF_TITLE.get(`${m.title.toLowerCase()}|${m.year - 1}`) ??
      FRANCHISE_OF_TITLE.get(`${m.title.toLowerCase()}|${m.year + 1}`))
    : undefined;
