import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { getSender } from "../src/lib/env";
import { GOOGLE_MAIL_SCOPE } from "../src/lib/google-oauth";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// One-time consent flow: turns a Google OAuth client into a refresh token for
// one mailbox, which SMTP and IMAP then use instead of an app password.
//
//   npx tsx scripts/google-oauth-setup.ts --sender 6
//
// Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET in .env, from a "Desktop app"
// OAuth client (that type allows the loopback redirect used below).

const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}/`;

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  const v = i === -1 ? null : process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

/** Wait for Google to redirect back, and hand over the one-time code. */
function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", REDIRECT);
      const code = url.searchParams.get("code");
      const err = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        code
          ? "<h2>Done.</h2><p>Authorised. You can close this tab and go back to the terminal.</p>"
          : `<h2>Failed</h2><p>${err ?? "no code returned"}</p>`
      );
      server.close();
      if (code) resolve(code);
      else reject(new Error(err ?? "no code returned"));
    });
    server.on("error", reject);
    server.listen(PORT);
    // Don't hang a terminal forever if the browser tab is abandoned.
    setTimeout(() => {
      server.close();
      reject(new Error("timed out after 15 minutes waiting for the browser redirect"));
    }, 900_000).unref();
  });
}

async function main() {
  const key = arg("sender") ?? "6";
  const sender = getSender(key);

  if (!sender.googleClientId || !sender.googleClientSecret) {
    console.error(`Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env (sender ${key}).`);
    console.error("Create a Desktop app OAuth client first - see README, 'Adding a Gmail mailbox (OAuth)'.");
    process.exit(1);
  }

  const authUrl =
    "https://accounts.google.com/o/oauth2/v2/auth?" +
    new URLSearchParams({
      client_id: sender.googleClientId,
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: GOOGLE_MAIL_SCOPE,
      // offline + consent is what actually returns a refresh token; without
      // prompt=consent Google omits it on every grant after the first.
      access_type: "offline",
      prompt: "consent",
      login_hint: sender.email,
    }).toString();

  console.log(`Authorising mailbox: ${sender.email || "(SENDER_EMAIL_" + key + " not set)"}`);
  console.log("");
  console.log("Open this URL and sign in AS THAT MAILBOX:");
  console.log("");
  console.log(authUrl);
  console.log("");
  console.log("Google will warn the app is unverified - click Advanced, then 'Go to ... (unsafe)'.");
  console.log(`Waiting for the redirect to ${REDIRECT} ...`);

  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", authUrl], { detached: true, stdio: "ignore" }).unref();
  }

  const code = await waitForCode();

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: sender.googleClientId,
      client_secret: sender.googleClientSecret,
      redirect_uri: REDIRECT,
    }).toString(),
  });

  const data = (await res.json()) as { refresh_token?: string; error_description?: string };
  if (!res.ok || !data.refresh_token) {
    console.error(`Token exchange failed (${res.status}): ${data.error_description ?? "no refresh_token returned"}`);
    console.error("If there is no refresh_token, revoke the app at myaccount.google.com/permissions and retry.");
    process.exit(1);
  }

  console.log("");
  console.log("Success. Put this line in .env (keep it secret, it is a credential):");
  console.log("");
  console.log(`GOOGLE_REFRESH_TOKEN_${key}=${data.refresh_token}`);
  console.log("");
  console.log(`Then run:  npx tsx scripts/verify-senders.ts --sender ${key}`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
