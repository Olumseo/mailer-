import { readFileSync } from "node:fs";

// Load .env the same way tick.ts does — env.ts derives internal domains and
// team hints from the sender config.
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Safe despite import hoisting: env.ts reads process.env inside its getters,
// not at module scope, so the .env load above still applies.
import { parseUsersReport, summarise, SEGMENT_ORDER } from "../src/lib/report";
import { REPORT_COPY } from "../src/lib/report-templates";
import {
  renderFor,
  buildRows,
  selectRecipients,
  emptyCopy,
  defaultIncluded,
} from "../src/lib/report-campaign";
import {
  getSender,
  getReportSenderKey,
  getInternalDomains,
  getTeamEmailHints,
} from "../src/lib/env";

// Validates the users-report pipeline end to end — parsing, segmentation,
// exclusions and rendering — without a database or a single email leaving.
//   npx tsx scripts/report-selftest.ts [path-to-report.xlsx]

const reportPath =
  process.argv[2] || "C:/Users/Asus/Downloads/Olum_Prod_Users_Report.xlsx";

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const buf = readFileSync(reportPath);
  const parsed = await parseUsersReport(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    { internalDomains: getInternalDomains(), teamHints: getTeamEmailHints() }
  );

  console.log(`\n[report] sheet "${parsed.sheetName}" — ${parsed.users.length} users, ` +
    `${parsed.duplicates} dupes, ${parsed.skipped} skipped`);
  console.log(`[report] internal domains: ${getInternalDomains().join(", ")}`);
  console.log(`[report] team hints: ${getTeamEmailHints().join(", ")}\n`);

  const counts = summarise(parsed.users);
  console.log("[segments] mailable users per segment:");
  for (const s of SEGMENT_ORDER) {
    console.log(`  ${String(counts[s]).padStart(3)}  ${s.padEnd(18)} ${REPORT_COPY[s].label}`);
  }

  const excluded = parsed.users.filter((u) => u.excluded);
  console.log(`\n[excluded] ${excluded.length}:`);
  for (const u of excluded) console.log(`  ${String(u.excluded).padEnd(11)} ${u.email}`);

  const flagged = parsed.users.filter((u) => !u.excluded && u.teamHint);
  console.log(`\n[team?] ${flagged.length} unticked by default:`);
  for (const u of flagged) console.log(`  ${u.email}`);

  const sender = getSender(getReportSenderKey());
  const cfg = {
    bookingLink: "https://cal.com/barath/15min",
    founderName: "Rohan",
    segments: [...SEGMENT_ORDER],
    includeEmails: null,
    includeTeamHints: false,
    includeInternal: false,
    copy: emptyCopy(),
  };

  console.log(`\n[sender] ${sender.displayName} <${sender.email}>\n`);

  // ── Rendering ──
  for (const seg of SEGMENT_ORDER) {
    const u = parsed.users.find((x) => x.segment === seg && defaultIncluded(x, cfg));
    if (!u) {
      console.log(`── ${seg}: no mailable user\n`);
      continue;
    }
    const { subject, body } = renderFor(u, cfg, sender);
    console.log(`──────── ${seg} — ${u.email} (${u.name}) ────────`);
    console.log(`Subject: ${subject}\n`);
    console.log(body);
    console.log("");
  }

  // ── Assertions across every recipient, every segment ──
  const chosen = selectRecipients(parsed.users, cfg);
  check(chosen.length > 0, "recipients selected", `${chosen.length}`);
  check(
    chosen.every((u) => !u.excluded && !u.teamHint),
    "no excluded or team-flagged user is selected by default"
  );

  let leftoverPlaceholder = 0;
  let leftoverSpintax = 0;
  let blankLineRun = 0;
  let missingSignoff = 0;
  let noLink = 0;
  for (const u of chosen) {
    // Render each user several times so every spintax branch gets exercised.
    for (let i = 0; i < 8; i++) {
      const { subject, body } = renderFor(u, cfg, sender);
      const both = `${subject}\n${body}`;
      if (/\{\{|\}\}/.test(both)) leftoverPlaceholder++;
      if (/[{}|]/.test(both)) leftoverSpintax++;
      if (/\n{3,}/.test(body)) blankLineRun++;
      if (!body.includes(sender.displayName)) missingSignoff++;
      if (!body.includes(cfg.bookingLink)) noLink++;
    }
  }
  check(leftoverPlaceholder === 0, "no unresolved {{placeholders}}", `${leftoverPlaceholder}`);
  check(leftoverSpintax === 0, "no unresolved spintax braces", `${leftoverSpintax}`);
  check(blankLineRun === 0, "no runs of blank lines", `${blankLineRun}`);
  check(missingSignoff === 0, "every email is signed by the sender", `${missingSignoff}`);
  check(noLink === 0, "every email carries the booking link", `${noLink}`);

  // Greeting must never invent a name.
  const badGreeting = chosen.filter((u) => {
    const g = renderFor(u, cfg, sender).body.split("\n")[0];
    return !/^Hi (there|[A-ZÀ-Þ][\p{L}'-]{2,})$/u.test(g.replace(/,$/, ""));
  });
  check(badGreeting.length === 0, "greetings are a real first name or 'Hi there'",
    badGreeting.map((u) => `${u.name} -> ${renderFor(u, cfg, sender).body.split("\n")[0]}`).join("; "));

  // Dropping the link must not leave a dangling paragraph.
  const noLinkCfg = { ...cfg, bookingLink: "" };
  const sample = renderFor(chosen[0], noLinkCfg, sender);
  check(!/\n{3,}/.test(sample.body), "meeting block removed cleanly when no link is set");

  // Campaign rows carry per-recipient copy and vars.
  const rows = buildRows(chosen, cfg, sender);
  check(rows.length === chosen.length, "one campaign row per recipient");
  check(
    rows.every((r) => r.subjectOverride && r.bodyOverride && r.vars?.greeting),
    "every row carries its own subject, body and vars"
  );
  check(
    new Set(rows.map((r) => r.bodyOverride)).size === new Set(chosen.map((u) => u.segment)).size,
    "distinct body per segment, shared within a segment"
  );

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
