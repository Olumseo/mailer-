// Branded HTML email — the one look every message from this app goes out in.
//
// Matches the olum.ai demo-request emails (authservice/services/email_service.py):
// cream page, white rounded card, italic serif "Olum" wordmark, ink text and a
// blue call-to-action. Everything is table-based with inline styles, because
// that is the only thing Gmail, Outlook and Apple Mail all render the same.
//
// Templates are written as *content* HTML — plain <p>, <a>, <ol>, <h2> with no
// styling — and `styleContent` stamps the brand styles onto those bare tags at
// send time. That keeps the code pane readable and the output consistent.
//
// Pure (no Node or env access), so the editor's live preview runs it in the
// browser and shows byte-for-byte what the send path produces.

export const BRAND = {
  page: "#F3F1EC", // cream
  card: "#FFFFFF",
  line: "#E2DDD3",
  soft: "#F8F6F1",
  ink: "#1D1107",
  navy: "#15173B",
  muted: "#6B6259",
  blue: "#2B4BEB",
  coral: "#F26538",
  sans: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  site: "https://olum.ai",
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True when a template is HTML rather than a plain-text letter. Plain-text
 *  templates (every campaign created before HTML mail) still work: they are
 *  converted paragraph by paragraph into the same branded layout. */
export function looksLikeHtml(s: string): boolean {
  return /<(p|div|table|a|br|h[1-6]|ul|ol|li|strong|em|b|i|span|img|blockquote|hr)\b[^>]*>/i.test(s);
}

function linkify(escaped: string): string {
  return escaped.replace(/(https?:\/\/[^\s<"]+)/g, '<a href="$1">$1</a>');
}

/** Plain text → content HTML: blank-line paragraphs, single newlines as <br>,
 *  bare URLs linked. Styling is applied later by styleContent. */
export function textToContentHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${linkify(escapeHtml(para)).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** A placeholder value going into an HTML template: escaped, and — when it's
 *  prose rather than a bare URL meant for an href — linked and line-broken. */
export function htmlValue(v: string): string {
  // Strip the blank lines text blocks carry at their edges, but keep spaces:
  // " — 3 times" is appended straight after a word.
  const t = (v ?? "").replace(/^\s*\n/, "").replace(/\n\s*$/, "");
  if (!t.trim()) return "";
  if (/^https?:\/\/\S+$/.test(t)) return escapeHtml(t);
  return linkify(escapeHtml(t)).replace(/\n/g, "<br>");
}

const TAG_STYLES: Record<string, string> = {
  p: `margin:0 0 16px;font-family:${BRAND.sans};font-size:15px;line-height:1.65;color:${BRAND.ink};`,
  a: `color:${BRAND.blue};text-decoration:underline;`,
  h1: `margin:0 0 14px;font-family:${BRAND.serif};font-size:26px;line-height:1.25;font-weight:normal;color:${BRAND.navy};`,
  h2: `margin:0 0 12px;font-family:${BRAND.serif};font-size:21px;line-height:1.3;font-weight:normal;color:${BRAND.navy};`,
  h3: `margin:0 0 10px;font-family:${BRAND.sans};font-size:15px;line-height:1.4;font-weight:700;color:${BRAND.ink};`,
  ol: `margin:0 0 16px;padding:0 0 0 22px;font-family:${BRAND.sans};font-size:15px;line-height:1.65;color:${BRAND.ink};`,
  ul: `margin:0 0 16px;padding:0 0 0 22px;font-family:${BRAND.sans};font-size:15px;line-height:1.65;color:${BRAND.ink};`,
  li: `margin:0 0 8px;`,
  blockquote: `margin:0 0 16px;padding:12px 16px;border-left:3px solid ${BRAND.coral};background:${BRAND.soft};font-family:${BRAND.sans};font-size:15px;line-height:1.6;color:${BRAND.ink};`,
  hr: `border:0;border-top:1px solid ${BRAND.line};margin:24px 0;`,
  strong: `color:${BRAND.navy};`,
};

/** Give every bare content tag the brand style. Tags that already carry a
 *  style attribute are left exactly as written. */
export function styleContent(html: string): string {
  return html.replace(
    /<(p|a|h1|h2|h3|ol|ul|li|blockquote|hr|strong)(\s[^>]*)?(\/?)>/gi,
    (m, tag: string, attrs: string | undefined, selfClose: string) => {
      const a = attrs ?? "";
      if (/\bstyle\s*=/i.test(a)) return m;
      const style = TAG_STYLES[tag.toLowerCase()];
      return `<${tag}${a} style="${style}"${selfClose}>`;
    }
  );
}

/** Drop paragraphs that a blank placeholder left empty. */
export function dropEmptyBlocks(html: string): string {
  return html
    .replace(/<p(\s[^>]*)?>\s*(<br\s*\/?>\s*)*<\/p>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Building blocks (placeholders that expand to finished HTML) ──────

export function button(
  label: string,
  href: string,
  variant: "primary" | "secondary" | "dark" = "primary"
): string {
  if (!href) return "";
  const { bg, fg, border } = {
    primary: { bg: BRAND.blue, fg: "#FFFFFF", border: BRAND.blue },
    dark: { bg: BRAND.navy, fg: "#FFFFFF", border: BRAND.navy },
    secondary: { bg: BRAND.card, fg: BRAND.navy, border: BRAND.line },
  }[variant];
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;">` +
    `<tr><td style="border-radius:10px;background:${bg};border:1px solid ${border};">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 24px;font-family:${BRAND.sans};` +
    `font-size:15px;font-weight:600;line-height:1;color:${fg};text-decoration:none;border-radius:10px;">` +
    `${escapeHtml(label)}</a></td></tr></table>`
  );
}

export interface ActivityFact {
  label: string;
  value: string;
}

/** "Your activity on Olum" card — what this person actually did, in a table. */
export function activityCard(facts: ActivityFact[], title = "Your activity on Olum"): string {
  const rows = facts.filter((f) => f.value);
  if (!rows.length) return "";
  const body = rows
    .map(
      (f, i) =>
        `<tr><td style="padding:9px 0;${i ? `border-top:1px solid ${BRAND.line};` : ""}font-family:${BRAND.sans};` +
        `font-size:13px;color:${BRAND.muted};width:44%;vertical-align:top;">${escapeHtml(f.label)}</td>` +
        `<td style="padding:9px 0;${i ? `border-top:1px solid ${BRAND.line};` : ""}font-family:${BRAND.sans};` +
        `font-size:14px;color:${BRAND.ink};font-weight:600;vertical-align:top;">${escapeHtml(f.value)}</td></tr>`
    )
    .join("");
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="margin:4px 0 22px;background:${BRAND.soft};border:1px solid ${BRAND.line};border-radius:12px;">` +
    `<tr><td style="padding:16px 20px 8px;">` +
    `<div style="font-family:${BRAND.sans};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;` +
    `color:${BRAND.coral};font-weight:700;margin:0 0 4px;">${escapeHtml(title)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>` +
    `</td></tr></table>`
  );
}

export function signature(name: string, title: string): string {
  if (!name) return "";
  return (
    `<p style="margin:8px 0 0;font-family:${BRAND.sans};font-size:15px;line-height:1.5;color:${BRAND.ink};">` +
    `Best,<br><strong style="color:${BRAND.navy};">${escapeHtml(name)}</strong>` +
    (title ? `<br><span style="color:${BRAND.muted};font-size:13px;">${escapeHtml(title)} · Olum</span>` : "") +
    `</p>`
  );
}

// ─── Shell ────────────────────────────────────────────────────────────

export interface ShellOptions {
  /** Hidden inbox-preview line shown after the subject. */
  preheader?: string;
  /** Organisation line under the card ("Olum AI · address"). */
  org?: string;
  /** Unsubscribe line. "" hides it (internal notifications). */
  unsubscribe?: string;
}

export const DEFAULT_UNSUBSCRIBE =
  `Not relevant, or wrong person? Just reply "unsubscribe" and I'll take you off my list.`;

/** Wrap finished content HTML in the branded page. */
export function wrapEmail(contentHtml: string, opts: ShellOptions = {}): string {
  const pre = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">` +
      `${escapeHtml(opts.preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>`
    : "";
  const org = opts.org ?? "Olum AI";
  const unsub = opts.unsubscribe ?? DEFAULT_UNSUBSCRIBE;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Olum</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-text-size-adjust:100%;">
${pre}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
<tr><td align="center" style="padding:32px 12px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:580px;">
<tr><td style="padding:0 6px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${BRAND.serif};font-style:italic;font-size:28px;line-height:1;color:${BRAND.navy};">Olum<span style="color:${BRAND.coral};font-style:normal;">.</span></td>
<td align="right" style="font-family:${BRAND.sans};font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${BRAND.muted};">AI search visibility</td>
</tr></table>
</td></tr>
<tr><td style="background:${BRAND.card};border:1px solid ${BRAND.line};border-top:4px solid ${BRAND.coral};border-radius:16px;padding:34px 36px 30px;">
${contentHtml}
</td></tr>
<tr><td style="padding:22px 8px 0;font-family:${BRAND.sans};font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center;">
${escapeHtml(org)} · <a href="${BRAND.site}" style="color:${BRAND.muted};text-decoration:underline;">olum.ai</a>${
    unsub ? `<br>${escapeHtml(unsub)}` : ""
  }
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── Plain-text alternative ──────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&zwnj;/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Content HTML → the text/plain part (and the Sent log's searchable body). */
export function htmlToText(html: string): string {
  let ol = 0;
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, "").trim();
        const url = decodeEntities(href);
        return !text || text === url || text === href ? url : `${text} (${url})`;
      })
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<ol[^>]*>/gi, () => ((ol = 0), "\n"))
      .replace(/<li[^>]*>/gi, () => (ol >= 0 ? `${++ol}. ` : "• "))
      .replace(/<ul[^>]*>/gi, () => ((ol = -1e9), "\n"))
      .replace(/<\/(p|h[1-6]|li|tr|blockquote|div|table|ol|ul)>/gi, "\n")
      .replace(/<hr[^>]*>/gi, "\n—\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
