"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseWorkbook } from "@/lib/excel";
import {
  createCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  addMeeting,
} from "@/lib/engine";
import { sql } from "@/lib/db";
import {
  getMeetingTzOffset,
  getSender,
  getReportSenderKey,
  getFounderName,
  getInternalDomains,
  getTeamEmailHints,
} from "@/lib/env";
import { parseUsersReport, SEGMENT_ORDER } from "@/lib/report";
import type { Segment } from "@/lib/report";
import { buildRows, selectRecipients, emptyCopy } from "@/lib/report-campaign";
import type { ReportCampaignConfig } from "@/lib/report-campaign";
import type { SenderKey } from "@/lib/types";

/** Interpret a `datetime-local` value ("2026-07-25T14:30") as IST wall-clock
 *  time and return the real UTC instant. */
function localToInstant(value: string, offsetHours: number): string {
  const asUtc = new Date(`${value}:00Z`); // treat the wall clock as if UTC…
  return new Date(asUtc.getTime() - offsetHours * 3600_000).toISOString(); // …then shift by IST offset
}

export async function createCampaignAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const bodyTemplate = String(formData.get("bodyTemplate") ?? "").trim();
  const file = formData.get("file") as File | null;

  if (!name || !subject || !bodyTemplate || !file || file.size === 0) {
    throw new Error("Name, subject, body and an Excel file are all required.");
  }

  // Selected sheets (empty => all sheets merged).
  const sheets = formData.getAll("sheets").map(String).filter(Boolean);
  const parsed = await parseWorkbook(await file.arrayBuffer(), sheets);
  if (parsed.rows.length === 0) {
    throw new Error(
      sheets.length
        ? "No valid rows found in the selected sheet(s)."
        : "No valid rows found in the spreadsheet."
    );
  }

  const id = await createCampaign({
    name,
    subject,
    bodyTemplate,
    sourceFile: file.name,
    rows: parsed.rows,
    duplicatesRemoved: parsed.duplicates,
  });

  revalidatePath("/");
  redirect(`/campaigns/${id}`);
}

/**
 * Create a product-feedback campaign from an Olum users report.
 *
 * The whole list is pinned to one mailbox (Barath's by default) and each
 * recipient carries the copy for their funnel segment, so a single campaign
 * sends five different letters. Like the normal flow it lands as a draft —
 * nothing goes out until "Start sending".
 */
export async function createReportCampaignAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const file = formData.get("file") as File | null;
  if (!name || !file || file.size === 0) {
    throw new Error("Campaign name and the report file are both required.");
  }

  const senderKey = (String(formData.get("senderKey") ?? "").trim() ||
    getReportSenderKey()) as SenderKey;
  const sender = getSender(senderKey);
  const bookingLink = String(formData.get("bookingLink") ?? "").trim();
  const founderName = String(formData.get("founderName") ?? "").trim() || getFounderName();

  if (bookingLink && !/^https?:\/\//i.test(bookingLink)) {
    throw new Error("The booking link must be a full URL starting with http:// or https://");
  }

  const segments = formData
    .getAll("segments")
    .map(String)
    .filter((s): s is Segment => (SEGMENT_ORDER as string[]).includes(s));
  if (segments.length === 0) {
    throw new Error("Pick at least one segment to write to.");
  }

  // Per-segment copy as edited in the form.
  const copy = emptyCopy();
  for (const seg of segments) {
    const subject = String(formData.get(`subject_${seg}`) ?? "").trim();
    const body = String(formData.get(`body_${seg}`) ?? "").trim();
    if (subject) copy[seg].subject = subject;
    if (body) copy[seg].body = body;
  }

  // The review table posts one checkbox per kept recipient; an empty list means
  // the table wasn't used, so fall back to the segment rules.
  const ticked = formData.getAll("include").map(String).filter(Boolean);

  const cfg: ReportCampaignConfig = {
    bookingLink,
    founderName,
    segments,
    includeEmails: ticked.length > 0 ? ticked : null,
    includeTeamHints: formData.get("includeTeamHints") === "on",
    includeInternal: formData.get("includeInternal") === "on",
    copy,
  };

  const parsed = await parseUsersReport(await file.arrayBuffer(), {
    internalDomains: getInternalDomains(),
    teamHints: getTeamEmailHints(),
  });

  // Re-apply the segment filter even to an explicit allow-list, so unticking a
  // whole segment can't be defeated by stale checkboxes left in the form.
  const chosen = selectRecipients(parsed.users, cfg).filter((u) =>
    segments.includes(u.segment)
  );
  if (chosen.length === 0) {
    throw new Error("No users matched — every row was excluded or unticked.");
  }

  const id = await createCampaign({
    name,
    // Campaign-level copy is only a fallback — every recipient carries its own.
    subject: copy[segments[0]].subject,
    bodyTemplate: copy[segments[0]].body,
    sourceFile: file.name,
    rows: buildRows(chosen, cfg, sender),
    duplicatesRemoved: parsed.duplicates,
    senderKey,
    kind: "report",
  });

  revalidatePath("/");
  redirect(`/campaigns/${id}`);
}

