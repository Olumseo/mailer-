import type { Sender } from "./types";

// ─── Google OAuth 2.0 (XOAUTH2) ──────────────────────────────────────
// For Gmail mailboxes that authenticate with a refresh token instead of an
// app password. Sending needs SMTP and reply detection needs IMAP, and both
// require the restricted scope https://mail.google.com/ — the narrower
// gmail.send scope cannot open an IMAP session.

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Scope that covers both SMTP send and IMAP read. */
export const GOOGLE_MAIL_SCOPE = "https://mail.google.com/";

/** Access tokens keyed by refresh token — a mailbox's token is its own. */
const cache = new Map<string, { value: string; expiresAt: number }>();

function assertConfigured(sender: Sender): void {
  const missing: string[] = [];
  if (!sender.email) missing.push(`SENDER_EMAIL_${sender.key}`);
  if (!sender.googleClientId) missing.push("GOOGLE_CLIENT_ID");
  if (!sender.googleClientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!sender.googleRefreshToken) missing.push(`GOOGLE_REFRESH_TOKEN_${sender.key}`);
  if (missing.length) {
    throw new Error(
      `Google OAuth not configured for sender ${sender.key} — set ${missing.join(", ")}. ` +
        `Run: npx tsx scripts/google-oauth-setup.ts --sender ${sender.key}`
    );
  }
}

/** Exchange the refresh token for an access token, cached until it expires. */
export async function getGoogleAccessToken(sender: Sender): Promise<string> {
  assertConfigured(sender);
  const hit = cache.get(sender.googleRefreshToken);
  // 60s buffer so a token cannot expire mid-session.
  if (hit && Date.now() < hit.expiresAt - 60_000) return hit.value;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: sender.googleClientId,
      client_secret: sender.googleClientSecret,
      refresh_token: sender.googleRefreshToken,
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  if (!res.ok) {
    // invalid_grant is by far the most common failure: an unpublished app in
    // "Testing" mode expires its refresh tokens after 7 days.
    const expired = /invalid_grant/.test(text);
    throw new Error(
      `Google token refresh failed for sender ${sender.key} (${res.status})` +
        (expired
          ? " — the refresh token is revoked or expired. An OAuth app left in " +
            "'Testing' mode expires refresh tokens every 7 days; publish it in the " +
            "Google Cloud console, then re-run scripts/google-oauth-setup.ts."
          : "")
    );
  }

  const data = JSON.parse(text) as { access_token: string; expires_in: number };
  cache.set(sender.googleRefreshToken, {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}
