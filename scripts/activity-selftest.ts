// Activity outreach self-test — sends nothing, touches no network, never Neon.
//
//   npm run activity:selftest
//
// 1. Decision rules: new user + finished analysis → "site analysed"; new user
//    without one → wait; existing users → their segment's letter; cooldown,
//    settling, unchanged activity and excluded accounts are all skipped.
// 2. Rendering: no unresolved {{placeholders}} or spintax, dashboard link present.
// 3. Full round-trip on an in-memory Postgres with a faked users feed:
//    baseline → new activity → draft → approve → queued on the activity
//    campaign → no re-draft for the same activity; reject; superseding.

// Forced before db.ts loads: everything is imported dynamically in main().
process.env.USE_LOCAL_SNAPSHOT = "true";
process.env.SNAPSHOT_PATH = "no-such-snapshot-for-activity-selftest.json";
process.env.SENDER_EMAIL_1 = "barath@example.test";
process.env.SENDER_NAME_1 = "Barath";
process.env.SENDER_TITLE_1 = "Founder, Olum";
process.env.BOOKING_LINK_1 = "https://cal.example.test/barath";
process.env.REPORT_SENDER = "1";
process.env.INTERNAL_DOMAINS = "olum.ai";
process.env.ACTIVITY_OUTREACH_ENABLED = "true";
process.env.OLUM_FEED_URL = "https://feed.example.test/api/v1/auth/outreach/users";
process.env.OLUM_FEED_KEY = "test-key";
process.env.OLUM_DASHBOARD_URL = "https://olum.ai/app/overview";
process.env.BUSINESS_HOURS_ENABLED = "false";

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const DAY = 24 * 3600_000;
const NOW = new Date(); // the DB round-trip runs on the real clock, so the fixtures must too
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function feedUser(over: Record<string, unknown> = {}) {
  return {
    id: "u-1",
    email: "jane@acme.com",
    full_name: "Jane Smith",
    plan: "free",
    auth_provider: "google",
    signed_up_at: ago(3 * DAY),
    last_visited_at: ago(5 * 3600_000),
    workflow_state: "analysis_completed",
    landed_dashboard: false,
    landed_dashboard_at: null,
    sites_analysed: ["acme.com"],
    sites_crawled: ["acme.com"],
    pages_crawled: 40,
    analyses_completed: 1,
    analyses_failed: 0,
    first_analysis_completed_at: ago(5 * 3600_000),
    last_analysis_completed_at: ago(5 * 3600_000),
    last_analysis_failed_at: null,
    ui_issue_events: 0,
    issue_kinds: "",
    api_error_calls: 0,
    ...over,
  };
}

