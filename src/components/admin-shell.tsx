import { FC, PropsWithChildren } from "hono/jsx";

export type AdminPage = "studio" | "shorts" | "feedback" | "subscribers";

const NAV: { id: AdminPage; href: string; label: string }[] = [
  { id: "studio", href: "/admin/studio", label: "Social studio" },
  { id: "shorts", href: "/admin/shorts", label: "Shorts generator" },
  { id: "feedback", href: "/admin/feedback", label: "Feedback" },
  { id: "subscribers", href: "/admin/subscribers", label: "Subscribers" },
];

export const AdminMark: FC = () => (
  <svg class="admin-mark" viewBox="0 0 36 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="1.25" y="1.25" width="33.5" height="21.5" rx="5.5" fill="none" stroke="#F2F5FA" stroke-width="2.5" />
    <circle cx="26.5" cy="16.5" r="3.4" fill="#FFA94D" opacity="0.22" />
    <circle cx="26.5" cy="16.5" r="2.2" fill="#FFA94D" />
  </svg>
);

export const AdminShell: FC<
  PropsWithChildren<{
    page: AdminPage;
    wide?: boolean;
    lead?: string;
  }>
> = ({ page, wide, lead, children }) => (
  <div class={`admin${wide ? " admin--wide" : ""}`}>
    <header class="admin-top">
      <div class="admin-brand">
        <AdminMark />
        <span class="admin-lockup">
          <span class="admin-kicker">TV Nightly</span>
          <span class="admin-wordmark">
            Admin<span class="dot" aria-hidden="true"></span>
          </span>
          {lead ? <span class="admin-tagline muted">{lead}</span> : null}
        </span>
      </div>
      <nav class="admin-nav" aria-label="Admin sections">
        {NAV.map((item) => (
          <a class={`admin-nav-link${item.id === page ? " on" : ""}`} href={item.href} aria-current={item.id === page ? "page" : undefined}>
            {item.label}
          </a>
        ))}
      </nav>
    </header>
    <div class="admin-body">{children}</div>
  </div>
);
