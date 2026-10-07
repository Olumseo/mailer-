import type { Sender } from "./types";
import {
  activityCard,
  button,
  dropEmptyBlocks,
  htmlToText,
  htmlValue,
  looksLikeHtml,
  signature,
  styleContent,
  textToContentHtml,
  wrapEmail,
  DEFAULT_UNSUBSCRIBE,
} from "./email-html";

// ─── Spintax + placeholder rendering ─────────────────────────────────
// Spintax {a|b|c} picks one option at random per email, so no two sends
// share identical wording — this defeats content-fingerprint spam
// filters the same way jittered timing defeats rate-based ones.

export type SpinMode = "random" | "first";

export function resolveSpintax(text: string, mode: SpinMode = "random"): string {
  // Resolve innermost {..|..} groups repeatedly until none remain.
  const group = /\{([^{}]*)\}/;
  let out = text;
  let guard = 0;
  while (group.test(out) && guard < 100) {
    out = out.replace(group, (_, inner: string) => {
      const opts = inner.split("|");
      return mode === "first" ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
    });
    guard++;
  }
  return out;
}

/** Only what rendering needs from a sender — the editor previews with this. */
export type SenderLike = Pick<Sender, "displayName" | "title" | "bookingLink">;

export interface RenderVars {
  company: string;
  sender: SenderLike;
  /** Extra per-recipient placeholders (report campaigns). Applied first. */
  extra?: Record<string, string>;
}

