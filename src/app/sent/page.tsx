import { sql } from "@/lib/db";
import { fmt } from "@/lib/format";
import { MailFrame } from "./MailFrame";

export const dynamic = "force-dynamic";

export default async function SentPage() {
  let rows: Array<{
    id: number; sender: string; to_email: string; company: string | null;
    subject: string | null; sent_at: string; campaign_name: string | null;
  }> = [];
  let total = 0;
  try {
    rows = (await sql`
      SELECT s.id, s.sender, s.to_email, s.company, s.subject, s.sent_at,
             c.name AS campaign_name
      FROM sent_emails s LEFT JOIN campaigns c ON c.id = s.campaign_id
      ORDER BY s.sent_at DESC LIMIT 200`) as typeof rows;
    const [{ n }] = (await sql`SELECT count(*)::int n FROM sent_emails`) as { n: number }[];
    total = n;
  } catch {
    // table not created yet
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Sent emails</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn ghost" href="/api/sent-log?format=csv" style={{ fontSize: 12, padding: "6px 12px" }}>Download CSV</a>
          <a className="btn ghost" href="/api/sent-log?format=jsonl" style={{ fontSize: 12, padding: "6px 12px" }}>Download JSONL</a>
        </div>
      </div>
      <p className="sub">
        Every email actually sent, stored in the database. Showing the latest {rows.length} of{" "}
        {total} — click one to see it exactly as the recipient did.
      </p>

      {rows.length === 0 ? (
        <div className="card empty">Nothing sent yet.</div>
      ) : (
        <div className="sent-list">
          {rows.map((r) => (
            <details className="sent-item" key={r.id}>
              <summary>
                <div className="when hint">{fmt(r.sent_at)}</div>
                <div className="who">
                  <div>{r.company || r.to_email}</div>
                  <div className="hint">{r.to_email}</div>
                </div>
                <div className="subj">
                  <div>{r.subject || "(no subject)"}</div>
                  <div className="hint">
                    {r.campaign_name ? `${r.campaign_name} · ` : ""}from {r.sender}
                  </div>
                </div>
                <span className="chev">▶</span>
              </summary>
              <div className="sent-body">
                <MailFrame id={r.id} title={`Email to ${r.to_email}`} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
