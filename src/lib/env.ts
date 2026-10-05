import type { Sender, SenderKey, DelayConfig, BusinessHours, Transport, SmtpAuth } from "./types";

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

/** A sender's transport. Explicit SENDER_TRANSPORT_N wins; otherwise a mailbox
 *  that has Graph credentials but no SMTP password is inferred as Graph, so
 *  adding an M365 mailbox needs no extra flag. */
function getTransport(key: SenderKey): Transport {
  const explicit = opt(`SENDER_TRANSPORT_${key}`).trim().toLowerCase();
  if (explicit === "graph" || explicit === "smtp") return explicit;
  const hasGraph = !!opt(`GRAPH_CLIENT_ID_${key}`).trim();
  const hasSmtpPass = !!opt(`SMTP_PASS_${key}`).trim();
  return hasGraph && !hasSmtpPass ? "graph" : "smtp";
}

interface MailHosts {
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
}

/** Known provider host/port pairs, so adding a mailbox is one env var instead
 *  of four. All use implicit TLS (465 SMTP / 993 IMAP). */
const PROVIDERS: Record<string, MailHosts> = {
  gmail: { smtpHost: "smtp.gmail.com", smtpPort: 465, imapHost: "imap.gmail.com", imapPort: 993 },
  zoho: { smtpHost: "smtp.zoho.in", smtpPort: 465, imapHost: "imap.zoho.in", imapPort: 993 },
  "zoho-com": { smtpHost: "smtp.zoho.com", smtpPort: 465, imapHost: "imap.zoho.com", imapPort: 993 },
};

/** A sender's mail hosts. Precedence: explicit SMTP_HOST_N/IMAP_HOST_N →
 *  SENDER_PROVIDER_N preset → preset inferred from the address domain →
 *  the ZOHO_* globals (so the original senders keep working untouched). */
function getHosts(key: SenderKey): MailHosts {
  const domain = opt(`SENDER_EMAIL_${key}`).split("@")[1]?.toLowerCase() ?? "";
  const named = opt(`SENDER_PROVIDER_${key}`).trim().toLowerCase();
  const preset =
    PROVIDERS[named] ??
    (domain === "gmail.com" || domain === "googlemail.com" ? PROVIDERS.gmail : null);

  const base: MailHosts = preset ?? {
    smtpHost: opt("ZOHO_SMTP_HOST", "smtp.zoho.in"),
    smtpPort: num("ZOHO_SMTP_PORT", 465),
    imapHost: opt("ZOHO_IMAP_HOST", "imap.zoho.in"),
    imapPort: num("ZOHO_IMAP_PORT", 993),
  };

  return {
    smtpHost: opt(`SMTP_HOST_${key}`) || base.smtpHost,
    smtpPort: num(`SMTP_PORT_${key}`, base.smtpPort),
    imapHost: opt(`IMAP_HOST_${key}`) || base.imapHost,
    imapPort: num(`IMAP_PORT_${key}`, base.imapPort),
  };
}

/** Build a sender from its numbered env vars. Secrets never leave the server.
 *  Uses opt() (not req()) so UI pages still render before creds are filled in;
 *  the SMTP/Graph layer throws a clear error if credentials are missing. */
