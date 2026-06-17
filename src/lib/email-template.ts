// Branded HTML email shell shared by every send (confirm, daily digest, alerts).
// Rules that survive Gmail / Outlook / Apple Mail: table layout, all-inline
// styles, no SVG, no web fonts. Dark card with the TV Nightly amber accent —
// so EVERY text element needs an explicit light color (unstyled text renders
// black-on-dark in clients that don't inherit). Colors are literal hex, kept in
// lockstep with the site palette (01-tokens.css).
const C = {
  bg: "#0b0b0d", // page behind the card
  card: "#161619", // --surface-ish
  line: "#2b2b32", // --line
  text: "#f8f6f2", // --text
  soft: "#e7e3db", // body copy
  muted: "#b6b1a9", // --muted
  accent: "#ffa94d", // --accent
  plate: "#0e0e11", // --plate (button ink)
};
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// shared text colors for content built elsewhere (sync.ts digest/alerts)
export const EMAIL = {
  accent: C.accent,
  text: C.text,
  soft: C.soft,
  muted: C.muted,
};

/** Bulletproof amber button — padding on the <td> so Outlook honors it. */
export function emailButton(label: string, href: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr>` +
    `<td align="center" bgcolor="${C.accent}" style="border-radius:8px;padding:13px 30px">` +
    `<a href="${href}" style="font-family:${SANS};font-size:15px;font-weight:700;color:${C.plate};text-decoration:none;letter-spacing:.02em;display:inline-block">${esc(label)}</a>` +
    `</td></tr></table>`
  );
}

// the TV NIGHTLY lockup: a bordered, TV-shaped "screen" (wider than tall, ~3:2
// like the app's LogoMark) with the amber standby LED tucked into the LOWER-RIGHT
// corner — matching src/components/Layout.tsx. Explicit width/height on the
// bordered cell stops it collapsing to a square; valign=bottom + align=right +
// the asymmetric padding seat the LED in the corner. Outlook drops the radius
// (square frame) and squares the LED — still reads as the mark.
function lockup(): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="padding-right:11px;vertical-align:middle">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td width="28" height="19" align="right" valign="bottom" style="width:28px;height:19px;border:2px solid #f2f5fa;border-radius:6px;padding:0 5px 4px 0;font-size:0;line-height:0">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr>` +
    `<td width="6" height="6" bgcolor="${C.accent}" style="width:6px;height:6px;border-radius:50%;font-size:0;line-height:0">&nbsp;</td>` +
    `</tr></table></td></tr></table>` +
    `</td>` +
    `<td valign="middle" style="font-family:${SANS};font-size:19px;font-weight:800;letter-spacing:.09em;color:${C.text}">TV&nbsp;NIGHTLY<span style="color:${C.accent}">.</span></td>` +
    `</tr></table>`
  );
}

export interface EmailShellOpts {
  /** <title> + default body heading. */
  title: string;
  /** Inbox preview text (hidden in the body). */
  preheader?: string;
  /** Big heading in the body (defaults to title). */
  heading?: string;
  /** Inner body HTML — must carry its own light colors. */
  contentHtml: string;
  /** Small line above the unsubscribe link, e.g. why they're getting this. */
  footerNote?: string;
  /** Full URL; renders the Unsubscribe link when present. */
  unsubscribeHref?: string;
}

/** Wrap content in the branded dark email chrome. */
export function emailShell(o: EmailShellOpts): string {
  const heading = o.heading ?? o.title;
  return (
    `<!DOCTYPE html><html lang="en"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">` +
    `<title>${esc(o.title)}</title>` +
    // belt to the inline-styles braces: brands links where <style> survives
    `<style>a{color:${C.accent}}</style></head>` +
    `<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%">` +
    (o.preheader
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.bg}">${esc(o.preheader)}</div>`
      : "") +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.bg}">` +
    `<tr><td align="center" style="padding:30px 12px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${C.card};border:1px solid ${C.line};border-radius:14px;overflow:hidden">` +
    // ---- header band ----
    `<tr><td style="padding:22px 30px 20px;border-bottom:1px solid ${C.line}">${lockup()}</td></tr>` +
    // ---- body ----
    `<tr><td style="padding:30px 30px 28px;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.soft}">` +
    `<h1 style="margin:0 0 16px;font-family:${SANS};font-size:24px;line-height:1.2;font-weight:800;letter-spacing:-.01em;color:${C.text}">${esc(heading)}</h1>` +
    o.contentHtml +
    `</td></tr>` +
    // ---- footer ----
    `<tr><td style="padding:18px 30px 24px;border-top:1px solid ${C.line};font-family:${SANS};font-size:12px;line-height:1.5;color:${C.muted}">` +
    `<p style="margin:0 0 8px;font-weight:700;letter-spacing:.04em;color:${C.text}">Tonight, decided<span style="color:${C.accent}">.</span></p>` +
    (o.footerNote ? `<p style="margin:0 0 5px;color:${C.muted}">${o.footerNote}</p>` : "") +
    (o.unsubscribeHref
      ? `<p style="margin:0"><a href="${o.unsubscribeHref}" style="color:${C.muted};text-decoration:underline">Unsubscribe</a> · <a href="https://tvnightly.com" style="color:${C.muted};text-decoration:underline">tvnightly.com</a></p>`
      : `<p style="margin:0"><a href="https://tvnightly.com" style="color:${C.muted};text-decoration:underline">tvnightly.com</a></p>`) +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}
