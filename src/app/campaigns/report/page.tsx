import Link from "next/link";
import { getAllSenders, getReportSenderKey, getFounderName, getSender } from "@/lib/env";
import { ReportForm } from "./ReportForm";

export const dynamic = "force-dynamic";

export default function ReportCampaignPage() {
  const senders = getAllSenders().map((s) => ({
    key: s.key,
    name: s.displayName,
    email: s.email,
  }));
  const defaultSenderKey = getReportSenderKey();

  return (
    <div>
      <p className="hint">
        <Link href="/">← Dashboard</Link>
      </p>
      <h1>Product feedback campaign</h1>
      <p className="sub">
        Upload the users report the app generates, and write to the people already in it. Everyone
        is placed in a funnel segment — signed up and stalled, analysis failed, ran it but never
        reached the dashboard, or got all the way through — and each segment gets its own letter
        asking for feedback and offering a call with the founder.
      </p>

      <ReportForm
        senders={senders}
        defaultSenderKey={defaultSenderKey}
        defaultFounderName={getFounderName()}
        defaultBookingLink={getSender(defaultSenderKey).bookingLink}
      />
    </div>
  );
}
