import type { Transporter } from "nodemailer"; // type-only (erased at build)
import type { Sender } from "./types";

// ─── Zoho SMTP sender (replaces Microsoft Graph) ─────────────────────
// nodemailer is loaded via dynamic import so it isn't pulled into the
// server-action bundle graph (its Node built-ins break that trace).

const transporters = new Map<string, Transporter>();

async function getTransport(sender: Sender): Promise<Transporter> {
  const cached = transporters.get(sender.email);
  if (cached) return cached;
  const nodemailer = (await import("nodemailer")).default;
  const t = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: { user: sender.user, pass: sender.pass },
    // Fail fast instead of hanging a serverless invocation.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  transporters.set(sender.email, t);
  return t;
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
  if (!sender.email || !sender.pass) {
    throw new Error(
      `Zoho SMTP not configured for sender ${sender.key} — set SENDER_EMAIL_${sender.key} and SMTP_PASS_${sender.key}.`
    );
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
  if (!sender.email || !sender.pass) {
    throw new Error(`missing SENDER_EMAIL_${sender.key} / SMTP_PASS_${sender.key}`);
  }
  const t = await getTransport(sender);
  await t.verify();
}
