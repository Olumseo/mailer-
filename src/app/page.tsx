import Link from "next/link";
import { sql, withRetry, isTransientDbError } from "@/lib/db";
import { fmt } from "@/lib/format";
import { deleteCampaignAction, deleteEventAction, clearActivityAction } from "@/app/actions";

export const dynamic = "force-dynamic";

type Stats = {
  campaigns: number;
  recipients: number;
  sent: number;
  replied: number;
  meetings: number;
  duplicates: number;
};

async function loadDashboard() {
  const [stats] = (await sql`
    SELECT
      (SELECT count(*) FROM campaigns)::int AS campaigns,
      (SELECT count(*) FROM recipients)::int AS recipients,
      (SELECT count(*) FROM recipients WHERE status = 'sent')::int AS sent,
      (SELECT count(*) FROM recipients WHERE status = 'replied')::int AS replied,
      (SELECT count(*) FROM meetings WHERE meeting_at > now())::int AS meetings,
      (SELECT COALESCE(SUM(duplicates_removed), 0) FROM campaigns)::int AS duplicates
  `) as Stats[];

  const campaigns = (await sql`
    SELECT c.id, c.name, c.status, c.created_at,
      count(r.*)::int AS total,
      count(*) FILTER (WHERE r.status = 'sent')::int AS sent,
      count(*) FILTER (WHERE r.status = 'replied')::int AS replied
    FROM campaigns c LEFT JOIN recipients r ON r.campaign_id = c.id
    GROUP BY c.id ORDER BY c.id DESC LIMIT 30
  `) as Array<{
    id: number; name: string; status: string; created_at: string;
    total: number; sent: number; replied: number;
  }>;

  const events = (await sql`
    SELECT id, type, ref, detail, created_at FROM events
    ORDER BY id DESC LIMIT 12
  `) as Array<{ id: number; type: string; ref: string | null; detail: unknown; created_at: string }>;

  return { stats, campaigns, events };
}

export default async function Dashboard() {
  let data;
  try {
    data = await withRetry(loadDashboard);
  } catch (e) {
    if (isTransientDbError(e)) {
      return (
        <div>
          <h1>Database waking up…</h1>
          <p className="sub">
            Couldn&apos;t reach Neon just now (its free compute sleeps when idle). This is
            temporary — just refresh in a few seconds.
          </p>
          <div className="mono-note">{(e as Error).message}</div>
        </div>
      );
    }
    return (
      <div>
        <h1>Setup required</h1>
        <p className="sub">The database tables aren&apos;t created yet.</p>
        <div className="mono-note">
          Set <code>DATABASE_URL</code> and <code>CRON_SECRET</code> in your env, then open{" "}
          <code>/api/setup?key=YOUR_CRON_SECRET</code> once to create the tables.
        </div>
      </div>
    );
  }

  const { stats, campaigns, events } = data;
  return (
    <div>
      <h1>Dashboard</h1>
      <p className="sub">Campaign sending, reply detection and meetings — all on one tick.</p>

      <div className="grid auto">
        <Stat n={stats.sent} l="Emails sent" />
        <Stat n={stats.replied} l="Replies" />
        <Stat n={stats.recipients} l="Contacts loaded" />
        <Stat n={stats.duplicates} l="Duplicates removed" />
        <Stat n={stats.meetings} l="Upcoming meetings" />
      </div>

      <div className="actions">
        <Link className="btn" href="/campaigns/new">+ New campaign</Link>
        <Link className="btn ghost" href="/campaigns/report">+ Feedback campaign from a users report</Link>
        <Link className="btn ghost" href="/meetings">+ Add meeting</Link>
      </div>

      <h2>Campaigns</h2>
      {campaigns.length === 0 ? (
        <div className="card empty">No campaigns yet.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Status</th><th>Sent</th><th>Replies</th><th>Total</th><th>Created</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/campaigns/${c.id}`}>{c.name}</Link></td>
                  <td><span className={`badge ${c.status}`}>{c.status}</span></td>
                  <td>{c.sent}</td>
                  <td>{c.replied}</td>
                  <td>{c.total}</td>
                  <td className="hint">{fmt(c.created_at)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Link className="btn ghost" href={`/campaigns/${c.id}/edit`}
                        style={{ padding: "4px 10px", fontSize: 12 }}>Edit</Link>
                      <form action={deleteCampaignAction} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={c.id} />
                        <button className="danger" type="submit"
                          style={{ padding: "4px 10px", fontSize: 12 }}>Delete</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 24, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Recent activity</h2>
        {events.length > 0 && (
          <form action={clearActivityAction}>
            <button className="ghost" type="submit" style={{ padding: "4px 10px", fontSize: 12 }}>
              Clear all
            </button>
          </form>
        )}
      </div>
      {events.length === 0 ? (
        <div className="card empty">Nothing yet.</div>
      ) : (
        <div className="card">
          {events.map((e, i) => (
            <div
              key={e.id}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < events.length - 1 ? "1px solid var(--border)" : "none" }}
            >
              <span className="badge">{e.type}</span>
              <span>{describeEvent(e)}</span>
              <span style={{ flex: 1 }} />
              <span className="hint">{fmt(e.created_at)}</span>
              <form action={deleteEventAction} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={e.id} />
                <button className="ghost" type="submit" title="Delete this entry"
                  style={{ padding: "0 8px", fontSize: 14, lineHeight: "22px" }}>✕</button>
              </form>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function describeEvent(e: { type: string; ref: string | null; detail: unknown }): string {
  const d = (e.detail ?? {}) as { name?: string; count?: number; person?: string; company?: string };
  const camp = d.name ?? (e.ref ? `#${e.ref}` : "");
  switch (e.type) {
    case "campaign_created":
      return `Campaign “${camp}” created${d.count != null ? ` — ${d.count} recipients` : ""}`;
    case "campaign_started":
      return `Campaign “${camp}” started`;
    case "campaign_paused":
      return `Campaign “${camp}” paused`;
    case "campaign_resumed":
      return `Campaign “${camp}” resumed`;
    case "reply_detected":
      return `Reply from ${e.ref}${d.company ? ` (${d.company})` : ""}`;
    case "meeting_booked":
      return `Meeting booked: ${d.person ?? ""}${e.ref ? ` (${e.ref})` : ""}`;
    case "reminder_sent":
      return `Reminder sent to ${e.ref}`;
    case "send_failed":
      return `Send failed: ${e.ref}`;
    default:
      return e.ref ?? e.type;
  }
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="card stat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
