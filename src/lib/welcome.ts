// Login welcome: the founder's one-time "you're in — want a demo?" email.
//
//   olum-backend (any successful sign-in) ─▶ POST /api/hooks/login
//     ─▶ handleLoginEvent(): first time we've seen this user?
//          ├─ internal / disposable / team-test account → recorded as skipped
//          └─ claim → render the branded email → send from the founder's
//             mailbox now → recipient of the "Login welcome" campaign (so a
//             reply is detected like any other) + Sent log
//
// At most one email per user and per address, ever: the backend reports every
// sign-in and this decides. A failed send is retried on their next sign-in.
// No approval step and no business-hours wait — it's a reply to something the
// person just did. Off unless LOGIN_WELCOME_ENABLED=true.

import { sql, ensureSchemaOnce, logEvent, recordSentEmail, withSchema } from "./db";
import { getInternalDomains, getSender, getTeamEmailHints, getWelcomeConfig } from "./env";
import { classifyExclusion, personFirstName } from "./report";
import { composeEmail } from "./template";
import { sendMail } from "./smtp";
import type { Sender } from "./types";

export interface LoginEvent {
  user_id: string;
  email: string;
  full_name?: string;
  provider?: string;
  plan?: string;
  signed_up_at?: string | null;
  logged_in_at?: string | null;
}

export interface WelcomeCopy {
  subject: string;
  body: string;
}

export const DEFAULT_WELCOME: WelcomeCopy = {
  subject: "{Welcome to Olum{{commaName}}|You're in{{commaName}} — welcome to Olum}",
  body: `<p>{{greeting}},</p>

<p>{{senderName}} here, founder of Olum. You've just signed in successfully — welcome aboard.</p>

<p>If anything is unclear, or you'd like a quick walkthrough of how to get the most out of Olum — where ChatGPT, Perplexity and Google's AI answers mention you, who they recommend instead, and what to fix first — book a 20-minute demo with me:</p>

{{demoButton}}

<p>{Or just reply to this email — it comes straight to me.|Rather write? Just reply — I read every one.}</p>

{{signature}}`,
};

const KV_SUBJECT = "welcome_subject";
const KV_BODY = "welcome_body";

export async function getWelcomeCopy(): Promise<WelcomeCopy & { edited: boolean }> {
  await ensureSchemaOnce();
  const rows = (await sql`
    SELECT key, value FROM kv WHERE key IN (${KV_SUBJECT}, ${KV_BODY})`) as { key: string; value: string | null }[];
  const got = Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""]));
  const subject = got[KV_SUBJECT]?.trim() || DEFAULT_WELCOME.subject;
  const body = got[KV_BODY]?.trim() || DEFAULT_WELCOME.body;
  return { subject, body, edited: Boolean(got[KV_SUBJECT]?.trim() || got[KV_BODY]?.trim()) };
}

