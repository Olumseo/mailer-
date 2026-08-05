import { readFileSync } from "node:fs";

// Load .env (tsx doesn't auto-load).
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const XLSX_PATH =
  "F:/olum.ai/outreach-mailer graph api 02/outreach-mailer/data/Singapore List (4).xlsx";

const pass: string[] = [];
const warn: string[] = [];
const fail: string[] = [];
const ok = (m: string) => (pass.push(m), console.log("✅", m));
const wn = (m: string) => (warn.push(m), console.log("⚠️ ", m));
const er = (m: string) => (fail.push(m), console.log("❌", m));

async function main() {
  const { sql, ensureSchema } = await import("../src/lib/db");
  const { getAllSenders } = await import("../src/lib/env");
  const { verifySmtp } = await import("../src/lib/smtp");
  const { pollInbox } = await import("../src/lib/imap");
  const { parseWorkbook } = await import("../src/lib/excel");
  const { createCampaign, startCampaign } = await import("../src/lib/engine");

  await ensureSchema();

  // 1) Schema: phone column exists on meetings
  const cols = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'meetings'`) as { column_name: string }[];
  const colNames = cols.map((c) => c.column_name);
  colNames.includes("phone")
    ? ok("meetings.phone column present")
    : er("meetings.phone column MISSING");

  // 2) Zoho SMTP: each sender can authenticate (no email sent)
  const senders = getAllSenders();
  for (const s of senders) {
    if (!s.email || !s.pass) {
      wn(`sender ${s.key}: SENDER_EMAIL_${s.key}/SMTP_PASS_${s.key} not set yet — skipping SMTP check`);
      continue;
    }
    try {
      await verifySmtp(s);
      ok(`Zoho SMTP login OK for sender ${s.key} (${s.email})`);
    } catch (e) {
      er(`Zoho SMTP login FAILED for ${s.email}: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  // 3) Zoho IMAP reply-poll capability — read-only, safe
  const s0 = senders[0];
  if (s0.email && s0.pass) {
    try {
      const msgs = await pollInbox(s0, new Date(Date.now() - 3600_000).toISOString(), 1);
      ok(`Zoho IMAP works for ${s0.email} (inbox reachable, ${msgs.length} recent msg sampled)`);
    } catch (e) {
      er(`IMAP error for ${s0.email}: ${(e as Error).message.slice(0, 120)}`);
    }
  } else {
    wn("IMAP check skipped — sender 1 creds not set");
  }

  // 4) Campaign lifecycle (DB only — created campaign is DELETED, never sent)
  const fbuf = readFileSync(XLSX_PATH);
  const { rows } = await parseWorkbook(
    fbuf.buffer.slice(fbuf.byteOffset, fbuf.byteOffset + fbuf.byteLength)
  );
  let testCampaignId = 0;
  try {
    testCampaignId = await createCampaign({
      name: `__verify__ ${Date.now()}`,
      subject: "verify",
      bodyTemplate: "Hi {{company}} — {{senderName}}",
      rows,
    });
    const [dist] = (await sql`
      SELECT count(*)::int total,
        count(*) FILTER (WHERE sender_key='1')::int s1,
        count(*) FILTER (WHERE sender_key='2')::int s2,
        count(*) FILTER (WHERE sender_key='3')::int s3
      FROM recipients WHERE campaign_id=${testCampaignId}`) as {
      total: number; s1: number; s2: number; s3: number;
    }[];
    dist.total === rows.length
      ? ok(`createCampaign inserted ${dist.total} recipients (split ${dist.s1}/${dist.s2}/${dist.s3} across senders)`)
      : er(`recipient count mismatch: inserted ${dist.total} vs parsed ${rows.length}`);

    await startCampaign(testCampaignId);
    const [sched] = (await sql`
      SELECT count(*)::int scheduled,
        count(*) FILTER (WHERE next_send_at IS NULL)::int missing,
        min(next_send_at) first_at, max(next_send_at) last_at
      FROM recipients WHERE campaign_id=${testCampaignId} AND status='scheduled'`) as {
      scheduled: number; missing: number; first_at: string; last_at: string;
    }[];
    // Verify all scheduled sends land inside SGT business hours (9–18, weekdays)
    const times = (await sql`
      SELECT next_send_at FROM recipients WHERE campaign_id=${testCampaignId}`) as {
      next_send_at: string;
    }[];
    let outside = 0;
    for (const t of times) {
      const loc = new Date(new Date(t.next_send_at).getTime() + 8 * 3600_000);
      const d = loc.getUTCDay(), h = loc.getUTCHours();
      if (d === 0 || h < 9 || h >= 18) outside++; // Sunday off; Mon–Sat allowed
    }
    sched.scheduled === rows.length && sched.missing === 0
      ? ok(`startCampaign scheduled all ${sched.scheduled} with timestamps (window ${new Date(sched.first_at).toISOString()} → ${new Date(sched.last_at).toISOString()})`)
      : er(`scheduling incomplete: scheduled=${sched.scheduled}, missing next_send_at=${sched.missing}`);
    outside === 0
      ? ok(`all ${times.length} sends fall inside SGT business hours`)
      : er(`${outside} sends land outside business hours`);
  } finally {
    if (testCampaignId) {
      await sql`DELETE FROM campaigns WHERE id=${testCampaignId}`;
      ok(`cleaned up verify campaign #${testCampaignId}`);
    }
  }

  // 5) Due-claim mechanics (scoped to a throwaway fake campaign — no real send)
  const [fake] = (await sql`
    INSERT INTO campaigns (name, subject, body_template, status)
    VALUES ('__claimtest__', 's', 'b', 'running') RETURNING id`) as { id: number }[];
  await sql`
    INSERT INTO recipients (campaign_id, name, email, sender_key, status, next_send_at)
    VALUES (${fake.id}, 'FakeCo', 'nobody@example.invalid', '1', 'scheduled', now() - interval '1 minute')`;
  const claimed = (await sql`
    UPDATE recipients SET status='sending'
    WHERE id IN (
      SELECT r.id FROM recipients r JOIN campaigns c ON c.id=r.campaign_id
      WHERE r.campaign_id=${fake.id} AND r.status='scheduled'
        AND r.next_send_at <= now() AND c.status='running'
      ORDER BY r.next_send_at ASC LIMIT 4 FOR UPDATE SKIP LOCKED)
    RETURNING id, email`) as { id: number; email: string }[];
  claimed.length === 1 && claimed[0].email === "nobody@example.invalid"
    ? ok("due-send claim query selects & locks the correct recipient")
    : er(`claim query returned ${claimed.length} rows (expected 1)`);
  await sql`DELETE FROM campaigns WHERE id=${fake.id}`;

  // 6) Meetings + reminder-due logic (direct DB, no notify email sent)
  const [mtg] = (await sql`
    INSERT INTO meetings (person_name, company, email, phone, meeting_at, sender_key, remind_1h)
    VALUES ('Verify Person', 'VerifyCo', 'meet@example.invalid', '+91 90000 00000',
            now() + interval '30 minutes', '1', true)
    RETURNING id, phone`) as { id: number; phone: string }[];
  mtg.phone === "+91 90000 00000"
    ? ok("meeting insert stores mobile number")
    : er(`mobile not stored (got ${mtg.phone})`);
  const dueRem = (await sql`
    SELECT id FROM meetings
    WHERE meeting_at > now() AND remind_1h AND NOT sent_1h
      AND meeting_at <= now() + interval '1 hour' AND id=${mtg.id}`) as { id: number }[];
  dueRem.length === 1
    ? ok("reminder-due query picks up the upcoming meeting (1h window)")
    : er("reminder-due query missed the upcoming meeting");
  await sql`DELETE FROM meetings WHERE id=${mtg.id}`;
  ok("cleaned up verify meeting");

  // ── summary ──
  console.log(`\n${"─".repeat(50)}`);
  console.log(`PASS ${pass.length}   WARN ${warn.length}   FAIL ${fail.length}`);
  if (warn.length) console.log("\nWarnings:\n" + warn.map((w) => "  • " + w).join("\n"));
  if (fail.length) {
    console.log("\nFailures:\n" + fail.map((f) => "  • " + f).join("\n"));
    process.exit(1);
  }
  console.log("\nAll critical functionality verified ✅");
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