export interface RenderOptions {
  /** Template is HTML: values are escaped, and `blocks` may be used. */
  html?: boolean;
  /** Placeholders that expand to finished HTML ({{demoButton}}…), inserted
   *  verbatim after spintax so their markup can't be mistaken for a choice. */
  blocks?: Record<string, string>;
  /** Leave these {{block}} placeholders in the output untouched — drafts keep
   *  {{activityCard}} readable and expand it when they're previewed or sent. */
  keepBlocks?: readonly string[];
  spin?: SpinMode;
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

// Private-use sentinels: survive spintax untouched, never appear in real copy.
const SENTINEL = (i: number) => `${i}`;
const SENTINEL_RE = /(\d+)/g;

/** Fill {{placeholders}}, then resolve spintax. */
export function renderTemplate(template: string, vars: RenderVars, opts: RenderOptions = {}): string {
  const { company, sender, extra } = vars;
  const val = (v: string) => (opts.html ? htmlValue(safeValue(v ?? "")) : safeValue(v ?? ""));

  // Shield what spintax must not touch: CSS rule bodies and block placeholders.
  const shielded: string[] = [];
  const shield = (s: string) => {
    shielded.push(s);
    return SENTINEL(shielded.length - 1);
  };
  let filled = template;
  if (opts.html) {
    filled = filled.replace(/<style[\s\S]*?<\/style>/gi, shield);
    for (const [key, html] of Object.entries(opts.blocks ?? {})) {
      filled = filled.replaceAll(`{{${key}}}`, () => shield(html));
    }
    for (const key of opts.keepBlocks ?? []) {
      filled = filled.replaceAll(`{{${key}}}`, () => shield(`{{${key}}}`));
    }
  }

  for (const [key, value] of Object.entries(extra ?? {})) {
    filled = filled.replaceAll(`{{${key}}}`, () => val(value));
  }
  filled = filled
    .replaceAll("{{company}}", () => val(company))
    .replaceAll("{{senderName}}", () => val(sender.displayName))
    .replaceAll("{{senderTitle}}", () => val(sender.title || ""))
    .replaceAll("{{bookingLink}}", () => val(sender.bookingLink || ""));
  // Never let an unknown placeholder reach a recipient as raw "{{foo}}".
  filled = filled.replace(/\{\{\s*[\w.]+\s*\}\}/g, "");
  const spun = resolveSpintax(filled, opts.spin).replace(SENTINEL_RE, (_, i: string) => shielded[Number(i)]);
  return opts.html ? dropEmptyBlocks(spun) : tidy(spun);
}

// ─── Full email: subject + branded HTML + text part ──────────────────

export const BLOCK_NAMES = ["demoButton", "callButton", "dashboardButton", "activityCard", "signature"] as const;

/** HTML building blocks available as placeholders in every HTML template. */
export function buildBlocks(extra: Record<string, string>, sender: SenderLike): Record<string, string> {
  const bookingLink = extra.bookingLink ?? sender.bookingLink ?? "";
  const demoLink = extra.demoLink || bookingLink;
  return {
    demoButton: button(extra.demoLabel || "Book a 20-minute demo", demoLink),
    callButton: button("Grab 15 minutes on a call", bookingLink, "secondary"),
    dashboardButton: button("Open your dashboard", extra.dashboardLink ?? "", "dark"),
    activityCard: activityCard([
      { label: "Website", value: extra.siteList || (extra.site && extra.site !== "your site" ? extra.site : "") },
      { label: "Signed up", value: extra.signupDate ?? "" },
      { label: "Came in through", value: extra.cameFrom ?? "" },
      { label: "Analyses run", value: extra.analysesDone ?? "" },
      { label: "Pages crawled", value: extra.pages && extra.pages !== "0" ? extra.pages : "" },
      { label: "Results dashboard", value: extra.dashboardStatus ?? "" },
      { label: "Pages you opened", value: extra.pagesVisited ?? "" },
      { label: "Last active", value: extra.lastActive ?? "" },
    ]),
    signature: signature(sender.displayName, sender.title || ""),
  };
}

export interface ComposeInput extends RenderVars {
  subject: string;
  body: string;
  spin?: SpinMode;
  /** Organisation line in the footer. Defaults to COMPANY_NAME/ADDRESS. */
  org?: string;
  /** Unsubscribe line; "" for internal mail. */
  unsubscribe?: string;
}

export interface ComposedEmail {
  subject: string;
  /** The rendered, styled body — what the approver edits and the Sent log shows. */
  contentHtml: string;
  /** Complete branded document that is actually sent. */
  html: string;
  text: string;
}

export function defaultOrg(): string {
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  return [env.COMPANY_NAME || "Olum AI", env.COMPANY_ADDRESS || ""].filter(Boolean).join(" · ");
}

function preheaderFrom(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const start = /^(hi|hello|hey|dear)\b/i.test(lines[0] ?? "") ? 1 : 0;
  const line = lines.slice(start).join(" ");
  return line.length > 110 ? line.slice(0, 107).replace(/\s+\S*$/, "") + "…" : line;
}

/** Fill one body template into content HTML (unstyled, blocks expanded).
 *  Plain-text templates (older campaigns) become paragraphs. This is what an
 *  approver edits: readable markup, styled only when it's sent. */
export function renderBody(
  body: string,
  vars: RenderVars,
  spin: SpinMode = "random",
  opts: { keepBlocks?: boolean } = {}
): string {
  if (!looksLikeHtml(body)) return textToContentHtml(renderTemplate(body, vars, { spin }));
  return opts.keepBlocks
    ? renderTemplate(body, vars, { html: true, spin, keepBlocks: BLOCK_NAMES })
    : renderTemplate(body, vars, { html: true, spin, blocks: buildBlocks(vars.extra ?? {}, vars.sender) });
}

/** One message, rendered exactly as it is sent. */
export function composeEmail(input: ComposeInput): ComposedEmail {
  const vars: RenderVars = { company: input.company, sender: input.sender, extra: input.extra };
  const spin = input.spin ?? "random";
  const subject = renderTemplate(input.subject, vars, { spin });
  const contentHtml = styleContent(renderBody(input.body, vars, spin));
  const org = input.org ?? defaultOrg();
  const unsubscribe = input.unsubscribe ?? DEFAULT_UNSUBSCRIBE;
  const bodyText = htmlToText(contentHtml);
  return {
    subject,
    contentHtml,
    html: wrapEmail(contentHtml, { preheader: preheaderFrom(bodyText), org, unsubscribe }),
    text: bodyText + "\n\n—\n" + org + (unsubscribe ? "\n" + unsubscribe : ""),
  };
}

/** Legitimacy + compliance footer: company/address (CAN-SPAM) and a human,
 *  natural unsubscribe line to pair with the List-Unsubscribe header. */
export function buildFooter(_sender: Sender): string {
  return "\n\n—\n" + defaultOrg() + "\n" + DEFAULT_UNSUBSCRIBE;
}

/** Plain text → the branded layout. Used for reminders and team notifications. */
export function textToHtml(text: string, opts: { unsubscribe?: string } = {}): string {
  const contentHtml = styleContent(textToContentHtml(text));
  return wrapEmail(contentHtml, {
    preheader: preheaderFrom(text),
    org: defaultOrg(),
    unsubscribe: opts.unsubscribe ?? "",
  });
}

// Default body for cold campaigns. HTML so it goes out in the branded layout;
// spintax still varies the wording per send, and {{demoButton}} only appears
// when the sender has a booking link configured.
export const DEFAULT_TEMPLATE = `<p>{Hi|Hello|Hi there},</p>

<p>{Businesses|Companies|Firms} in Singapore are searching across Google, ChatGPT and other AI assistants for bookkeeping, payroll, tax and accounting support — but many firms aren't visible when those customers are deciding whom to contact.</p>

<p>Olum helps firms like <strong>{{company}}</strong> get found. Our AI agents work out what potential clients are asking, create and distribute the content that answers them, lift your visibility across search and AI platforms, and surface conversations where your services can be introduced.</p>

<p>{I can prepare|I'd be glad to put together|I can send over} a short client-opportunity brief for {{company}} showing where new enquiries could come from — or walk you through it live:</p>

{{demoButton}}

<p>{Would it be useful if I sent the brief across?|Would that be worth a look?|Open to me sharing it?}</p>

{{signature}}`;
