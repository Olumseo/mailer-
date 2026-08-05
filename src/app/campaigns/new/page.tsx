import { DEFAULT_TEMPLATE } from "@/lib/template";
import { CampaignForm } from "./CampaignForm";

export const dynamic = "force-dynamic";

export default function NewCampaign() {
  return (
    <div>
      <h1>New campaign</h1>
      <p className="sub">
        Upload the list, pick which sheet(s) to send to, set the copy, then start. Recipients are
        shuffled and split evenly across all three senders; each send time is jittered inside
        business hours.
      </p>
      <CampaignForm defaultTemplate={DEFAULT_TEMPLATE} />
    </div>
  );
}
