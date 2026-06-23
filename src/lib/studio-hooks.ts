// Social Studio hook lines — viral-first copy for captions and card notes.
// Swap [SHOW] / [TITLE] when posting manually; dynamic builders fill real names.
import { pad2 } from "./format";

export const STUDIO_HOOK_TEMPLATES: { hook: string; for: string }[] = [
  { hook: "The worst episode has ★6.2 — fans hated it", for: "Controversy · ratings graph" },
  { hook: "Not the finale — [S__E__] is the peak", for: "Surprise ranking · best episodes" },
  { hook: "Every [SHOW] episode ranked — best to worst", for: "Episode ranking · /guide or best-episodes" },
  { hook: "Renewed or cancelled? Updated today", for: "Release date · status card" },
  { hook: "Premieres in [N] days — every confirmed detail", for: "Countdown · premiere moment" },
  { hook: "Which is better? Episode ratings settle it", for: "Head-to-head · vs card" },
  { hook: "You're watching [FRANCHISE] wrong — correct order inside", for: "TV / movie watch order" },
  { hook: "Rate 5 things → get your TV taste profile", for: "/recommend · Wrapped loop" },
  { hook: "78% drama · 22% sci-fi — what's your taste?", for: "Taste profile share link" },
  { hook: "9/10 and barely watched — your next obsession", for: "Hidden gems list" },
  { hook: "Shows like [SHOW] — ranked by match strength", for: "Similar · Pinterest pin" },
  { hook: "If you liked [SHOW], watch these next", for: "If you liked X composer" },
  { hook: "The top 5 [GENRE] shows — ranked by real ratings", for: "Top 5 by genre" },
  { hook: "CANCELLED after [N] seasons", for: "Renewal bomb · moment card" },
  { hook: "RENEWED for Season [N]", for: "Renewal win · moment card" },
  { hook: "[SHOW] or [SHOW]? Tonight's pick, decided", for: "Showcase · dual-poster feed card" },
];

export function ratingsHook(avg: number | null, peakStr: string | null, worstRating?: number | null): string {
  if (peakStr) return `not the finale — ${peakStr} is the peak`;
  if (worstRating != null && worstRating <= 6.5) return `the worst episode has ★${worstRating.toFixed(1)} — fans hated it`;
  return avg != null ? `every episode rated — series avg ★${avg.toFixed(1)}` : "every episode rated on one chart";
}

export function bestEpisodesHook(peakStr: string | null): string {
  return peakStr ? `not the finale — ${peakStr} is #1` : "every episode ranked — best to worst";
}

export function likedHook(): string {
  return "if you liked it, these are your next 3";
}

export function statusHook(): string {
  return "renewed or cancelled? Updated today";
}

export function vsHook(): string {
  return "which is better? Episode ratings settle it";
}

export function topHook(): string {
  return "the top 5, ranked by real viewer ratings";
}

export function similarHook(): string {
  return "the closest matches — ranked by genre overlap";
}

export function gemsHook(): string {
  return "9/10 and barely watched — your next obsession";
}

export function tasteHook(): string {
  return "rate 5 things → get your TV taste profile";
}

export function watchOrderHook(): string {
  return "you're watching it wrong — correct order inside";
}

export function showcaseHook(): string {
  return "tonight's pick, decided — what to stream right now";
}

export function episodeGuideHook(showName: string, peakStr: string | null): string {
  return peakStr
    ? `every ${showName} episode ranked — peak is ${peakStr}`
    : `every ${showName} episode ranked — best to worst`;
}

export function peakCode(season: number | null, number: number | null, rating: number): string {
  return `S${pad2(season)}E${pad2(number)} (★${rating.toFixed(1)})`;
}