export async function saveWelcomeCopy(copy: WelcomeCopy | null): Promise<void> {
  await ensureSchemaOnce();
  if (!copy) {
    await sql`DELETE FROM kv WHERE key IN (${KV_SUBJECT}, ${KV_BODY})`;
    return;
  }
  for (const [key, value] of [[KV_SUBJECT, copy.subject], [KV_BODY, copy.body]] as const) {
    await sql`INSERT INTO kv (key, value, updated_at) VALUES (${key}, ${value}, now())
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }
}

/** Placeholder values for one person. */
export function welcomeVars(name: string, sender: Pick<Sender, "bookingLink" | "displayName">, dashboardUrl: string) {
  const firstName = personFirstName(name);
  return {
    greeting: firstName ? `Hi ${firstName}` : "Hi there",
    firstName,
    // ", Priya" or nothing — so "Welcome to Olum{{commaName}}" reads well either way.
    commaName: firstName ? `, ${firstName}` : "",
    bookingLink: sender.bookingLink,
    demoLabel: sender.displayName ? `Book a demo with ${sender.displayName}` : "Book a 20-minute demo",
    dashboardLink: dashboardUrl,
  };
}

export type WelcomeResult =
  | { status: "sent"; email: string }
  | { status: "skipped" | "already" | "disabled" | "invalid"; reason: string }
  | { status: "failed"; reason: string };

/** The "Login welcome" campaign every welcome is a recipient of. */
async function welcomeCampaign(): Promise<number> {
  const [found] = (await withSchema(() => sql`
    SELECT id FROM campaigns WHERE kind = 'welcome' ORDER BY id LIMIT 1`)) as { id: number }[];
  if (found) return found.id;
  const [c] = (await withSchema(() => sql`
    INSERT INTO campaigns (name, subject, body_template, source_file, status, kind, started_at)
    VALUES ('Login welcome', '(per recipient — sent on first sign-in)', '(per recipient)',
            'backend login hook', 'running', 'welcome', now())
    RETURNING id`)) as { id: number }[];
  await logEvent("campaign_created", String(c.id), { name: "Login welcome", kind: "welcome" });
  return c.id;
}

export async function handleLoginEvent(
  evt: LoginEvent,
  deps: { send?: typeof sendMail } = {}
): Promise<WelcomeResult> {
  const cfg = getWelcomeConfig();
  if (!cfg.enabled) return { status: "disabled", reason: "LOGIN_WELCOME_ENABLED is not true" };

  const userId = String(evt.user_id ?? "").trim();
  const email = String(evt.email ?? "").trim().toLowerCase();
  const name = String(evt.full_name ?? "").trim();
  if (!userId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: "invalid", reason: "user_id and a valid email are required" };
  }

  await ensureSchemaOnce();

  // Already handled this person (or this address under another account)?
  // Only a failed attempt is worth another go.
  const [prev] = (await sql`
    SELECT status FROM login_welcomes
    WHERE user_id = ${userId} OR lower(email) = ${email}
    ORDER BY (status = 'sent') DESC LIMIT 1`) as { status: string }[];
  if (prev && prev.status !== "failed") {
    await sql`UPDATE login_welcomes SET logins = logins + 1, last_login_at = now() WHERE user_id = ${userId}`;
    return { status: "already", reason: prev.status };
  }

  const { excluded, teamHint } = classifyExclusion(
    { email, role: "user", notes: "" },
    { internalDomains: getInternalDomains(), teamHints: getTeamEmailHints() }
  );
  const skip = excluded ?? (teamHint ? "team account" : null);
  if (skip) {
    await sql`
      INSERT INTO login_welcomes (user_id, email, name, status, reason)
      VALUES (${userId}, ${email}, ${name || null}, 'skipped', ${skip})
      ON CONFLICT (user_id) DO NOTHING`;
    return { status: "skipped", reason: skip };
  }

  // Claim atomically: two sign-ins a second apart must not both send.
  const claimed = (await sql`
    INSERT INTO login_welcomes (user_id, email, name, status)
    VALUES (${userId}, ${email}, ${name || null}, 'sending')
    ON CONFLICT (user_id) DO UPDATE
      SET status = 'sending', reason = NULL, email = EXCLUDED.email, name = EXCLUDED.name,
          logins = login_welcomes.logins + 1, last_login_at = now()
      WHERE login_welcomes.status = 'failed'
    RETURNING user_id`) as { user_id: string }[];
  if (!claimed.length) return { status: "already", reason: "being sent" };

  const sender = getSender(cfg.senderKey);
  const copy = await getWelcomeCopy();
  const extra = welcomeVars(name, sender, cfg.dashboardUrl);
  const mail = composeEmail({ subject: copy.subject, body: copy.body, company: name || email, sender, extra });

  const campaignId = await welcomeCampaign();
  const [rec] = (await withSchema(() => sql`
    INSERT INTO recipients (campaign_id, name, email, sender_key, segment, subject_override,
                            body_override, vars, status)
    VALUES (${campaignId}, ${name || email}, ${email}, ${cfg.senderKey}, 'welcome', ${copy.subject},
            ${copy.body}, ${JSON.stringify(extra)}::jsonb, 'sending')
    ON CONFLICT (campaign_id, email) DO UPDATE
      SET status = 'sending', error = NULL, sender_key = EXCLUDED.sender_key
      WHERE recipients.status = 'failed'
    RETURNING id`)) as { id: number }[];
  if (!rec) {
    await sql`UPDATE login_welcomes SET status = 'sent', reason = 'already in the welcome campaign'
              WHERE user_id = ${userId}`;
    return { status: "already", reason: "already in the welcome campaign" };
  }

  try {
    await (deps.send ?? sendMail)({
      sender,
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      headers: {
        "List-Unsubscribe": `<mailto:${sender.email}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (err) {
    const msg = (err as Error).message.slice(0, 500);
    await sql`UPDATE recipients SET status = 'failed', error = ${msg} WHERE id = ${rec.id}`;
    await sql`UPDATE login_welcomes SET status = 'failed', reason = ${msg}, recipient_id = ${rec.id}
              WHERE user_id = ${userId}`;
    await logEvent("welcome_failed", email, { error: msg });
    return { status: "failed", reason: msg };
  }

  await sql`UPDATE recipients SET status = 'sent', sent_at = now(), error = NULL WHERE id = ${rec.id}`;
  await sql`UPDATE login_welcomes SET status = 'sent', sent_at = now(), recipient_id = ${rec.id}
            WHERE user_id = ${userId}`;
  try {
    await recordSentEmail({
      campaignId,
      recipientId: rec.id,
      sender: sender.email,
      to: email,
      company: name || email,
      subject: mail.subject,
      body: mail.text,
      html: mail.html,
    });
  } catch (logErr) {
    await logEvent("sentlog_failed", String(rec.id), { error: (logErr as Error).message.slice(0, 200) });
  }
  await logEvent("welcome_sent", email, { provider: evt.provider ?? "", sender: sender.email });
  return { status: "sent", email };
}
