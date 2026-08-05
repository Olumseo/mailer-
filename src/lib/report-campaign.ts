// Turns a parsed users report into campaign rows. Shared by the preview API
// and the create action so what Barath reads in the preview is byte-for-byte
// what gets stored on the recipient (spintax aside — that spins per send).

import type { CampaignRow } from "./engine";
import { renderTemplate } from "./template";
import { REPORT_COPY, buildReportVars } from "./report-templates";
import type { ReportUser, Segment } from "./report";
import { SEGMENT_ORDER } from "./report";
import type { Sender } from "./types";

export interface ReportCampaignConfig {
  bookingLink: string;
  founderName: string;
  segments: Segment[];
  /** Explicit allow-list of emails from the review table. null => segment rules decide. */
  includeEmails: string[] | null;
  includeTeamHints: boolean;
  includeInternal: boolean;
  /** Copy edited in the form, per segment. Falls back to REPORT_COPY. */
  copy: Partial<Record<Segment, { subject: string; body: string }>>;
}

export function emptyCopy(): Record<Segment, { subject: string; body: string }> {
  return Object.fromEntries(
    SEGMENT_ORDER.map((s) => [s, { subject: REPORT_COPY[s].subject, body: REPORT_COPY[s].body }])
  ) as Record<Segment, { subject: string; body: string }>;
}

function copyFor(cfg: ReportCampaignConfig, segment: Segment) {
  const edited = cfg.copy[segment];
  const subject = edited?.subject?.trim() || REPORT_COPY[segment].subject;
  const body = edited?.body?.trim() || REPORT_COPY[segment].body;
  return { subject, body };
}

/** Whether a user would be mailed by default (before any manual ticking). */
export function defaultIncluded(u: ReportUser, cfg: ReportCampaignConfig): boolean {
  if (u.excluded === "no_email") return false;
  if (u.excluded === "internal" && !cfg.includeInternal) return false;
  if (u.excluded === "disposable") return false;
  if (u.teamHint && !cfg.includeTeamHints) return false;
  return cfg.segments.includes(u.segment);
}

/** Final recipient set. An explicit allow-list wins over the segment rules,
 *  but can never resurrect a row with no usable email. */
export function selectRecipients(
  users: ReportUser[],
  cfg: ReportCampaignConfig
): ReportUser[] {
  if (cfg.includeEmails) {
    const allow = new Set(cfg.includeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
    return users.filter((u) => u.excluded !== "no_email" && allow.has(u.email));
  }
  return users.filter((u) => defaultIncluded(u, cfg));
}

/** Render one user's email exactly as it will be sent (one spintax variant). */
export function renderFor(
  u: ReportUser,
  cfg: ReportCampaignConfig,
  sender: Sender
): { subject: string; body: string } {
  const { subject, body } = copyFor(cfg, u.segment);
  const extra = buildReportVars(u, {
    bookingLink: cfg.bookingLink,
    founderName: cfg.founderName,
    senderTitle: sender.title,
  });
  const vars = { company: u.name || u.email, sender, extra };
  return { subject: renderTemplate(subject, vars), body: renderTemplate(body, vars) };
}

export function buildRows(
  users: ReportUser[],
  cfg: ReportCampaignConfig,
  sender: Sender
): CampaignRow[] {
  return users.map((u) => {
    const { subject, body } = copyFor(cfg, u.segment);
    return {
      // `name` is the campaign UI's identity column; the person reads better
      // than a blank cell for these rows, with their site as the website.
      name: u.name || u.email,
      email: u.email,
      website: u.primarySite || undefined,
      service: u.segment,
      segment: u.segment,
      subjectOverride: subject,
      bodyOverride: body,
      vars: buildReportVars(u, {
        bookingLink: cfg.bookingLink,
        founderName: cfg.founderName,
        senderTitle: sender.title,
      }),
    };
  });
}
