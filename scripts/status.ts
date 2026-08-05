import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Read-only snapshot: what would the mailer/cron do right now?
async function main() {
  const { sql } = await import("../src/lib/db");

  const camps = (await sql`
    SELECT c.id, c.name, c.status,
      count(r.*)::int total,
      count(*) FILTER (WHERE r.status='sent')::int sent,
      count(*) FILTER (WHERE r.status='scheduled')::int scheduled,
      count(*) FILTER (WHERE r.status='scheduled' AND r.next_send_at <= now() AND c.status='running')::int due_now,
      count(*) FILTER (WHERE r.status='replied')::int replied,
      count(*) FILTER (WHERE r.status='failed')::int failed
    FROM campaigns c LEFT JOIN recipients r ON r.campaign_id=c.id
    GROUP BY c.id ORDER BY c.id DESC`) as Array<Record<string, number | string>>;

  console.log("\nCAMPAIGNS");
  if (!camps.length) console.log("  (none)");
  for (const c of camps) {
    console.log(`  #${c.id} "${c.name}" [${c.status}] — total ${c.total}, sent ${c.sent}, scheduled ${c.scheduled}, DUE NOW ${c.due_now}, replied ${c.replied}, failed ${c.failed}`);
  }

  const [rem] = (await sql`
    SELECT count(*)::int n FROM meetings
    WHERE meeting_at > now() AND (
      (remind_24h AND NOT sent_24h AND meeting_at <= now() + interval '24 hours') OR
      (remind_1h  AND NOT sent_1h  AND meeting_at <= now() + interval '1 hour'))`) as { n: number }[];

  const [sentTotal] = (await sql`SELECT count(*)::int n FROM sent_emails`) as { n: number }[];

  const due = camps.reduce((a, c) => a + (c.due_now as number), 0);
  console.log(`\nIf you run 'npm run mailer' now:`);
  console.log(`  • ${due} campaign email(s) are DUE and would start sending (up to ${process.env.MAX_SENDS_PER_TICK || 4} per tick)`);
  console.log(`  • ${rem.n} meeting reminder(s) would fire`);
  console.log(`  • sent_emails archive currently holds ${sentTotal.n} row(s)\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
