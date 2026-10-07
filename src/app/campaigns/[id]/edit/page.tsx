import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { updateCampaignAction } from "@/app/actions";
import { getSender, getSenderKeys } from "@/lib/env";
import { EmailEditor } from "@/app/components/EmailEditor";

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

  // Preview as the campaign's first recipient, from the mailbox they're on.
  const [first] = (await sql`
    SELECT name, email, sender_key, vars FROM recipients
    WHERE campaign_id = ${campaignId} ORDER BY id LIMIT 1`) as Array<{
    name: string; email: string; sender_key: string; vars: Record<string, string> | null;
  }>;
  const keys = getSenderKeys();
  const sender = getSender(first && keys.includes(first.sender_key) ? first.sender_key : keys[0]);

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

        <label>Email</label>
        <EmailEditor
          subjectName="subject"
          bodyName="bodyTemplate"
          defaultSubject={c.subject}
          defaultBody={c.body_template}
          sender={{ displayName: sender.displayName, title: sender.title, bookingLink: sender.bookingLink }}
          senderEmail={sender.email}
          sample={{
            company: first?.name ?? "Acme Pte Ltd",
            toEmail: first?.email,
            extra: first?.vars ?? undefined,
          }}
          placeholders={["company", "senderName", "senderTitle", "bookingLink", "demoButton", "signature"]}
        />

        <div className="actions">
          <button type="submit">Save changes</button>
          <Link className="btn ghost" href={`/campaigns/${c.id}`}>Cancel</Link>
        </div>
      </form>
    </div>
  );
}
