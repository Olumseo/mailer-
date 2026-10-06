// Activity outreach: live users feed → personalised drafts → human approval →
// queued on the normal send engine.
//
//   cron tick ─▶ syncActivity()            (at most every ACTIVITY_SYNC_MINUTES)
//                 ├─ GET olum-backend /auth/outreach/users  (X-Outreach-Key)
//                 ├─ decideDraft() per user: new signup with a finished
//                 │   analysis → "site analysed"; anyone else with NEW activity
//                 │   → the letter for their funnel segment
//                 ├─ INSERT activity_drafts (status 'pending')
//                 └─ email the approver: "N drafts waiting"
//   /approvals  ─▶ approveDrafts() → recipient of that day's "Activity outreach"
//                 campaign → processDueSends() sends it with the usual jitter,
//                 footer, sent archive and reply detection.
//
// Nothing reaches a user without someone pressing Approve.

import { sql, ensureSchemaOnce, logEvent, withSchema } from "./db";
import {
  getActivityConfig,
  getBusinessHours,
  getDelayConfig,
  getFounderName,
  getInternalDomains,
  getSender,
  getTeamEmailHints,
  NOTIFY_SENDER,
  type ActivityConfig,
} from "./env";
import { userFromFeed, type FeedUser, type ReportUser } from "./report";
import { buildActivityVars, copyForKind, kindLabel, type DraftKind } from "./activity-templates";
import { renderBody, renderTemplate, textToHtml } from "./template";
import { computeSchedule } from "./schedule";
import { sendMail } from "./smtp";
import type { SenderKey } from "./types";

// ─── Pure decision logic (unit-tested in scripts/activity-selftest.ts) ──

/** What "this user's activity" means for change detection. A new value is new
 *  activity worth (possibly) writing about; the same value never re-drafts. */
export function fingerprint(u: ReportUser): string {
  const sites = [...u.sitesAnalysed].sort().join(",");
  return [
    u.segment,
    `c${u.analysesCompleted}`,
    `f${u.analysesFailed}`,
    `d${u.landedDashboard ? 1 : 0}`,
    `s${sites}`,
  ].join("|");
}

export interface UserState {
  lastFingerprint: string | null;
  /** Latest email we sent them by ANY campaign (activity, report, cold). */
  lastEmailedAt: Date | null;
}

export interface FeedTimes {
  signedUpAt: Date | null;
  lastActivityAt: Date | null;
  firstAnalysisCompletedAt: Date | null;
}

export type Decision =
  | { action: "draft"; kind: DraftKind; fingerprint: string }
  | { action: "skip"; reason: string };

const DAY = 24 * 3600_000;