async function main() {
  const act = await import("../src/lib/activity");
  const { userFromFeed } = await import("../src/lib/report");
  const { ensureSchema, sql, isSnapshotMode } = await import("../src/lib/db");
  if (!isSnapshotMode()) {
    console.error("Refusing to run: not in local-snapshot mode, this would hit Neon.");
    process.exit(1);
  }

  const ex = { internalDomains: ["olum.ai"], teamHints: ["barath", "test"] };
  const cfg = { cooldownDays: 14, newUserDays: 14, settleMinutes: 120 };
  type F = Parameters<typeof userFromFeed>[0];
  const decide = (f: Record<string, unknown>, st?: { lastFingerprint: string | null; lastEmailedAt: Date | null }) =>
    act.decideDraft(userFromFeed(f as unknown as F, ex), act.feedTimes(f as unknown as F), st, NOW, cfg);

  console.log("\n— decision rules —");
  let d = decide(feedUser());
  check(d.action === "draft" && d.kind === "site_analysed", "new user with finished analysis → site_analysed", JSON.stringify(d));

  d = decide(feedUser({ analyses_completed: 0, first_analysis_completed_at: null, sites_analysed: [], sites_crawled: [], workflow_state: "" }));
  check(d.action === "skip" && /new user/.test(d.reason), "new user without analysis → wait", JSON.stringify(d));

  d = decide(feedUser({ signed_up_at: ago(60 * DAY), landed_dashboard: true }));
  check(d.action === "draft" && d.kind === "demo_invite", "existing user who saw dashboard, no demo asked → demo_invite", JSON.stringify(d));

  d = decide(feedUser({ signed_up_at: ago(60 * DAY), landed_dashboard: true, demo_requested_at: ago(2 * DAY) }));
  check(d.action === "draft" && d.kind === "dashboard_seen", "saw dashboard and already asked for a demo → dashboard_seen letter", JSON.stringify(d));

  d = decide(feedUser({ signed_up_at: ago(60 * DAY), analyses_completed: 0, analyses_failed: 2, workflow_state: "failed" }));
  check(d.action === "draft" && d.kind === "analysis_failed", "existing user with failed runs → analysis_failed letter", JSON.stringify(d));

  d = decide(feedUser({ signed_up_at: ago(60 * DAY), analyses_completed: 0, sites_analysed: [], sites_crawled: [], workflow_state: "", first_analysis_completed_at: null }));
  check(d.action === "draft" && d.kind === "signed_up_only", "old signup that never ran anything → signed_up_only letter", JSON.stringify(d));

  d = decide(feedUser({ last_visited_at: ago(10 * 60_000) }));
  check(d.action === "skip" && d.reason === "activity still settling", "active in the last 2h → wait for it to settle", JSON.stringify(d));

  d = decide(feedUser({ signed_up_at: ago(60 * DAY) }), { lastFingerprint: null, lastEmailedAt: new Date(NOW.getTime() - 3 * DAY) });
  check(d.action === "skip" && d.reason === "cooldown", "emailed 3 days ago → cooldown", JSON.stringify(d));

  const fp = act.fingerprint(userFromFeed(feedUser() as unknown as F, ex));
  d = decide(feedUser(), { lastFingerprint: fp, lastEmailedAt: null });
  check(d.action === "skip" && d.reason === "no new activity", "same activity as last draft → skip", JSON.stringify(d));

  d = decide(feedUser({ email: "dev@olum.ai" }));
  check(d.action === "skip" && /internal/.test(d.reason), "internal domain → skip", JSON.stringify(d));

  d = decide(feedUser({ signed_up_at: ago(3 * DAY) }), { lastFingerprint: null, lastEmailedAt: new Date(NOW.getTime() - 30 * DAY) });
  check(d.action === "draft" && d.kind !== "site_analysed", "already emailed before → never the 'new user' letter again", JSON.stringify(d));

  console.log("\n— rendering —");
  const { composeEmail, BLOCK_NAMES } = await import("../src/lib/template");
  const journeyUser = userFromFeed(
    feedUser({ signup_landing_page: "ppc-landing-2", signup_source: "google", pages_reached: ["/app/overview", "/app/ai-visibility"] }) as unknown as F,
    ex
  );
  const sender = { displayName: "Barath", title: "Founder, Olum", bookingLink: "https://cal.example.test/barath" };
  const sendAs = (r: { subject: string; body: string; vars: Record<string, string> }) =>
    composeEmail({ subject: r.subject, body: r.body, company: "Jane Smith", sender, extra: r.vars });
  for (const kind of ["site_analysed", "demo_invite", "dashboard_seen", "results_not_seen", "analysis_stuck", "analysis_failed", "signed_up_only"] as const) {
    const r = act.renderDraft(journeyUser, kind, "1", { dashboardUrl: "https://olum.ai/app/overview" });
    // The draft keeps only known blocks as placeholders — nothing else unresolved.
    const stray = (r.body.match(/\{\{\s*(\w+)\s*\}\}/g) ?? []).filter(
      (m) => !(BLOCK_NAMES as readonly string[]).includes(m.replace(/[{}\s]/g, ""))
    );
    const sent = sendAs(r);
    const leftovers = /\{\{|\}\}|\{[^{}]*\|[^{}]*\}/.test(sent.subject + sent.text);
    check(!stray.length && !leftovers && sent.text.startsWith("Hi Jane"), `${kind}: clean render`, stray.join(",") || (leftovers ? sent.text.slice(0, 120) : r.subject));
  }
  const di = act.renderDraft(journeyUser, "demo_invite", "1", { dashboardUrl: "https://olum.ai/app/overview" });
  check(di.body.includes("{{activityCard}}") && di.body.includes("{{demoButton}}"), "demo_invite draft keeps readable block placeholders");
  const diSent = sendAs(di);
  check(
    diSent.html.includes("Landing page 2 (google)") && diSent.html.includes("AI visibility") && diSent.html.includes("Your activity on Olum"),
    "sent demo_invite expands the activity card: landing page and sections visited"
  );
  check(diSent.html.includes("https://cal.example.test/barath"), "sent demo_invite carries the booking link button");
  check(!/<p[^>]*>\s*<\/p>/.test(diSent.html), "no empty paragraphs left by blank placeholders");
  const sa = act.renderDraft(userFromFeed(feedUser() as unknown as F, ex), "site_analysed", "1", { dashboardUrl: "https://olum.ai/app/overview" });
  const saSent = sendAs(sa);
  check(saSent.html.includes("https://olum.ai/app/overview") && saSent.text.includes("acme.com"), "site_analysed names the site and links the dashboard");

  console.log("\n— DB round-trip (in-memory Postgres, faked feed) —");
  await ensureSchema();
  let feed = [feedUser({ id: "u-1" }), feedUser({ id: "u-2", email: "sam@beta.io", full_name: "Sam Lee", signed_up_at: ago(60 * DAY), sites_analysed: ["beta.io"], landed_dashboard: true })];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const key = (init?.headers as Record<string, string>)?.["X-Outreach-Key"];
    if (key !== "test-key") return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ users: feed }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const notified: number[] = [];
  const notify = async (_c: unknown, drafts: unknown[]) => { notified.push(drafts.length); };

  let r = await act.syncActivity({ force: true, notify });
  check(r.baselined === 2 && !r.drafted, "first sync records a baseline, drafts nothing", JSON.stringify(r));

  // New activity: u-1 reaches the dashboard; a brand-new user u-3 finishes a run.
  feed = [
    feedUser({ id: "u-1", landed_dashboard: true }),
    feed[1],
    feedUser({ id: "u-3", email: "ana@gamma.co", full_name: "Ana Ruiz", sites_analysed: ["gamma.co"] }),
  ];
  r = await act.syncActivity({ force: true, notify });
  check(r.drafted === 2, "new activity → 2 drafts (u-1 changed, u-3 new)", JSON.stringify(r));
  check(notified.at(-1) === 2, "approver notified once with both drafts");

  const pend = (await sql`SELECT id, user_id, kind, status FROM activity_drafts ORDER BY id`) as { id: number; user_id: string; kind: string; status: string }[];
  const u3 = pend.find((p) => p.user_id === "u-3");
  const u1 = pend.find((p) => p.user_id === "u-1");
  check(u3?.kind === "site_analysed", "brand-new user u-3 gets site_analysed", u3?.kind);
  check(u1?.kind === "site_analysed", "u-1 (still new, never emailed) gets site_analysed", u1?.kind);

  r = await act.syncActivity({ force: true, notify });
  check(r.drafted === 0, "same activity again → no duplicate drafts", JSON.stringify(r));

  const ap = await act.approveDrafts([u3!.id]);
  check(ap.approved === 1, "approve u-3", JSON.stringify(ap));
  const [q] = (await sql`
    SELECT r.status, r.subject_override, r.next_send_at, c.kind, c.status AS c_status
    FROM activity_drafts d JOIN recipients r ON r.id = d.recipient_id JOIN campaigns c ON c.id = r.campaign_id
    WHERE d.id = ${u3!.id}`) as { status: string; subject_override: string; next_send_at: string; kind: string; c_status: string }[];
  check(q?.status === "scheduled" && q.kind === "activity" && q.c_status === "running", "queued as a scheduled recipient of a running activity campaign", JSON.stringify(q));

  const again = await act.approveDrafts([u3!.id]);
  check(again.approved === 0, "approving the same draft twice queues nothing", JSON.stringify(again));

  const rej = await act.rejectDrafts([u1!.id]);
  check(rej === 1, "reject u-1");
  r = await act.syncActivity({ force: true, notify });
  check(r.drafted === 0, "rejected activity is not re-drafted", JSON.stringify(r));

  // u-3 does something new right after being emailed → cooldown holds it.
  feed = [feed[0], feed[1], feedUser({ id: "u-3", email: "ana@gamma.co", full_name: "Ana Ruiz", sites_analysed: ["gamma.co"], landed_dashboard: true })];
  r = await act.syncActivity({ force: true, notify });
  check(r.drafted === 0 && (r.reasons?.cooldown ?? 0) >= 1, "emailed user's new activity waits out the cooldown", JSON.stringify(r));

  globalThis.fetch = realFetch;
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll activity checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
