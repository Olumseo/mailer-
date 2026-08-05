import { NextRequest, NextResponse } from "next/server";
import { CRON_SECRET } from "@/lib/env";
import { ensureSchema, withRetry } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-time (idempotent) table creation. Call once after deploy:
//   GET /api/setup?key=YOUR_CRON_SECRET
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== CRON_SECRET()) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await withRetry(() => ensureSchema(), 5);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: "Schema ready." });
}
