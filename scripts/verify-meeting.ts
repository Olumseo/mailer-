import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Exercises the exact code the meeting form's server action runs:
// addMeeting -> DB insert (incl. mobile) -> live team notification email.
async function main() {
  const { addMeeting } = await import("../src/lib/engine");
  const { sql } = await import("../src/lib/db");
  const { NOTIFY_EMAIL } = await import("../src/lib/env");

  console.log(`Sending a test "meeting booked" notification to ${NOTIFY_EMAIL()} …`);

  const id = await addMeeting({
    personName: "Verification Test",
    company: "Olum QA",
    website: "https://olum.ai",
    email: "qa-test@example.invalid",
    phone: "+91 98765 43210",
    meetingId: "TEST-VERIFY-123",
    meetingAt: new Date(Date.now() + 26 * 3600_000).toISOString(), // ~26h out
    senderKey: "1",
    notes: "Automated end-to-end verification — safe to ignore.",
    remind24h: true,
    remind1h: true,
  });
  console.log("✅ addMeeting returned meeting id", id);

  const [row] = (await sql`
    SELECT person_name, phone, meeting_id FROM meetings WHERE id=${id}`) as {
    person_name: string; phone: string; meeting_id: string;
  }[];
  console.log("✅ row persisted:", row.person_name, "| mobile:", row.phone, "| mtgId:", row.meeting_id);

  const ev = (await sql`
    SELECT type FROM events WHERE ref='qa-test@example.invalid' ORDER BY id DESC LIMIT 1`) as {
    type: string;
  }[];
  if (ev[0]?.type === "meeting_booked") console.log("✅ team notification email SENT (event: meeting_booked)");
  else if (ev[0]?.type === "notify_failed") console.log("⚠️  meeting saved but notification failed (event: notify_failed) — check Graph perms");
  else console.log("⚠️  no notify event found");

  await sql`DELETE FROM meetings WHERE id=${id}`;
  console.log("✅ cleaned up test meeting");
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
