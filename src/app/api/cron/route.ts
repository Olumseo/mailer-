import { NextRequest, NextResponse } from "next/server";
import { CRON_SECRET, redactSecrets } from "@/lib/env";
import { safeEqual } from "@/lib/auth";
import {
  processDueSends,
  pollReplies,
  processMeetingReminders,
} from "@/lib/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby cap

function authorized(req: NextRequest): boolean {
  const secret = CRON_SECRET();
  const bearer = req.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return safeEqual(bearer.slice(7), secret);
  }
  // ?key= is kept for schedulers that can't set headers, but the secret then
  // lands in access logs, proxy logs and browser history. Prefer the header.
  const key = req.nextUrl.searchParams.get("key");
  return key !== null && safeEqual(key, secret);
}

async function tick(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Each step is independent; one failing shouldn't block the others.
  const results: Record<string, unknown> = {};
  try {
    results.sends = await processDueSends();
  } catch (e) {
    results.sends = { error: redactSecrets((e as Error).message) };
  }
  try {
    results.replies = await pollReplies();
  } catch (e) {
    results.replies = { error: redactSecrets((e as Error).message) };
  }
  try {
    results.reminders = await processMeetingReminders();
  } catch (e) {
    results.reminders = { error: redactSecrets((e as Error).message) };
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), ...results });
}

// cron-job.org can call either verb.
export const GET = tick;
export const POST = tick;
