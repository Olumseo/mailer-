import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
async function main() {
  const { sql } = await import("../src/lib/db");
  const machine = Date.now();
  const [{ db }] = (await sql`SELECT extract(epoch from now())*1000 AS db`) as { db: number }[];
  const skewSec = Math.round((machine - Number(db)) / 1000);
  console.log("machine now:", new Date(machine).toISOString());
  console.log("DB now     :", new Date(Number(db)).toISOString());
  console.log(`SKEW: machine is ${skewSec}s ${skewSec>=0?"AHEAD of":"BEHIND"} the DB (${(skewSec/60).toFixed(1)} min)`);
}
main().catch(e=>{console.error(e);process.exit(1);});
