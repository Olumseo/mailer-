// Login welcome self-test — sends nothing, touches no network, never Neon.
//
//   npm run welcome:selftest
//
// Off by default; first sign-in sends once from the founder's mailbox (branded
// HTML, demo button, recipient + Sent log rows); later sign-ins never resend,
// not even under another account with the same address; internal/team/
// disposable accounts are skipped; a failed send is retried on the next
// sign-in; copy edited on /welcome is what goes out.

export {}; // a module, so its names don't collide with the other self-tests

// Forced before db.ts loads: everything is imported dynamically in main().
process.env.USE_LOCAL_SNAPSHOT = "true";
process.env.SNAPSHOT_PATH = "no-such-snapshot-for-welcome-selftest.json";
process.env.SENDER_EMAIL_1 = "rohan@example.test";
process.env.SENDER_NAME_1 = "Rohan";
process.env.SENDER_TITLE_1 = "Founder, Olum AI";
process.env.BOOKING_LINK_1 = "https://cal.example.test/rohan";
process.env.SENDER_EMAIL_2 = "barath@example.test";
process.env.SENDER_NAME_2 = "Barath";
process.env.LOGIN_WELCOME_SENDER = "1";
process.env.INTERNAL_DOMAINS = "olum.ai";
process.env.TEAM_EMAIL_HINTS = "qa-test";
process.env.OLUM_FEED_KEY = "test-key";
process.env.LOGIN_WELCOME_ENABLED = "false";

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}

type Sent = { from: string; to: string; subject: string; html: string; text: string };

async function main() {
  const { handleLoginEvent, saveWelcomeCopy } = await import("../src/lib/welcome");
  const { sql, ensureSchema, isSnapshotMode } = await import("../src/lib/db");
  if (!isSnapshotMode()) {
    console.error("Refusing to run: not in local-snapshot mode, this would hit Neon.");
    process.exit(1);
  }
  await ensureSchema();

  const outbox: Sent[] = [];
  let failNext = false;
  const send = (async (a: { sender: { email: string }; to: string; subject: string; html: string; text?: string }) => {
    if (failNext) {
      failNext = false;
      throw new Error("Graph 503: try again later");
    }
    outbox.push({ from: a.sender.email, to: a.to, subject: a.subject, html: a.html, text: a.text ?? "" });
  }) as unknown as Parameters<typeof handleLoginEvent>[1] extends infer D ? NonNullable<D extends { send?: infer S } ? S : never> : never;
  const login = (over: Record<string, string> = {}) =>
    handleLoginEvent(
      { user_id: "u-1", email: "Priya@BrightDental.in", full_name: "Priya Raman", provider: "google", ...over },
      { send }
    );

  console.log("\n— switch —");
  let r = await login();
  check(r.status === "disabled" && outbox.length === 0, "off by default: nothing sent", JSON.stringify(r));
  process.env.LOGIN_WELCOME_ENABLED = "true";

  console.log("\n— first sign-in —");
  r = await login();
  check(r.status === "sent" && outbox.length === 1, "first sign-in sends one email", JSON.stringify(r));
  const m = outbox[0];
  check(m.from === "rohan@example.test" && m.to === "priya@brightdental.in", "from the founder, to the user", `${m.from} → ${m.to}`);
  check(/, Priya/.test(m.subject) && /welcome to Olum/i.test(m.subject), "subject is the welcome, with their name", m.subject);
  check(m.html.includes("https://cal.example.test/rohan") && m.html.includes("Book a demo with Rohan"), "branded HTML carries the demo button");
  check(m.html.includes("Hi Priya") && !/\{\{|\}\}/.test(m.html + m.subject), "personalised, no leftover placeholders");
  check(m.text.includes("successfully"), "plain-text part present");
  const [rec] = (await sql`
    SELECT r.status, r.sender_key, c.kind FROM recipients r JOIN campaigns c ON c.id = r.campaign_id
    WHERE r.email = 'priya@brightdental.in'`) as { status: string; sender_key: string; kind: string }[];
  check(rec?.status === "sent" && rec.kind === "welcome" && rec.sender_key === "1", "recorded as a sent recipient of the welcome campaign (reply detection)", JSON.stringify(rec));
  const [log] = (await sql`SELECT count(*)::int n, max(length(html)) h FROM sent_emails WHERE to_email = 'priya@brightdental.in'`) as { n: number; h: number }[];
  check(log.n === 1 && log.h > 1000, "on the Sent log with its HTML", JSON.stringify(log));

  console.log("\n— later sign-ins —");
  r = await login();
  check(r.status === "already" && outbox.length === 1, "second sign-in sends nothing", JSON.stringify(r));
  r = await login({ user_id: "u-1b" });
  check(r.status === "already" && outbox.length === 1, "same address under another account: nothing", JSON.stringify(r));
  const [w] = (await sql`SELECT logins FROM login_welcomes WHERE user_id = 'u-1'`) as { logins: number }[];
  check(w.logins === 2, "sign-ins are counted", String(w.logins));

  console.log("\n— who is skipped —");
  for (const [email, why] of [["dev@olum.ai", "internal"], ["qa-test1@gmail.com", "team account"], ["x@mailinator.com", "disposable"]]) {
    r = await login({ user_id: `skip-${email}`, email });
    check(r.status === "skipped" && "reason" in r && r.reason === why, `${email} skipped (${why})`, JSON.stringify(r));
  }
  r = await login({ user_id: "", email: "a@b.co" });
  check(r.status === "invalid", "missing user_id is rejected", JSON.stringify(r));
  check(outbox.length === 1, "still only one email sent");

  console.log("\n— failure and retry —");
  failNext = true;
  r = await login({ user_id: "u-2", email: "sam@beta.io", full_name: "Sam Lee" });
  check(r.status === "failed" && outbox.length === 1, "a failed send is recorded", JSON.stringify(r));
  r = await login({ user_id: "u-2", email: "sam@beta.io", full_name: "Sam Lee" });
  check(r.status === "sent" && outbox.length === 2, "and retried on the next sign-in", JSON.stringify(r));
  r = await login({ user_id: "u-2", email: "sam@beta.io", full_name: "Sam Lee" });
  check(r.status === "already" && outbox.length === 2, "then never again", JSON.stringify(r));

  console.log("\n— edited copy —");
  await saveWelcomeCopy({ subject: "Hello {{firstName}} from Rohan", body: "<p>{{greeting}}, custom note.</p>\n{{demoButton}}\n{{signature}}" });
  r = await login({ user_id: "u-3", email: "anna@gamma.co", full_name: "Anna Bell" });
  const last = outbox[outbox.length - 1];
  check(r.status === "sent" && last.subject === "Hello Anna from Rohan" && last.html.includes("custom note"), "edited copy is what goes out", last.subject);
  await saveWelcomeCopy(null);
  r = await login({ user_id: "u-4", email: "li@delta.co", full_name: "" });
  const nameless = outbox[outbox.length - 1];
  check(
    r.status === "sent" && nameless.html.includes("Hi there") && !/there|, —|,\s*$|\s,/.test(nameless.subject),
    "reset to default; subject reads well without a name",
    nameless.subject
  );

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll welcome checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
