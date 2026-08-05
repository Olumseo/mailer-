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

const SIGNOFF = `Best,
{{senderName}}{{senderTitleLine}}`;

export const REPORT_COPY: Record<Segment, SegmentCopy> = {
  dashboard_seen: {
    label: "Saw the dashboard",
    blurb:
      "Reached the results dashboard (beacon set, or workflow state = landed_dashboard). The only people who've seen the whole product — ask for the blunt verdict.",
    subject:
      "{What did you make of your {{site}} report?|Was the {{site}} report actually useful?|Your honest read on Olum?}",
    body: `{{greeting}},

Barath here from Olum. You ran us on {{site}} and got all the way through to the results — which puts you in a small group, so your read on it matters more than most.

{I'd like the blunt version, not the polite one.|I'm after the honest version, not the encouraging one.|Please don't be nice about it — the useful answer is the harsh one.} Three questions, answer whichever you have an opinion on:

1. Was anything in that report genuinely useful, or was it mostly noise?
2. What did you expect to find and didn't?
3. Would you run it on another site? If not, what's the reason?
{{frictionLine}}
{One reply, however short, beats another week of us guessing.|Even a one-line answer is worth more to us than another week of guessing.}
{{meetingBlock}}
${SIGNOFF}`,
  },

  results_not_seen: {
    label: "Ran an analysis, never saw results",
    blurb:
      "Analyses completed, but no dashboard landing recorded. The biggest drop-off — find out whether they saw the results and it was underwhelming, or never got there at all.",
    subject:
      "{Did your {{site}} results ever load?|Did you get to see the {{site}} results?|Your {{site}} analysis — did you ever see it?}",
    body: `{{greeting}},

Barath here from Olum. Our logs say you ran {{analysesPhrase}} {{siteClause}}, but there's no record of you ever reaching the results dashboard afterwards.

{Either something broke on the way there, or what you saw wasn't worth staying for.|Either we broke it, or the results weren't worth the click.|Either something stalled, or what came back wasn't worth coming back for.} {Both are on us — I'd just rather know which:|Both are our problem, but they need different fixes:|Either way it's our fault, but I need to know which one:}

1. If you did see the results — were they any good? What was wrong, thin, or plainly obvious to you but missed by us?
2. If you never got that far — just reply "stuck". I'll pull up what actually happened on your account and come back to you with a straight answer.
{{frictionLine}}
{Either reply is genuinely useful.|Both answers help; the second one helps more.}
{{meetingBlock}}
${SIGNOFF}`,
  },

  analysis_stuck: {
    label: "Analysis left running",
    blurb:
      "Workflow state is still analysis_running — the run never resolved either way. Treat as a bug report we owe them an answer on.",
    subject:
      "{Your {{site}} analysis never finished|Your {{site}} run is still stuck|We left your {{site}} analysis hanging}",
    body: `{{greeting}},

Barath from Olum. Your analysis {{siteClause}} is still sitting in a "running" state on our side — meaning it never finished and never told you so. That's a bug, and you shouldn't have had to notice it yourself.

I can re-run it properly and watch it through. Before I do: what were you actually trying to find out about the site? {If I know what you were after, I can tell you whether we're even the right tool for it.|That way I can tell you honestly whether we'd have answered it.}
{{frictionLine}}
{{meetingBlock}}
${SIGNOFF}`,
  },

  analysis_failed: {
    label: "Analysis failed",
    blurb:
      "Runs errored out (workflow state = failed, or only failed analyses). They've seen the worst version of the product — lead with the apology, not the ask.",
    subject:
      "{Sorry — your Olum analysis failed|We broke your {{site}} run|Your analysis didn't complete, and that's on us}",
    body: `{{greeting}},

Barath from Olum. I went through our production logs and your analysis {{siteClause}} failed{{failedCount}}. That's our fault, not anything you did wrong.

{I'm not going to ask you to just try again.|Asking you to "try again" would be a bit rich.} What I'd rather know is what you were hoping to get out of it — what question about the site sent you to us in the first place?

Reply with a line and I'll make sure your next run actually completes. I'll watch that one myself.
{{frictionLine}}
{{meetingBlock}}
${SIGNOFF}`,
  },

  signed_up_only: {
    label: "Signed up, never ran anything",
    blurb:
      "Account created, zero analyses and zero crawls. The question is what stopped them in the first minute.",
    subject:
      "{What stopped you at signup?|You signed up for Olum and then nothing|Did something block you on Olum?}",
    body: `{{greeting}},

Barath from Olum. You created an account {{signupClause}} and then never ran a single analysis — no site, no crawl, nothing.

I'm not chasing you to use it. I want to know about that first minute: {was it unclear what to do next|did it ask for something you'd rather not hand over|did it just look like more work than it was worth}?

{Any reason is a useful reason. "I forgot" is a useful reason.|Whatever it was, it's useful — including "I forgot about it".}
{{meetingBlock}}
${SIGNOFF}`,
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
  const d = new Date(raw.length <= 10 ? `${raw}T00:00:00Z` : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  }).format(d);
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
  };
}
