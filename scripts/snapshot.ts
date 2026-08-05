import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Captures the CURRENT live backend into data/snapshot.json for offline local
// dev. Always reads the real Neon DB (never the local snapshot).
async function main() {
  const { neon } = await import("@neondatabase/serverless");
  // neon() has no .query() before v1.0 — a plain string query is run by
  // calling the handle directly.
  const sql = neon(process.env.DATABASE_URL || "") as unknown as (
    text: string,
    params?: unknown[]
  ) => Promise<Record<string, unknown>[]>;
  const tables = ["campaigns", "recipients", "meetings", "sent_emails", "mailbox_state", "events"];

  const out: Record<string, unknown> = { capturedAt: new Date().toISOString() };
  for (const t of tables) {
    const rows = await sql(`SELECT * FROM ${t} ORDER BY 1`);
    out[t] = rows;
    console.log(`  ${t}: ${rows.length} rows`);
  }

  const dir = path.join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "snapshot.json");
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n✅ snapshot written to ${file}`);
  console.log(`   Flip USE_LOCAL_SNAPSHOT=true in .env to run the app from it (offline).`);
}
main().catch((e) => { console.error("snapshot failed:", e); process.exit(1); });
