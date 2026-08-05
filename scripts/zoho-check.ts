import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
async function main() {
  const { getSender, getSenderKeys } = await import("../src/lib/env");
  const { verifySmtp } = await import("../src/lib/smtp");
  const { pollInbox } = await import("../src/lib/imap");

  for (const key of getSenderKeys()) {
    const s = getSender(key);
    if (!s.email || !s.pass) {
      console.log(`sender ${key}: creds not set yet — skipping`);
      continue;
    }
    console.log(`\nsender ${key} → ${s.email}  (login user: ${s.user})`);
    console.log(`  SMTP ${s.smtpHost}:${s.smtpPort}  IMAP ${s.imapHost}:${s.imapPort}`);
    try {
      await verifySmtp(s);
      console.log("  ✅ SMTP login OK");
    } catch (e) {
      console.log(`  ❌ SMTP login FAILED: ${(e as Error).message.slice(0, 200)}`);
    }
    try {
      const msgs = await pollInbox(s, new Date(Date.now() - 3600_000).toISOString(), 1);
      console.log(`  ✅ IMAP OK (inbox reachable, sampled ${msgs.length})`);
    } catch (e) {
      console.log(`  ❌ IMAP FAILED: ${(e as Error).message.slice(0, 200)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
