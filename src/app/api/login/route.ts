import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

export const runtime = "nodejs";

// Crude per-IP throttle. The gate is one shared password on a public URL, so
// without this it's freely brute-forceable. In-memory means it resets on cold
// start and isn't shared across serverless instances — it raises the cost of a
// guessing run, it doesn't make one impossible. A long ACCESS_PASSWORD is
// still what actually protects this.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
}

function fail(req: NextRequest, next: string, code: string) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("error", code);
  if (next) url.searchParams.set("next", next);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const rawNext = String(form.get("next") ?? "/");
  // Only same-site paths — an attacker-supplied ?next=https://evil.tld would
  // otherwise turn the login form into an open redirect.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (tooManyAttempts(clientIp(req))) {
    return fail(req, next, "rate");
  }

  const expected = process.env.ACCESS_PASSWORD;
  if (!expected || !safeEqual(password, expected)) {
    return fail(req, next, "1");
  }

  const res = NextResponse.redirect(new URL(next, req.url), { status: 303 });
  res.cookies.set(AUTH_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    // Plain http on localhost can't set a `secure` cookie, so dev would never
    // stay logged in. Production is always https.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
