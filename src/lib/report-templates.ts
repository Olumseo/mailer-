// Per-segment copy for the product-feedback campaign.
//
// These go to people who already have an Olum account, so the copy is written
// as a founder-to-user note, not as outreach: it opens with what *they*
// actually did (their own domain, their own run count), asks exactly one
// question, and offers a call. Spintax `{a|b|c}` still varies every send.
//
// Placeholders resolved per recipient by `buildReportVars` below.

import type { ReportUser, Segment } from "./report";

export interface SegmentCopy {
  label: string;
  /** One line explaining who lands in this segment — shown in the UI. */
  blurb: string;
  subject: string;
  body: string;
}

// HTML letters: plain <p>/<ol> that the branded layout styles, plus blocks —
// {{activityCard}} (what they did, as a table), {{demoButton}} (only when a
// booking link is set) and {{signature}}. Campaigns created before HTML mail
// keep their plain-text copy and still send fine.
export const REPORT_COPY: Record<Segment, SegmentCopy> = {
  dashboard_seen: {
    label: "Saw the dashboard",
    blurb:
      "Reached the results dashboard (beacon set, or workflow state = landed_dashboard). The only people who've seen the whole product — ask for the blunt verdict, offer a walkthrough.",
    subject:
      "{What did you make of your {{site}} report?|Was the {{site}} report actually useful?|Your honest read on Olum?}",
    body: `<p>{{greeting}},</p>

<p>Barath here from Olum. You ran us on <strong>{{site}}</strong> and got all the way through to the results — which puts you in a small group, so your read on it matters more than most.</p>

{{activityCard}}

<p>{I'd like the blunt version, not the polite one.|I'm after the honest version, not the encouraging one.|Please don't be nice about it — the useful answer is the harsh one.} Answer whichever you have an opinion on:</p>

<ol>
<li>Was anything in that report genuinely useful, or was it mostly noise?</li>
<li>What did you expect to find and didn't?</li>
<li>Would you run it on another site? If not, what's the reason?</li>
</ol>

<p>{{frictionLine}}</p>

<p>{{meetingLine}}</p>

{{demoButton}}

{{signature}}`,
  },

  results_not_seen: {
    label: "Ran an analysis, never saw results",
    blurb:
      "Analyses completed, but no dashboard landing recorded. The biggest drop-off — find out whether they saw the results and it was underwhelming, or never got there at all.",
    subject:
      "{Did your {{site}} results ever load?|Did you get to see the {{site}} results?|Your {{site}} analysis — did you ever see it?}",
    body: `<p>{{greeting}},</p>

<p>Barath here from Olum. Our logs say you ran {{analysesPhrase}} {{siteClause}}, but there's no record of you ever reaching the results dashboard afterwards.</p>

{{activityCard}}

<p>{Either something broke on the way there, or what you saw wasn't worth staying for.|Either we broke it, or the results weren't worth the click.} {Both are on us — I'd just rather know which:|Both are our problem, but they need different fixes:}</p>

<ol>
<li>If you did see the results — were they any good? What was wrong, thin, or plainly obvious to you but missed by us?</li>
<li>If you never got that far — just reply <strong>"stuck"</strong>. I'll pull up what actually happened on your account and come back with a straight answer.</li>
</ol>

<p>{{frictionLine}}</p>

<p>{{meetingLine}}</p>

{{demoButton}}

{{signature}}`,
  },

  analysis_stuck: {
    label: "Analysis left running",
    blurb:
      "Workflow state is still analysis_running — the run never resolved either way. Treat as a bug report we owe them an answer on.",
    subject:
      "{Your {{site}} analysis never finished|Your {{site}} run is still stuck|We left your {{site}} analysis hanging}",
    body: `<p>{{greeting}},</p>

<p>Barath from Olum. Your analysis {{siteClause}} is still sitting in a "running" state on our side — it never finished and never told you so. That's a bug, and you shouldn't have had to notice it yourself.</p>

{{activityCard}}

<p>I can re-run it properly and watch it through. Before I do: what were you actually trying to find out about the site? {If I know what you were after, I can tell you whether we're even the right tool for it.|That way I can tell you honestly whether we'd have answered it.}</p>

<p>{{frictionLine}}</p>

<p>{{meetingLine}}</p>

{{demoButton}}

{{signature}}`,
  },

  analysis_failed: {
    label: "Analysis failed",
    blurb:
      "Runs errored out (workflow state = failed, or only failed analyses). They've seen the worst version of the product — lead with the apology, not the ask.",
    subject:
      "{Sorry — your Olum analysis failed|We broke your {{site}} run|Your analysis didn't complete, and that's on us}",
    body: `<p>{{greeting}},</p>

<p>Barath from Olum. I went through our production logs and your analysis {{siteClause}} failed{{failedCount}}. That's our fault, not anything you did wrong.</p>

<p>{I'm not going to ask you to just try again.|Asking you to "try again" would be a bit rich.} What I'd rather know is what you were hoping to get out of it — what question about the site sent you to us in the first place?</p>

<p>Reply with a line and I'll make sure your next run actually completes — I'll watch that one myself. Or let me show you live what it should have produced:</p>

{{demoButton}}

<p>{{frictionLine}}</p>

{{signature}}`,
  },

  signed_up_only: {
    label: "Signed up, never ran anything",
    blurb:
      "Account created, zero analyses and zero crawls. The question is what stopped them in the first minute — and a demo shows them what they'd get.",
    subject:
      "{What stopped you at signup?|You signed up for Olum and then nothing|Did something block you on Olum?}",
    body: `<p>{{greeting}},</p>

<p>Barath from Olum. You created an account {{signupClause}} and then never ran a single analysis — no site, no crawl, nothing.</p>

<p>I'm not chasing you to use it. I want to know about that first minute: {was it unclear what to do next|did it ask for something you'd rather not hand over|did it just look like more work than it was worth}?</p>

<p>{Any reason is a useful reason. "I forgot" is a useful reason.|Whatever it was, it's useful — including "I forgot about it".}</p>

<p>If it's easier to just see it, I'll run Olum on your site with you in 20 minutes — where ChatGPT, Perplexity and Google's AI answers mention you, and who they name instead.</p>

{{demoButton}}

{{signature}}`,
  },
};

