import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// ─── Local mailer (PRIMARY send path) ────────────────────────────────
// A long-running process that runs the SAME send engine as the Vercel cron,
// but directly against the DB (no HTTP, no Next server needed). Because it
// shares the engine's atomic claim (FOR UPDATE SKIP LOCKED), it is safe to
// run alongside the Vercel cron (SECONDARY path) without double-sending.
//
//   npm run mailer            (send from this machine, forever)
//   MAILER_INTERVAL_SEC=15 npm run mailer

async function main() {
  const { processDueSends, pollReplies, processMeetingReminders } = await import("../src/lib/engine");
  const intervalMs = Number(process.env.MAILER_INTERVAL_SEC || 20) * 1000;

  console.log(`\n📮 Local mailer started — sending from this machine.`);
  console.log(`   Engine tick every ${intervalMs / 1000}s. Press Ctrl+C to stop.\n`);

  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    console.log("\n⏹  Stopping after the current tick…");
  });

  async function tick() {
    const stamp = new Date().toLocaleTimeString();
    try {
      const s = await processDueSends();
      const r = await pollReplies();
      const m = await processMeetingReminders();
      if (s.sent || s.failed || r.replies || m.reminders) {
        console.log(`${stamp}  ✉️  sent=${s.sent} failed=${s.failed} replies=${r.replies} reminders=${m.reminders}`);
      } else {
        console.log(`${stamp}  · idle (nothing due)`);
      }
    } catch (e) {
      console.error(`${stamp}  ⚠️  tick error: ${(e as Error).message}`);
    }
  }

  await tick();
  const timer = setInterval(async () => {
    if (stopping) {
      clearInterval(timer);
      console.log("Stopped.");
      process.exit(0);
    }
    await tick();
  }, intervalMs);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
