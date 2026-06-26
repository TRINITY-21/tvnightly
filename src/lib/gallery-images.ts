// Poster + backdrop paths for the overview photo slideshow.
export type GalleryImage = { path: string; kind: "poster" | "backdrop" };

export function mergeGalleryImages(
  posters: string[],
  backdrops: string[],
  limit = 12,
): GalleryImage[] {
  const items: GalleryImage[] = [
    ...posters.map((path) => ({ path, kind: "poster" as const })),
    ...backdrops.map((path) => ({ path, kind: "backdrop" as const })),
  ];
  return items.slice(0, limit);
}

const pgPath = (file: string, size: string) => `https://image.tmdb.org/t/p/${size}${file}`;

export const galleryMainSrc = (img: GalleryImage) =>
  pgPath(img.path, img.kind === "backdrop" ? "w1280" : "w780");

export const galleryThumbSrc = (img: GalleryImage) =>
  pgPath(img.path, img.kind === "backdrop" ? "w300" : "w154");
