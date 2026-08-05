// Node-only instrumentation — imported ONLY when NEXT_RUNTIME === "nodejs"
// (see instrumentation.ts), so the engine + Zoho mail libs never get bundled
// for the edge runtime.
import { processDueSends, pollReplies, processMeetingReminders } from "./lib/engine";

// Auto-start the local mailer when opted in (never on Vercel).
if (process.env.ENABLE_LOCAL_MAILER === "true" && !process.env.VERCEL) {
  const g = globalThis as unknown as { __olumMailer?: boolean };
  if (!g.__olumMailer) {
    g.__olumMailer = true; // one loop per process, survives HMR
    const intervalMs = Math.max(5, Number(process.env.MAILER_INTERVAL_SEC || 20)) * 1000;
    console.log(`[local-mailer] auto-started — tick every ${intervalMs / 1000}s (ENABLE_LOCAL_MAILER=true)`);

    const tick = async () => {
      try {
        const s = await processDueSends();
        const r = await pollReplies();
        const m = await processMeetingReminders();
        if (s.sent || s.failed || r.replies || m.reminders) {
          console.log(
            `[local-mailer] sent=${s.sent} failed=${s.failed} replies=${r.replies} reminders=${m.reminders}`
          );
        }
      } catch (e) {
        console.error("[local-mailer] tick error:", (e as Error).message);
      }
    };

    const loop = () => {
      tick().finally(() => setTimeout(loop, intervalMs));
    };
    setTimeout(loop, 3000);
  }
}
