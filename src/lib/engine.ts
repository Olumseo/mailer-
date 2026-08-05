import { sql, logEvent, recordSentEmail, withSchema } from "./db";
import { getSender, getSenderKeys, getDelayConfig, getBusinessHours, MAX_SENDS_PER_TICK } from "./env";
import { sendMail } from "./smtp";
import { pollInbox } from "./imap";
import { renderTemplate, textToHtml, buildFooter } from "./template";
import type { Sender } from "./types";
import { computeSchedule, shuffle } from "./schedule";
import { notifyTeam } from "./notify";
import { fmt } from "./format";
import type { ParsedRow, SenderKey } from "./types";

// ─── Campaign creation ───────────────────────────────────────────────

/** A recipient may carry its own copy — report campaigns send different text
 *  per funnel segment, so subject/body/vars ride on the row and fall back to
 *  the campaign's template when absent. */
export interface CampaignRow extends ParsedRow {
  segment?: string;
  subjectOverride?: string;
  bodyOverride?: string;
  vars?: Record<string, string>;
}

export async function createCampaign(input: {
  name: string;
  subject: string;
  bodyTemplate: string;
  sourceFile?: string;
  rows: CampaignRow[];
  duplicatesRemoved?: number;
  /** Pin every recipient to one mailbox instead of round-robining senders. */
  senderKey?: SenderKey;
  kind?: string;
}): Promise<number> {
  const [camp] = (await withSchema(() => sql`
    INSERT INTO campaigns (name, subject, body_template, source_file, duplicates_removed, status, kind)
    VALUES (${input.name}, ${input.subject}, ${input.bodyTemplate}, ${input.sourceFile ?? null},
            ${input.duplicatesRemoved ?? 0}, 'draft', ${input.kind ?? "outreach"})
    RETURNING id`)) as { id: number }[];
  const campaignId = camp.id;

  // Round-robin the shuffled list across the 3 senders (like the CLI's 3
  // batches) — unless the campaign pins a single mailbox.
  const senders: SenderKey[] = getSenderKeys();
  const rows = shuffle(input.rows).map((r, i) => ({
    name: r.name,
    email: r.email,
    website: r.website ?? null,
    phone: r.phone ?? null,
    service: r.service ?? null,
    sender_key: input.senderKey ?? senders[i % senders.length],
    segment: r.segment ?? null,
    subject_override: r.subjectOverride ?? null,
    body_override: r.bodyOverride ?? null,
    vars: r.vars ?? null,
  }));

  // One bulk insert instead of N round-trips.
  await withSchema(() => sql`
    INSERT INTO recipients (campaign_id, name, email, website, phone, service, sender_key,
                            segment, subject_override, body_override, vars, status)
    SELECT ${campaignId}, e->>'name', e->>'email', e->>'website', e->>'phone',
           e->>'service', e->>'sender_key', e->>'segment', e->>'subject_override',
           e->>'body_override', e->'vars', 'pending'
    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS e
    ON CONFLICT (campaign_id, email) DO NOTHING`);

  await logEvent("campaign_created", String(campaignId), {
    name: input.name,
    count: rows.length,
  });
  return campaignId;
}

// ─── Start / pause / resume ──────────────────────────────────────────

/** Compute jittered send timestamps for every pending recipient and go live. */
export async function startCampaign(campaignId: number): Promise<void> {
  const cfg = getDelayConfig();
  const bh = getBusinessHours();
  const now = Date.now();

  const keys = getSenderKeys();
  for (let s = 0; s < keys.length; s++) {
    const senderKey = keys[s];
    const rows = (await sql`
      SELECT id FROM recipients
      WHERE campaign_id = ${campaignId} AND sender_key = ${senderKey}
        AND status IN ('pending')`) as { id: number }[];
    if (rows.length === 0) continue;

    // Stagger each sender's start so all 3 don't fire at the same instant.
    const stagger = s * (60 + Math.floor(Math.random() * 180)) * 1000;
    const ids = shuffle(rows).map((r) => r.id);
    const times = computeSchedule(ids.length, new Date(now + stagger), cfg, bh);
    const pairs = ids.map((id, i) => ({ id, ts: times[i].toISOString() }));

    await sql`
      UPDATE recipients AS r
      SET next_send_at = (e->>'ts')::timestamptz, status = 'scheduled'
      FROM jsonb_array_elements(${JSON.stringify(pairs)}::jsonb) AS e
      WHERE r.id = (e->>'id')::int`;
  }

  await sql`UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, now())
            WHERE id = ${campaignId}`;
  await logCampaignEvent("campaign_started", campaignId);
}

