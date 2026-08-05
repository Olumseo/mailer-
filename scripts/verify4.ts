import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ok = (m: string) => console.log("✅", m);
const er = (m: string) => { console.log("❌", m); process.exitCode = 1; };

async function main() {
  const { parseWorkbook } = await import("../src/lib/excel");
  const { createCampaign } = await import("../src/lib/engine");
  const { sql, logEvent, recordSentEmail } = await import("../src/lib/db");

  // 1) parse stats add up
  const f = readFileSync("F:/olum.ai/outreach-mailer graph api 02/outreach-mailer/data/Singapore List (4).xlsx");
  const p = await parseWorkbook(f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength));
  p.total === p.rows.length + p.duplicates + p.invalid
    ? ok(`parse stats consistent: ${p.total} scanned = ${p.rows.length} unique + ${p.duplicates} duplicates + ${p.invalid} invalid`)
    : er(`stats don't add up: ${JSON.stringify({ total: p.total, rows: p.rows.length, dup: p.duplicates, inv: p.invalid })}`);

  // 2) createCampaign stores duplicates_removed + dashboard SUM reflects it
  const id = await createCampaign({
    name: "__dup_test__", subject: "s", bodyTemplate: "b {{company}}",
    rows: [{ name: "X", email: "x@example.invalid" }], duplicatesRemoved: 5,
  });
  const [c] = (await sql`SELECT duplicates_removed FROM campaigns WHERE id=${id}`) as { duplicates_removed: number }[];
  const [agg] = (await sql`SELECT COALESCE(SUM(duplicates_removed),0)::int s FROM campaigns`) as { s: number }[];
  (c.duplicates_removed === 5 && agg.s >= 5)
    ? ok(`campaign stores duplicates_removed=${c.duplicates_removed}; dashboard SUM=${agg.s}`)
    : er(`duplicates_removed wrong: row=${c.duplicates_removed} sum=${agg.s}`);
  await sql`DELETE FROM campaigns WHERE id=${id}`;

  // 3) sent email persisted to the DB
  const marker = `verify4-${Date.now()}@example.invalid`;
  await recordSentEmail({ campaignId: null, sender: "barath@olum.ai", to: marker, company: "LogCo", subject: "S", body: "B" });
  const found = (await sql`SELECT id FROM sent_emails WHERE to_email=${marker}`) as { id: number }[];
  if (found.length === 1) { ok("sent email persisted to sent_emails table"); await sql`DELETE FROM sent_emails WHERE to_email=${marker}`; }
  else er(`sent_emails row missing (found ${found.length})`);

  // 4) event delete + clear
  await logEvent("verify_evt_a", "r1", {});
  await logEvent("verify_evt_b", "r2", {});
  const evs = (await sql`SELECT id FROM events WHERE type LIKE 'verify_evt_%' ORDER BY id`) as { id: number }[];
  await sql`DELETE FROM events WHERE id=${evs[0].id}`;
  const [afterDel] = (await sql`SELECT count(*)::int n FROM events WHERE type LIKE 'verify_evt_%'`) as { n: number }[];
  afterDel.n === 1 ? ok("single-event delete works") : er(`expected 1 remaining, got ${afterDel.n}`);
  await sql`DELETE FROM events WHERE type LIKE 'verify_evt_%'`;
  const [afterClear] = (await sql`SELECT count(*)::int n FROM events WHERE type LIKE 'verify_evt_%'`) as { n: number }[];
  afterClear.n === 0 ? ok("clear (bulk delete) works") : er(`clear failed, ${afterClear.n} remain`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
