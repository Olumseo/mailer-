import { NextRequest, NextResponse } from "next/server";
import { CRON_SECRET, redactSecrets } from "@/lib/env";
import { safeEqual } from "@/lib/auth";
import { ensureSchema, withRetry } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One-time (idempotent) table creation. Call once after deploy:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP/api/setup
export async function GET(req: NextRequest) {
  const secret = CRON_SECRET();
  const bearer = req.headers.get("authorization");
  const key = bearer?.startsWith("Bearer ") ? bearer.slice(7) : req.nextUrl.searchParams.get("key");
  if (key === null || !safeEqual(key, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    await withRetry(() => ensureSchema(), 5);
  } catch (e) {
    return NextResponse.json({ ok: false, error: redactSecrets((e as Error).message) }, { status: 500 });
  }
  return NextResponse.json({ ok: true, message: "Schema ready." });
}
