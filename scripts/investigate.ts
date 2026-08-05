import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
async function main() {
  const { sql } = await import("../src/lib/db");

  const [t] = (await sql`SELECT now() AS db_now`) as { db_now: string }[];
  console.log("DB now (UTC):", new Date(t.db_now).toISOString());
  console.log("DB now (IST):", new Date(t.db_now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }));

  const camps = (await sql`SELECT id, name, status FROM campaigns ORDER BY id DESC`) as
    { id: number; name: string; status: string }[];
  console.log("\nCampaigns:", JSON.stringify(camps));

  for (const c of camps) {
    const [agg] = (await sql`
      SELECT count(*)::int total,
        count(*) FILTER (WHERE status='scheduled')::int scheduled,
        count(*) FILTER (WHERE status='sending')::int sending,
        count(*) FILTER (WHERE status='sent')::int sent,
        count(*) FILTER (WHERE status='scheduled' AND next_send_at <= now())::int due_by_time,
        min(next_send_at) earliest, max(next_send_at) latest
      FROM recipients WHERE campaign_id=${c.id}`) as Array<Record<string, unknown>>;
    console.log(`\n#${c.id} "${c.name}" [${c.status}]`);
    console.log(`   total=${agg.total} scheduled=${agg.scheduled} sending=${agg.sending} sent=${agg.sent} due_by_time=${agg.due_by_time}`);
    console.log(`   earliest next_send_at: ${agg.earliest ? new Date(agg.earliest as string).toISOString() : "—"}`);
    console.log(`   latest   next_send_at: ${agg.latest ? new Date(agg.latest as string).toISOString() : "—"}`);

    // exactly what processDueSends' claim SELECT would see (without mutating)
    const wouldClaim = (await sql`
      SELECT r.id, r.email, r.next_send_at FROM recipients r
      JOIN campaigns c ON c.id=r.campaign_id
      WHERE r.status='scheduled' AND r.next_send_at <= now() AND c.status='running'
        AND r.campaign_id=${c.id}
      ORDER BY r.next_send_at ASC LIMIT 4`) as { id: number; email: string; next_send_at: string }[];
    console.log(`   claim-query would pick: ${wouldClaim.length} row(s)` +
      (wouldClaim.length ? ` -> ${wouldClaim.map(w => w.email).join(", ")}` : ""));
  }

  // any stuck in 'sending' (claimed but never completed)?
  const [stuck] = (await sql`SELECT count(*)::int n FROM recipients WHERE status='sending'`) as { n: number }[];
  console.log(`\nStuck in 'sending': ${stuck.n}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
