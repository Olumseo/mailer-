import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { textToHtml } from "@/lib/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The exact HTML of one sent email, for the Sent page's preview.
// Emails sent before HTML was recorded are shown from their text body.
// Gated by the access-cookie middleware.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = (await sql`
    SELECT html, body FROM sent_emails WHERE id = ${Number(id) || 0}`) as {
    html: string | null;
    body: string | null;
  }[];
  if (!row) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(row.html || textToHtml(row.body ?? ""), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Opened directly, it still can't run anything: no scripts, only images.
      "Content-Security-Policy": "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'",
      "X-Rendered-From": row.html ? "html" : "text",
    },
  });
}
