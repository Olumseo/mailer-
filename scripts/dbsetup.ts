import { readFileSync } from "node:fs";

async function main() {
  // Load .env manually (tsx doesn't auto-load it).
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

  const { ensureSchema, sql, withRetry } = await import("../src/lib/db");

  console.log(
    "DB host:",
    (process.env.DATABASE_URL || "").replace(/:[^:@]+@/, ":****@").split("@")[1]
  );

  try {
    const [{ now }] = (await withRetry(() => sql`SELECT now()`, 5)) as { now: string }[];
    console.log("✅ Connected. Server time:", now);
  } catch (e) {
    console.error("❌ Connection failed after retries:", (e as Error).message);
    process.exit(1);
  }

  await withRetry(() => ensureSchema(), 5);
  console.log("✅ Tables created / verified.");

  const tables = (await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' ORDER BY table_name`) as { table_name: string }[];
  console.log("Tables now present:", tables.map((t) => t.table_name).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
