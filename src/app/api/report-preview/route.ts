import { NextRequest, NextResponse } from "next/server";
import { parseUsersReport, summarise, SEGMENT_ORDER } from "@/lib/report";
import { REPORT_COPY } from "@/lib/report-templates";
import { defaultIncluded, renderFor, emptyCopy } from "@/lib/report-campaign";
import type { ReportCampaignConfig } from "@/lib/report-campaign";
import {
  getSender,
  getReportSenderKey,
  getFounderName,
  getInternalDomains,
  getTeamEmailHints,
} from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads an uploaded users report and returns everything the review screen
 * needs: the segmented user list, per-segment counts, and one fully rendered
 * sample email per segment. Nothing is written to the DB here.
 * Gated by the access-cookie middleware like the rest of the app.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  const senderKey = String(form.get("senderKey") ?? "") || getReportSenderKey();
  const sender = getSender(senderKey);
  const bookingLink = String(form.get("bookingLink") ?? "").trim();
  const founderName = String(form.get("founderName") ?? "").trim() || getFounderName();

  try {
    const parsed = await parseUsersReport(await file.arrayBuffer(), {
      internalDomains: getInternalDomains(),
      teamHints: getTeamEmailHints(),
    });

    // The form posts its edited copy back so previews stay honest after a rewrite.
    let copy = emptyCopy();
    const rawCopy = String(form.get("copy") ?? "");
    if (rawCopy) {
      try {
        const edited = JSON.parse(rawCopy) as Record<string, { subject?: string; body?: string }>;
        for (const seg of SEGMENT_ORDER) {
          if (edited[seg]?.subject?.trim()) copy[seg].subject = edited[seg].subject!.trim();
          if (edited[seg]?.body?.trim()) copy[seg].body = edited[seg].body!.trim();
        }
      } catch {
        copy = emptyCopy(); // malformed edit — fall back to the defaults
      }
    }

    const cfg: ReportCampaignConfig = {
      bookingLink,
      founderName,
      segments: [...SEGMENT_ORDER],
      includeEmails: null,
      includeTeamHints: false,
      includeInternal: false,
      copy,
    };

    // One rendered sample per segment — taken from a user who'd actually be
    // mailed, so the placeholders show real values rather than "your site".
    const samples: Record<string, { subject: string; body: string } | null> = {};
    for (const seg of SEGMENT_ORDER) {
      const pick =
        parsed.users.find((u) => u.segment === seg && defaultIncluded(u, cfg)) ??
        parsed.users.find((u) => u.segment === seg);
      samples[seg] = pick ? renderFor(pick, cfg, sender) : null;
    }

    // "Preview this person" — the exact letter one named user would receive.
    const focusEmail = String(form.get("previewEmail") ?? "").trim().toLowerCase();
    const focusUser = focusEmail ? parsed.users.find((u) => u.email === focusEmail) : undefined;
    const focus = focusUser
      ? { email: focusUser.email, name: focusUser.name, ...renderFor(focusUser, cfg, sender) }
      : null;

    return NextResponse.json({
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
      sender: { key: sender.key, name: sender.displayName, email: sender.email },
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
        excluded: u.excluded,
        teamHint: u.teamHint,
        business: u.businessEmail,
        highFriction: u.highFriction,
        defaultInclude: defaultIncluded(u, cfg),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Couldn't read the report: ${(e as Error).message}` },
      { status: 400 }
    );
  }
}
