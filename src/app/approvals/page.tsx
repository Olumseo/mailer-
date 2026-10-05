import Link from "next/link";
import { sql, ensureSchemaOnce } from "@/lib/db";
import { getActivityConfig, getSender } from "@/lib/env";
import { fmt } from "@/lib/format";
import { kindLabel } from "@/lib/activity-templates";
import {
  approveDraftsAction,
  rejectDraftsAction,
  saveDraftAction,
  syncActivityNowAction,
} from "@/app/actions";

export const dynamic = "force-dynamic";

type Tab = "pending" | "approved" | "rejected";

interface DraftRow {
  id: number;
  email: string;
  name: string | null;
  site: string | null;
  kind: string;
  activity: {
    segment?: string;
    signedUp?: string;
    lastVisited?: string;
    landedDashboard?: boolean;
    analysesCompleted?: number;
    analysesFailed?: number;
    sitesAnalysed?: string[];
    uiIssueEvents?: number;
    plan?: string;
  } | null;
  subject: string;
  body: string;
  sender_key: string;
  status: string;
  error: string | null;
  created_at: string;
  decided_at: string | null;
  r_status: string | null;
  next_send_at: string | null;
  sent_at: string | null;
}

function ActivityFacts({ a }: { a: DraftRow["activity"] }) {
  if (!a) return null;
  const bits = [
    a.signedUp ? `signed up ${fmt(a.signedUp)}` : "",
    `${a.analysesCompleted ?? 0} ${(a.analysesCompleted ?? 0) === 1 ? "analysis" : "analyses"} done`,
    a.analysesFailed ? `${a.analysesFailed} failed` : "",
    a.landedDashboard ? "saw dashboard" : "never reached dashboard",
    a.sitesAnalysed?.length ? `sites: ${a.sitesAnalysed.join(", ")}` : "",
    a.uiIssueEvents ? `${a.uiIssueEvents} UI issues` : "",
    a.lastVisited ? `last active ${fmt(a.lastVisited)}` : "",
  ].filter(Boolean);
  return <div className="hint">{bits.join(" · ")}</div>;
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: Tab = rawTab === "approved" || rawTab === "rejected" ? rawTab : "pending";
  const cfg = getActivityConfig();

  let rows: DraftRow[] = [];
  let counts: Record<string, number> = {};
  let lastSync: string | null = null;
  let dbError = "";
  try {
    await ensureSchemaOnce();
    const statuses =
      tab === "pending"
        ? ["pending"]
        : tab === "approved"
          ? ["approved", "failed"]
          : ["rejected", "superseded"];
    rows = (await sql`
      SELECT d.id, d.email, d.name, d.site, d.kind, d.activity, d.subject, d.body, d.sender_key,
             d.status, d.error, d.created_at, d.decided_at,
             r.status AS r_status, r.next_send_at, r.sent_at
      FROM activity_drafts d LEFT JOIN recipients r ON r.id = d.recipient_id
      WHERE d.status = ANY(${statuses}::text[])
      ORDER BY COALESCE(d.decided_at, d.created_at) DESC
      LIMIT 200`) as unknown as DraftRow[];
    const c = (await sql`
      SELECT status, count(*)::int n FROM activity_drafts GROUP BY status`) as {
      status: string;
      n: number;
    }[];
    counts = Object.fromEntries(c.map((x) => [x.status, x.n]));
    const [k] = (await sql`SELECT value FROM kv WHERE key = 'activity_last_sync'`) as {
      value: string;
    }[];
    lastSync = k?.value ?? null;
  } catch (e) {
    dbError = (e as Error).message;
  }

  const pendingIds = tab === "pending" ? rows.map((r) => r.id) : [];
  const tabLink = (t: Tab, label: string, n: number) => (
    <Link
      href={`/approvals?tab=${t}`}
      className={`btn ${tab === t ? "" : "ghost"}`}
      style={{ fontSize: 12, padding: "6px 12px" }}
    >
      {label} ({n})
    </Link>
  );

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0 }}>Approvals</h1>
        <form action={syncActivityNowAction}>
          <button type="submit" className="ghost" style={{ fontSize: 12, padding: "6px 12px" }}>
            Check for new activity now
          </button>
        </form>
      </div>
      <p className="sub">
        Emails drafted from what each Olum user did on the frontend. New users whose first
        analysis finished get the &ldquo;your site has been analysed&rdquo; letter; everyone else
        gets a letter about their own activity. <strong>Nothing is sent until you approve it</strong>
        — approved emails go out from {getSender(cfg.senderKey).email} at the usual drip pace.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="hint">
          {cfg.enabled ? "✅ Activity outreach is ON" : "⏸ Activity outreach is OFF (set ACTIVITY_OUTREACH_ENABLED=true)"}
          {" · "}
          {cfg.feedUrl && cfg.feedKey ? "users feed configured" : "⚠️ OLUM_FEED_URL / OLUM_FEED_KEY not set"}
          {" · "}checks every {cfg.syncMinutes} min · last check {fmt(lastSync)}
          {" · "}at most one email per user every {cfg.cooldownDays} days
        </div>
        {dbError ? <div className="hint" style={{ color: "var(--bad)" }}>Database: {dbError}</div> : null}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabLink("pending", "Waiting for approval", counts.pending ?? 0)}
        {tabLink("approved", "Approved", (counts.approved ?? 0) + (counts.failed ?? 0))}
        {tabLink("rejected", "Rejected / replaced", (counts.rejected ?? 0) + (counts.superseded ?? 0))}
      </div>

      {tab === "pending" && pendingIds.length > 1 ? (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <form action={approveDraftsAction}>
            {pendingIds.map((id) => (
              <input key={id} type="hidden" name="id" value={id} />
            ))}
            <button type="submit">Approve all {pendingIds.length} as written</button>
          </form>
          <form action={rejectDraftsAction}>
            {pendingIds.map((id) => (
              <input key={id} type="hidden" name="id" value={id} />
            ))}
            <button type="submit" className="danger">Reject all</button>
          </form>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="card empty">
          {tab === "pending" ? "No drafts waiting. New ones appear as users do things on Olum." : "Nothing here yet."}
        </div>
      ) : (
        <div className="grid">
          {rows.map((d) => (
            <div className="card" key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <strong>{d.name || d.email}</strong> <span className="hint">&lt;{d.email}&gt;</span>
                  {d.site ? <span className="hint"> · {d.site}</span> : null}
                  <ActivityFacts a={d.activity} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className="badge">{kindLabel(d.kind)}</span>{" "}
                  {d.status !== "pending" ? (
                    <span className={`badge ${d.r_status ?? d.status}`}>{d.r_status ?? d.status}</span>
                  ) : null}
                  <div className="hint">drafted {fmt(d.created_at)}</div>
                  {d.r_status === "scheduled" ? <div className="hint">sends {fmt(d.next_send_at)}</div> : null}
                  {d.sent_at ? <div className="hint">sent {fmt(d.sent_at)}</div> : null}
                  {d.error ? <div className="hint" style={{ color: "var(--bad)" }}>{d.error}</div> : null}
                </div>
              </div>

              {d.status === "pending" ? (
                <form>
                  <input type="hidden" name="id" value={d.id} />
                  <label>Subject</label>
                  <input name="subject" defaultValue={d.subject} required />
                  <label>Body (signature and unsubscribe footer are added when it sends)</label>
                  <textarea name="body" defaultValue={d.body} required />
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button type="submit" formAction={approveDraftsAction}>Approve &amp; send</button>
                    <button type="submit" className="ghost" formAction={saveDraftAction}>Save edits</button>
                    <button type="submit" className="danger" formAction={rejectDraftsAction}>Reject</button>
                  </div>
                </form>
              ) : (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "var(--muted)" }}>{d.subject}</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 6 }}>{d.body}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
