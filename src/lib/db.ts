import { neon } from "@neondatabase/serverless";

// When true, the app runs the SAME SQL against a local in-memory Postgres
// (PGlite) seeded from data/snapshot.json — so you can keep developing while
// the real backend is down. It NEVER touches the network. Local-only:
// snapshot data is gitignored and this flag is never set in production.
const SNAPSHOT = process.env.USE_LOCAL_SNAPSHOT === "true";

// ─── Schema (shared by Neon and the local snapshot) ──────────────────
const CREATE_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS campaigns (
      id            SERIAL PRIMARY KEY,
      name          TEXT NOT NULL,
      subject       TEXT NOT NULL,
      body_template TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'draft',
      source_file   TEXT,
      duplicates_removed INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      started_at    TIMESTAMPTZ
   )`,
  `CREATE TABLE IF NOT EXISTS recipients (
      id           SERIAL PRIMARY KEY,
      campaign_id  INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      name         TEXT NOT NULL,
      email        TEXT NOT NULL,
      website      TEXT,
      phone        TEXT,
      service      TEXT,
      sender_key   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      next_send_at TIMESTAMPTZ,
      sent_at      TIMESTAMPTZ,
      replied_at   TIMESTAMPTZ,
      error        TEXT,
      UNIQUE (campaign_id, email)
   )`,
  `CREATE TABLE IF NOT EXISTS meetings (
      id             SERIAL PRIMARY KEY,
      person_name    TEXT NOT NULL,
      company        TEXT,
      website        TEXT,
      email          TEXT NOT NULL,
      phone          TEXT,
      meeting_id     TEXT,
      meeting_at     TIMESTAMPTZ NOT NULL,
      sender_key     TEXT NOT NULL DEFAULT '1',
      notes          TEXT,
      remind_24h     BOOLEAN NOT NULL DEFAULT true,
      remind_1h      BOOLEAN NOT NULL DEFAULT true,
      sent_24h       BOOLEAN NOT NULL DEFAULT false,
      sent_1h        BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sent_emails (
      id           SERIAL PRIMARY KEY,
      campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
      recipient_id INTEGER,
      sender       TEXT NOT NULL,
      to_email     TEXT NOT NULL,
      company      TEXT,
      subject      TEXT,
      body         TEXT,
      sent_at      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS mailbox_state (
      sender_key   TEXT PRIMARY KEY,
      last_poll_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS events (
      id         SERIAL PRIMARY KEY,
      type       TEXT NOT NULL,
      ref        TEXT,
      detail     JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // ── Activity outreach ──
  // One row per Olum user we've seen in the live feed: what their activity
  // looked like the last time we drafted for them, and when we last emailed.
  `CREATE TABLE IF NOT EXISTS activity_users (
      user_id          TEXT PRIMARY KEY,
      email            TEXT NOT NULL,
      last_fingerprint TEXT,
      last_drafted_at  TIMESTAMPTZ,
      last_emailed_at  TIMESTAMPTZ,
      first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // A personalised email waiting for (or past) a human decision. Subject/body
  // are the exact text the approver sees and edits; approval queues it as a
  // recipient of that day's "Activity outreach" campaign (recipient_id).
  `CREATE TABLE IF NOT EXISTS activity_drafts (
      id           SERIAL PRIMARY KEY,
      user_id      TEXT NOT NULL,
      email        TEXT NOT NULL,
      name         TEXT,
      site         TEXT,
      kind         TEXT NOT NULL,
      fingerprint  TEXT NOT NULL,
      activity     JSONB,
      subject      TEXT NOT NULL,
      body         TEXT NOT NULL,
      sender_key   TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      recipient_id INTEGER,
      error        TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      decided_at   TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS idx_activity_drafts_status ON activity_drafts (status, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS kv (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_recipients_due ON recipients (status, next_send_at)`,
  `CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails (sent_at DESC)`,
];

const ALTER_STATEMENTS: string[] = [
  `ALTER TABLE meetings ADD COLUMN IF NOT EXISTS phone TEXT`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS duplicates_removed INTEGER NOT NULL DEFAULT 0`,
  // Report campaigns: 'outreach' (cold list) vs 'report' (our own users).
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'outreach'`,
  // Report campaigns send different copy per segment, so subject/body live on
  // the recipient and fall back to the campaign's when null.
  `ALTER TABLE recipients ADD COLUMN IF NOT EXISTS segment TEXT`,
  `ALTER TABLE recipients ADD COLUMN IF NOT EXISTS subject_override TEXT`,
  `ALTER TABLE recipients ADD COLUMN IF NOT EXISTS body_override TEXT`,
  `ALTER TABLE recipients ADD COLUMN IF NOT EXISTS vars JSONB`,
];

// ─── The `sql` handle: Neon normally, PGlite in snapshot mode ─────────
type Row = Record<string, unknown>;
type SqlFn = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
};

export const sql: SqlFn = SNAPSHOT ? makeSnapshotSql() : makeNeonSql();

function makeNeonSql(): SqlFn {
  const fn = neon(
    process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/db"
  ) as unknown as SqlFn;
  // @neondatabase/serverless < 1.0 has no `.query`; a plain string query is run
  // by calling the handle directly. Shim it so both handles share one interface.
  if (typeof fn.query !== "function") {
    const call = fn as unknown as (text: string, params: unknown[]) => Promise<Row[]>;
    fn.query = (text: string, params: unknown[] = []) => call(text, params);
  }
  return fn;
}

function makeSnapshotSql(): SqlFn {
  let ready: Promise<{ query: (t: string, p?: unknown[]) => Promise<{ rows: Row[] }> }> | null = null;
  const getPg = () => (ready ??= initSnapshotDb());
  const run = async (text: string, params: unknown[]): Promise<Row[]> => {
    const pg = await getPg();
    return (await pg.query(text, params)).rows as Row[];
  };
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
    return run(text, values);
  }) as SqlFn;
  fn.query = (text: string, params: unknown[] = []) => run(text, params);
  return fn;
}

async function initSnapshotDb() {
  // webpackIgnore: these load only at runtime in snapshot mode; keep Next from
  // analyzing/bundling them (pglite ships WASM; node:* aren't client-resolvable).
  const { PGlite } = await import(/* webpackIgnore: true */ "@electric-sql/pglite");
  const fs = await import(/* webpackIgnore: true */ "node:fs");
  const path = await import(/* webpackIgnore: true */ "node:path");

  const pg = new PGlite(); // in-memory; ephemeral, never persisted
  await pg.exec(CREATE_STATEMENTS.join(";\n") + ";");
  for (const s of ALTER_STATEMENTS) {
    try { await pg.exec(s); } catch { /* column already present */ }
  }

  const file = process.env.SNAPSHOT_PATH || path.join(process.cwd(), "data", "snapshot.json");
  if (!fs.existsSync(file)) {
    console.warn(`[snapshot] ${file} not found — starting with an empty local DB`);
    return pg;
  }

  const snap = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Row[]>;
  const tables = ["campaigns", "recipients", "meetings", "sent_emails", "mailbox_state", "events"];
  let loaded = 0;
  for (const table of tables) {
    const rows = snap[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    for (const row of rows) {
      const cols = Object.keys(row);
      const vals: unknown[] = [];
      const placeholders = cols.map((c, i) => {
        const v = row[c];
        if (v !== null && typeof v === "object") { // jsonb (events.detail)
          vals.push(JSON.stringify(v));
          return `$${i + 1}::jsonb`;
        }
        vals.push(v);
        return `$${i + 1}`;
      });
      await pg.query(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${placeholders.join(",")})`,
        vals
      );
      loaded++;
    }
    // realign SERIAL sequences so new local inserts don't collide with snapshot ids
    if (table !== "mailbox_state") {
      try {
        await pg.exec(
          `SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}),1))`
        );
      } catch { /* no id sequence */ }
    }
  }
  console.log(`[snapshot] loaded ${loaded} rows from ${file} into local PGlite (offline mode)`);
  return pg;
}

export function isSnapshotMode(): boolean {
  return SNAPSHOT;
}

/** Idempotent schema creation. Safe to run on every deploy / via /api/setup. */
export async function ensureSchema(): Promise<void> {
  for (const stmt of CREATE_STATEMENTS) await sql.query(stmt);
  for (const stmt of ALTER_STATEMENTS) await sql.query(stmt);
}

let migration: Promise<void> | null = null;

/** ensureSchema, but at most once per process. */
export function ensureSchemaOnce(): Promise<void> {
  return (migration ??= ensureSchema().catch((e) => {
    migration = null; // a failed migration must be retryable
    throw e;
  }));
}

function isMissingColumnError(e: unknown): boolean {
  return /column .* does not exist/i.test((e as Error)?.message ?? "");
}

/**
 * Run a query that needs a column added by a later ALTER, migrating on demand.
 *
 * Without this, deploying a release that adds a column breaks *every* campaign
 * until someone remembers to hit /api/setup — the send tick would fail on the
 * claim query and no email would go out at all. The migration is idempotent
 * and only ever runs when a query has actually proved it's missing.
 */
export async function withSchema<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    await ensureSchemaOnce();
    return fn();
  }
}

const TRANSIENT = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|timed? ?out/i;

/** Retry only transient network errors (e.g. Neon cold-start), never SQL errors. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 600
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!TRANSIENT.test((e as Error).message ?? "")) throw e;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw last;
}

export function isTransientDbError(e: unknown): boolean {
  return TRANSIENT.test((e as Error)?.message ?? "");
}

export async function logEvent(
  type: string,
  ref: string | null,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await sql`INSERT INTO events (type, ref, detail)
            VALUES (${type}, ${ref}, ${JSON.stringify(detail)}::jsonb)`;
}

/** Persist a sent email to the DB (durable on Vercel, unlike a local file). */
export async function recordSentEmail(rec: {
  campaignId: number | null;
  recipientId?: number;
  sender: string;
  to: string;
  company: string;
  subject: string;
  body: string;
}): Promise<void> {
  await sql`
    INSERT INTO sent_emails (campaign_id, recipient_id, sender, to_email, company, subject, body)
    VALUES (${rec.campaignId}, ${rec.recipientId ?? null}, ${rec.sender}, ${rec.to},
            ${rec.company}, ${rec.subject}, ${rec.body})`;
}
