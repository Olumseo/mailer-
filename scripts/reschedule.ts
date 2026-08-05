import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
// Usage: npx tsx scripts/reschedule.ts <campaignId>
async function main() {
  const id = Number(process.argv[2]);
  if (!id) { console.error("pass a campaign id: npx tsx scripts/reschedule.ts <id>"); process.exit(1); }
  const { rescheduleCampaign } = await import("../src/lib/engine");
  const { sql } = await import("../src/lib/db");
  const n = await rescheduleCampaign(id);
  const [w] = (await sql`
    SELECT min(next_send_at) first, max(next_send_at) last
    FROM recipients WHERE campaign_id=${id} AND status='scheduled'`) as
    { first: string; last: string }[];
  console.log(`rescheduled ${n} recipient(s) for campaign #${id}`);
  console.log(`first send: ${new Date(w.first).toISOString()}  (IST ${new Date(w.first).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})})`);
  console.log(`last send:  ${new Date(w.last).toISOString()}  (IST ${new Date(w.last).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})})`);
}
main().catch((e) => { console.error(e); process.exit(1); });
