import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const XLSX_PATH =
  "F:/olum.ai/outreach-mailer graph api 02/outreach-mailer/data/Singapore List (4).xlsx";

const results: string[] = [];
const ok = (m: string) => (results.push("✅ " + m), console.log("✅", m));
const er = (m: string) => (results.push("❌ " + m), console.log("❌", m));

async function main() {
  const { parseWorkbook, listSheets } = await import("../src/lib/excel");
  const { sql } = await import("../src/lib/db");

  const f = readFileSync(XLSX_PATH);
  const buf = f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength);

  // 1) listSheets
  const sheets = await listSheets(buf);
  sheets.length > 1
    ? ok(`listSheets returned ${sheets.length} sheets: ${sheets.map((s) => `${s.name}(${s.count})`).join(", ")}`)
    : er(`expected multiple sheets, got ${sheets.length}`);

  // 2) all-sheets parse == default
  const all = (await parseWorkbook(buf)).rows;
  const allExplicit = (await parseWorkbook(buf, sheets.map((s) => s.name))).rows;
  all.length === allExplicit.length
    ? ok(`all-sheets parse consistent (${all.length} recipients)`)
    : er(`all vs explicit mismatch: ${all.length} vs ${allExplicit.length}`);

  // 3) single-sheet filter returns a strict subset
  const one = sheets.find((s) => s.count > 0)!;
  const subset = (await parseWorkbook(buf, [one.name])).rows;
  subset.length > 0 && subset.length < all.length && subset.length <= one.count
    ? ok(`single-sheet filter "${one.name}" -> ${subset.length} recipients (subset of ${all.length})`)
    : er(`single-sheet filter wrong: ${subset.length} (sheet count ${one.count}, total ${all.length})`);

  // 4) two-sheet selection
  const two = sheets.filter((s) => s.count > 0).slice(0, 2).map((s) => s.name);
  const twoRes = (await parseWorkbook(buf, two)).rows;
  twoRes.length > subset.length
    ? ok(`two-sheet selection (${two.join(", ")}) -> ${twoRes.length} recipients`)
    : er(`two-sheet selection not larger than single (${twoRes.length} vs ${subset.length})`);

  // 5) meeting UPDATE resets reminder flags (mimics updateMeetingAction SQL)
  const [ins] = (await sql`
    INSERT INTO meetings (person_name, email, phone, meeting_at, sender_key, sent_24h, sent_1h)
    VALUES ('Edit Test', 'edit@example.invalid', '+91 11111 11111',
            now() + interval '2 hours', '1', true, true)
    RETURNING id`) as { id: number }[];
  await sql`
    UPDATE meetings SET person_name='Edited Name', phone='+91 22222 22222',
      meeting_at = now() + interval '30 hours', sent_24h=false, sent_1h=false
    WHERE id=${ins.id}`;
  const [upd] = (await sql`
    SELECT person_name, phone, sent_24h, sent_1h FROM meetings WHERE id=${ins.id}`) as {
    person_name: string; phone: string; sent_24h: boolean; sent_1h: boolean;
  }[];
  upd.person_name === "Edited Name" && upd.phone === "+91 22222 22222" && !upd.sent_24h && !upd.sent_1h
    ? ok("meeting UPDATE applies edits and re-arms reminder flags")
    : er(`update wrong: ${JSON.stringify(upd)}`);

  // 6) meeting DELETE
  await sql`DELETE FROM meetings WHERE id=${ins.id}`;
  const [{ n }] = (await sql`SELECT count(*)::int n FROM meetings WHERE id=${ins.id}`) as { n: number }[];
  n === 0 ? ok("meeting DELETE removes the row") : er(`delete failed, ${n} rows remain`);

  const failed = results.filter((r) => r.startsWith("❌"));
  console.log(`\n${"─".repeat(48)}\n${failed.length ? "SOME FAILED" : "ALL PASSED ✅"}  (${results.length - failed.length}/${results.length})`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
