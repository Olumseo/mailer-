// Numbered sender key ("1", "2", …). Which keys are active is derived from
// the SENDER_EMAIL_N env vars, so adding senders is config-only.
export type SenderKey = string;

export interface Sender {
  key: SenderKey;
  displayName: string;
  email: string;
  title: string; // "" => team tone
  bookingLink: string;
  // Zoho SMTP (send) + IMAP (reply polling)
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  user: string; // login (usually the email)
  pass: string; // Zoho app-specific password
}

export interface DelayConfig {
  minDelaySec: number;
  maxDelaySec: number;
  pauseEveryN: number;
  pauseMinSec: number;
  pauseMaxSec: number;
}

export interface BusinessHours {
  /** When false, the window is ignored entirely — send any time, any day. */
  enabled: boolean;
  tzOffsetHours: number;
  startHour: number;
  endHour: number;
  /** Days sending is allowed, 0=Sun … 6=Sat. Default Mon–Sat. */
  sendDays: number[];
}

export type RecipientStatus =
  | "pending"
  | "scheduled"
  | "sent"
  | "failed"
  | "replied"
  | "skipped";

export type CampaignStatus = "draft" | "running" | "paused" | "completed";

export interface ParsedRow {
  name: string;
  email: string;
  website?: string;
  phone?: string;
  service?: string;
}
