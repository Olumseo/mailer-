import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
async function main() {
  const { recordSentEmail } = await import("../src/lib/db");
  await recordSentEmail({
    campaignId: null,
    sender: "sender@example.invalid",
    to: "sent-http@example.invalid",
    company: "HTTP Sent Co",
    subject: "HTTP Sent Test",
    body: "This is the exact body that went out.\nLine two.",
  });
  console.log("inserted test sent_emails row");
}
main().catch((e) => { console.error(e); process.exit(1); });
