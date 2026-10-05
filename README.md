# Olum Outreach — Next.js control plane

A Vercel-deployable web app that runs the outreach campaign, detects replies, and
manages meeting reminders — built on top of the existing Microsoft Graph mailer base.

It replaces the long-running CLI loop with a **tick architecture** so it fits serverless:
state lives in Postgres, and an external 1-minute cron pings `/api/cron`, which sends only
the emails whose jittered `next_send_at` timestamp is due, polls each mailbox for replies,
and fires meeting reminders. Nothing sleeps; everything is resumable.

## What it does

- **Campaigns** — upload an `.xlsx`; if it has multiple sheets you choose which one(s) to send
  to (or "Select all"), with a live recipient count per sheet. Rows are deduped by email, then
  shuffled and split evenly across the 3 sender mailboxes.
- **Product feedback from a users report** (`/campaigns/report`) — upload the users report the
  product generates and write to the people already in it. Everyone is placed in a funnel
  segment from their own telemetry, each segment gets its own letter, and the whole list goes
  out from one mailbox (Barath's). See [Product-feedback campaigns](#product-feedback-campaigns)
  below.
- **Meetings** — add, **edit**, and **delete** logged meetings; times are handled in IST.
- **Sent archive** — every email that goes out is stored in the `sent_emails` DB table (durable
  on Vercel). Browse it on the **Sent** page and export via `/api/sent-log?format=csv|jsonl`.
- **Anti-spam / unpredictable sending**
  - Gaussian inter-email delay (45–120s) + ±15% jitter, periodic "coffee break" pauses.
  - **Business-hours gating** — sends only 09:00–18:00 recipient-local (Singapore, UTC+8),
    weekends skipped. No 3am sends.
  - **Spintax** `{a|b|c}` in the template → every email is worded differently, so content
    fingerprints differ (defeats content-based filters the way jitter defeats rate limits).
- **Reply detection** — cron polls each mailbox (`Mail.Read`), matches senders to campaign
  recipients, marks them `replied`, and emails **Barath** an alert.
- **Meetings handler** — log a booked meeting (person, company, website, meeting ID, time).
  The team is notified immediately, and the attendee gets automatic **24h + 1h reminders**.

## 1. Mailboxes (Zoho SMTP or Microsoft 365 Graph)

Each sender is a numbered block of env vars (`SENDER_EMAIL_1`, `_2`, …). A sender uses one of
two transports, picked automatically:

| Mailbox | Transport | Credentials |
|---|---|---|
| Zoho (`@tryolumai.com`) | SMTP + IMAP | `SMTP_PASS_N` — a Zoho app-specific password |
| Gmail / Google Workspace | SMTP + IMAP | `SMTP_PASS_N` (app password) **or** `GOOGLE_REFRESH_TOKEN_N` (OAuth) |
| Microsoft 365 / Outlook (`@olum.ai`) | Microsoft Graph | `GRAPH_CLIENT_ID_N` + `GRAPH_CLIENT_SECRET_N` |

A sender with `GRAPH_CLIENT_ID_N` set and no `SMTP_PASS_N` is treated as a Graph mailbox;
`SENDER_TRANSPORT_N=graph|smtp` forces it. Microsoft retired basic-auth SMTP, so an M365
mailbox **must** go through Graph — there is no password to put in `SMTP_PASS_N`.

Hosts are resolved per sender: explicit `SMTP_HOST_N`/`IMAP_HOST_N` win, else the
`SENDER_PROVIDER_N` preset (`gmail`, `zoho`, `zoho-com`), else a preset inferred from the
address domain (`@gmail.com` → Gmail), else the `ZOHO_*` globals. So senders on different
providers can run side by side.

### Adding a Gmail mailbox

Pick one of two auth methods. If `GOOGLE_REFRESH_TOKEN_N` is set the sender uses OAuth;
otherwise it uses the app password in `SMTP_PASS_N`.

**A. App password** (simplest, but requires 2-Step Verification on the account)

1. [myaccount.google.com/security](https://myaccount.google.com/security) → turn on
   **2-Step Verification**. App passwords do not exist without it.
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → create one.
   Paste the 16 characters into `SMTP_PASS_N` **with no spaces**. The normal account password
   will not work.

**B. OAuth 2.0** (no 2FA needed; more setup). One Google Cloud project covers every Gmail
mailbox — the refresh token is per mailbox.

1. [console.cloud.google.com](https://console.cloud.google.com) → create or pick a project.
2. **APIs & Services → Library** → enable the **Gmail API**.
3. **OAuth consent screen** → *External* → add the scope `https://mail.google.com/`, and add
   the mailbox under *Test users*. The narrower `gmail.send` scope will not work — IMAP reply
   polling needs the full mail scope, which Google classes as **restricted**.
4. **Publish the app.** Left in *Testing*, Google expires refresh tokens after **7 days** and
   sending breaks weekly. Publishing a restricted scope may require Google's app-verification
   review.
5. **Credentials → Create credentials → OAuth client ID → Desktop app.** That client type is
   what permits the `http://localhost:53682/` redirect the setup script listens on. Put the id
   and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
6. Run the consent flow and paste the line it prints into `.env`:

   ```bash
   npx tsx scripts/google-oauth-setup.ts --sender 6
   ```

   Google will warn that the app is unverified — *Advanced → Go to … (unsafe)*. Sign in **as
   the mailbox being authorised**, not your own account.

**Either way:** enable IMAP on the mailbox — Gmail → Settings → See all settings →
Forwarding and POP/IMAP → *Enable IMAP*. Without it the mailbox sends fine but never
registers replies. Then set `SENDER_EMAIL_N` / `SENDER_NAME_N` and run `npm run verify:mail`.

> 📉 **Volume.** A free `@gmail.com` account is capped around 500 recipients/day (Workspace
> ~2,000), and Gmail is stricter than Zoho about cold outreach from a fresh account. Warm it
> up slowly and keep `MAX_SENDS_PER_TICK` low.

### Checking mailboxes

```bash
npm run verify:mail                                        # every sender
npx tsx scripts/verify-senders.ts --sender 6               # just one
npx tsx scripts/verify-senders.ts --sender 6 --send you@example.com   # real test email
```

### Azure app registration (Graph senders only)

In **Azure Portal → App registrations → (your app)**:

1. **Overview** — copy the *Application (client) ID* → `GRAPH_CLIENT_ID_N`, and the
   *Directory (tenant) ID* → `GRAPH_TENANT_ID` (shared by all Graph senders).
2. **Certificates & secrets → New client secret** — copy the **Value** (not the Secret ID) into
   `GRAPH_CLIENT_SECRET_N`. It is shown once and it **expires**; a dead secret shows up as
   `AADSTS7000222` in the cron log.
3. **API permissions** — add **Application** (not Delegated) permissions, then
   **"Grant admin consent"**:

| Permission | Type | Why |
|---|---|---|
| `Mail.Send` | Application | Send the campaign |
| `Mail.Read` | Application | Detect replies and alert the team |

> ⚠️ **One app per mailbox.** Sharing a client ID across mailboxes works, but one expired secret
> then takes every mailbox down at once. (The older `outreach-mailer/` CLI had `CLIENT_ID_2` and
> `CLIENT_ID_3` set to the same GUID — don't carry that over.)

> 🔒 **Hardening.** Application `Mail.Send`/`Mail.Read` grant access to *every* mailbox in the
> tenant. Lock each app to its one mailbox with an Exchange
> [Application Access Policy](https://learn.microsoft.com/en-us/graph/auth-limit-mailbox-access)
> (`New-ApplicationAccessPolicy`).

## 2. Database (Neon / Vercel Postgres)

1. In the Vercel dashboard → **Storage → Create → Postgres (Neon)** (free tier), or create a
   free DB at [neon.tech](https://neon.tech).
2. Copy the connection string into `DATABASE_URL` (must include `?sslmode=require`).

## 3. Deploy to Vercel

1. Push this `outreach-app/` folder to a Git repo and **Import** it in Vercel.
2. Add all env vars from `.env.example` (Project → Settings → Environment Variables).
   Generate a long random `CRON_SECRET` and set an `ACCESS_PASSWORD`.
3. Deploy.
4. **Create the tables** — run once (returns `{ "ok": true }`):

   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-APP.vercel.app/api/setup
   ```

   `?key=...` also works, but a secret in a URL ends up in access logs and browser
   history — prefer the header.

## 4. The 1-minute cron (cron-job.org)

The drip needs a per-minute tick, which Vercel's free cron can't do (Hobby = once/day). Use a
free external cron:

1. Sign up at [cron-job.org](https://console.cron-job.org).
2. Create a job:
   - **URL:** `https://YOUR-APP.vercel.app/api/cron`
   - **Header:** `Authorization: Bearer YOUR_CRON_SECRET` (cron-job.org → Advanced →
     Headers). `?key=YOUR_CRON_SECRET` still works but logs the secret in plain text.
   - **Schedule:** every 1 minute
   - Method GET is fine.
3. Save. Each run returns a JSON summary of `{ sends, replies, reminders }`.

*(GitHub Actions on a `*/5 * * * *` schedule works too if you prefer — just curl the same URL.)*

## Sending: local (primary) or Vercel (secondary)

The web app only **schedules** sends (stores a jittered `next_send_at` per recipient).
Something then has to run the engine tick that actually sends what's due, polls replies,
and fires reminders. There are two interchangeable ways — both hit the same Neon DB and use
the same atomic claim, so they can even run at the same time without double-sending:

- **Primary — local mailer (from your machine):** a long-running process that runs the engine
  directly against the DB (no HTTP, no Next server required):

  ```bash
  npm run mailer
  ```

  It ticks every `MAILER_INTERVAL_SEC` seconds (default 20), printing
  `sent / failed / replies / reminders` each tick. Keep it running while a campaign is live.

- **Secondary — Vercel cron:** when deployed, point **cron-job.org** at
  `https://YOUR-APP.vercel.app/api/cron?key=YOUR_CRON_SECRET` every 1 minute (section 4 above).
  This keeps sending even when your laptop is off.

> The local mailer sends **real** emails the moment recipients are due. Pause a campaign in the
> UI to hold sends.

## Use it

1. Visit the app, enter `ACCESS_PASSWORD`.
2. **New campaign** → upload the list, pick sheet(s), edit copy, **Create** → **Start sending**.
   This schedules the drip across business hours with jitter.
3. Run `npm run mailer` (local) — or rely on the Vercel cron — to actually send.
4. **Meetings** → log a booking; reminders fire on each tick.
5. Replies to any sender mailbox auto-notify Barath within one tick.

## Product-feedback campaigns

A second campaign type, at **/campaigns/report**, for writing to people who are *already users*
rather than to a cold list. It takes the `Olum_Prod_Users_Report.xlsx` the product exports
(Name, Email, Landed dashboard, Workflow state, Sites analysed, UI issue events…) — a completely
different shape from a lead list, so it has its own parser.

**Segmentation.** Each user is placed in one of five buckets from their own telemetry:

| Segment | Who lands here | What the letter says |
|---|---|---|
| Saw the dashboard | reached the results dashboard | asks for the blunt verdict on the report |
| Ran an analysis, never saw results | analyses completed, no dashboard landing | "did the results load, or did you never get there?" |
| Analysis left running | workflow state stuck at `analysis_running` | treats it as a bug we owe them an answer on |
| Analysis failed | runs errored out | leads with the apology, asks what they wanted to find |
| Signed up, never ran anything | account created, zero runs | asks what stopped them in the first minute |

The report's own legend warns that `Landed dashboard` comes from a recent beacon, so older users
who clearly saw results still read "No". The backend-stamped `Workflow state` is therefore the
primary signal and the beacon only ever *promotes* a user — exactly as the legend recommends.

**Personalisation.** Copy is filled per person from their own row: their domain(s), their run
count, their signup date, and — when we actually logged errors on their session — a line naming
how many. Placeholders are `{{greeting}}`, `{{site}}`, `{{siteClause}}`, `{{analysesPhrase}}`,
`{{signupClause}}`, `{{frictionLine}}`, `{{meetingBlock}}`, plus the usual `{{senderName}}`.
Spintax `{a|b|c}` still varies every send. A greeting is only used when the name is confidently a
person's first name — "ff", "SF Reports" and "POWER EQUIPMENTS" all get "Hi there" rather than an
embarrassing guess.

**Who gets excluded.** Internal accounts (your own domains, non-`user` roles, admin/soft-deleted
notes) and rows that look like your own test accounts start unticked; disposable-domain signups
can't be ticked at all. Everything is shown in a review table with per-person checkboxes and a
**Preview** button that renders the exact letter that person would receive, so the final list is
always a deliberate choice.

**Sending.** Unlike a normal campaign, the list is *not* round-robined — every recipient is
pinned to one mailbox (`REPORT_SENDER`, default Barath's), because these people know who they
signed up with. The copy for their segment is stored on the recipient row (`subject_override` /
`body_override` / `vars`), so one campaign sends five different letters. It's created as a draft
and drips with the same jitter and business-hours gating as everything else.

**Setup.** Paste Barath's booking link into `BOOKING_LINK_2` (or type it into the form each
time) — with no link the whole "book a call" paragraph is dropped rather than left dangling.
Set `FOUNDER_NAME` to whoever is named in that line.

Two checks, neither of which sends anything or touches Neon:

```bash
npm run report:selftest
```

parses the report, prints the segment breakdown and one rendered email per segment, and asserts
there are no unresolved placeholders, no stray spintax, no invented greetings, and that dropping
the booking link doesn't leave a hole.

```bash
npm run report:dbtest
```

round-trips a whole campaign through the real schema on an in-memory Postgres, proving the new
recipient columns and the JSONB vars survive insert → claim → render.

```bash
npm run report:migrationtest
```

builds the *pre-report* schema and checks the engine migrates itself instead of failing — see
below.

### Schema migration

Report campaigns add columns: `campaigns.kind`, and `recipients.segment` /
`subject_override` / `body_override` / `vars`. They're in `ALTER_STATEMENTS`, so
a `/api/setup` call adds them — but you no longer have to remember to.

Queries that need those columns are wrapped in `withSchema()`, which catches a missing-column
error once, runs the idempotent migration, and retries. Without it, deploying this release
against an un-migrated database would break the **send tick for every campaign**, not just new
ones: the claim query would throw and no email would go out at all. The migration is
metadata-only (nullable columns, plus one with a default) and runs at most once per process.

## Environment variables

See `.env.example` — a template of placeholders only. Real values live in `.env`, which is
gitignored and must never be committed. Key ones: `SENDER_EMAIL_1..12` / `SMTP_PASS_1..12`,
`DATABASE_URL`, `CRON_SECRET`, `ACCESS_PASSWORD`, `NOTIFY_EMAIL`.
Pacing (`DELAY_*`, `PAUSE_*`, `MAX_SENDS_PER_TICK`) and the sending window
(`BUSINESS_*`) are all tunable without code changes.

## Local development

```bash
npm install
cp .env.example .env   # fill in real values incl. a Neon DATABASE_URL
npm run dev            # http://localhost:3000
# then create the tables once:
# curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/setup
```

`scripts/selftest.ts` (`npx tsx scripts/selftest.ts`) validates Excel parsing, spintax, and
business-hours scheduling without touching the database.

## Notes / limits

- Free Neon may cold-start after idle — the first cron tick after a quiet spell can be slow;
  subsequent ticks are fast.
- `MAX_SENDS_PER_TICK` (default 4) caps work per invocation so each stays well under Vercel's
  60s limit. With a 1-min cron that's up to ~240 emails/hour across all senders — far more than
  the jittered 45–120s spacing will actually release, so spacing, not the cap, is the throttle.
- The access gate is a single shared password (fine for an internal tool). Swap for SSO if this
  ever needs per-user auth.

## Security

Nothing secret is in this repo, and it has to stay that way.

**Where secrets live.** Only `.env` (local, gitignored) and Vercel → Settings → Environment
Variables. `.env.example` is a placeholder template — putting a real value there publishes it.
`data/` is gitignored entirely: snapshots and sent-mail logs contain real recipient addresses
and message bodies.

**Before you commit.** Install the pre-commit secret scanner once per clone:

```bash
npm run hooks:install
```

It blocks commits containing DB URLs with passwords, API keys, private keys, or a `.env` file.
Scan everything already tracked with `npm run check:secrets`.

**Rotate on exposure.** A secret that has been pushed, pasted into a URL, or sent to a
third-party scheduler is burned — rotating is the only fix, because git history and logs keep
copies forever:

- `ACCESS_PASSWORD` — change the env var; every session cookie invalidates automatically.
- `CRON_SECRET` — change the env var, then update the cron job's header.
- `SMTP_PASS_N` — revoke in Zoho → Settings → Security → App Passwords, issue a new one.
- `DATABASE_URL` — reset the role's password in Neon.

**How the gate works.** The cookie holds `HMAC-SHA256(ACCESS_PASSWORD)`, not the password, so a
leaked cookie can't reveal a password that might be reused elsewhere. Login attempts are
throttled per IP and compared in constant time. All responses carry `X-Robots-Tag: noindex`,
`X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`.

**Repo visibility.** This tool reads a live prospect database. Even with no secrets in the
source, the repo should be private — a public one hands an attacker the exact auth scheme,
route list, and DB schema to work against.
