import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Proves the send engine survives a deploy against a database that predates the
// report-campaign columns. Builds the OLD schema by hand, then runs the normal
// create + claim path and checks it migrated itself instead of failing:
//   npm run report:migrationtest
process.env.USE_LOCAL_SNAPSHOT = "true";
process.env.SNAPSHOT_PATH = "no-such-snapshot-for-report-migrationtest.json";

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

// The schema exactly as it stood before report campaigns existed.
// One statement per entry — the query interface takes a single statement.
const OLD_SCHEMA = [
  // The snapshot DB boots on the *current* schema, so roll it back first.
  `DROP TABLE IF EXISTS recipients CASCADE`,
  `DROP TABLE IF EXISTS campaigns CASCADE`,
  `CREATE TABLE campaigns (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, subject TEXT NOT NULL,
    body_template TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
    source_file TEXT, duplicates_removed INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), started_at TIMESTAMPTZ)`,
  `CREATE TABLE recipients (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name TEXT NOT NULL, email TEXT NOT NULL, website TEXT, phone TEXT, service TEXT,
    sender_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    next_send_at TIMESTAMPTZ, sent_at TIMESTAMPTZ, replied_at TIMESTAMPTZ, error TEXT,
    UNIQUE (campaign_id, email))`,
];

async function main() {
  const { sql } = await import("../src/lib/db");
  const { createCampaign, processDueSends } = await import("../src/lib/engine");

  for (const stmt of OLD_SCHEMA) await sql.query(stmt);
  const before = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'recipients' AND column_name = 'subject_override'`) as unknown[];
  check(before.length === 0, "started on the pre-report schema");

  // A plain outreach campaign — the path every existing user is already on.
  const id = await createCampaign({
    name: "Legacy campaign on an un-migrated DB",
    subject: "Hello",
    bodyTemplate: "Hi {{company}},\n\nBest,\n{{senderName}}",
    rows: [{ name: "Acme", email: "someone@example.com" }],
  });
  check(Number.isInteger(id), "createCampaign migrated on demand and succeeded", `id=${id}`);

  const after = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'recipients'
      AND column_name IN ('segment','subject_override','body_override','vars')`) as Array<{
    column_name: string;
  }>;
  check(after.length === 4, "all report columns were added", after.map((c) => c.column_name).join(","));

  const kind = (await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'kind'`) as unknown[];
  check(kind.length === 1, "campaigns.kind was added");

  // Now the claim path. Nothing is due, so no mail can leave; what's being
  // tested is that the query runs at all instead of throwing.
  const res = await processDueSends();
  check(res.sent === 0 && res.failed === 0, "send tick ran cleanly", JSON.stringify(res));

  console.log(failures === 0 ? "\nMigration self-heal verified.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\nFAILED — the engine did not recover from the old schema:\n", e);
  process.exit(1);
});
