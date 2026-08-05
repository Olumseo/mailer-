import { sql } from "@/lib/db";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SentPage() {
  let rows: Array<{
    id: number; sender: string; to_email: string; company: string | null;
    subject: string | null; body: string | null; sent_at: string; campaign_name: string | null;
  }> = [];
  let total = 0;
  try {
    rows = (await sql`
      SELECT s.id, s.sender, s.to_email, s.company, s.subject, s.body, s.sent_at,
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Sent emails</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn ghost" href="/api/sent-log?format=csv" style={{ fontSize: 12, padding: "6px 12px" }}>Download CSV</a>
          <a className="btn ghost" href="/api/sent-log?format=jsonl" style={{ fontSize: 12, padding: "6px 12px" }}>Download JSONL</a>
        </div>
      </div>
      <p className="sub">
        Durable record of every email actually sent — stored in the database, so it persists on
        Vercel. Showing the latest {rows.length} of {total}.
      </p>

      {rows.length === 0 ? (
        <div className="card empty">Nothing sent yet.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Sent (IST)</th><th>To</th><th>From</th><th>Subject</th><th>Body</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="hint" style={{ whiteSpace: "nowrap" }}>{fmt(r.sent_at)}</td>
                  <td>
                    {r.company ?? "—"}
                    <div className="hint">{r.to_email}</div>
                    {r.campaign_name ? <div className="hint">↳ {r.campaign_name}</div> : null}
                  </td>
                  <td className="hint">{r.sender}</td>
                  <td>{r.subject}</td>
                  <td>
                    <details>
                      <summary style={{ cursor: "pointer", color: "var(--muted)" }}>view</summary>
                      <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 6, maxWidth: 420 }}>
                        {r.body}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
