import Link from "next/link";
import { getAllSenders, getReportSenderKey, getFounderName, getSender } from "@/lib/env";
import { feedConfigured } from "@/lib/report-source";
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
      <h1>User feedback &amp; demo campaign</h1>
      <p className="sub">
        Write to the people already using Olum, straight from their live activity: who signed up,
        which landing page they came in through, what they ran, which sections they opened and
        whether they reached their results. Everyone lands in a funnel segment, and each segment
        gets its own branded letter asking for feedback with a &ldquo;Book a demo&rdquo; button.
        For one-by-one drafts as activity happens, see <Link href="/approvals">Approvals</Link>.
      </p>

      <ReportForm
        senders={senders}
        defaultSenderKey={defaultSenderKey}
        defaultFounderName={getFounderName()}
        defaultBookingLink={getSender(defaultSenderKey).bookingLink}
        feedReady={feedConfigured()}
      />
    </div>
  );
}
