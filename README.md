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

## 1. Azure app registrations (permissions)

Each of the 3 mailboxes uses client-credentials auth. In **Azure Portal → App registrations
→ (each app) → API permissions**, add **Application** permissions and click
**"Grant admin consent for olum.ai"**:

| Permission | Type | Why |
|---|---|---|
| `Mail.Send` | Application | Send the campaign (you already have this) |
| `Mail.Read` | Application | **Add this** — lets the tool detect replies and alert Barath |

> ⚠️ **Check your client IDs.** `CLIENT_ID_2` (rohann) and `CLIENT_ID_3` (rohansathish) are the
> same GUID in what you sent me. Each mailbox is normally its own app registration with its own
> client ID — confirm account 2's client ID before going live, or reply detection/sending for
> that mailbox may misbehave.

> 🔒 **Optional hardening.** Application `Mail.Send`/`Mail.Read` grant access to *every* mailbox
> in the tenant. Lock each app to just its one mailbox with an Exchange
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
4. **Create the tables** — open once in your browser:
   `https://YOUR-APP.vercel.app/api/setup?key=YOUR_CRON_SECRET`
   (returns `{ "ok": true }`).

## 4. The 1-minute cron (cron-job.org)

The drip needs a per-minute tick, which Vercel's free cron can't do (Hobby = once/day). Use a
free external cron:

1. Sign up at [cron-job.org](https://console.cron-job.org).
2. Create a job:
   - **URL:** `https://YOUR-APP.vercel.app/api/cron?key=YOUR_CRON_SECRET`
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
`/api/setup?key=YOUR_CRON_SECRET` adds them — but you no longer have to remember to.

Queries that need those columns are wrapped in `withSchema()`, which catches a missing-column
error once, runs the idempotent migration, and retries. Without it, deploying this release
against an un-migrated database would break the **send tick for every campaign**, not just new
ones: the claim query would throw and no email would go out at all. The migration is
metadata-only (nullable columns, plus one with a default) and runs at most once per process.

## Environment variables

See `.env.example`. Key ones: `TENANT_ID`, `CLIENT_ID_1..3` / `CLIENT_SECRET_1..3`,
`SENDER_EMAIL_1..3`, `DATABASE_URL`, `CRON_SECRET`, `ACCESS_PASSWORD`, `NOTIFY_EMAIL`.
Pacing (`DELAY_*`, `PAUSE_*`, `MAX_SENDS_PER_TICK`) and the sending window
(`BUSINESS_*`) are all tunable without code changes.

## Local development

```bash
npm install
cp .env.example .env   # fill in real values incl. a Neon DATABASE_URL
npm run dev            # http://localhost:3000
# then hit http://localhost:3000/api/setup?key=YOUR_CRON_SECRET once
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
