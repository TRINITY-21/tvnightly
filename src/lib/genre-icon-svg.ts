// Shared genre icon paths for SVG cards (taste story PNG) — same shapes as
// components/genre-icons.tsx, drawn on a 24×24 viewBox.

export const genreKey = (label: string): string => {
  const n = label.toLowerCase().trim();
  if (n.includes("science") || n.includes("sci-fi") || n === "sci fi") return "scifi";
  if (n.includes("adventure")) return "adventure";
  if (n.includes("romance")) return "romance";
  if (n.includes("drama")) return "drama";
  if (n.includes("comedy")) return "comedy";
  if (n.includes("music") || n.includes("musical")) return "music";
  if (n.includes("horror")) return "horror";
  if (n.includes("thriller")) return "thriller";
  if (n.includes("action")) return "action";
  if (n.includes("crime")) return "crime";
  if (n.includes("mystery")) return "mystery";
  if (n.includes("fantasy")) return "fantasy";
  if (n.includes("animation") || n.includes("anime")) return "animation";
  if (n.includes("family") || n.includes("sitcom")) return "family";
  if (n.includes("documentary")) return "documentary";
  if (n.includes("sport")) return "sports";
  if (n.includes("western")) return "western";
  if (n.includes("war")) return "war";
  if (n.includes("child") || n.includes("kids")) return "children";
  return "default";
};