export function decideDraft(
  u: ReportUser,
  t: FeedTimes,
  state: UserState | undefined,
  now: Date,
  cfg: Pick<ActivityConfig, "cooldownDays" | "newUserDays" | "settleMinutes">
): Decision {
  if (u.excluded) return { action: "skip", reason: `excluded:${u.excluded}` };
  if (u.teamHint) return { action: "skip", reason: "team account" };

  const fp = fingerprint(u);
  if (state?.lastFingerprint === fp) return { action: "skip", reason: "no new activity" };

  // Don't write mid-session: a run in progress reads as "analysis_running",
  // and an email about a "stuck" analysis that finishes a minute later is wrong.
  if (t.lastActivityAt && now.getTime() - t.lastActivityAt.getTime() < cfg.settleMinutes * 60_000) {
    return { action: "skip", reason: "activity still settling" };
  }

  const lastEmailed = state?.lastEmailedAt ?? null;
  if (lastEmailed && now.getTime() - lastEmailed.getTime() < cfg.cooldownDays * DAY) {
    return { action: "skip", reason: "cooldown" };
  }

  const isNew =
    !lastEmailed &&
    !!t.signedUpAt &&
    now.getTime() - t.signedUpAt.getTime() <= cfg.newUserDays * DAY;

  if (isNew) {
    // A new user's first email is "your site has been analysed" — so it waits
    // for that analysis. Until then (or if it never comes) they're left alone;
    // once they stop being new they get the activity letter for their segment.
    if (u.analysesCompleted > 0 || t.firstAnalysisCompletedAt) {
      return { action: "draft", kind: "site_analysed", fingerprint: fp };
    }
    return { action: "skip", reason: "new user, no finished analysis yet" };
  }

  // Seen their results and never asked for a demo: offer a walkthrough of
  // their own numbers rather than another feedback questionnaire.
  if (u.segment === "dashboard_seen" && !u.demoRequestedAt) {
    return { action: "draft", kind: "demo_invite", fingerprint: fp };
  }

  return { action: "draft", kind: u.segment, fingerprint: fp };
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function maxDate(...ds: Array<Date | null>): Date | null {
  const t = ds.filter((d): d is Date => !!d).map((d) => d.getTime());
  return t.length ? new Date(Math.max(...t)) : null;
}

export function feedTimes(f: FeedUser): FeedTimes {
  return {
    signedUpAt: toDate(f.signed_up_at),
    lastActivityAt: maxDate(
      toDate(f.last_visited_at),
      toDate(f.last_analysis_completed_at),
      toDate(f.last_analysis_failed_at),
      toDate(f.landed_dashboard_at)
    ),
    firstAnalysisCompletedAt: toDate(f.first_analysis_completed_at),
  };
}

/** Render one draft exactly as the approver will see it (spintax resolved). */
export function renderDraft(
  u: ReportUser,
  kind: DraftKind,
  senderKey: SenderKey,
  cfg: Pick<ActivityConfig, "dashboardUrl">
): { subject: string; body: string; vars: Record<string, string> } {
  const sender = getSender(senderKey);
  const copy = copyForKind(kind);
  const extra = buildActivityVars(u, {
    bookingLink: sender.bookingLink,
    founderName: getFounderName(),
    senderTitle: sender.title,
    dashboardUrl: cfg.dashboardUrl,
  });
  const vars = { company: u.name || u.email, sender, extra };
  // Blocks ({{activityCard}}, {{demoButton}}…) stay as placeholders so the
  // approver edits readable HTML; `extra` rides along to fill them later.
  return {
    subject: renderTemplate(copy.subject, vars),
    body: renderBody(copy.body, vars, "random", { keepBlocks: true }),
    vars: extra,
  };
}

// ─── Feed ────────────────────────────────────────────────────────────

export async function fetchFeed(cfg: ActivityConfig): Promise<FeedUser[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(cfg.feedUrl, {
      headers: { "X-Outreach-Key": cfg.feedKey, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`users feed returned HTTP ${res.status}`);
    const body = (await res.json()) as { users?: FeedUser[] };
    if (!Array.isArray(body.users)) throw new Error("users feed: missing users array");
    return body.users;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Sync (cron step) ────────────────────────────────────────────────

async function kvGet(key: string): Promise<string | null> {
  const [r] = (await sql`SELECT value FROM kv WHERE key = ${key}`) as { value: string | null }[];
  return r?.value ?? null;
}

async function kvSet(key: string, value: string): Promise<void> {
  await sql`INSERT INTO kv (key, value, updated_at) VALUES (${key}, ${value}, now())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export interface SyncResult {
  skipped?: string;
  users?: number;
  drafted?: number;
  superseded?: number;
  baselined?: number;
  reasons?: Record<string, number>;
}

type Notifier = (
  cfg: ActivityConfig,
  drafts: Array<{ name: string; email: string; kind: DraftKind; site: string }>
) => Promise<void>;

export async function syncActivity(
  opts: { force?: boolean; notify?: Notifier } = {}
): Promise<SyncResult> {
  const cfg = getActivityConfig();
  if (!cfg.enabled) return { skipped: "disabled (ACTIVITY_OUTREACH_ENABLED != true)" };
  if (!cfg.feedUrl || !cfg.feedKey) return { skipped: "OLUM_FEED_URL / OLUM_FEED_KEY not set" };

  await ensureSchemaOnce();

  const last = await kvGet("activity_last_sync");
  if (!opts.force && last && Date.now() - new Date(last).getTime() < cfg.syncMinutes * 60_000) {
    return { skipped: "not due" };
  }
  // Stamp first so an overlapping tick doesn't run a second sync alongside.
  await kvSet("activity_last_sync", new Date().toISOString());

  const feed = await fetchFeed(cfg);
  const excludeCfg = { internalDomains: getInternalDomains(), teamHints: getTeamEmailHints() };
  const now = new Date();

  const stateRows = (await sql`
    SELECT user_id, last_fingerprint, last_emailed_at FROM activity_users`) as {
    user_id: string;
    last_fingerprint: string | null;
    last_emailed_at: string | null;
  }[];

  // First run: record where everyone is today without drafting, so turning
  // this on doesn't drop hundreds of letters about old activity on the
  // approver. ACTIVITY_BACKFILL=true skips the baseline and drafts for all.
  if (stateRows.length === 0 && !cfg.backfill && !(await kvGet("activity_baselined"))) {
    const rows = feed
      .filter((f) => f.id && f.email)
      .map((f) => ({ user_id: f.id, email: f.email.toLowerCase(), fp: fingerprint(userFromFeed(f, excludeCfg)) }));
    await sql`
      INSERT INTO activity_users (user_id, email, last_fingerprint)
      SELECT e->>'user_id', e->>'email', e->>'fp' FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) e
      ON CONFLICT (user_id) DO NOTHING`;
    await kvSet("activity_baselined", now.toISOString());
    await logEvent("activity_baselined", null, { users: rows.length });
    return { users: feed.length, baselined: rows.length };
  }

  const state = new Map(stateRows.map((r) => [r.user_id, r]));
  // Cooldown counts every email we've sent the address, not just activity ones.
  const sentRows = (await sql`
    SELECT lower(to_email) AS email, max(sent_at) AS last FROM sent_emails GROUP BY 1`) as {
    email: string;
    last: string;
  }[];
  const lastSent = new Map(sentRows.map((r) => [r.email, new Date(r.last)]));
  const pendingRows = (await sql`
    SELECT id, user_id FROM activity_drafts WHERE status = 'pending'`) as { id: number; user_id: string }[];
  const pending = new Map(pendingRows.map((r) => [r.user_id, r.id]));

  const reasons: Record<string, number> = {};
  const created: Array<{ name: string; email: string; kind: DraftKind; site: string }> = [];
  let superseded = 0;

  for (const f of feed) {
    if (!f.id || !f.email) continue;
    const u = userFromFeed(f, excludeCfg);
    const st = state.get(f.id);
    const decision = decideDraft(
      u,
      feedTimes(f),
      {
        lastFingerprint: st?.last_fingerprint ?? null,
        lastEmailedAt: maxDate(toDate(st?.last_emailed_at), lastSent.get(u.email) ?? null),
      },
      now,
      cfg
    );
    if (decision.action === "skip") {
      reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1;
      continue;
    }

    const { subject, body, vars } = renderDraft(u, decision.kind, cfg.senderKey, cfg);
    const oldId = pending.get(f.id);
    if (oldId) {
      // Their activity moved on before anyone decided — the old letter is stale.
      await sql`UPDATE activity_drafts SET status = 'superseded', decided_at = now()
                WHERE id = ${oldId} AND status = 'pending'`;
      superseded++;
    }
    const activity = {
      segment: u.segment,
      signedUp: u.signedUp,
      lastVisited: u.lastVisited,
      workflowState: u.workflowState,
      landedDashboard: u.landedDashboard,
      analysesCompleted: u.analysesCompleted,
      analysesFailed: u.analysesFailed,
      sitesAnalysed: u.sitesAnalysed,
      pagesCrawled: u.pagesCrawled,
      uiIssueEvents: u.uiIssueEvents,
      apiErrorCalls: u.apiErrorCalls,
      plan: u.plan,
      landingPage: u.landingPage,
      landingSource: u.landingSource,
      pagesReached: u.pagesReached,
      demoRequestedAt: u.demoRequestedAt,
    };
    await sql`
      INSERT INTO activity_drafts (user_id, email, name, site, kind, fingerprint, activity,
                                   subject, body, vars, sender_key, status)
      VALUES (${f.id}, ${u.email}, ${u.name || null}, ${u.primarySite || null}, ${decision.kind},
              ${decision.fingerprint}, ${JSON.stringify(activity)}::jsonb, ${subject}, ${body},
              ${JSON.stringify(vars)}::jsonb, ${cfg.senderKey}, 'pending')`;
    await sql`
      INSERT INTO activity_users (user_id, email, last_fingerprint, last_drafted_at)
      VALUES (${f.id}, ${u.email}, ${decision.fingerprint}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET email = EXCLUDED.email, last_fingerprint = EXCLUDED.last_fingerprint,
            last_drafted_at = now()`;
    created.push({ name: u.name || u.email, email: u.email, kind: decision.kind, site: u.primarySite });
  }

  if (created.length) {
    await logEvent("activity_drafted", null, { count: created.length, superseded });
    try {
      await (opts.notify ?? notifyApprover)(cfg, created);
    } catch (err) {
      await logEvent("notify_failed", null, {
        context: "activity_drafts",
        error: (err as Error).message.slice(0, 300),
      });
    }
  }

  return { users: feed.length, drafted: created.length, superseded, reasons };
}

async function notifyApprover(
  cfg: ActivityConfig,
  drafts: Array<{ name: string; email: string; kind: DraftKind; site: string }>
): Promise<void> {
  if (!cfg.approverEmail) return;
  const link = cfg.appUrl ? `${cfg.appUrl}/approvals` : "the Approvals page of the outreach app";
  const lines = drafts
    .slice(0, 25)
    .map((d) => `• ${d.name} <${d.email}>${d.site ? ` — ${d.site}` : ""} — ${kindLabel(d.kind)}`);
  const more = drafts.length > 25 ? `\n…and ${drafts.length - 25} more.` : "";
  await sendMail({
    sender: getSender(NOTIFY_SENDER()),
    to: cfg.approverEmail,
    subject: `📝 ${drafts.length} outreach ${drafts.length === 1 ? "draft" : "drafts"} waiting for approval`,
    html: textToHtml(
      `New activity on Olum produced ${drafts.length} personalised ` +
        `${drafts.length === 1 ? "email" : "emails"}. Nothing is sent until you approve it.\n\n` +
        `${lines.join("\n")}${more}\n\n` +
        `Review, edit and approve: ${link}`
    ),
  });
}

// ─── Approve / reject / edit (server actions call these) ─────────────

export async function saveDraftEdit(id: number, subject: string, body: string): Promise<void> {
  await ensureSchemaOnce();
  await sql`UPDATE activity_drafts SET subject = ${subject}, body = ${body}
            WHERE id = ${id} AND status = 'pending'`;
}

export async function rejectDrafts(ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  await ensureSchemaOnce();
  const rows = (await sql`
    UPDATE activity_drafts SET status = 'rejected', decided_at = now()
    WHERE id = ANY(${ids}::int[]) AND status = 'pending'
    RETURNING id`) as { id: number }[];
  if (rows.length) await logEvent("activity_rejected", null, { count: rows.length });
  return rows.length;
}

function istDay(d: Date): string {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** The day's "Activity outreach" campaign — created on demand, kept running. */
async function activityCampaign(now: Date): Promise<number> {
  const name = `Activity outreach · ${istDay(now)}`;
  const [found] = (await withSchema(() => sql`
    SELECT id FROM campaigns WHERE kind = 'activity' AND name = ${name}
    ORDER BY id LIMIT 1`)) as { id: number }[];
  if (found) {
    // The engine marks a campaign 'completed' once nothing is left to send;
    // a new approval the same day reopens it.
    await sql`UPDATE campaigns SET status = 'running' WHERE id = ${found.id} AND status = 'completed'`;
    return found.id;
  }
  const [c] = (await withSchema(() => sql`
    INSERT INTO campaigns (name, subject, body_template, source_file, status, kind, started_at)
    VALUES (${name}, '(per recipient — approved activity drafts)', '(per recipient)',
            'activity feed', 'running', 'activity', now())
    RETURNING id`)) as { id: number }[];
  await logEvent("campaign_created", String(c.id), { name, kind: "activity" });
  return c.id;
}

/**
 * Approve drafts: claim them, queue each as a recipient of today's activity
 * campaign with jittered send times, and record the email against the user.
 * The send itself is the engine's normal processDueSends().
 */
export async function approveDrafts(ids: number[]): Promise<{ approved: number; failed: number }> {
  if (!ids.length) return { approved: 0, failed: 0 };
  await ensureSchemaOnce();

  // Claim atomically so a double-click (or two approvers) can't queue twice.
  const drafts = (await sql`
    UPDATE activity_drafts SET status = 'approving'
    WHERE id = ANY(${ids}::int[]) AND status = 'pending'
    RETURNING id, user_id, email, name, site, kind, subject, body, vars, sender_key`) as {
    id: number;
    user_id: string;
    email: string;
    name: string | null;
    site: string | null;
    kind: string;
    subject: string;
    body: string;
    vars: Record<string, string> | null;
    sender_key: SenderKey;
  }[];
  if (!drafts.length) return { approved: 0, failed: 0 };

  const now = new Date();
  const campaignId = await activityCampaign(now);
  let approved = 0;
  let failed = 0;

  // Space sends after anything this mailbox already has queued, so a big
  // approval batch drips out at the same human pace as a campaign.
  const bySender = new Map<SenderKey, typeof drafts>();
  for (const d of drafts) bySender.set(d.sender_key, [...(bySender.get(d.sender_key) ?? []), d]);

  for (const [senderKey, group] of bySender) {
    const [{ last }] = (await sql`
      SELECT max(r.next_send_at) AS last FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
      WHERE c.kind = 'activity' AND r.sender_key = ${senderKey}
        AND r.status IN ('scheduled', 'sending')`) as { last: string | null }[];
    const lastTs = last ? new Date(last).getTime() : 0;
    const start = new Date(Math.max(now.getTime() + 30_000, lastTs + 90_000));
    const times = computeSchedule(group.length, start, getDelayConfig(), getBusinessHours());

    for (let i = 0; i < group.length; i++) {
      const d = group[i];
      const rows = (await withSchema(() => sql`
        INSERT INTO recipients (campaign_id, name, email, website, service, sender_key, segment,
                                subject_override, body_override, vars, status, next_send_at)
        VALUES (${campaignId}, ${d.name || d.email}, ${d.email}, ${d.site}, ${d.kind}, ${senderKey},
                ${d.kind}, ${d.subject}, ${d.body}, ${d.vars ? JSON.stringify(d.vars) : null}::jsonb,
                'scheduled', ${times[i].toISOString()})
        ON CONFLICT (campaign_id, email) DO NOTHING
        RETURNING id`)) as { id: number }[];
      if (!rows.length) {
        await sql`UPDATE activity_drafts SET status = 'failed', decided_at = now(),
                    error = 'Already queued in today''s activity campaign.'
                  WHERE id = ${d.id}`;
        failed++;
        continue;
      }
      await sql`UPDATE activity_drafts SET status = 'approved', decided_at = now(),
                  recipient_id = ${rows[0].id}, error = NULL
                WHERE id = ${d.id}`;
      await sql`
        INSERT INTO activity_users (user_id, email, last_emailed_at)
        VALUES (${d.user_id}, ${d.email}, now())
        ON CONFLICT (user_id) DO UPDATE SET last_emailed_at = now()`;
      approved++;
    }
  }

  await logEvent("activity_approved", String(campaignId), { approved, failed });
  return { approved, failed };
}
