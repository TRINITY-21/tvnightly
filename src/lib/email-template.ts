// Branded HTML email shell shared by every send (confirm, daily digest, alerts).
// Rules that survive Gmail / Outlook / Apple Mail: table layout, all-inline
// styles, no SVG, no web fonts. Dark card with the TV Nightly amber accent —
// so EVERY text element needs an explicit light color (unstyled text renders
// black-on-dark in clients that don't inherit). Colors are literal hex, kept in
// lockstep with the site palette (01-tokens.css).
const C = {
  bg: "#0b0b0d",
  card: "#161619",
  cardHi: "#1c1c22",
  line: "#2b2b32",
  lineSoft: "#232328",
  text: "#f8f6f2",
  soft: "#e7e3db",
  muted: "#b6b1a9",
  accent: "#ffa94d",
  accentHi: "#ffb86a",
  gold: "#eac54f",
  plate: "#0e0e11",
  panel: "#141418",
  ok: "#3cdf8e",
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const EMAIL = {
  accent: C.accent,
  text: C.text,
  soft: C.soft,
  muted: C.muted,
  cardHi: C.cardHi,
  line: C.line,
};

const link = (href: string, label: string) =>
  `<a href="${href}" style="color:${C.accent};text-decoration:none;font-weight:600">${label}</a>`;

/** Small uppercase eyebrow above the headline. */
export function emailKicker(label: string): string {
  return (
    `<p style="margin:0 0 10px;font-family:${SANS};font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${C.accent}">` +
    `${esc(label)}</p>`
  );
}

/** Left-accent callout for the key alert line. */
export function emailHighlight(html: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px">` +
    `<tr><td bgcolor="${C.cardHi}" style="padding:18px 20px;background-color:${C.cardHi};border:1px solid ${C.line};border-left:4px solid ${C.accent};border-radius:10px;font-family:${SANS};font-size:16px;line-height:1.55;color:${C.soft}">` +
    html +
    `</td></tr></table>`
  );
}

/** Premium CTA — padding on the <td> so Outlook honors it. */
export function emailButton(label: string, href: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px">` +
    `<tr><td align="center" bgcolor="${C.accent}" style="background-color:${C.accent};border-radius:10px;padding:14px 32px">` +
    `<a href="${href}" style="font-family:${SANS};font-size:15px;font-weight:800;color:${C.plate};text-decoration:none;letter-spacing:.03em;display:inline-block">${esc(label)}</a>` +
    `</td></tr></table>`
  );
}

/** Ghost secondary link row under a primary CTA. */
export function emailLinkFallback(url: string): string {
  return (
    `<p style="margin:18px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${C.muted}">` +
    `Button not working? Paste this into your browser:<br>` +
    `<a href="${url}" style="color:${C.accent};word-break:break-all;text-decoration:none">${esc(url)}</a></p>`
  );
}

/** Digest / newsletter section — titled card block. */
export function emailSection(title: string, bodyHtml: string): string {
  if (!bodyHtml.trim()) return "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0">` +
    `<tr><td style="padding:0 0 10px;font-family:${SANS};font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${C.muted}">${esc(title)}</td></tr>` +
    `<tr><td bgcolor="${C.cardHi}" style="padding:14px 16px;background-color:${C.cardHi};border:1px solid ${C.line};border-radius:10px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.soft}">` +
    bodyHtml +
    `</td></tr></table>`
  );
}

/** Single digest row with optional bottom rule. */
export function emailRow(html: string, last = false): string {
  return (
    `<p style="margin:0;padding:${last ? "0" : "0 0 11px"};${last ? "" : `border-bottom:1px solid ${C.lineSoft};`}font-family:${SANS};font-size:15px;line-height:1.5;color:${C.soft}">` +
    html +
    `</p>`
  );
}

/** Branded inline link (amber, no underline). */
export function emailInlineLink(href: string, label: string): string {
  return link(href, esc(label));
}

/** Show alert bundle — kicker + highlight + CTA. */
export function emailAlertBody(opts: {
  kicker: string;
  highlightHtml: string;
  ctaLabel: string;
  ctaHref: string;
}): string {
  return emailKicker(opts.kicker) + emailHighlight(opts.highlightHtml) + emailButton(opts.ctaLabel, opts.ctaHref);
}

function lockup(): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding-right:11px;vertical-align:middle">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td width="28" height="19" align="right" valign="bottom" style="width:28px;height:19px;border:2px solid #f2f5fa;border-radius:6px;padding:0 5px 4px 0;font-size:0;line-height:0">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr>` +
    `<td width="6" height="6" bgcolor="${C.accent}" style="width:6px;height:6px;background-color:${C.accent};border-radius:50%;font-size:0;line-height:0">&nbsp;</td>` +
    `</tr></table></td></tr></table>` +
    `</td>` +
    `<td valign="middle" style="font-family:${SANS};font-size:19px;font-weight:800;letter-spacing:.09em;color:${C.text}">TV&nbsp;NIGHTLY<span style="color:${C.accent}">.</span></td>` +
    `</tr></table>`
  );
}

export interface EmailShellOpts {
  title: string;
  preheader?: string;
  heading?: string;
  /** Small label rendered above the H1 (e.g. "Renewal alert"). */
  kicker?: string;
  contentHtml: string;
  footerNote?: string;
  unsubscribeHref?: string;
}

/** Wrap content in the branded dark email chrome. */
export function emailShell(o: EmailShellOpts): string {
  const heading = o.heading ?? o.title;
  const kickerBlock = o.kicker ? emailKicker(o.kicker) : "";
  return (
    `<!DOCTYPE html><html lang="en"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">` +
    `<title>${esc(o.title)}</title>` +
    `<style>a{color:${C.accent}}</style></head>` +
    `<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">` +
    (o.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(o.preheader)}</div>`
      : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">` +
    `<tr><td align="center" style="padding:32px 14px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.line};border-radius:16px;overflow:hidden">` +
    `<tr><td bgcolor="${C.accent}" height="4" style="height:4px;background-color:${C.accent};font-size:0;line-height:0">&nbsp;</td></tr>` +
    `<tr><td style="padding:24px 32px 22px;border-bottom:1px solid ${C.line}">${lockup()}</td></tr>` +
    `<tr><td style="padding:32px 32px 28px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.soft}">` +
    kickerBlock +
    `<h1 style="margin:0 0 18px;font-family:${SANS};font-size:26px;line-height:1.18;font-weight:800;letter-spacing:-.02em;color:${C.text}">${esc(heading)}</h1>` +
    o.contentHtml +
    `</td></tr>` +
    `<tr><td style="padding:20px 32px 26px;border-top:1px solid ${C.line};background:${C.panel};font-family:${SANS};font-size:12px;line-height:1.55;color:${C.muted}">` +
    `<p style="margin:0 0 10px;font-size:13px;font-weight:800;letter-spacing:.06em;color:${C.text}">Tonight, decided<span style="color:${C.accent}">.</span></p>` +
    (o.footerNote ? `<p style="margin:0 0 8px;color:${C.muted}">${o.footerNote}</p>` : "") +
    (o.unsubscribeHref
      ? `<p style="margin:0"><a href="${o.unsubscribeHref}" style="color:${C.muted};text-decoration:underline">Unsubscribe</a><span style="color:${C.line}"> · </span><a href="https://tvnightly.com" style="color:${C.muted};text-decoration:underline">tvnightly.com</a></p>`
      : `<p style="margin:0"><a href="https://tvnightly.com" style="color:${C.muted};text-decoration:underline">tvnightly.com</a></p>`) +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
