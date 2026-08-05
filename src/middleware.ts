import { NextRequest, NextResponse } from "next/server";

// Lightweight shared-password gate for this internal tool.
// The cron + setup endpoints authenticate with CRON_SECRET instead, so
// they're excluded here.
const PUBLIC_PATHS = ["/login", "/api/login", "/api/cron", "/api/setup"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const expected = process.env.ACCESS_PASSWORD;
  const cookie = req.cookies.get("olum_auth")?.value;
  if (expected && cookie === expected) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
