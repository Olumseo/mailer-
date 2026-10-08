import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, safeEqual, sessionToken } from "@/lib/auth";

// Lightweight shared-password gate for this internal tool.
// The cron + setup endpoints authenticate with CRON_SECRET, and the backend's
// login hook with the shared feed key, so they're excluded here.
const PUBLIC_PATHS = ["/login", "/api/login", "/api/cron", "/api/setup", "/api/hooks/"];

// This tool is not meant to be indexed, framed, or linked out of with a
// referrer — it shows real prospect data behind one shared password.
function harden(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return harden(NextResponse.next());
  }

  const expected = process.env.ACCESS_PASSWORD;
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  // Fail closed: no ACCESS_PASSWORD configured means nobody gets in, rather
  // than the whole dashboard being open because a deploy forgot the var.
  if (expected && cookie && safeEqual(cookie, await sessionToken(expected))) {
    return harden(NextResponse.next());
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname);
  const res = harden(NextResponse.redirect(url));
  // Clear a stale/forged cookie so the browser stops replaying it.
  if (cookie) res.cookies.delete(AUTH_COOKIE);
  return res;
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
