"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns/new", label: "New campaign" },
  { href: "/campaigns/report", label: "User feedback" },
  { href: "/approvals", label: "Approvals" },
  { href: "/welcome", label: "Login welcome" },
  { href: "/sent", label: "Sent" },
  { href: "/meetings", label: "Meetings" },
];

export function NavLinks() {
  const path = usePathname() ?? "/";
  // Longest matching prefix wins, so /campaigns/new doesn't also light up "/".
  const active = LINKS.filter((l) => (l.href === "/" ? path === "/" : path.startsWith(l.href)))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={l.href === active ? "active" : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  );
}
