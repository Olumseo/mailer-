// Copy for activity outreach.
//
// A NEW user (never emailed, signed up recently) whose first analysis has
// finished gets the "your site has been analysed" letter below. A user who has
// seen their results but never asked for a demo gets the demo invite. Everyone
// else gets the letter for their funnel segment — the same REPORT_COPY the
// product-feedback campaign uses, so each email opens with what that person
// actually did on the frontend (their site, their run count, whether they
// reached the results, whether runs failed or stalled).
//
// Placeholders: everything buildReportVars provides, plus {{dashboardLink}};
// blocks {{activityCard}}, {{dashboardButton}}, {{demoButton}}, {{signature}}.

import { REPORT_COPY, buildReportVars } from "./report-templates";
import type { ReportVarOptions, SegmentCopy } from "./report-templates";
import type { ReportUser, Segment } from "./report";

export type DraftKind = "site_analysed" | "demo_invite" | Segment;

export const SITE_ANALYSED_COPY: SegmentCopy = {
  label: "New user — site analysed",
  blurb:
    "First email to a new signup whose first analysis has finished: tells them it's ready, where to find it, and invites a reply.",
  subject:
    "{Your {{site}} analysis is ready|We've finished analysing {{site}}|{{site}}: your Olum results are in}",
  body: `<p>{{greeting}},</p>

<p>Barath here from Olum. Your analysis {{siteClause}} has finished, and {the full results are waiting in your dashboard|you can see everything in your dashboard}.</p>

{{dashboardButton}}

<p>{In there you'll find|It shows} where AI assistants like ChatGPT, Google AI Overviews, Perplexity and Claude mention you, who they name instead, and the fixes worth doing first.</p>

{{activityCard}}

<p>{If anything in it looks wrong, thin or confusing, just reply to this email — I read every reply.|If something doesn't make sense or looks off, hit reply. It comes straight to me.} {{meetingLine}}</p>

{{demoButton}}

{{signature}}`,
};

export const DEMO_INVITE_COPY: SegmentCopy = {
  label: "Saw results — invite to a demo",
  blurb:
    "Reached the dashboard and hasn't asked for a demo yet. Recaps what they did on Olum and offers a 20-minute walkthrough of their own results.",
  subject:
    "{A 20-minute walkthrough of your {{site}} results?|Want me to walk you through {{site}}?|{{site}}: shall I show you what to fix first?}",
  body: `<p>{{greeting}},</p>

<p>Barath here from Olum. I saw you've been through your results for <strong>{{site}}</strong> — here's what you've done on Olum so far:</p>

{{activityCard}}

<p>{The dashboard shows a lot at once.|There's a lot packed into that dashboard.} In a 20-minute demo I'll walk you through <strong>your own</strong> numbers — where ChatGPT, Perplexity and Google's AI answers mention you, who they recommend instead, and the three fixes that would move it fastest.</p>

{{demoButton}}

<p>{No slides and no sales pitch — just your site.|It's your site on screen, not a slide deck.} If a call isn't your thing, reply with your biggest question and I'll answer it here.</p>

{{signature}}`,
};

export function copyForKind(kind: DraftKind): SegmentCopy {
  if (kind === "site_analysed") return SITE_ANALYSED_COPY;
  if (kind === "demo_invite") return DEMO_INVITE_COPY;
  return REPORT_COPY[kind];
}

export function kindLabel(kind: string): string {
  if (kind === "site_analysed") return SITE_ANALYSED_COPY.label;
  if (kind === "demo_invite") return DEMO_INVITE_COPY.label;
  return (REPORT_COPY as Record<string, SegmentCopy>)[kind]?.label ?? kind;
}

export function buildActivityVars(
  u: ReportUser,
  opts: ReportVarOptions & { dashboardUrl: string }
): Record<string, string> {
  return {
    ...buildReportVars(u, opts),
    dashboardLink: opts.dashboardUrl,
  };
}
