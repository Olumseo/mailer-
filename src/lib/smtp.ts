import type { Transporter } from "nodemailer"; // type-only (erased at build)
import type { Sender } from "./types";
import { sendMailGraph, verifyGraph } from "./graph";
import { getGoogleAccessToken } from "./google-oauth";

// ─── Outbound mail: Zoho SMTP, or Microsoft Graph per sender ─────────
// sendMail() is the single send entry point for the whole app; it routes on
// sender.transport so callers never care which mailbox provider is behind it.
// nodemailer is loaded via dynamic import so it isn't pulled into the
// server-action bundle graph (its Node built-ins break that trace).

const transporters = new Map<string, Transporter>();

async function getTransport(sender: Sender): Promise<Transporter> {
  const cached = transporters.get(sender.email);
  if (cached) return cached;
  const nodemailer = (await import("nodemailer")).default;

  // XOAUTH2: hand nodemailer the refresh token and let it mint access tokens,
  // so a cached transporter keeps working past the first token's hour.
  const auth =
    sender.smtpAuth === "oauth2"
      ? {
          type: "OAuth2" as const,
          user: sender.email,
          clientId: sender.googleClientId,
          clientSecret: sender.googleClientSecret,
          refreshToken: sender.googleRefreshToken,
        }
      : { user: sender.user, pass: sender.pass };

  const t = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth,
    // Fail fast instead of hanging a serverless invocation.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  transporters.set(sender.email, t);
  return t;
}

/** Credentials present for the sender's auth mode? Returns a reason if not. */
function missingCredentials(sender: Sender): string | null {
  if (!sender.email) return `SENDER_EMAIL_${sender.key}`;
  if (sender.smtpAuth === "oauth2") {
    if (!sender.googleClientId) return "GOOGLE_CLIENT_ID";
    if (!sender.googleClientSecret) return "GOOGLE_CLIENT_SECRET";
    if (!sender.googleRefreshToken) return `GOOGLE_REFRESH_TOKEN_${sender.key}`;
    return null;
  }
  if (!sender.pass) return `SMTP_PASS_${sender.key}`;
  return null;
}

export interface SendMailArgs {
  sender: Sender;
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative — multipart text+HTML improves deliverability. */
  text?: string;
  headers?: Record<string, string>;
}

export async function sendMail(args: SendMailArgs): Promise<void> {
  const { sender } = args;
  if (sender.transport === "graph") return sendMailGraph(args);
  const missing = missingCredentials(sender);
  if (missing) {
    throw new Error(`SMTP not configured for sender ${sender.key} — set ${missing}.`);
  }
  const t = await getTransport(sender);
  await t.sendMail({
    from: { name: sender.displayName, address: sender.email },
    to: args.to,
    replyTo: sender.email,
    subject: args.subject,
    text: args.text,
    html: args.html,
    headers: args.headers,
  });
}

/** Verify a mailbox's SMTP login without sending (used by the setup check). */
export async function verifySmtp(sender: Sender): Promise<void> {
  if (sender.transport === "graph") return verifyGraph(sender);
  const missing = missingCredentials(sender);
  if (missing) throw new Error(`missing ${missing}`);
  const t = await getTransport(sender);
  await t.verify();
}
