import type { Sender } from "@/lib/types";

export interface MeetingDefaults {
  personName?: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
  meetingId?: string;
  meetingAtLocal?: string; // "YYYY-MM-DDTHH:MM" in IST
  senderKey?: string;
  notes?: string;
  remind24h?: boolean;
  remind1h?: boolean;
}

/** Shared field set for the add + edit meeting forms. */
export function MeetingFields({
  senders,
  d = {},
}: {
  senders: Sender[];
  d?: MeetingDefaults;
}) {
  return (
    <>
      <div className="row">
        <div>
          <label>Person name *</label>
          <input name="personName" defaultValue={d.personName} required />
        </div>
        <div>
          <label>Email *</label>
          <input name="email" type="email" defaultValue={d.email} required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Mobile number</label>
          <input name="phone" type="tel" placeholder="+91 98765 43210" defaultValue={d.phone} />
        </div>
        <div>
          <label>Company</label>
          <input name="company" defaultValue={d.company} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Website</label>
          <input name="website" defaultValue={d.website} />
        </div>
        <div>
          <label>Meeting ID</label>
          <input name="meetingId" placeholder="Teams / Zoom / booking ref" defaultValue={d.meetingId} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Meeting time * (IST)</label>
          <input name="meetingAt" type="datetime-local" defaultValue={d.meetingAtLocal} required />
        </div>
      </div>
      <label>Host mailbox (sends reminders)</label>
      <select name="senderKey" defaultValue={d.senderKey ?? "1"}>
        {senders.map((s) => (
          <option key={s.key} value={s.key}>
            {s.displayName} — {s.email}
          </option>
        ))}
      </select>
      <label>Notes (included in reminder + team alert)</label>
      <textarea name="notes" style={{ minHeight: 80 }} defaultValue={d.notes} />
      <div className="actions">
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            name="remind24h"
            defaultChecked={d.remind24h ?? true}
            style={{ width: "auto" }}
          />{" "}
          24h reminder
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            name="remind1h"
            defaultChecked={d.remind1h ?? true}
            style={{ width: "auto" }}
          />{" "}
          1h reminder
        </label>
      </div>
    </>
  );
}
