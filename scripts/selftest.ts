import { readFileSync } from "node:fs";
import { parseWorkbook } from "../src/lib/excel";
import { renderTemplate, resolveSpintax, DEFAULT_TEMPLATE } from "../src/lib/template";
import { computeSchedule } from "../src/lib/schedule";
import type { Sender } from "../src/lib/types";

const xlsxPath =
  "F:/olum.ai/outreach-mailer graph api 02/outreach-mailer/data/Singapore List (4).xlsx";

async function main() {
  // 1) Excel parsing across all sheets
  const buf = readFileSync(xlsxPath);
  const { rows } = await parseWorkbook(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  );
  console.log(`[excel] parsed ${rows.length} unique recipients`);
  console.log("[excel] sample:", rows.slice(0, 3).map((r) => `${r.name} <${r.email}>`));

  // 2) Spintax uniqueness — renders should differ
  const sender: Sender = {
    key: "2", displayName: "Test Sender", email: "sender@example.invalid",
    title: "Founder, Example Co", bookingLink: "https://book.example/sender",
    smtpHost: "smtp.zoho.in", smtpPort: 465, imapHost: "imap.zoho.in", imapPort: 993,
    user: "sender@example.invalid", pass: "x",
  };
  const variants = new Set(
    Array.from({ length: 20 }, () =>
      renderTemplate(DEFAULT_TEMPLATE, { company: "Acme Bookkeeping", sender }).slice(0, 40)
    )
  );
  console.log(`[spintax] ${variants.size} distinct openings out of 20 renders`);
  console.log("[spintax] {a|b|c} sample:", resolveSpintax("{Hi|Hello|Hey} there"));

  // 3) Schedule stays inside business hours (SG, 9–18, weekdays)
  const bh = { enabled: true, tzOffsetHours: 8, startHour: 9, endHour: 18, sendDays: [1, 2, 3, 4, 5, 6] };
  const cfg = { minDelaySec: 45, maxDelaySec: 120, pauseEveryN: 7, pauseMinSec: 180, pauseMaxSec: 480 };
  const start = new Date(Date.UTC(2026, 6, 24, 15, 0, 0)); // Fri 23:00 SGT
  const times = computeSchedule(30, start, cfg, bh);
  let outside = 0;
  for (const t of times) {
    const local = new Date(t.getTime() + 8 * 3600_000);
    const day = local.getUTCDay();
    const hr = local.getUTCHours();
    if (!bh.sendDays.includes(day) || hr < 9 || hr >= 18) outside++;
  }
  console.log(`[schedule] first=${times[0].toISOString()} last=${times[29].toISOString()}`);
  console.log(`[schedule] out-of-window sends: ${outside} (expect 0)`);
  console.log(outside === 0 && rows.length > 0 && variants.size > 1 ? "\nALL OK ✅" : "\nCHECK ❌");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
