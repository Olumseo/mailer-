import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { getAllSenders, getMeetingTzOffset } from "@/lib/env";
import { toLocalInput } from "@/lib/format";
import { updateMeetingAction } from "@/app/actions";
import { MeetingFields } from "../../MeetingFields";

export const dynamic = "force-dynamic";

export default async function EditMeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meetingId = Number(id);

  const [m] = (await sql`
    SELECT id, person_name, company, website, email, phone, meeting_id, meeting_at,
           sender_key, notes, remind_24h, remind_1h
    FROM meetings WHERE id = ${meetingId}`) as Array<{
    id: number; person_name: string; company: string | null; website: string | null;
    email: string; phone: string | null; meeting_id: string | null; meeting_at: string;
    sender_key: string; notes: string | null; remind_24h: boolean; remind_1h: boolean;
  }>;
  if (!m) notFound();

  const senders = getAllSenders();

  return (
    <div>
      <p className="hint"><Link href="/meetings">← Meetings</Link></p>
      <h1>Edit meeting</h1>
      <p className="sub">
        Saving updates the details and re-arms the reminders against the new time (no new
        &ldquo;booked&rdquo; alert is sent).
      </p>

      <form className="card" action={updateMeetingAction}>
        <input type="hidden" name="id" value={m.id} />
        <MeetingFields
          senders={senders}
          d={{
            personName: m.person_name,
            email: m.email,
            phone: m.phone ?? undefined,
            company: m.company ?? undefined,
            website: m.website ?? undefined,
            meetingId: m.meeting_id ?? undefined,
            meetingAtLocal: toLocalInput(m.meeting_at, getMeetingTzOffset()),
            senderKey: m.sender_key,
            notes: m.notes ?? undefined,
            remind24h: m.remind_24h,
            remind1h: m.remind_1h,
          }}
        />
        <div className="actions">
          <button type="submit">Save changes</button>
          <Link className="btn ghost" href="/meetings">Cancel</Link>
        </div>
      </form>
    </div>
  );
}
