import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
async function main() {
  const { sql } = await import("../src/lib/db");
  const res = (await sql`
    UPDATE events e
    SET detail = COALESCE(e.detail, '{}'::jsonb) || jsonb_build_object('name', c.name)
    FROM campaigns c
    WHERE e.type LIKE 'campaign_%' AND e.ref = c.id::text AND NOT (e.detail ? 'name')
    RETURNING e.id`) as { id: number }[];
  console.log(`backfilled ${res.length} campaign event(s) with names`);
}
main().catch((e) => { console.error(e); process.exit(1); });