const PATHS: Record<string, string> = {
  scifi: `<circle cx="12" cy="13" r="3.6" stroke="currentColor" stroke-width="1.75"/><ellipse cx="12" cy="13" rx="8.5" ry="3.2" stroke="currentColor" stroke-width="1.75" transform="rotate(-18 12 13)"/><circle cx="18.5" cy="6.5" r="1.4" fill="ACCENT" stroke="none"/>`,
  adventure: `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.75"/><path d="M12 4.5v2M12 17.5v2M4.5 12h2M17.5 12h2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M12 8.2 L14.2 13 9 11.2 12.8 15.8 10.6 11 15.8 12.8 Z" fill="ACCENT" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
  romance: `<path d="M12 19.2 C7.2 15.4 5 13.2 5 10.4 A3.6 3.6 0 0 1 12 8.2 A3.6 3.6 0 0 1 19 10.4 C19 13.2 16.8 15.4 12 19.2 Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M9.2 6.8 C10.2 5.6 11.4 5 12 5" stroke="ACCENT" stroke-width="1.5" stroke-linecap="round"/>`,
  drama: `<path d="M8 9.5 C8 7.8 9.4 6.5 11 6.5 C12.2 6.5 13.2 7.2 13.8 8.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M16 9.5 C16 7.8 14.6 6.5 13 6.5 C11.8 6.5 10.8 7.2 10.2 8.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M6.5 10.5 C6.5 15.8 9 18.5 12 18.5 C15 18.5 17.5 15.8 17.5 10.5" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M9.5 14.2 C10.2 15.4 11 16 12 16 C13 16 13.8 15.4 14.5 14.2" stroke="ACCENT" stroke-width="1.5" stroke-linecap="round"/>`,
  comedy: `<circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.75"/><circle cx="9" cy="10.5" r="1" fill="currentColor"/><circle cx="15" cy="10.5" r="1" fill="currentColor"/><path d="M8.5 14.2 C9.8 16.2 14.2 16.2 15.5 14.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M7.5 8.5 L8.8 9.2" stroke="ACCENT" stroke-width="1.4" stroke-linecap="round"/>`,
  music: `<path d="M10 17.5 V7.8 L16.5 6.2 V15.8" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8.5" cy="17.5" r="2.2" stroke="currentColor" stroke-width="1.75"/><circle cx="15" cy="15.8" r="2.2" stroke="currentColor" stroke-width="1.75"/><path d="M16.5 6.2 L18.5 5.8" stroke="ACCENT" stroke-width="1.5" stroke-linecap="round"/>`,
  horror: `<path d="M17 14.5 A7 7 0 1 1 14.5 7.2" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><circle cx="14" cy="11" r="0.9" fill="currentColor"/><path d="M6.5 18.5 C7.5 16.8 8.8 16 10.5 16.2" stroke="ACCENT" stroke-width="1.5" stroke-linecap="round"/>`,
  thriller: `<path d="M12 5.5 C8.5 5.5 6 8.2 6 11.5 C6 15.5 8.8 18 12 18 C15.2 18 18 15.5 18 11.5 C18 8.2 15.5 5.5 12 5.5 Z" stroke="currentColor" stroke-width="1.75"/><circle cx="12" cy="11.5" r="2.8" stroke="currentColor" stroke-width="1.75"/><circle cx="12" cy="11.5" r="0.9" fill="ACCENT"/><path d="M12 8.7 V6.5" stroke="ACCENT" stroke-width="1.4" stroke-linecap="round"/>`,
  action: `<path d="M12 4.5 L13.8 9.8 L19 10.5 L15 14 L16 19 L12 16.2 L8 19 L9 14 L5 10.5 L10.2 9.8 Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="12" cy="12" r="1.6" fill="ACCENT"/>`,
  crime: `<circle cx="10.5" cy="10.5" r="5.5" stroke="currentColor" stroke-width="1.75"/><path d="M14.8 14.8 L18.5 18.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M8.5 10.5 H12.5 M10.5 8.5 V12.5" stroke="ACCENT" stroke-width="1.4" stroke-linecap="round"/>`,
  mystery: `<path d="M8 11.5 H16 V16.5 C16 17.6 15.1 18.5 14 18.5 H10 C8.9 18.5 8 17.6 8 16.5 Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="12" cy="9.5" r="3.5" stroke="currentColor" stroke-width="1.75"/><circle cx="12" cy="14.2" r="1.1" fill="ACCENT"/>`,
  fantasy: `<path d="M12 19.5 L12 6.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M12 6.5 L8.5 11 L12 9.5 L15.5 11 Z" fill="ACCENT" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M6 8 L7.2 9.5 M18 8 L16.8 9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  animation: `<rect x="5" y="7" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.75"/><path d="M5 10 H19 M5 14 H19" stroke="currentColor" stroke-width="1.2" opacity="0.45"/><path d="M10.5 11.2 L13.5 12.5 L10.5 13.8 Z" fill="ACCENT" stroke="ACCENT" stroke-width="1" stroke-linejoin="round"/>`,
  family: `<path d="M5 19 V11.5 L12 7 L19 11.5 V19" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M9.5 19 V14.5 H14.5 V19" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M12 11.2 C12 11.2 10.8 10 9.8 10 C8.8 10 8 10.8 8 11.8 C8 12.8 12 14.5 12 14.5 C12 14.5 16 12.8 16 11.8 C16 10.8 15.2 10 14.2 10 C13.2 10 12 11.2 12 11.2 Z" fill="ACCENT" stroke="none"/>`,
  documentary: `<rect x="4" y="8" width="12" height="8" rx="1.5" stroke="currentColor" stroke-width="1.75"/><path d="M16 10.5 L20 8.5 V15.5 L16 13.5" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><circle cx="10" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="12" r="0.7" fill="ACCENT"/>`,
  sports: `<path d="M6 18 L8.5 6 L15.5 6 L18 18 Z" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M7.5 13 H16.5 M8.5 9.5 H15.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="12" cy="6" r="1.3" fill="ACCENT"/>`,
  western: `<ellipse cx="12" cy="15" rx="9" ry="2.2" stroke="currentColor" stroke-width="1.75"/><path d="M6.5 11.5 C7.5 9.5 9.5 8.5 12 8.5 C14.5 8.5 16.5 9.5 17.5 11.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><path d="M12 8.5 V6.5" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><circle cx="12" cy="5.8" r="1.2" fill="ACCENT"/>`,
  war: `<path d="M7 18 L7 10 L12 7 L17 10 V18" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M9.5 18 V13.5 H14.5 V18" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/><path d="M5 10 L12 6 L19 10" stroke="ACCENT" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  children: `<path d="M8 17 C8 14 9.8 12 12 12 C14.2 12 16 14 16 17" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><circle cx="12" cy="9" r="2.8" stroke="currentColor" stroke-width="1.75"/><path d="M12 5.5 V4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/><circle cx="12" cy="3.5" r="1.1" fill="ACCENT"/>`,
  default: `<rect x="4" y="6" width="16" height="12" rx="2.5" stroke="currentColor" stroke-width="1.75"/><path d="M4 10 H20" stroke="currentColor" stroke-width="1.75"/><circle cx="8" cy="8.2" r="0.7" fill="ACCENT"/><path d="M10.5 13.5 L14.5 15.5 L10.5 17.5 Z" fill="currentColor" stroke="none"/>`,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Icon cell for card SVG — matches the in-app taste profile row icon. */
export function genreIconCell(
  x: number,
  y: number,
  box: number,
  genre: string,
  lead: boolean,
  colors: { stroke: string; accent: string; bg: string; border: string },
): string {
  const key = genreKey(genre);
  const raw = (PATHS[key] ?? PATHS.default)
    .replaceAll("currentColor", colors.stroke)
    .replaceAll("ACCENT", colors.accent);
  const scale = (box * 0.52) / 24;
  const tx = x + box / 2 - 12 * scale;
  const ty = y + box / 2 - 12 * scale;
  return (
    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(box)}" height="${r2(box)}" rx="10" fill="${colors.bg}" stroke="${colors.border}"/>` +
    `<g transform="translate(${r2(tx)},${r2(ty)}) scale(${r2(scale)})" fill="none" stroke-linecap="round" stroke-linejoin="round">${raw}</g>`
  );
}