/** Re-derive jittered future send times for all un-sent recipients (from now).
 *  Use when a campaign fell behind its window so it sends at a human pace
 *  instead of bursting through everything that's overdue. */
export async function rescheduleCampaign(campaignId: number): Promise<number> {
  const cfg = getDelayConfig();
  const bh = getBusinessHours();
  const now = Date.now();
  let total = 0;

  const keys = getSenderKeys();
  for (let s = 0; s < keys.length; s++) {
    const senderKey = keys[s];
    const rows = (await sql`
      SELECT id FROM recipients
      WHERE campaign_id = ${campaignId} AND sender_key = ${senderKey}
        AND status IN ('scheduled', 'pending')`) as { id: number }[];
    if (rows.length === 0) continue;

    const stagger = s * (60 + Math.floor(Math.random() * 180)) * 1000;
    const ids = shuffle(rows).map((r) => r.id);
    const times = computeSchedule(ids.length, new Date(now + stagger), cfg, bh);
    const pairs = ids.map((id, i) => ({ id, ts: times[i].toISOString() }));
    await sql`
      UPDATE recipients AS r
      SET next_send_at = (e->>'ts')::timestamptz, status = 'scheduled'
      FROM jsonb_array_elements(${JSON.stringify(pairs)}::jsonb) AS e
      WHERE r.id = (e->>'id')::int`;
    total += ids.length;
  }

  await logCampaignEvent("campaign_rescheduled", campaignId, { count: total });
  return total;
}

export async function pauseCampaign(campaignId: number): Promise<void> {
  await sql`UPDATE campaigns SET status = 'paused' WHERE id = ${campaignId}`;
  await logCampaignEvent("campaign_paused", campaignId);
}

export async function resumeCampaign(campaignId: number): Promise<void> {
  await sql`UPDATE campaigns SET status = 'running' WHERE id = ${campaignId} AND status = 'paused'`;
  await logCampaignEvent("campaign_resumed", campaignId);
}

/** Log a campaign event with its name in the detail (so the activity feed
 *  can show the name, not just the id — and it survives campaign deletion). */
async function logCampaignEvent(
  type: string,
  campaignId: number,
  extra: Record<string, unknown> = {}
): Promise<void> {
  const [c] = (await sql`SELECT name FROM campaigns WHERE id = ${campaignId}`) as {
    name: string;
  }[];
  await logEvent(type, String(campaignId), { name: c?.name, ...extra });
}

// ─── Cron step 1: send everything that's due ─────────────────────────

