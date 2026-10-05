// Parser for the product's own "Olum production users report" .xlsx — a very
// different shape from the lead lists `excel.ts` handles. Rows are *our own
// signed-up users* with funnel telemetry, so instead of name/email/website we
// care about how far each person actually got, and we segment on that.

export type Segment =
  | "dashboard_seen" // reached the results dashboard
  | "results_not_seen" // ran analyses, but no dashboard beacon
  | "analysis_stuck" // an analysis is still stamped as running
  | "analysis_failed" // their run(s) failed
  | "signed_up_only"; // account created, never ran anything

export const SEGMENT_ORDER: Segment[] = [
  "dashboard_seen",
  "results_not_seen",
  "analysis_stuck",
  "analysis_failed",
  "signed_up_only",
];

/** Why a row is not mailable / not mailed by default. */
export type ExcludeReason = "no_email" | "internal" | "disposable" | null;

export interface ReportUser {
  name: string;
  firstName: string; // "" when we can't confidently name the person
  email: string;
  role: string;
  plan: string;
  signedUp: string;
  lastVisited: string;
  landedDashboard: boolean;
  workflowState: string;
  sitesAnalysed: string[];
  sitesCrawled: string[];
  pagesCrawled: number;
  analysesCompleted: number;
  analysesFailed: number;
  uiIssueEvents: number;
  issueTypes: string;
  apiErrorCalls: number;
  authProvider: string;
  notes: string;

  // ─ derived ─
  segment: Segment;
  primarySite: string;
  highFriction: boolean;
  businessEmail: boolean;
  excluded: ExcludeReason;
  teamHint: boolean; // looks like one of our own test accounts
}

// ─── Header handling ─────────────────────────────────────────────────
// Matched case-insensitively with aliases, so a slightly renamed column in a
// future export doesn't silently zero out a signal.

const H = {
  name: ["name", "user", "full name"],
  email: ["email", "e-mail", "user email"],
  role: ["role"],
  plan: ["plan"],
  signedUp: ["signed up", "signup", "created at", "signed up at"],
  lastVisited: ["last visited", "last seen", "last active"],
  landed: ["landed dashboard", "landed_dashboard", "reached dashboard"],
  workflow: ["workflow state", "workflow_state", "funnel state", "state"],
  sitesAnalysed: ["sites analysed", "sites analyzed"],
  nAnalysed: ["# sites analysed", "# sites analyzed"],
  sitesCrawled: ["sites crawled"],
  pages: ["pages crawled"],
  done: ["analyses completed", "analyses complete"],
  failed: ["analyses failed"],
  uiIssues: ["ui issue events", "ui issues"],
  issueTypes: ["issue types"],
  apiErrors: ["api error calls", "api errors"],
  auth: ["auth provider"],
  notes: ["notes"],
} as const;

function lower(row: Record<string, unknown>): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) m.set(k.trim().toLowerCase(), v);
  return m;
}

function str(m: Map<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = m.get(k);
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function int(m: Map<string, unknown>, keys: readonly string[]): number {
  const raw = str(m, keys);
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function yes(m: Map<string, unknown>, keys: readonly string[]): boolean {
  return /^(y|yes|true|1)$/i.test(str(m, keys));
}

/** Newline/comma-separated domain cell -> clean list. */
function domains(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, ""))
    .filter((s) => s.includes("."));
}

// ─── Person-name extraction ──────────────────────────────────────────
// The real data has "ff", "ro", "rm ", "SF Reports", "POWER EQUIPMENTS".
// A wrong first name in a greeting is worse than no name at all, so this is
// deliberately conservative: anything doubtful yields "" -> "Hi there".

const ROLE_WORDS = new Set([
  "reports", "report", "marketing", "tools", "admin", "administrator", "info", "sales",
  "support", "team", "contact", "hello", "hi", "test", "testing", "demo", "user", "account",
  "accounts", "billing", "office", "mail", "email", "developer", "dev", "no", "noreply",
]);

const ORG_WORDS =
  /\b(ltd|limited|pvt|private|inc|llc|llp|corp|corporation|co|company|equipments?|solutions?|services?|technologies|tech|systems|industries|enterprises|group|store|studio|labs?)\b/i;

