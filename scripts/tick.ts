import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Local stand-in for cron-job.org: pings /api/cron so due emails actually send,
// replies get polled, and reminders fire — while developing on localhost.
//   npm run tick        (one tick)
//   npm run tick:loop   (every 60s, like production)
const KEY = process.env.CRON_SECRET;
const BASE = process.env.TICK_URL || "http://localhost:3000";

async function tickOnce() {
  if (!KEY) {
    console.error("CRON_SECRET missing in .env");
    process.exit(1);
  }
  try {
    const res = await fetch(`${BASE}/api/cron?key=${encodeURIComponent(KEY)}`);
    const data = await res.json().catch(() => ({}));
    console.log(new Date().toLocaleTimeString(), `HTTP ${res.status}`, JSON.stringify(data));
  } catch (e) {
    console.error(new Date().toLocaleTimeString(), "tick failed:", (e as Error).message);
  }
}

async function main() {
  if (process.argv.includes("--loop")) {
    console.log(`Ticking ${BASE}/api/cron every 60s. Ctrl+C to stop.`);
    await tickOnce();
    setInterval(tickOnce, 60_000);
  } else {
    await tickOnce();
  }
}
main();
