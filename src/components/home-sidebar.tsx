import { FC, PropsWithChildren } from "hono/jsx";
import { posterImg } from "../lib/format";
import type { TrailerItem } from "../lib/latest-trailers";
import type { SideRankItem } from "../lib/sidebar-tops";
import type { AppContext } from "../types";
import { DiscordSidebarCard } from "./discord";
import { Honeypot } from "./Layout";
import { IconFacebook, IconInstagram, IconMail, IconPlayDisc, IconTikTok, IconX, IconYouTube } from "./icons";

const FOLLOW: { label: string; url: string; Icon: FC<{ size?: number }> }[] = [
  { label: "YouTube", url: "https://www.youtube.com/@tvnightly", Icon: IconYouTube },
  { label: "Facebook", url: "https://www.facebook.com/profile.php?id=61591022677323", Icon: IconFacebook },
  { label: "X", url: "https://x.com/tvnightly", Icon: IconX },
  { label: "Instagram", url: "https://www.instagram.com/tvnightly", Icon: IconInstagram },
  { label: "TikTok", url: "https://www.tiktok.com/@tvnightly", Icon: IconTikTok },
];

export const FollowGrid: FC = () => (
  <section class="side-card side-follow" aria-labelledby="side-follow-title">
    <h2 class="side-title" id="side-follow-title">
      Follow TV Nightly
    </h2>
    <div class="follow-grid">
      {FOLLOW.map(({ label, url, Icon }) => (
        <a
          class="follow-tile"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`TV Nightly on ${label}`}
        >
          <span class="follow-ico">
            <Icon size={22} />
          </span>
          <span class="follow-label">{label}</span>
        </a>
      ))}
    </div>
  </section>
);

export const SidebarNewsletter: FC = () => (
  <section class="side-newsletter" aria-labelledby="side-newsletter-title">
    <div class="side-newsletter-head">
      <span class="side-newsletter-ico" aria-hidden="true">
        <IconMail size={18} />
      </span>
      <h2 class="side-newsletter-title" id="side-newsletter-title">
        Tonight, decided
      </h2>
    </div>
    <div class="side-newsletter-body">
      <p class="side-newsletter-dek">
        What&apos;s on, what&apos;s new, and what to watch. One email each evening.
      </p>
      <form action="/subscribe" method="post" class="side-newsletter-form">
        <input type="hidden" name="kind" value="daily" />
        <input
          type="email"
          name="email"
          placeholder="you@email.com"
          required
          autocomplete="email"
          aria-label="Email address"
        />
        <button type="submit">Subscribe</button>
        <Honeypot />
      </form>
      <p class="side-newsletter-fine">Free · unsubscribe anytime</p>
    </div>
  </section>
);

export const LatestTrailers: FC<{ items: TrailerItem[] }> = ({ items }) =>
  items.length ? (
    <section class="side-card side-trailers" aria-labelledby="side-trailers-title">
      <h2 class="side-title" id="side-trailers-title">
        Latest trailers
      </h2>
      <ul class="trailer-list">
        {items.map((t) => (
          <li>
            <a
              class="trailer-item"
              href={`https://www.youtube.com/watch?v=${t.key}`}
              data-video-key={t.key}
              data-video-name={t.name}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span class="trailer-thumb">
                <img
                  src={`https://i.ytimg.com/vi/${t.key}/mqdefault.jpg`}
                  alt=""
                  width="116"
                  height="65"
                  loading="lazy"
                  decoding="async"
                />
                <span class="trailer-play" aria-hidden="true">
                  <IconPlayDisc size={36} />
                </span>
              </span>
              <span class="trailer-meta">
                <span class="trailer-name">{t.title}</span>
                <span class="trailer-kind">{t.kind} · Trailer</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

const SideRankList: FC<{ title: string; id: string; items: SideRankItem[] }> = ({ title, id, items }) =>
  items.length ? (
    <section class="side-card side-rank" aria-labelledby={id}>
      <h2 class="side-title" id={id}>
        {title}
      </h2>
      <ul class="side-rank-list">
        {items.map((item) => (
          <li>
            <a class="side-rank-item" href={item.href}>
              <span class="side-rank-thumb">
                {item.poster ? (
                  <img
                    {...posterImg(item.poster, "thumb")!}
                    alt=""
                    width="52"
                    height="78"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span class="side-rank-fallback" aria-hidden="true"></span>
                )}
              </span>
              <span class="side-rank-meta">
                <span class="side-rank-name">{item.name}</span>
                <span class="side-rank-kind">
                  {[item.genres ?? item.kind, item.rating != null ? item.rating.toFixed(1) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  ) : null;

export const HomeSidebarRail: FC<{
  trailers: TrailerItem[];
  topSeries: SideRankItem[];
  topMovies: SideRankItem[];
}> = ({ trailers, topSeries, topMovies }) => (
  <aside class="home-rail" aria-label="More from TV Nightly">
    <DiscordSidebarCard />
    <FollowGrid />
    <SidebarNewsletter />
    <LatestTrailers items={trailers} />
    <SideRankList title="Top series" id="side-top-series-title" items={topSeries} />
    <SideRankList title="Top movies" id="side-top-movies-title" items={topMovies} />
  </aside>
);

/** Full-bleed hero + two-column content/rail (use with Layout sidebarInline). */
export const SidebarPageGrid: FC<{
  c: AppContext;
  children: PropsWithChildren["children"];
}> = ({ c, children }) => {
  const sidebar = c.get("siteSidebar");
  return (
    <div class="home-main-grid">
      <div class="home-col">{children}</div>
      <HomeSidebarRail
        trailers={sidebar?.trailers ?? []}
        topSeries={sidebar?.topSeries ?? []}
        topMovies={sidebar?.topMovies ?? []}
      />
    </div>
  );
};
