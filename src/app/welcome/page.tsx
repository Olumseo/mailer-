import { sql, ensureSchemaOnce } from "@/lib/db";
import { getActivityConfig, getSender, getWelcomeConfig } from "@/lib/env";
import { fmt } from "@/lib/format";
import { getWelcomeCopy, welcomeVars, DEFAULT_WELCOME } from "@/lib/welcome";
import { saveWelcomeCopyAction, resetWelcomeCopyAction } from "@/app/actions";
import { EmailEditor } from "@/app/components/EmailEditor";

export const dynamic = "force-dynamic";

interface Row {
  user_id: string;
  email: string;
  name: string | null;
  status: string;
  reason: string | null;
  logins: number;
  created_at: string;
  sent_at: string | null;
  last_login_at: string;
}

const STATUS_BADGE: Record<string, string> = { sent: "sent", failed: "failed", skipped: "draft", sending: "sending" };

export default async function WelcomePage() {
  const cfg = getWelcomeConfig();
  const sender = getSender(cfg.senderKey);
  const appUrl = getActivityConfig().appUrl;

  let copy = { ...DEFAULT_WELCOME, edited: false };
  let rows: Row[] = [];
  let counts: Record<string, number> = {};
  let dbError = "";
  try {
    await ensureSchemaOnce();
    copy = await getWelcomeCopy();
    rows = (await sql`
      SELECT user_id, email, name, status, reason, logins, created_at, sent_at, last_login_at
      FROM login_welcomes ORDER BY created_at DESC LIMIT 100`) as unknown as Row[];
    const c = (await sql`SELECT status, count(*)::int n FROM login_welcomes GROUP BY status`) as {
      status: string;
      n: number;
    }[];
    counts = Object.fromEntries(c.map((x) => [x.status, x.n]));
  } catch (e) {
    dbError = (e as Error).message;
  }

  const sample = welcomeVars("Priya Raman", sender, cfg.dashboardUrl);

  return (
    <div>
      <h1>Login welcome</h1>
      <p className="sub">
        The first time someone signs in to Olum, the backend tells this app and{" "}
        {sender.displayName} sends them one personal welcome straight away: they&rsquo;re in, and
        if they want help or a walkthrough, here&rsquo;s a &ldquo;Book a demo&rdquo; button. Once per
        person, never again; internal and test accounts are skipped. Replies show up like any
        campaign reply.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="hint">
          {cfg.enabled ? "✅ Login welcome is ON" : "⏸ Login welcome is OFF (set LOGIN_WELCOME_ENABLED=true)"}
          {" · "}sends from {sender.displayName} &lt;{sender.email || "no address set"}&gt;
          {sender.bookingLink ? " · demo button → their booking link" : " · ⚠️ no booking link for this sender, so no demo button"}
          {" · "}
          {cfg.hookKey ? "hook key set" : "⚠️ OLUM_FEED_KEY not set — the hook refuses every call"}
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Backend setting: <code>OUTREACH_LOGIN_HOOK_URL={appUrl ? `${appUrl}/api/hooks/login` : "<this app's URL>/api/hooks/login"}</code>{" "}
          with <code>OUTREACH_FEED_KEY</code> equal to this app&rsquo;s <code>OLUM_FEED_KEY</code>.
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          So far: {counts.sent ?? 0} sent · {counts.skipped ?? 0} skipped · {counts.failed ?? 0} failed
        </div>
        {dbError ? <div className="hint" style={{ color: "var(--bad)" }}>Database: {dbError}</div> : null}
      </div>

      <h2>The email</h2>
      <form className="card" action={saveWelcomeCopyAction}>
        {/* Keyed on the saved copy so a reset (or a save elsewhere) reloads the editor. */}
        <EmailEditor
          key={`${copy.subject}::${copy.body}`}
          subjectName="subject"
          bodyName="body"
          defaultSubject={copy.subject}
          defaultBody={copy.body}
          sender={{ displayName: sender.displayName, title: sender.title, bookingLink: sender.bookingLink }}
          senderEmail={sender.email}
          sample={{ company: "Priya Raman", toEmail: "priya@brightdental.in", extra: sample }}
          placeholders={["greeting", "firstName", "commaName", "senderName", "demoButton", "dashboardButton", "signature"]}
        />
        <div className="actions" style={{ marginBottom: 0 }}>
          <button type="submit">Save email</button>
          {copy.edited && (
            <button type="submit" className="ghost" formAction={resetWelcomeCopyAction} formNoValidate>
              Reset to the default
            </button>
          )}
          <span className="hint">Changes apply to the next sign-in — no deploy needed.</span>
        </div>
      </form>

      <h2>Recent sign-ins</h2>
      {rows.length === 0 ? (
        <div className="card empty">No sign-ins reported yet.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th>First sign-in seen</th>
                <th>Sent</th>
                <th>Sign-ins</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td>
                    {r.name || "—"}
                    <div className="hint">{r.email}</div>
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? ""}`}>{r.status}</span>
                    {r.reason ? <div className="hint" style={r.status === "failed" ? { color: "var(--bad)" } : undefined}>{r.reason}</div> : null}
                  </td>
                  <td className="hint">{fmt(r.created_at)}</td>
                  <td className="hint">{r.sent_at ? fmt(r.sent_at) : "—"}</td>
                  <td className="hint">
                    {r.logins}
                    <div>last {fmt(r.last_login_at)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
