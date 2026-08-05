import type { Sender } from "./types";

// ─── Spintax + placeholder rendering ─────────────────────────────────
// Spintax {a|b|c} picks one option at random per email, so no two sends
// share identical wording — this defeats content-fingerprint spam
// filters the same way jittered timing defeats rate-based ones.

export function resolveSpintax(text: string): string {
  // Resolve innermost {..|..} groups repeatedly until none remain.
  const group = /\{([^{}]*)\}/;
  let out = text;
  let guard = 0;
  while (group.test(out) && guard < 100) {
    out = out.replace(group, (_, inner: string) => {
      const opts = inner.split("|");
      return opts[Math.floor(Math.random() * opts.length)];
    });
    guard++;
  }
  return out;
}

export interface RenderVars {
  company: string;
  sender: Sender;
  /** Extra per-recipient placeholders (report campaigns). Applied first. */
  extra?: Record<string, string>;
}

/** Spintax metacharacters in *data* would corrupt the spin pass, so strip them
 *  from substituted values (a site called "a{b|c}" must not become a choice). */
function safeValue(v: string): string {
  return v.replace(/[{}|]/g, "");
}

/** Tidy the result of substitution: blocks that resolved to "" leave runs of
 *  blank lines behind, which would look broken in the delivered email. */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fill {{placeholders}}, then resolve spintax. */
export function renderTemplate(template: string, vars: RenderVars): string {
  const { company, sender, extra } = vars;
  let filled = template;
  for (const [key, value] of Object.entries(extra ?? {})) {
    filled = filled.replaceAll(`{{${key}}}`, safeValue(value ?? ""));
  }
  filled = filled
    .replaceAll("{{company}}", safeValue(company))
    .replaceAll("{{senderName}}", safeValue(sender.displayName))
    .replaceAll("{{senderTitle}}", safeValue(sender.title || ""))
    .replaceAll("{{bookingLink}}", safeValue(sender.bookingLink || ""));
  // Never let an unknown placeholder reach a recipient as raw "{{foo}}".
  filled = filled.replace(/\{\{\s*[\w.]+\s*\}\}/g, "");
  return tidy(resolveSpintax(filled));
}

/** Legitimacy + compliance footer: company/address (CAN-SPAM) and a human,
 *  natural unsubscribe line to pair with the List-Unsubscribe header. */
export function buildFooter(_sender: Sender): string {
  const company = process.env.COMPANY_NAME || "Olum AI";
  const address = process.env.COMPANY_ADDRESS || "";
  const org = [company, address].filter(Boolean).join(" · ");
  return (
    "\n\n—\n" +
    (org ? org + "\n" : "") +
    `Not relevant, or wrong person? Just reply "unsubscribe" and I'll take you off my list.`
  );
}

/** Plain text → simple, clean HTML (mirrors the CLI base's mailer). */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#1a73e8;">$1</a>'
  );
  const html = withLinks.replace(/\n/g, "<br>");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#333;line-height:1.75;">${html}</div>`;
}

// Default body — works for both team and founder tones. Spintax varies
// the opening/closing per send. Booking link only appears if the sender
// has one configured.
export const DEFAULT_TEMPLATE = `{Hi|Hello|Hi there},

{Businesses|Companies|Firms} in Singapore are searching across Google, ChatGPT and other platforms for bookkeeping, payroll, tax and accounting support — but many firms aren't visible when these customers are deciding whom to contact.

Olum helps firms like {{company}} attract more clients. Our AI agents identify what potential customers are looking for, create and distribute the content needed to reach them, improve visibility across search and AI platforms, and find relevant online conversations where your services can be introduced.

{I can prepare|I'd be glad to put together|I can send over} a short client-opportunity brief for {{company}} showing where new enquiries could come from.

{Would it be useful if I sent it across?|Would that be worth a look?|Open to me sharing it?}

{{bookingLink}}

Best,
{{senderName}}
{{senderTitle}}`;
