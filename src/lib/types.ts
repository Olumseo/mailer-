// Numbered sender key ("1", "2", …). Which keys are active is derived from
// the SENDER_EMAIL_N env vars, so adding senders is config-only.
export type SenderKey = string;

/** How a mailbox talks to the world. Zoho mailboxes use SMTP+IMAP with an
 *  app password; Microsoft 365 / Outlook mailboxes use Graph, because M365 has
 *  retired basic-auth SMTP. Set per sender with SENDER_TRANSPORT_N. */
export type Transport = "smtp" | "graph";

/** How an SMTP/IMAP mailbox authenticates. "password" is an app-specific
 *  password; "oauth2" is XOAUTH2 with a Google OAuth refresh token, for
 *  accounts that cannot or will not enable 2-Step Verification. */
export type SmtpAuth = "password" | "oauth2";

export interface Sender {
  key: SenderKey;
  displayName: string;
  email: string;
  title: string; // "" => team tone
  bookingLink: string;
  transport: Transport;
  // Zoho SMTP (send) + IMAP (reply polling) — transport "smtp"
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  user: string; // login (usually the email)
  pass: string; // app-specific password (auth "password")
  smtpAuth: SmtpAuth;
  // Google OAuth (auth "oauth2") — one Cloud project, one refresh token each
  googleClientId: string;
  googleClientSecret: string;
  googleRefreshToken: string;
  // Microsoft Graph client credentials — transport "graph"
  graphTenantId: string;
  graphClientId: string;
  graphClientSecret: string;
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
