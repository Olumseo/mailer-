import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Round-trips a report campaign through the real schema on an in-memory
// Postgres, so the new recipient columns (segment / overrides / vars jsonb) are
// proven before anything touches Neon:
//   npm run report:dbtest [-- path/to/report.xlsx]
//
// Forced on before db.ts is loaded — everything below is imported dynamically
// inside main() so this assignment lands first and no query can reach Neon.
process.env.USE_LOCAL_SNAPSHOT = "true";
process.env.SNAPSHOT_PATH = "no-such-snapshot-for-report-dbtest.json";

const reportPath =
  process.argv[2] || "C:/Users/Asus/Downloads/Olum_Prod_Users_Report.xlsx";

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const { ensureSchema, sql, isSnapshotMode } = await import("../src/lib/db");
  const { createCampaign } = await import("../src/lib/engine");
  const { parseUsersReport, SEGMENT_ORDER } = await import("../src/lib/report");
  const { buildRows, selectRecipients, emptyCopy, renderFor } = await import(
    "../src/lib/report-campaign"
  );
  const { composeEmail } = await import("../src/lib/template");
  const { getSender, getReportSenderKey, getInternalDomains, getTeamEmailHints } =
    await import("../src/lib/env");

  if (!isSnapshotMode()) {
    console.error("Refusing to run: not in local-snapshot mode, this would hit Neon.");
    process.exit(1);
  }

  await ensureSchema();

  const buf = readFileSync(reportPath);
  const parsed = await parseUsersReport(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    { internalDomains: getInternalDomains(), teamHints: getTeamEmailHints() }
  );

  const senderKey = getReportSenderKey();
  const sender = getSender(senderKey);
  const cfg = {
    bookingLink: "https://cal.com/barath/15min",
    founderName: "Rohan",
    segments: [...SEGMENT_ORDER],
    includeEmails: null,
    includeTeamHints: false,
    includeInternal: false,
    copy: emptyCopy(),
  };

  const chosen = selectRecipients(parsed.users, cfg);
  const rows = buildRows(chosen, cfg, sender);

  const id = await createCampaign({
    name: "DB round-trip test",
    subject: rows[0].subjectOverride!,
    bodyTemplate: rows[0].bodyOverride!,
    sourceFile: "Olum_Prod_Users_Report.xlsx",
    rows,
    senderKey,
    kind: "report",
  });
  check(Number.isInteger(id), "campaign created", `id=${id}`);

  const [camp] = (await sql`SELECT kind FROM campaigns WHERE id = ${id}`) as { kind: string }[];
  check(camp.kind === "report", "campaign kind persisted", camp.kind);

  const stored = (await sql`
    SELECT name, email, sender_key, segment, subject_override, body_override, vars, website
    FROM recipients WHERE campaign_id = ${id}`) as Array<{
    name: string; email: string; sender_key: string; segment: string | null;
    subject_override: string | null; body_override: string | null;
    vars: Record<string, string> | null; website: string | null;
  }>;

  check(stored.length === chosen.length, "all recipients inserted", `${stored.length}/${chosen.length}`);
  check(stored.every((r) => r.sender_key === senderKey), "every recipient pinned to one mailbox", senderKey);
  check(stored.every((r) => r.segment && SEGMENT_ORDER.includes(r.segment as never)), "segment column populated");
  check(stored.every((r) => !!r.subject_override && !!r.body_override), "per-recipient copy stored");
  check(
    stored.every((r) => r.vars && typeof r.vars === "object" && typeof r.vars.greeting === "string"),
    "vars survived the jsonb round-trip"
  );

  // Exactly the columns processDueSends claims — proves the RETURNING clause.
  const claimed = (await sql`
    UPDATE recipients SET status = 'sending'
    WHERE id IN (SELECT id FROM recipients WHERE campaign_id = ${id} LIMIT 3)
    RETURNING id, campaign_id, name, email, sender_key, subject_override, body_override, vars`) as Array<{
    name: string; subject_override: string | null; body_override: string | null;
    vars: Record<string, string> | null; email: string;
  }>;
  check(claimed.length === 3, "send-claim query returns the new columns", `${claimed.length}`);

  // Rendering from the DB row must match rendering straight from the parser.
  let mismatches = 0;
  for (const r of claimed) {
    const user = chosen.find((u) => u.email === r.email)!;
    const fromDb = composeEmail({
      subject: r.subject_override ?? "",
      body: r.body_override!,
      company: r.name,
      sender,
      extra: r.vars ?? undefined,
    }).text;
    const direct = renderFor(user, cfg, sender).body;
    // Spintax differs per render, so compare the parts that must be identical.
    const strip = (s: string) => s.replace(/\s+/g, " ");
    if (!strip(fromDb).includes(user.firstName ? `Hi ${user.firstName}` : "Hi there")) mismatches++;
    if (user.primarySite && !strip(fromDb).includes(user.primarySite) &&
        strip(direct).includes(user.primarySite)) mismatches++;
    if (!fromDb.includes(cfg.bookingLink)) mismatches++;
  }
  check(mismatches === 0, "DB-rendered email matches the previewed one", `${mismatches}`);

  console.log(failures === 0 ? "\nAll DB checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
