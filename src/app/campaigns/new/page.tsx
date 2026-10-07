import { DEFAULT_TEMPLATE } from "@/lib/template";
import { getAllSenders } from "@/lib/env";
import { CampaignForm } from "./CampaignForm";

export const dynamic = "force-dynamic";

export default function NewCampaign() {
  const senders = getAllSenders().map((s) => ({
    key: s.key,
    name: s.displayName,
    email: s.email,
    title: s.title,
    bookingLink: s.bookingLink,
  }));

  return (
    <div>
      <h1>New campaign</h1>
      <p className="sub">
        Upload the list, pick which sheet(s) to send to, choose the mailbox it goes out from, write
        the email — HTML on the left, the branded email it becomes on the right — then start. Recipients are shuffled and — unless you pin one mailbox — split
        evenly across every sender; each send time is jittered inside business hours.
      </p>
      <CampaignForm defaultTemplate={DEFAULT_TEMPLATE} senders={senders} />
    </div>
  );
}