export function personFirstName(name: string): string {
  const raw = name.trim();
  if (!raw) return "";
  if (ORG_WORDS.test(raw)) return "";

  const tokens = raw.split(/\s+/).filter(Boolean);
  // ALL-CAPS with more than one word reads as an organisation, not a person.
  const allCaps = raw === raw.toUpperCase() && /\p{L}/u.test(raw);
  if (allCaps && tokens.length > 1) return "";

  for (const token of tokens) {
    const letters = token.replace(/[^\p{L}'-]/gu, "");
    if (letters.length < 3) continue; // "ff", "ro", "rm", initials like "B"
    if (ROLE_WORDS.has(letters.toLowerCase())) continue;
    return letters[0].toUpperCase() + letters.slice(1).toLowerCase();
  }
  return "";
}

// ─── Exclusions ──────────────────────────────────────────────────────

const DISPOSABLE = [
  "jobraux.com", "epaynine.com", "mailinator.com", "guerrillamail.com", "10minutemail.com",
  "yopmail.com", "tempmail.com", "temp-mail.org", "trashmail.com", "sharklasers.com",
  "getnada.com", "dispostable.com", "maildrop.cc", "throwawaymail.com",
];

const FREE_MAIL = [
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com",
  "live.com", "aol.com", "icloud.com", "protonmail.com", "proton.me", "rediffmail.com",
  "zoho.com", "mail.com", "gmx.com", "yandex.com",
];

export function domainOf(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

export interface ExcludeConfig {
  /** Domains treated as our own staff (e.g. olum.ai, tryolumai.com). */
  internalDomains: string[];
  /** Substrings that mark an address as one of our own test accounts. */
  teamHints: string[];
}

export function classifyExclusion(
  u: { email: string; role: string; notes: string },
  cfg: ExcludeConfig
): { excluded: ExcludeReason; teamHint: boolean } {
  const email = u.email.toLowerCase();
  if (!email.includes("@") || !email.includes(".")) {
    return { excluded: "no_email", teamHint: false };
  }
  const domain = domainOf(email);
  const local = email.split("@")[0];

  const internal =
    cfg.internalDomains.some((d) => domain === d || domain.endsWith(`.${d}`)) ||
    (u.role && u.role.toLowerCase() !== "user") ||
    /admin|superuser|soft.?deleted/i.test(u.notes);
  if (internal) return { excluded: "internal", teamHint: false };

  if (DISPOSABLE.includes(domain)) return { excluded: "disposable", teamHint: false };

  const teamHint = cfg.teamHints.some((h) => h.length >= 3 && local.includes(h));
  return { excluded: null, teamHint };
}

// ─── Segmentation ────────────────────────────────────────────────────
// The report's own legend warns that `Landed dashboard` comes from a *recent*
// beacon, so plenty of users who clearly saw results still read "No". It
// therefore only ever promotes a user; the backend-stamped `Workflow state` is
// the primary signal, exactly as the legend recommends.

export function classifySegment(u: {
  landedDashboard: boolean;
  workflowState: string;
  analysesCompleted: number;
  analysesFailed: number;
  sitesAnalysed: string[];
  sitesCrawled: string[];
}): Segment {
  const state = u.workflowState.trim().toLowerCase();

  if (u.landedDashboard || state === "landed_dashboard") return "dashboard_seen";
  if (state === "analysis_running") return "analysis_stuck";
  if (state === "failed" || (u.analysesFailed > 0 && u.analysesCompleted === 0)) {
    return "analysis_failed";
  }
  if (state === "analysis_completed" || u.analysesCompleted > 0) return "results_not_seen";
  if (u.sitesAnalysed.length > 0 || u.sitesCrawled.length > 0) return "results_not_seen";
  return "signed_up_only";
}

// ─── Parse ───────────────────────────────────────────────────────────

export interface ReportParseResult {
  users: ReportUser[];
  sheetName: string;
  sheets: string[];
  duplicates: number;
  skipped: number; // rows with no usable email at all
}

function toUser(row: Record<string, unknown>, cfg: ExcludeConfig): ReportUser | null {
  const m = lower(row);
  const email = str(m, H.email).toLowerCase();
  const name = str(m, H.name);
  if (!email && !name) return null;

  const sitesAnalysed = domains(str(m, H.sitesAnalysed));
  const sitesCrawled = domains(str(m, H.sitesCrawled));
  const analysesCompleted = int(m, H.done);
  const analysesFailed = int(m, H.failed);
  const uiIssueEvents = int(m, H.uiIssues);
  const apiErrorCalls = int(m, H.apiErrors);
  const role = str(m, H.role);
  const notes = str(m, H.notes);

  const base = {
    landedDashboard: yes(m, H.landed),
    workflowState: str(m, H.workflow),
    analysesCompleted,
    analysesFailed,
    sitesAnalysed,
    sitesCrawled,
  };

  const { excluded, teamHint } = classifyExclusion({ email, role, notes }, cfg);
  const domain = domainOf(email);

  return {
    name,
    firstName: personFirstName(name),
    email,
    role,
    plan: str(m, H.plan),
    signedUp: str(m, H.signedUp),
    lastVisited: str(m, H.lastVisited),
    ...base,
    pagesCrawled: int(m, H.pages),
    uiIssueEvents,
    issueTypes: str(m, H.issueTypes),
    apiErrorCalls,
    authProvider: str(m, H.auth),
    notes,

    segment: classifySegment(base),
    primarySite: sitesAnalysed[0] ?? sitesCrawled[0] ?? "",
    // "Friction" = they hit our bugs, not just zero usage. Worth acknowledging
    // in the copy, because pretending it didn't happen reads as tone-deaf.
    highFriction: uiIssueEvents > 0 || analysesFailed > 0 || apiErrorCalls >= 20,
    businessEmail: Boolean(domain) && !FREE_MAIL.includes(domain) && !DISPOSABLE.includes(domain),
    excluded,
    teamHint,
  };
}

/** The users sheet is the one with an Email column; "Legend & method" isn't. */
function looksLikeUsersSheet(rows: Record<string, unknown>[]): boolean {
  if (rows.length === 0) return false;
  const headers = new Set(Object.keys(rows[0]).map((k) => k.trim().toLowerCase()));
  return H.email.some((k) => headers.has(k));
}

export async function parseUsersReport(
  buf: ArrayBuffer,
  cfg: ExcludeConfig,
  sheetName?: string
): Promise<ReportParseResult> {
  // Lazy import for the same reason as excel.ts: keeps this CommonJS package
  // out of the static server-action bundle.
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buf, { type: "array" });

  let chosen = "";
  let rows: Record<string, unknown>[] = [];
  const candidates = sheetName ? [sheetName] : wb.SheetNames;
  for (const nm of candidates) {
    if (!wb.Sheets[nm]) continue;
    const r = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[nm], { defval: "" });
    if (looksLikeUsersSheet(r)) {
      chosen = nm;
      rows = r;
      break;
    }
  }
  if (!chosen) {
    throw new Error(
      "No users sheet found — expected a sheet with Name and Email columns " +
        `(saw: ${wb.SheetNames.join(", ")}).`
    );
  }

  const seen = new Set<string>();
  const users: ReportUser[] = [];
  let duplicates = 0;
  let skipped = 0;

  for (const row of rows) {
    const u = toUser(row, cfg);
    if (!u) continue;
    if (u.excluded === "no_email") {
      skipped++;
      continue;
    }
    if (seen.has(u.email)) {
      duplicates++;
      continue;
    }
    seen.add(u.email);
    users.push(u);
  }

  return { users, sheetName: chosen, sheets: wb.SheetNames, duplicates, skipped };
}

/** Counts per segment across the mailable users, for the picker UI. */
export function summarise(users: ReportUser[]): Record<Segment, number> {
  const out = Object.fromEntries(SEGMENT_ORDER.map((s) => [s, 0])) as Record<Segment, number>;
  for (const u of users) if (!u.excluded) out[u.segment]++;
  return out;
}

// ─── From the live backend feed (activity outreach) ──────────────────
// Same ReportUser shape as the .xlsx parser, so segmentation, exclusions and
// the per-segment letters behave identically whichever way a user arrives.

/** One row of GET /api/v1/auth/outreach/users (olum-backend). */
export interface FeedUser {
  id: string;
  email: string;
  full_name: string;
  plan: string;
  auth_provider: string;
  signed_up_at: string | null;
  last_visited_at: string | null;
  workflow_state: string;
  landed_dashboard: boolean;
  landed_dashboard_at: string | null;
  sites_analysed: string[];
  sites_crawled: string[];
  pages_crawled: number;
  analyses_completed: number;
  analyses_failed: number;
  first_analysis_completed_at: string | null;
  last_analysis_completed_at: string | null;
  last_analysis_failed_at: string | null;
  ui_issue_events: number;
  issue_kinds: string;
  api_error_calls: number;
}

export function userFromFeed(f: FeedUser, cfg: ExcludeConfig): ReportUser {
  const email = (f.email || "").trim().toLowerCase();
  const sitesAnalysed = (f.sites_analysed ?? []).filter((s) => s.includes("."));
  const sitesCrawled = (f.sites_crawled ?? []).filter((s) => s.includes("."));
  const base = {
    landedDashboard: Boolean(f.landed_dashboard),
    workflowState: f.workflow_state || "",
    analysesCompleted: Number(f.analyses_completed) || 0,
    analysesFailed: Number(f.analyses_failed) || 0,
    sitesAnalysed,
    sitesCrawled,
  };
  // The feed only carries customer accounts (role "user"), so role is fixed.
  const { excluded, teamHint } = classifyExclusion({ email, role: "user", notes: "" }, cfg);
  const domain = domainOf(email);
  const uiIssueEvents = Number(f.ui_issue_events) || 0;
  const apiErrorCalls = Number(f.api_error_calls) || 0;
  return {
    name: f.full_name || "",
    firstName: personFirstName(f.full_name || ""),
    email,
    role: "user",
    plan: f.plan || "",
    signedUp: f.signed_up_at || "",
    lastVisited: f.last_visited_at || "",
    ...base,
    pagesCrawled: Number(f.pages_crawled) || 0,
    uiIssueEvents,
    issueTypes: f.issue_kinds || "",
    apiErrorCalls,
    authProvider: f.auth_provider || "",
    notes: "",
    segment: classifySegment(base),
    primarySite: sitesAnalysed[0] ?? sitesCrawled[0] ?? "",
    highFriction: uiIssueEvents > 0 || base.analysesFailed > 0 || apiErrorCalls >= 20,
    businessEmail: Boolean(domain) && !FREE_MAIL.includes(domain) && !DISPOSABLE.includes(domain),
    excluded,
    teamHint,
  };
}
