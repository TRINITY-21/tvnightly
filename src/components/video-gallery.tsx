// Trailers & videos list for show/movie overviews — opens in the site modal
// via data-video-key (public/js/media-video.js).
import { FC } from "hono/jsx";
import { IconPlay } from "./icons";

type GalleryVideo = { key: string; name: string; type: string };

export const VideoGallery: FC<{
  mediaHref: string;
  videos: GalleryVideo[];
}> = ({ mediaHref, videos }) => {
  if (!videos.length) return null;
  return (
    <section class="video-gallery-wrap">
      <div class="photo-gallery-head">
        <h2 class="photo-gallery-title">Trailers &amp; Videos</h2>
        <a class="photo-gallery-more chev-after" href={mediaHref}>
          View all
        </a>
      </div>
      <div class="vg-grid">
        {videos.map((v) => (
          <a
            class="vg-card"
            href={`https://www.youtube.com/watch?v=${v.key}`}
            target="_blank"
            rel="noopener"
            data-video-key={v.key}
            data-video-name={v.name}
          >
            <span class="vg-thumb">
              <img
                src={`https://img.youtube.com/vi/${v.key}/hqdefault.jpg`}
                alt=""
                width="480"
                height="360"
                loading="lazy"
                decoding="async"
              />
              <IconPlay size={34} />
            </span>
            <span class="vg-card-type">{v.type}</span>
            <span class="vg-card-name">{v.name}</span>
          </a>
        ))}
      </div>
    </section>
  );
};
