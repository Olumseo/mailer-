import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Olum Outreach",
  description: "Internal outreach mailer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav>
          <div className="inner">
            <span className="brand">OLUM · OUTREACH</span>
            <Link href="/">Dashboard</Link>
            <Link href="/campaigns/new">New campaign</Link>
            <Link href="/campaigns/report">User feedback</Link>
            <Link href="/sent">Sent</Link>
            <Link href="/meetings">Meetings</Link>
            <span className="spacer" />
            <span className="hint">internal tool</span>
          </div>
        </nav>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