export async function processDueSends(): Promise<{ sent: number; failed: number }> {
  const limit = MAX_SENDS_PER_TICK();

  // Atomically claim due rows so overlapping ticks can't double-send.
  // withSchema: the per-recipient copy columns arrived with report campaigns,
  // and a tick that can't read them would halt sending for every campaign.
  const claimed = (await withSchema(() => sql`
    UPDATE recipients SET status = 'sending'
    WHERE id IN (
      SELECT r.id FROM recipients r
      JOIN campaigns c ON c.id = r.campaign_id
      WHERE r.status = 'scheduled' AND r.next_send_at <= now() AND c.status = 'running'
      ORDER BY r.next_send_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, campaign_id, name, email, sender_key,
              subject_override, body_override, vars`)) as {
    id: number;
    campaign_id: number;
    name: string;
    email: string;
    sender_key: SenderKey;
    subject_override: string | null;
    body_override: string | null;
    vars: Record<string, string> | null;
  }[];

  let sent = 0;
  let failed = 0;

  for (const r of claimed) {
    const [camp] = (await sql`
      SELECT subject, body_template FROM campaigns WHERE id = ${r.campaign_id}`) as {
      subject: string;
      body_template: string;
    }[];
    const sender = getSender(r.sender_key);

    try {
      // Humanise: spintax varies the subject per send; footer adds a real
      // signature + unsubscribe line; send multipart text + HTML.
      // Subjects go through the same pipeline as bodies now: report campaigns
      // put {{site}} in the subject line, and renderTemplate spins it too.
      const subject = renderTemplate(r.subject_override ?? camp.subject, {
        company: r.name,
        sender,
        extra: r.vars ?? undefined,
      });
      const bodyText =
        renderTemplate(r.body_override ?? camp.body_template, {
          company: r.name,
          sender,
          extra: r.vars ?? undefined,
        }) + buildFooter(sender);
      await sendMail({
        sender,
        to: r.email,
        subject,
        text: bodyText,
        html: textToHtml(bodyText),
        headers: {
          "List-Unsubscribe": `<mailto:${sender.email}?subject=unsubscribe>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      });
      await sql`UPDATE recipients SET status = 'sent', sent_at = now(), error = NULL WHERE id = ${r.id}`;
      // Persist the sent email to the DB (best-effort; the email already went out).
      try {
        await recordSentEmail({
          campaignId: r.campaign_id,
          recipientId: r.id,
          sender: sender.email,
          to: r.email,
          company: r.name,
          subject,
          body: bodyText,
        });
      } catch (logErr) {
        await logEvent("sentlog_failed", String(r.id), {
          error: (logErr as Error).message.slice(0, 200),
        });
      }
      sent++;
    } catch (err) {
      const msg = (err as Error).message.slice(0, 500);
      await sql`UPDATE recipients SET status = 'failed', error = ${msg} WHERE id = ${r.id}`;
      await logEvent("send_failed", String(r.id), { email: r.email, error: msg });
      failed++;
    }
  }

  // Auto-complete campaigns with no work left.
  await sql`
    UPDATE campaigns c SET status = 'completed'
    WHERE c.status = 'running'
      AND NOT EXISTS (
        SELECT 1 FROM recipients r
        WHERE r.campaign_id = c.id
          AND r.status IN ('pending', 'scheduled', 'sending')
      )`;

  return { sent, failed };
}

// ─── Cron step 2: detect replies, notify the team ────────────────────

export async function pollReplies(): Promise<{ replies: number }> {
  let replies = 0;

  for (const key of getSenderKeys()) {
    // Only poll mailboxes that have live/sent recipients (saves Graph calls).
    const [{ n }] = (await sql`
      SELECT count(*)::int AS n FROM recipients
      WHERE sender_key = ${key} AND status IN ('sent', 'scheduled', 'sending', 'pending')`) as {
      n: number;
    }[];
    if (n === 0) continue;

    const sender = getSender(key);
    const [state] = (await sql`
      SELECT last_poll_at FROM mailbox_state WHERE sender_key = ${key}`) as {
      last_poll_at: string;
    }[];
    const since = state?.last_poll_at ?? new Date(Date.now() - 24 * 3600_000).toISOString();

    let messages;
    try {
      messages = await pollInbox(sender, new Date(since).toISOString());
    } catch (err) {
      await logEvent("poll_failed", key, { error: (err as Error).message.slice(0, 300) });
      continue;
    }

    for (const m of messages) {
      if (!m.fromAddress) continue;
      const updated = (await sql`
        UPDATE recipients r SET status = 'replied', replied_at = now()
        FROM campaigns c
        WHERE r.campaign_id = c.id
          AND lower(r.email) = ${m.fromAddress}
          AND r.sender_key = ${key}
          AND r.status IN ('sent', 'scheduled', 'sending', 'pending')
        RETURNING r.name, r.email, r.website, c.name AS campaign_name`) as {
        name: string;
        email: string;
        website: string | null;
        campaign_name: string;
      }[];

      if (updated.length > 0) {
        const rec = updated[0];
        replies++;
        await notifyTeam(
          `📩 Reply from ${rec.name} (${rec.email})`,
          textToHtml(
            `Good news — a campaign recipient just replied.\n\n` +
              `Company: ${rec.name}\n` +
              `Email: ${rec.email}\n` +
              (rec.website ? `Website: ${rec.website}\n` : "") +
              `Campaign: ${rec.campaign_name}\n` +
              `Replied to: ${sender.email}\n` +
              `Subject: ${m.subject}\n\n` +
              `Preview:\n${m.preview}`
          ),
          { type: "reply_detected", ref: rec.email, detail: { company: rec.name, sender: key } }
        );
      }
    }

    await sql`
      INSERT INTO mailbox_state (sender_key, last_poll_at)
      VALUES (${key}, now())
      ON CONFLICT (sender_key) DO UPDATE SET last_poll_at = now()`;
  }

  return { replies };
}

// ─── Cron step 3: fire due meeting reminders ─────────────────────────

export async function processMeetingReminders(): Promise<{ reminders: number }> {
  const due = (await sql`
    SELECT id, person_name, company, email, meeting_id, meeting_at, sender_key, notes,
           remind_24h, remind_1h, sent_24h, sent_1h
    FROM meetings
    WHERE meeting_at > now()
      AND (
        (remind_24h AND NOT sent_24h AND meeting_at <= now() + interval '24 hours') OR
        (remind_1h  AND NOT sent_1h  AND meeting_at <= now() + interval '1 hour')
      )`) as Array<{
    id: number;
    person_name: string;
    company: string | null;
    email: string;
    meeting_id: string | null;
    meeting_at: string;
    sender_key: SenderKey;
    notes: string | null;
    remind_24h: boolean;
    remind_1h: boolean;
    sent_24h: boolean;
    sent_1h: boolean;
  }>;

  let reminders = 0;
  for (const mtg of due) {
    const sender = getSender(mtg.sender_key);
    const when = new Date(mtg.meeting_at);
    const msLeft = when.getTime() - Date.now();

    const fire1h = mtg.remind_1h && !mtg.sent_1h && msLeft <= 3600_000;
    const fire24h = mtg.remind_24h && !mtg.sent_24h && msLeft <= 24 * 3600_000 && !fire1h;
    if (!fire1h && !fire24h) continue;

    const whenStr = fmt(when);
    const label = fire1h ? "in about an hour" : "tomorrow";
    try {
      await sendMail({
        sender,
        to: mtg.email,
        subject: `Reminder: our meeting ${label}`,
        html: textToHtml(
          `Hi ${mtg.person_name},\n\n` +
            `A quick reminder about our meeting ${label} (${whenStr}).\n` +
            (mtg.meeting_id ? `Meeting ID: ${mtg.meeting_id}\n` : "") +
            (mtg.notes ? `\n${mtg.notes}\n` : "") +
            `\nLooking forward to speaking with you.\n\n` +
            `Best,\n${sender.displayName}${sender.title ? `\n${sender.title}` : ""}`
        ),
      });
      if (fire1h) {
        await sql`UPDATE meetings SET sent_1h = true, sent_24h = true WHERE id = ${mtg.id}`;
      } else {
        await sql`UPDATE meetings SET sent_24h = true WHERE id = ${mtg.id}`;
      }
      reminders++;
      await logEvent("reminder_sent", String(mtg.id), { email: mtg.email, when: whenStr });
    } catch (err) {
      await logEvent("reminder_failed", String(mtg.id), {
        error: (err as Error).message.slice(0, 300),
      });
    }
  }

  return { reminders };
}

// ─── Meetings: create + notify ───────────────────────────────────────

export async function addMeeting(input: {
  personName: string;
  company?: string;
  website?: string;
  email: string;
  phone?: string;
  meetingId?: string;
  meetingAt: string; // ISO
  senderKey: SenderKey;
  notes?: string;
  remind24h: boolean;
  remind1h: boolean;
}): Promise<number> {
  const [row] = (await sql`
    INSERT INTO meetings (person_name, company, website, email, phone, meeting_id, meeting_at,
                          sender_key, notes, remind_24h, remind_1h)
    VALUES (${input.personName}, ${input.company ?? null}, ${input.website ?? null},
            ${input.email}, ${input.phone ?? null}, ${input.meetingId ?? null}, ${input.meetingAt},
            ${input.senderKey}, ${input.notes ?? null}, ${input.remind24h}, ${input.remind1h})
    RETURNING id`) as { id: number }[];

  // Notify the team immediately that a meeting was booked.
  // Best-effort: a Graph failure must not undo a successfully saved meeting.
  const when = fmt(input.meetingAt);
  try {
    await notifyTeam(
      `📅 Meeting booked: ${input.personName}${input.company ? ` — ${input.company}` : ""}`,
      textToHtml(
        `A meeting was just added.\n\n` +
          `Person: ${input.personName}\n` +
          (input.company ? `Company: ${input.company}\n` : "") +
          (input.website ? `Website: ${input.website}\n` : "") +
          `Email: ${input.email}\n` +
          (input.phone ? `Mobile: ${input.phone}\n` : "") +
          (input.meetingId ? `Meeting ID: ${input.meetingId}\n` : "") +
          `When: ${when}\n` +
          (input.notes ? `\nNotes:\n${input.notes}\n` : ""),
      ),
      { type: "meeting_booked", ref: input.email, detail: { person: input.personName } }
    );
  } catch (err) {
    await logEvent("notify_failed", input.email, {
      error: (err as Error).message.slice(0, 300),
      context: "meeting_booked",
    });
  }

  return row.id;
}