// ─── Per-recipient variables ─────────────────────────────────────────

export interface ReportVarOptions {
  /** Whose calendar the meeting link belongs to; "" hides the whole block. */
  bookingLink: string;
  /** Named in the meeting line, e.g. "Rohan". "" => neutral "the team". */
  founderName: string;
  senderTitle: string;
}

function humanDate(raw: string): string {
  if (!raw) return "";
  // The live feed sends full ISO with an offset ("…+00:00"); the .xlsx sends
  // "YYYY-MM-DD[ HH:MM]" with no zone, which is UTC by the report's legend.
  const zoned = /(?:[zZ]|[+-]\d\d:?\d\d)$/.test(raw.trim());
  const d = zoned
    ? new Date(raw.trim())
    : new Date(raw.length <= 10 ? `${raw}T00:00:00Z` : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  }).format(d);
}

const SECTION_WORDS: Record<string, string> = { ai: "AI", seo: "SEO", llm: "LLM", geo: "GEO", faq: "FAQ" };

/** "/app/ai-visibility" → "AI visibility". */
export function sectionLabel(route: string): string {
  const last = route.split("?")[0].split("/").filter(Boolean).pop() ?? "";
  const words = last.replace(/[-_]+/g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return words
    .map((w, i) =>
      SECTION_WORDS[w.toLowerCase()] ??
      (i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())
    )
    .join(" ");
}

/** "ppc-landing-2" + "google" → "Landing page 2 (google)". */
export function landingLabel(page: string, source: string): string {
  const p = page.trim().toLowerCase();
  if (!p) return "";
  const n = /landing-?(\d+)$/.exec(p)?.[1];
  const base = p === "home" ? "olum.ai homepage" : n ? `Landing page ${n}` : page.trim();
  return source.trim() ? `${base} (${source.trim()})` : base;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Build the placeholder map for one user. Everything is resolved to a final
 * string here (no nested placeholders), and blocks that don't apply resolve to
 * "" — `renderTemplate` collapses the blank lines they leave behind.
 */
export function buildReportVars(
  u: ReportUser,
  opts: ReportVarOptions
): Record<string, string> {
  const site = u.primarySite;

  const meetingBlock = opts.bookingLink
    ? "\n" +
      (opts.founderName
        ? `If it's easier to talk it through, you can grab 15 minutes with ${opts.founderName}, our founder, here:\n${opts.bookingLink}\n`
        : `If it's easier to talk it through, you can book a slot with us here:\n${opts.bookingLink}\n`)
    : "";

  // Only raised when we actually logged errors on their session. Naming the
  // number is the point — it shows we looked, rather than sending a form letter.
  let frictionLine = "";
  if (u.uiIssueEvents >= 3) {
    frictionLine = `\nAlso, our logs show the app was slow or glitchy on your session (${plural(
      u.uiIssueEvents,
      "hiccup",
      "hiccups"
    )} recorded). Sorry about that. If that's the reason you haven't been back, say so plainly.\n`;
  } else if (u.apiErrorCalls >= 20) {
    frictionLine = `\nOur logs also show a run of errors against your account (${u.apiErrorCalls} failed calls). Sorry — if that's what put you off, I'd rather hear it.\n`;
  }

  const signupDate = humanDate(u.signedUp);

  // Don't claim every run happened on the primary domain — several users
  // analysed two or three sites, and getting that wrong reads as a mail merge.
  const sites = u.sitesAnalysed.length ? u.sitesAnalysed : u.sitesCrawled;
  let siteClause = "";
  if (sites.length === 1) siteClause = `on ${sites[0]}`;
  else if (sites.length === 2) siteClause = `on ${sites[0]} and ${sites[1]}`;
  else if (sites.length > 2) siteClause = `across ${sites.length} sites, starting with ${sites[0]}`;

  const pagesVisited = [...new Set(u.pagesReached.map(sectionLabel).filter(Boolean))];
  const meetingLine = opts.bookingLink
    ? opts.founderName
      ? `If it's easier to talk it through, grab a slot with ${opts.founderName}, our founder — we'll walk through your results live.`
      : "If it's easier to talk it through, book a slot and we'll walk through your results live."
    : "";

  return {
    greeting: u.firstName ? `Hi ${u.firstName}` : "Hi there",
    firstName: u.firstName,
    site: site || "your site",
    siteClause,
    siteList: sites.join(", "),
    siteCount: String(sites.length),
    analyses: String(u.analysesCompleted),
    // "1 analysis" would be a lie for someone whose completed count is 0.
    analysesPhrase:
      u.analysesCompleted >= 1
        ? plural(u.analysesCompleted, "analysis", "analyses")
        : "an analysis",
    failedCount:
      u.analysesFailed > 1 ? ` — ${plural(u.analysesFailed, "time", "times")}` : "",
    pages: String(u.pagesCrawled),
    signupDate,
    signupClause: signupDate ? `on ${signupDate}` : "",
    plan: u.plan,
    uiIssues: String(u.uiIssueEvents),
    frictionLine,
    meetingBlock,
    bookingLink: opts.bookingLink,
    founderName: opts.founderName,
    senderTitleLine: opts.senderTitle ? `\n${opts.senderTitle}` : "",
    // ─ HTML letters: the activity card and the demo button ─
    meetingLine,
    demoLabel: opts.founderName ? `Book a demo with ${opts.founderName}` : "Book a 20-minute demo",
    analysesDone:
      u.analysesCompleted || u.analysesFailed
        ? `${u.analysesCompleted} completed${u.analysesFailed ? ` · ${u.analysesFailed} failed` : ""}`
        : "None yet",
    dashboardStatus: u.landedDashboard ? "Reached" : u.analysesCompleted ? "Not opened yet" : "",
    cameFrom: landingLabel(u.landingPage, u.landingSource),
    pagesVisited: pagesVisited.slice(0, 6).join(", "),
    lastActive: humanDate(u.lastVisited),
  };
}
