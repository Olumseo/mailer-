import { readFileSync } from "node:fs";
import { getAllSenders, getSender } from "../src/lib/env";
import { verifySmtp, sendMail } from "../src/lib/smtp";

// Same .env loader the other scripts use (no dotenv dependency). env.ts reads
// process.env lazily inside getSender(), so loading here is early enough.
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Check every configured mailbox can authenticate — SMTP/IMAP mailboxes via a
// login handshake, Microsoft 365 ones via a Graph token + mailbox lookup:
//   npm run verify:mail
// Narrow it, or send a real test email to yourself:
//   npx tsx scripts/verify-senders.ts --sender 6
//   npx tsx scripts/verify-senders.ts --transport graph
//   npx tsx scripts/verify-senders.ts --sender 6 --send you@example.com

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? null : process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

async function main() {
  const only = arg("sender");
  const wantTransport = arg("transport");
  const sendTo = arg("send");

  let senders = only ? [getSender(only)] : getAllSenders();
  if (wantTransport) senders = senders.filter((s) => s.transport === wantTransport);

  if (senders.length === 0) {
    console.log("No matching senders configured.");
    return;
  }

  let bad = 0;
  for (const s of senders) {
    const where = s.transport === "graph" ? "Graph" : `${s.smtpHost}:${s.smtpPort}`;
    process.stdout.write(`[${s.key}] ${s.email} via ${where} ... `);
    try {
      await verifySmtp(s);
      console.log("OK - credentials accepted");
    } catch (e) {
      bad++;
      console.log(`FAILED - ${(e as Error).message}`);
      continue;
    }

    if (sendTo) {
      try {
        const body = `Test message from the outreach app, sent as ${s.email} over ${where}.`;
        await sendMail({
          sender: s,
          to: sendTo,
          subject: `Mail test from ${s.email}`,
          text: body,
          html: `<p>${body}</p>`,
        });
        console.log(`     sent a test to ${sendTo} - check the inbox AND Sent Items`);
      } catch (e) {
        bad++;
        console.log(`     send FAILED - ${(e as Error).message}`);
      }
    }
  }
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
