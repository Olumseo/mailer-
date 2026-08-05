import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { updateCampaignAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const campaignId = Number(id);

  const [c] = (await sql`
    SELECT id, name, subject, body_template, status
    FROM campaigns WHERE id = ${campaignId}`) as Array<{
    id: number; name: string; subject: string; body_template: string; status: string;
  }>;
  if (!c) notFound();

  return (
    <div>
      <p className="hint"><Link href={`/campaigns/${c.id}`}>← Campaign</Link></p>
      <h1>Edit campaign <span className={`badge ${c.status}`}>{c.status}</span></h1>
      <p className="sub">
        You can edit the copy at any time. Changes to the subject or body only affect emails that
        haven&apos;t been sent yet — already-sent messages are unchanged. Recipients and sender split
        aren&apos;t changed here.
      </p>

      <form className="card" action={updateCampaignAction}>
        <input type="hidden" name="id" value={c.id} />
        <label>Campaign name</label>
        <input name="name" defaultValue={c.name} required />

        <label>Subject line</label>
        <input name="subject" defaultValue={c.subject} required />

        <label>Body template</label>
        <textarea name="bodyTemplate" defaultValue={c.body_template} required />
        <div className="mono-note" style={{ marginTop: 8 }}>
          Placeholders: <code>{"{{company}}"}</code> <code>{"{{senderName}}"}</code>{" "}
          <code>{"{{senderTitle}}"}</code> <code>{"{{bookingLink}}"}</code>. Spintax{" "}
          <code>{"{a|b|c}"}</code> varies each email.
        </div>

        <div className="actions">
          <button type="submit">Save changes</button>
          <Link className="btn ghost" href={`/campaigns/${c.id}`}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
