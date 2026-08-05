import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const ok = (m: string) => console.log("✅", m);
const er = (m: string) => { console.log("❌", m); process.exitCode = 1; };

async function main() {
  const { createCampaign } = await import("../src/lib/engine");
  const { sql } = await import("../src/lib/db");
  const rows = [
    { name: "Alpha Co", email: "a@example.invalid" },
    { name: "Beta Co", email: "b@example.invalid" },
  ];

  // create -> update -> verify -> delete -> verify gone (with cascade)
  const id = await createCampaign({ name: "__edit_logic__", subject: "S1", bodyTemplate: "B1 {{company}}", rows });
  await sql`UPDATE campaigns SET name='__edited__', subject='S2', body_template='B2 {{company}}' WHERE id=${id}`;
  const [u] = (await sql`SELECT name, subject, body_template FROM campaigns WHERE id=${id}`) as
    { name: string; subject: string; body_template: string }[];
  (u.name === "__edited__" && u.subject === "S2" && u.body_template === "B2 {{company}}")
    ? ok("campaign UPDATE applies name/subject/body") : er(`update wrong: ${JSON.stringify(u)}`);

  const [rc] = (await sql`SELECT count(*)::int n FROM recipients WHERE campaign_id=${id}`) as { n: number }[];
  await sql`DELETE FROM campaigns WHERE id=${id}`;
  const [gone] = (await sql`SELECT count(*)::int n FROM campaigns WHERE id=${id}`) as { n: number }[];
  const [orphan] = (await sql`SELECT count(*)::int n FROM recipients WHERE campaign_id=${id}`) as { n: number }[];
  (gone.n === 0 && orphan.n === 0)
    ? ok(`campaign DELETE removes campaign + cascades ${rc.n} recipients`) : er("delete/cascade failed");

  // leave one campaign for the HTTP render test
  const httpId = await createCampaign({ name: "__httptest__", subject: "HTTP subj", bodyTemplate: "hi {{company}}", rows });
  writeFileSync(new URL("../../.httpcamp", import.meta.url), String(httpId));
  ok(`created __httptest__ campaign #${httpId} for HTTP check`);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
