import Link from "next/link";
import { sql } from "@/lib/db";
import { getAllSenders } from "@/lib/env";
import { fmt } from "@/lib/format";
import { addMeetingAction, deleteMeetingAction } from "@/app/actions";
import { MeetingFields } from "./MeetingFields";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const senders = getAllSenders();

  let meetings: Array<{
    id: number; person_name: string; company: string | null; email: string;
    phone: string | null; meeting_id: string | null; meeting_at: string; sender_key: string;
    sent_24h: boolean; sent_1h: boolean;
  }> = [];
  try {
    meetings = (await sql`
      SELECT id, person_name, company, email, phone, meeting_id, meeting_at, sender_key, sent_24h, sent_1h
      FROM meetings ORDER BY meeting_at DESC LIMIT 100`) as typeof meetings;
  } catch {
    // table may not exist yet — treat as empty
  }

  const now = Date.now();

  return (
    <div>
      <h1>Meetings</h1>
      <p className="sub">
        Log a booked meeting. The team is notified immediately, and the attendee gets automatic
        reminders (24h + 1h before) on the cron tick.
      </p>

      <div className="grid cols-2">
        <form className="card" action={addMeetingAction}>
          <h2 style={{ marginTop: 0 }}>Add meeting</h2>
          <MeetingFields senders={senders} />
          <button type="submit">Save meeting &amp; notify team</button>
        </form>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Logged meetings</h2>
          {meetings.length === 0 ? (
            <div className="empty">No meetings yet.</div>
          ) : (
            <div className="table-scroll" style={{ border: "none" }}>
              <table>
                <thead>
                  <tr><th>Person</th><th>When</th><th>Rem.</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {meetings.map((m) => {
                    const upcoming = new Date(m.meeting_at).getTime() > now;
                    return (
                      <tr key={m.id}>
                        <td>
                          {m.person_name}
                          {m.company ? <div className="hint">{m.company}</div> : null}
                          <div className="hint">{m.email}</div>
                          {m.phone ? <div className="hint">{m.phone}</div> : null}
                        </td>
                        <td className="hint">
                          {fmt(m.meeting_at)}
                          <div>
                            <span className={`badge ${upcoming ? "scheduled" : "completed"}`}>
                              {upcoming ? "upcoming" : "past"}
                            </span>
                          </div>
                        </td>
                        <td className="hint">
                          24h {m.sent_24h ? "✓" : "·"}<br />1h {m.sent_1h ? "✓" : "·"}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <Link
                              className="btn ghost"
                              href={`/meetings/${m.id}/edit`}
                              style={{ padding: "4px 10px", fontSize: 12 }}
                            >
                              Edit
                            </Link>
                            <form action={deleteMeetingAction} style={{ display: "inline" }}>
                              <input type="hidden" name="id" value={m.id} />
                              <button
                                className="danger"
                                type="submit"
                                style={{ padding: "4px 10px", fontSize: 12 }}
                              >
                                Delete
                              </button>
                            </form>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
