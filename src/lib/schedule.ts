import type { DelayConfig, BusinessHours } from "./types";

// ─── Humanised delay maths (ported from the CLI base) ────────────────
// Instead of sleeping, we turn the same gaussian + jitter distribution
// into a list of future timestamps and store them. The cron tick then
// sends whatever is due. Timing stays mathematically unpredictable.

/** Box–Muller transform → gaussian random clamped to [min, max]. */
function gaussianRandom(min: number, max: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  const mid = (min + max) / 2;
  const spread = (max - min) / 6; // 99.7% inside range
  return Math.max(min, Math.min(max, mid + z * spread));
}

/** Seconds to wait before send i+1, given how many have already gone out. */
function gapSeconds(sentSoFar: number, cfg: DelayConfig): number {
  if (sentSoFar > 0 && sentSoFar % cfg.pauseEveryN === 0) {
    // periodic "coffee break"
    return Math.round(gaussianRandom(cfg.pauseMinSec, cfg.pauseMaxSec));
  }
  const base = gaussianRandom(cfg.minDelaySec, cfg.maxDelaySec);
  const jitter = base * (0.85 + Math.random() * 0.3); // ±15%
  return Math.round(jitter);
}

// ─── Business-hours gating ───────────────────────────────────────────
// Uses a fixed UTC offset (Singapore = +8, no DST) so we avoid pulling
// in a timezone library. Sends never fire at 3am or on weekends.

/** Push `date` forward to the next moment inside the sending window.
 *  When the window is disabled, return the time unchanged (send any time). */
export function clampToBusinessHours(date: Date, bh: BusinessHours): Date {
  if (!bh.enabled) return date;
  const offsetMs = bh.tzOffsetHours * 3600_000;
  // Read wall-clock parts in the target offset by shifting then using UTC getters.
  let localMs = date.getTime() + offsetMs;
  let local = new Date(localMs);

  for (let guard = 0; guard < 14; guard++) {
    const day = local.getUTCDay(); // 0 Sun … 6 Sat
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;

    if (!bh.sendDays.includes(day)) {
      // not an allowed send day — jump to next day's start hour
      local = startOfNextDay(local, bh.startHour);
    } else if (hour < bh.startHour) {
      local.setUTCHours(bh.startHour, 0, 0, 0);
    } else if (hour >= bh.endHour) {
      local = startOfNextDay(local, bh.startHour);
    } else {
      break; // inside the window
    }
    localMs = local.getTime();
  }

  return new Date(local.getTime() - offsetMs);
}

function startOfNextDay(local: Date, startHour: number): Date {
  const d = new Date(local.getTime());
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(startHour, 0, 0, 0);
  return d;
}

/**
 * Compute send timestamps for `count` recipients starting at `startAt`,
 * honouring delays and the business-hours window.
 */
export function computeSchedule(
  count: number,
  startAt: Date,
  cfg: DelayConfig,
  bh: BusinessHours
): Date[] {
  const times: Date[] = [];
  let cursor = clampToBusinessHours(startAt, bh);

  for (let i = 0; i < count; i++) {
    times.push(cursor);
    const gap = gapSeconds(i + 1, cfg);
    cursor = clampToBusinessHours(new Date(cursor.getTime() + gap * 1000), bh);
  }
  return times;
}

/** Fisher–Yates shuffle (so batches aren't city-clustered). */
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
