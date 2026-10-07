import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/auth";
import { getWelcomeConfig, redactSecrets } from "@/lib/env";
import { handleLoginEvent, type LoginEvent } from "@/lib/welcome";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// olum-backend calls this after every successful sign-in (fire-and-forget).
// Not behind the access cookie — authenticated by the shared X-Outreach-Key
// (the backend's OUTREACH_FEED_KEY = OLUM_FEED_KEY here). No key, no hook.
export async function POST(req: NextRequest) {
  const cfg = getWelcomeConfig();
  if (!cfg.hookKey) {
    return NextResponse.json({ error: "Login hook is not configured." }, { status: 503 });
  }
  const given = (req.headers.get("x-outreach-key") ?? "").trim();
  if (!given || !safeEqual(given, cfg.hookKey)) {
    return NextResponse.json({ error: "Invalid outreach key." }, { status: 401 });
  }

  let evt: LoginEvent;
  try {
    evt = (await req.json()) as LoginEvent;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  try {
    const result = await handleLoginEvent(evt);
    return NextResponse.json(result, { status: result.status === "invalid" ? 400 : 200 });
  } catch (e) {
    return NextResponse.json(
      { status: "error", reason: redactSecrets((e as Error).message).slice(0, 300) },
      { status: 500 }
    );
  }
}
