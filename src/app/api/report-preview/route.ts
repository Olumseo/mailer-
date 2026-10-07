import { NextRequest, NextResponse } from "next/server";
import { summarise, SEGMENT_ORDER } from "@/lib/report";
import { REPORT_COPY, sectionLabel, landingLabel } from "@/lib/report-templates";
import { defaultIncluded, renderFor, emptyCopy, varsFor } from "@/lib/report-campaign";
import type { ReportCampaignConfig } from "@/lib/report-campaign";
import { loadReportUsers, type ReportSource } from "@/lib/report-source";
import { getSender, getReportSenderKey, getFounderName } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Loads the users (live feed, or an uploaded report) and returns everything
 * the review screen needs: the segmented user list, per-segment counts, and
 * the placeholder values of one real user per segment — the editor renders
 * the live preview from those as you type. Nothing is written to the DB here.
 * Gated by the access-cookie middleware like the rest of the app.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const source: ReportSource = form.get("source") === "xlsx" ? "xlsx" : "feed";
  const file = form.get("file") as File | null;

  const senderKey = String(form.get("senderKey") ?? "") || getReportSenderKey();
  const sender = getSender(senderKey);
  const bookingLink = String(form.get("bookingLink") ?? "").trim();
  const founderName = String(form.get("founderName") ?? "").trim() || getFounderName();

  try {
    const parsed = await loadReportUsers(source, file);

    const cfg: ReportCampaignConfig = {
      bookingLink,
      founderName,
      segments: [...SEGMENT_ORDER],
      includeEmails: null,
      includeTeamHints: false,
      includeInternal: false,
      copy: emptyCopy(),
    };

    // One sample per segment — a user who'd actually be mailed, so the preview
    // shows real values rather than "your site".
    const samples: Record<string, { email: string; company: string; extra: Record<string, string> } | null> = {};
    for (const seg of SEGMENT_ORDER) {
      const pick =
        parsed.users.find((u) => u.segment === seg && defaultIncluded(u, cfg)) ??
        parsed.users.find((u) => u.segment === seg);
      samples[seg] = pick
        ? { email: pick.email, company: pick.name || pick.email, extra: varsFor(pick, cfg, sender) }
        : null;
    }

    // "Preview this person" — their placeholder values, so the segment editor
    // can switch its preview to them; plus one rendered copy for a quick look.
    const focusEmail = String(form.get("previewEmail") ?? "").trim().toLowerCase();
    const focusUser = focusEmail ? parsed.users.find((u) => u.email === focusEmail) : undefined;
    const focus = focusUser
      ? {
          email: focusUser.email,
          name: focusUser.name,
          segment: focusUser.segment,
          company: focusUser.name || focusUser.email,
          extra: varsFor(focusUser, cfg, sender),
          ...renderFor(focusUser, cfg, sender),
        }
      : null;

    return NextResponse.json({
      source,
      focus,
      sheetName: parsed.sheetName,
      duplicates: parsed.duplicates,
      skipped: parsed.skipped,
      counts: summarise(parsed.users),
      segments: SEGMENT_ORDER.map((s) => ({
        key: s,
        label: REPORT_COPY[s].label,
        blurb: REPORT_COPY[s].blurb,
        subject: REPORT_COPY[s].subject,
        body: REPORT_COPY[s].body,
      })),
      sender: {
        key: sender.key,
        name: sender.displayName,
        email: sender.email,
        title: sender.title,
      },
      samples,
      users: parsed.users.map((u) => ({
        name: u.name,
        firstName: u.firstName,
        email: u.email,
        segment: u.segment,
        plan: u.plan,
        site: u.primarySite,
        sites: u.sitesAnalysed.length,
        analyses: u.analysesCompleted,
        failed: u.analysesFailed,
        uiIssues: u.uiIssueEvents,
        apiErrors: u.apiErrorCalls,
        lastVisited: u.lastVisited,
        signedUp: u.signedUp,
        landed: u.landedDashboard,
        workflowState: u.workflowState,
        cameFrom: landingLabel(u.landingPage, u.landingSource),
        pages: [...new Set(u.pagesReached.map(sectionLabel).filter(Boolean))],
        demoRequested: Boolean(u.demoRequestedAt),
        excluded: u.excluded,
        teamHint: u.teamHint,
        business: u.businessEmail,
        highFriction: u.highFriction,
        defaultInclude: defaultIncluded(u, cfg),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't load users: ${(e as Error).message}` },
      { status: 400 }
    );
  }
}