export function getSender(key: SenderKey): Sender {
  const hosts = getHosts(key);
  return {
    key,
    displayName: opt(`SENDER_NAME_${key}`, `Sender ${key}`),
    email: opt(`SENDER_EMAIL_${key}`),
    title: opt(`SENDER_TITLE_${key}`),
    bookingLink: opt(`BOOKING_LINK_${key}`),
    transport: getTransport(key),
    ...hosts,
    user: opt(`SMTP_USER_${key}`) || opt(`SENDER_EMAIL_${key}`),
    pass: opt(`SMTP_PASS_${key}`),
    // A refresh token means XOAUTH2; otherwise fall back to an app password.
    smtpAuth: (opt(`GOOGLE_REFRESH_TOKEN_${key}`).trim()
      ? "oauth2"
      : "password") as SmtpAuth,
    // One Cloud project normally covers every Gmail mailbox; the refresh token
    // is always per mailbox, since it represents that account's consent.
    googleClientId: opt(`GOOGLE_CLIENT_ID_${key}`) || opt("GOOGLE_CLIENT_ID"),
    googleClientSecret: opt(`GOOGLE_CLIENT_SECRET_${key}`) || opt("GOOGLE_CLIENT_SECRET"),
    googleRefreshToken: opt(`GOOGLE_REFRESH_TOKEN_${key}`),
    // One tenant covers every M365 mailbox; per-sender override is allowed in
    // case a mailbox ever lives in a different directory.
    graphTenantId: opt(`GRAPH_TENANT_ID_${key}`) || opt("GRAPH_TENANT_ID"),
    graphClientId: opt(`GRAPH_CLIENT_ID_${key}`),
    graphClientSecret: opt(`GRAPH_CLIENT_SECRET_${key}`),
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

/** Which mailbox sends the users-report campaign. Set REPORT_SENDER; the
 *  first configured sender is the fallback. */
export function getReportSenderKey(): SenderKey {
  const keys = getSenderKeys();
  const explicit = opt("REPORT_SENDER");
  if (explicit && keys.includes(explicit)) return explicit;
  return keys[0];
}

/** Name used in the "grab 15 minutes with X, our founder" line. Falls back to
 *  sender 1's first name rather than a name hardcoded into the source. */
export const getFounderName = () =>
  opt("FOUNDER_NAME") || opt("SENDER_NAME_1").split(/\s+/)[0] || "";

/** Domains whose users are our own staff — never mailed as customers.
 *  Derived from the sender mailboxes plus INTERNAL_DOMAINS, so it keeps
 *  working if the product domain changes. */
/** Free/public mailbox providers. A sender on one of these is still just one
 *  person — treating its whole domain as "our staff" would silently exclude
 *  every consumer signup from report campaigns. */
const PUBLIC_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "zohomail.com",
]);

export function getInternalDomains(): string[] {
  const fromSenders = getSenderKeys()
    .map((k) => opt(`SENDER_EMAIL_${k}`).split("@")[1]?.toLowerCase())
    .filter((d): d is string => !!d && !PUBLIC_MAIL_DOMAINS.has(d));
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
/** Falls back to sender 1's mailbox rather than a hardcoded address, so no
 *  real inbox is baked into the source. */
export const NOTIFY_EMAIL = () =>
  opt("NOTIFY_EMAIL") || opt(`SENDER_EMAIL_${NOTIFY_SENDER()}`);
export const NOTIFY_SENDER = () => (opt("NOTIFY_SENDER", "1") as SenderKey);
export const MAX_SENDS_PER_TICK = () => num("MAX_SENDS_PER_TICK", 4);

/** Strip credentials out of text before it goes into an HTTP response.
 *  Driver errors love to quote the connection string back at you, and cron
 *  responses are read by a third-party scheduler's log viewer. */
export function redactSecrets(text: string): string {
  let out = text
    // postgres://user:pass@host → postgres://***:***@host
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^:@/\s]+:[^@/\s]+@/gi, "$1***:***@");
  for (const name of [
    "DATABASE_URL",
    "CRON_SECRET",
    "ACCESS_PASSWORD",
    "GOOGLE_CLIENT_SECRET",
  ]) {
    const v = process.env[name];
    if (v && v.length >= 8) out = out.split(v).join(`<${name}>`);
  }
  for (let i = 1; i <= 12; i++) {
    for (const name of [
      `SMTP_PASS_${i}`,
      `GRAPH_CLIENT_SECRET_${i}`,
      `GOOGLE_REFRESH_TOKEN_${i}`,
    ]) {
      const p = process.env[name];
      if (p && p.length >= 6) out = out.split(p).join(`<${name}>`);
    }
  }
  return out;
}
