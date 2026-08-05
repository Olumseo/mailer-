import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { getAllSenders } from "@/lib/env";
import { fmt } from "@/lib/format";
import {
  startCampaignAction,
  pauseCampaignAction,
  resumeCampaignAction,
  deleteCampaignAction,
} from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = Number(id);

  const [campaign] = (await sql`
    SELECT id, name, subject, status, created_at, started_at, source_file
    FROM campaigns WHERE id = ${campaignId}`) as Array<{
    id: number; name: string; subject: string; status: string;
    created_at: string; started_at: string | null; source_file: string | null;
  }>;
  if (!campaign) notFound();

  const [counts] = (await sql`
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE status='sent')::int AS sent,
      count(*) FILTER (WHERE status='scheduled')::int AS scheduled,
      count(*) FILTER (WHERE status='replied')::int AS replied,
      count(*) FILTER (WHERE status='failed')::int AS failed,
      count(*) FILTER (WHERE status='pending')::int AS pending,
      min(next_send_at) FILTER (WHERE status='scheduled') AS next_at
    FROM recipients WHERE campaign_id = ${campaignId}`) as Array<{
    total: number; sent: number; scheduled: number; replied: number;
    failed: number; pending: number; next_at: string | null;
  }>;

  const recipients = (await sql`
    SELECT name, email, sender_key, status, next_send_at, sent_at, error
    FROM recipients WHERE campaign_id = ${campaignId}
    ORDER BY
      CASE status WHEN 'replied' THEN 0 WHEN 'sending' THEN 1 WHEN 'scheduled' THEN 2
                  WHEN 'sent' THEN 3 WHEN 'failed' THEN 4 ELSE 5 END,
      next_send_at NULLS LAST
    LIMIT 500`) as Array<{
    name: string; email: string; sender_key: string; status: string;
    next_send_at: string | null; sent_at: string | null; error: string | null;
  }>;

  const senders = getAllSenders();
  const senderName = (k: string) => senders.find((s) => s.key === k)?.displayName ?? k;

  return (
    <div>
      <p className="hint"><Link href="/">← Dashboard</Link></p>
      <h1>{campaign.name} <span className={`badge ${campaign.status}`}>{campaign.status}</span></h1>
      <p className="sub">{campaign.subject}</p>

      <div className="grid cols-4">
        <Stat n={counts.sent} l="Sent" />
        <Stat n={counts.scheduled} l="Scheduled" />
        <Stat n={counts.replied} l="Replied" />
        <Stat n={counts.failed} l="Failed" />
      </div>

      <div className="actions">
        {campaign.status === "draft" && (
          <form action={startCampaignAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <button type="submit">Start sending</button>
          </form>
        )}
        {campaign.status === "running" && (
          <form action={pauseCampaignAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <button className="ghost" type="submit">Pause</button>
          </form>
        )}
        {campaign.status === "paused" && (
          <form action={resumeCampaignAction}>
            <input type="hidden" name="id" value={campaign.id} />
            <button type="submit">Resume</button>
          </form>
        )}
        <Link className="btn ghost" href={`/campaigns/${campaign.id}/edit`}>Edit</Link>
        <form action={deleteCampaignAction}>
          <input type="hidden" name="id" value={campaign.id} />
          <button className="danger" type="submit">Delete</button>
        </form>
      </div>

      {counts.next_at && (
        <p className="hint">Next send due: {fmt(counts.next_at)}</p>
      )}

      <h2>Recipients ({counts.total})</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Company</th><th>Email</th><th>Sender</th><th>Status</th>
              <th>Next / sent</th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td className="hint">{r.email}</td>
                <td>{senderName(r.sender_key)}</td>
                <td>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                  {r.error ? <div className="hint" style={{ color: "var(--bad)" }}>{r.error}</div> : null}
                </td>
                <td className="hint">
                  {r.sent_at ? fmt(r.sent_at) : r.next_send_at ? fmt(r.next_send_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="card stat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}
