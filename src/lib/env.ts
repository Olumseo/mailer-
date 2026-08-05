import type { Sender, SenderKey, DelayConfig, BusinessHours } from "./types";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Build a Zoho sender from its numbered env vars. Secrets never leave the server.
 *  Uses opt() (not req()) so UI pages still render before creds are filled in;
 *  the SMTP/IMAP layer throws a clear error if email/pass are missing. */
export function getSender(key: SenderKey): Sender {
  return {
    key,
    displayName: opt(`SENDER_NAME_${key}`, `Sender ${key}`),
    email: opt(`SENDER_EMAIL_${key}`),
    title: opt(`SENDER_TITLE_${key}`),
    bookingLink: opt(`BOOKING_LINK_${key}`),
    smtpHost: opt("ZOHO_SMTP_HOST", "smtp.zoho.in"),
    smtpPort: num("ZOHO_SMTP_PORT", 465),
    imapHost: opt("ZOHO_IMAP_HOST", "imap.zoho.in"),
    imapPort: num("ZOHO_IMAP_PORT", 993),
    user: opt(`SMTP_USER_${key}`) || opt(`SENDER_EMAIL_${key}`),
    pass: opt(`SMTP_PASS_${key}`),
  };
}

/** Active sender keys = every SENDER_EMAIL_N that's set (scans 1..12). */
export function getSenderKeys(): SenderKey[] {
  const keys: SenderKey[] = [];
  for (let i = 1; i <= 12; i++) {
    if ((process.env[`SENDER_EMAIL_${i}`] ?? "").trim()) keys.push(String(i));
  }
  return keys.length ? keys : ["1"];
}

export function getAllSenders(): Sender[] {
  return getSenderKeys().map(getSender);
}

// ─── Product-feedback (users report) campaigns ───────────────────────

/** Which mailbox sends the users-report campaign. Defaults to Barath's. */
export function getReportSenderKey(): SenderKey {
  const keys = getSenderKeys();
  const explicit = opt("REPORT_SENDER");
  if (explicit && keys.includes(explicit)) return explicit;
  const barath = keys.find((k) => /^barath@/i.test(opt(`SENDER_EMAIL_${k}`)));
  return barath ?? keys[0];
}

/** Name used in the "grab 15 minutes with X, our founder" line. */
export const getFounderName = () => opt("FOUNDER_NAME", "Rohan");

/** Domains whose users are our own staff — never mailed as customers.
 *  Derived from the sender mailboxes plus INTERNAL_DOMAINS, so it keeps
 *  working if the product domain changes. */
export function getInternalDomains(): string[] {
  const fromSenders = getSenderKeys()
    .map((k) => opt(`SENDER_EMAIL_${k}`).split("@")[1]?.toLowerCase())
    .filter(Boolean) as string[];
  const extra = opt("INTERNAL_DOMAINS", "olum.ai")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...fromSenders, ...extra])];
}

/** Substrings that mark a signup as one of our own test accounts (e.g. the
 *  team's personal Gmails). Defaults to the senders' first names. */
export function getTeamEmailHints(): string[] {
  const override = opt("TEAM_EMAIL_HINTS");
  const raw = override
    ? override.split(",")
    : [...getSenderKeys().map((k) => opt(`SENDER_NAME_${k}`).split(/\s+/)[0]), "test"];
  return [...new Set(raw.map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3))];
}

export function getDelayConfig(): DelayConfig {
  return {
    minDelaySec: num("DELAY_MIN_SEC", 45),
    maxDelaySec: num("DELAY_MAX_SEC", 120),
    pauseEveryN: num("PAUSE_EVERY_N", 7),
    pauseMinSec: num("PAUSE_MIN_SEC", 180),
    pauseMaxSec: num("PAUSE_MAX_SEC", 480),
  };
}

function parseSendDays(): number[] {
  // BUSINESS_SEND_DAYS: comma-separated day numbers (0=Sun … 6=Sat).
  const raw = process.env.BUSINESS_SEND_DAYS;
  if (raw) {
    const days = [
      ...new Set(
        raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
      ),
    ];
    if (days.length) return days;
  }
  // Back-compat: if the old flag explicitly allowed weekends, allow all days.
  if (process.env.BUSINESS_SKIP_WEEKENDS === "false") return [0, 1, 2, 3, 4, 5, 6];
  // Default: Monday–Saturday (Saturday allowed, Sunday off).
  return [1, 2, 3, 4, 5, 6];
}

export function getBusinessHours(): BusinessHours {
  return {
    // BUSINESS_HOURS_ENABLED=false => send 24/7, any day.
    enabled: opt("BUSINESS_HOURS_ENABLED", "true") !== "false",
    tzOffsetHours: num("BUSINESS_TZ_OFFSET", 8),
    startHour: num("BUSINESS_START_HOUR", 9),
    endHour: num("BUSINESS_END_HOUR", 18),
    sendDays: parseSendDays(),
  };
}

// Timezone the team enters meeting times in (IST = UTC+5:30, no DST).
export const getMeetingTzOffset = () => num("MEETING_TZ_OFFSET", 5.5);

export const CRON_SECRET = () => req("CRON_SECRET");
export const ACCESS_PASSWORD = () => req("ACCESS_PASSWORD");
export const NOTIFY_EMAIL = () => opt("NOTIFY_EMAIL", "barath@olum.ai");
export const NOTIFY_SENDER = () => (opt("NOTIFY_SENDER", "1") as SenderKey);
export const MAX_SENDS_PER_TICK = () => num("MAX_SENDS_PER_TICK", 4);
