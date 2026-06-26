// Inline photo gallery for show/movie overviews — autoplay slideshow with
// thumbnail rail (enhanced by public/js/photo-gallery.js).
import { FC } from "hono/jsx";
import {
  type GalleryImage,
  galleryMainSrc,
  galleryThumbSrc,
  mergeGalleryImages,
} from "../lib/gallery-images";

export { mergeGalleryImages, type GalleryImage };

export const PhotoGallery: FC<{
  entityName: string;
  mediaHref: string;
  images: GalleryImage[];
}> = ({ entityName, mediaHref, images }) => {
  if (!images.length) return null;
  const first = images[0];
  return (
    <section class="photo-gallery-wrap">
      <div class="photo-gallery-head">
        <h2 class="photo-gallery-title">Photos</h2>
        <a class="photo-gallery-more chev-after" href={mediaHref}>
          View all
        </a>
      </div>
      <div
        class={`photo-gallery${first.kind === "backdrop" ? " is-backdrop" : " is-poster"}`}
        data-photo-gallery
        data-autoplay="10000"
      >
        <div class="pg-stage">
          <div class="pg-kenburns" aria-hidden="true">
            <img
              class="pg-main pg-animate pg-kb-0"
              src={galleryMainSrc(first)}
              alt={`${entityName} — image 1 of ${images.length}`}
              width="780"
              height={first.kind === "backdrop" ? "439" : "1170"}
              decoding="async"
            />
          </div>
          <span class="pg-counter" aria-live="polite">
            <span class="pg-cur">1</span> / {images.length}
          </span>
          <button type="button" class="pg-toggle" data-playing="true" aria-label="Pause slideshow">
            <span class="pg-toggle-pause" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="0.5" />
                <rect x="14" y="5" width="4" height="14" rx="0.5" />
              </svg>
            </span>
            <span class="pg-toggle-play" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.5v13l11-6.5z" />
              </svg>
            </span>
          </button>
          <div class="pg-caption">
            <p class="pg-cap-title">{entityName}</p>
            <p class="pg-cap-sub" data-pg-sub>
              {first.kind === "backdrop" ? "Backdrop" : "Poster"} · 1 of {images.length}
            </p>
          </div>
        </div>
        <div class="pg-progress" aria-hidden="true">
          <span class="pg-progress-bar" />
        </div>
        <div class="pg-strip" role="tablist" aria-label="Photo thumbnails">
          {images.map((img, i) => (
            <button
              type="button"
              class={`pg-thumb${i === 0 ? " is-active" : ""}${img.kind === "backdrop" ? " is-backdrop" : ""}`}
              role="tab"
              aria-selected={i === 0 ? "true" : "false"}
              data-index={String(i)}
              aria-label={`Image ${i + 1} of ${images.length}`}
            >
              <img
                src={galleryThumbSrc(img)}
                alt=""
                width={img.kind === "backdrop" ? "150" : "77"}
                height={img.kind === "backdrop" ? "84" : "115"}
                loading={i < 6 ? "eager" : "lazy"}
                decoding="async"
              />
            </button>
          ))}
        </div>
        <div class="pg-sources" hidden>
          {images.map((img, i) => (
            <span
              data-src={galleryMainSrc(img)}
              data-kind={img.kind}
              data-alt={`${entityName} — ${img.kind} ${i + 1} of ${images.length}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
