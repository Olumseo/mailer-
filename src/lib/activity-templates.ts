// Copy for activity outreach.
//
// A NEW user (never emailed, signed up recently) whose first analysis has
// finished gets the "your site has been analysed" letter below. Everyone else
// gets the letter for their funnel segment — the same REPORT_COPY the
// product-feedback campaign uses, so each email opens with what that person
// actually did on the frontend (their site, their run count, whether they
// reached the results, whether runs failed or stalled).
//
// Placeholders: everything buildReportVars provides, plus {{dashboardLink}}.

import { REPORT_COPY, buildReportVars } from "./report-templates";
import type { ReportVarOptions, SegmentCopy } from "./report-templates";
import type { ReportUser, Segment } from "./report";

export type DraftKind = "site_analysed" | Segment;

const SIGNOFF = `Best,
{{senderName}}{{senderTitleLine}}`;

export const SITE_ANALYSED_COPY: SegmentCopy = {
  label: "New user — site analysed",
  blurb:
    "First email to a new signup whose first analysis has finished: tells them it's ready, where to find it, and invites a reply.",
  subject:
    "{Your {{site}} analysis is ready|We've finished analysing {{site}}|{{site}}: your Olum results are in}",
  body: `{{greeting}},

Barath here from Olum. Your analysis {{siteClause}} has finished, and {the full results are waiting in your dashboard|you can see everything in your dashboard}:
{{dashboardLink}}

{In there you'll find|It shows} where AI assistants like ChatGPT, Google AI Overviews, Perplexity and Claude mention you, who they name instead, and the fixes worth doing first.

{If anything in it looks wrong, thin or confusing, just reply to this email — I read every reply.|If something doesn't make sense or looks off, hit reply. It comes straight to me.}
{{meetingBlock}}
${SIGNOFF}`,
};

export function copyForKind(kind: DraftKind): SegmentCopy {
  return kind === "site_analysed" ? SITE_ANALYSED_COPY : REPORT_COPY[kind];
}

export function kindLabel(kind: string): string {
  if (kind === "site_analysed") return SITE_ANALYSED_COPY.label;
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
