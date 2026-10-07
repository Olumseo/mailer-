import "./globals.css";
import type { Metadata } from "next";
import { NavLinks } from "./components/NavLinks";

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
            <NavLinks />
            <span className="spacer" />
            <span className="hint">internal tool</span>
          </div>
        </nav>
        <div className="wrap">{children}</div>
      </body>
    </html>
  );
}
