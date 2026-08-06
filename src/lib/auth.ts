// Shared-password gate helpers.
//
// Web Crypto (not node:crypto) so the exact same code runs in the Edge
// middleware and in the Node route handlers.

const enc = new TextEncoder();

// Bump to invalidate every issued cookie without changing the password.
const COOKIE_VERSION = "olum-auth-v1";

/** HMAC-SHA256(ACCESS_PASSWORD, COOKIE_VERSION), hex.
 *
 *  The cookie stores this instead of the password itself. The old scheme put
 *  the raw password in the cookie, so anything that ever sees a cookie — a
 *  proxy log, a shared browser, devtools — handed over the password people
 *  may have reused elsewhere. The derived token still grants access if stolen,
 *  but it's scoped to this app and dies when the password rotates. */
export async function sessionToken(password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(COOKIE_VERSION));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time compare, so response latency doesn't reveal how many leading
 *  characters of a guess were right. Length mismatch short-circuits — that
 *  leaks the length, not the content, which is the same trade node's
 *  timingSafeEqual makes. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const AUTH_COOKIE = "olum_auth";
