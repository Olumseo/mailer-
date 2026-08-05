import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
async function main() {
  const { sql } = await import("../src/lib/db");
  console.log("meetings before:", JSON.stringify(await sql`SELECT id, person_name, email FROM meetings ORDER BY id`));
  console.log("campaigns before:", JSON.stringify(await sql`SELECT id, name, status FROM campaigns ORDER BY id`));
  await sql`DELETE FROM meetings WHERE email LIKE '%example.invalid' OR person_name ILIKE '%test%' OR person_name = 'Edited Name'`;
  await sql`DELETE FROM campaigns WHERE name LIKE '\_\_%' OR name ILIKE '%verify%' OR name ILIKE '%claimtest%'`;
  await sql`DELETE FROM sent_emails WHERE to_email LIKE '%example.invalid'`;
  const [m2] = (await sql`SELECT count(*)::int n FROM meetings`) as { n: number }[];
  const [c2] = (await sql`SELECT count(*)::int n FROM campaigns`) as { n: number }[];
  console.log(`after cleanup -> meetings: ${m2.n}  campaigns: ${c2.n}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