export async function startCampaignAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  await startCampaign(id);
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/");
}

export async function pauseCampaignAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  await pauseCampaign(id);
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/");
}

export async function resumeCampaignAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  await resumeCampaign(id);
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/");
}

export async function updateCampaignAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const subject = String(formData.get("subject") ?? "").trim();
  const bodyTemplate = String(formData.get("bodyTemplate") ?? "").trim();
  if (!id || !name || !subject || !bodyTemplate) {
    throw new Error("Name, subject and body are required.");
  }
  // Subject/body changes only affect not-yet-sent emails; already-sent ones are unchanged.
  await sql`
    UPDATE campaigns SET name = ${name}, subject = ${subject}, body_template = ${bodyTemplate}
    WHERE id = ${id}`;
  revalidatePath(`/campaigns/${id}`);
  revalidatePath("/");
  redirect(`/campaigns/${id}`);
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  await sql`DELETE FROM campaigns WHERE id = ${id}`;
  revalidatePath("/");
  redirect("/");
}

export async function addMeetingAction(formData: FormData): Promise<void> {
  const personName = String(formData.get("personName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const meetingAtLocal = String(formData.get("meetingAt") ?? "").trim();
  if (!personName || !email || !meetingAtLocal) {
    throw new Error("Person, email and meeting time are required.");
  }

  await addMeeting({
    personName,
    company: String(formData.get("company") ?? "").trim() || undefined,
    website: String(formData.get("website") ?? "").trim() || undefined,
    email,
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    meetingId: String(formData.get("meetingId") ?? "").trim() || undefined,
    // datetime-local has no timezone; interpret it as IST.
    meetingAt: localToInstant(meetingAtLocal, getMeetingTzOffset()),
    senderKey: (String(formData.get("senderKey") ?? "1") as SenderKey) || "1",
    notes: String(formData.get("notes") ?? "").trim() || undefined,
    remind24h: formData.get("remind24h") === "on",
    remind1h: formData.get("remind1h") === "on",
  });

  revalidatePath("/meetings");
  revalidatePath("/");
  redirect("/meetings");
}

export async function updateMeetingAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const personName = String(formData.get("personName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const meetingAtLocal = String(formData.get("meetingAt") ?? "").trim();
  if (!id || !personName || !email || !meetingAtLocal) {
    throw new Error("Person, email and meeting time are required.");
  }

  const meetingAt = localToInstant(meetingAtLocal, getMeetingTzOffset());
  // Reset the reminder flags so an edited time re-triggers reminders correctly.
  await sql`
    UPDATE meetings SET
      person_name = ${personName},
      company     = ${String(formData.get("company") ?? "").trim() || null},
      website     = ${String(formData.get("website") ?? "").trim() || null},
      email       = ${email},
      phone       = ${String(formData.get("phone") ?? "").trim() || null},
      meeting_id  = ${String(formData.get("meetingId") ?? "").trim() || null},
      meeting_at  = ${meetingAt},
      sender_key  = ${String(formData.get("senderKey") ?? "1") || "1"},
      notes       = ${String(formData.get("notes") ?? "").trim() || null},
      remind_24h  = ${formData.get("remind24h") === "on"},
      remind_1h   = ${formData.get("remind1h") === "on"},
      sent_24h    = false,
      sent_1h     = false
    WHERE id = ${id}`;

  revalidatePath("/meetings");
  revalidatePath("/");
  redirect("/meetings");
}

export async function deleteMeetingAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (id) await sql`DELETE FROM meetings WHERE id = ${id}`;
  revalidatePath("/meetings");
  revalidatePath("/");
  redirect("/meetings");
}

export async function deleteEventAction(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (id) await sql`DELETE FROM events WHERE id = ${id}`;
  revalidatePath("/");
}

export async function clearActivityAction(): Promise<void> {
  await sql`DELETE FROM events`;
  revalidatePath("/");
}
