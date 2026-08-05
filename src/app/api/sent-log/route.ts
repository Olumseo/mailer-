import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Exports the sent_emails table. Gated by the access-cookie middleware.
//   /api/sent-log?format=csv    (default: jsonl)
export async function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "jsonl";

  const rows = (await sql`
    SELECT s.id,
           to_char(s.sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS sent_at,
           s.sender, s.to_email, s.company, s.subject, s.body,
           c.name AS campaign_name
    FROM sent_emails s LEFT JOIN campaigns c ON c.id = s.campaign_id
    ORDER BY s.sent_at DESC LIMIT 10000`) as Array<Record<string, unknown>>;

  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const cols = ["id", "sent_at", "sender", "to_email", "company", "campaign_name", "subject", "body"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(",")];
    for (const r of rows) lines.push(cols.map((c) => esc(r[c])).join(","));
    return new NextResponse(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sent-emails-${stamp}.csv"`,
      },
    });
  }

  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="sent-emails-${stamp}.jsonl"`,
    },
  });
}
