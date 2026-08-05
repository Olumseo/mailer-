import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
process.env.MAX_SENDS_PER_TICK = "0"; // never send during diagnosis

async function main() {
  const { processDueSends, pollReplies, processMeetingReminders } = await import("../src/lib/engine");

  const time = async (label: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      const out = await fn();
      console.log(`✅ ${label}: ${Date.now() - t0}ms ->`, JSON.stringify(out));
    } catch (e) {
      console.log(`❌ ${label}: ${Date.now() - t0}ms threw: ${(e as Error).message}`);
    }
  };

  console.log("Diagnosing engine steps (send limit forced to 0)…\n");
  await time("processDueSends", processDueSends);
  await time("pollReplies", pollReplies);
  await time("processMeetingReminders", processMeetingReminders);
  console.log("\nDone.");
  process.exit(0);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
