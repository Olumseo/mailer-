"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createReportCampaignAction } from "@/app/actions";
import { EmailEditor, type PreviewSample } from "@/app/components/EmailEditor";

type SegmentKey = string;
type Source = "feed" | "xlsx";

type SegmentDef = {
  key: SegmentKey;
  label: string;
  blurb: string;
  subject: string;
  body: string;
};

type User = {
  name: string;
  firstName: string;
  email: string;
  segment: SegmentKey;
  plan: string;
  site: string;
  sites: number;
  analyses: number;
  failed: number;
  uiIssues: number;
  apiErrors: number;
  lastVisited: string;
  signedUp: string;
  landed: boolean;
  workflowState: string;
  cameFrom: string;
  pages: string[];
  demoRequested: boolean;
  excluded: "internal" | "disposable" | "no_email" | null;
  teamHint: boolean;
  business: boolean;
  highFriction: boolean;
  defaultInclude: boolean;
};

type Sample = { email: string; company: string; extra: Record<string, string> } | null;

type Preview = {
  source: Source;
  sheetName: string;
  duplicates: number;
  skipped: number;
  counts: Record<string, number>;
  segments: SegmentDef[];
  sender: { key: string; name: string; email: string; title: string };
  samples: Record<string, Sample>;
  users: User[];
  focus: (NonNullable<Sample> & { name: string; segment: string }) | null;
};

type Copy = Record<SegmentKey, { subject: string; body: string }>;

const PLACEHOLDERS = [
  "greeting", "firstName", "site", "siteClause", "analysesPhrase", "signupClause",
  "frictionLine", "meetingLine", "activityCard", "demoButton", "signature",
];

function shortDate(raw: string): string {
  if (!raw) return "—";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}

export function ReportForm({
  senders,
  defaultSenderKey,
  defaultFounderName,
  defaultBookingLink,
  feedReady,
}: {
  senders: Array<{ key: string; name: string; email: string }>;
  defaultSenderKey: string;
  defaultFounderName: string;
  defaultBookingLink: string;
  feedReady: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source>(feedReady ? "feed" : "xlsx");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [copy, setCopy] = useState<Copy>({});
  const [segments, setSegments] = useState<Set<SegmentKey>>(new Set());
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [openSegment, setOpenSegment] = useState<SegmentKey | null>(null);

  const [senderKey, setSenderKey] = useState(defaultSenderKey);
  const [founderName, setFounderName] = useState(defaultFounderName);
  const [bookingLink, setBookingLink] = useState(defaultBookingLink);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");

  /** (Re)load users server-side with the current settings. `reset` starts the
   *  review over (fresh copy, default ticks); otherwise only samples refresh. */
  const load = useCallback(
    async (opts: { reset?: boolean; previewEmail?: string } = {}) => {
      const file = fileRef.current?.files?.[0];
      if (source === "xlsx" && !file) return;
      setLoading(true);
      setErr(null);
      try {
        const fd = new FormData();
        fd.append("source", source);
        if (source === "xlsx" && file) fd.append("file", file);
        fd.append("senderKey", senderKey);
        fd.append("founderName", founderName);
        fd.append("bookingLink", bookingLink);
        if (opts.previewEmail) fd.append("previewEmail", opts.previewEmail);

        const res = await fetch("/api/report-preview", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't load users");

        const p = data as Preview;
        // Keep a focused person across refreshes unless a new one was asked for.
        setPreview((prev) => ({ ...p, focus: p.focus ?? (opts.reset ? null : prev?.focus ?? null) }));
        if (opts.reset) {
          const fresh: Copy = {};
          for (const s of p.segments) fresh[s.key] = { subject: s.subject, body: s.body };
          setCopy(fresh);
          setSegments(new Set(p.segments.filter((s) => (p.counts[s.key] ?? 0) > 0).map((s) => s.key)));
          setIncluded(new Set(p.users.filter((u) => u.defaultInclude).map((u) => u.email)));
          setOpenSegment(null);
        }
        if (p.focus) setOpenSegment(p.focus.segment);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [source, senderKey, founderName, bookingLink]
  );

  // The live feed needs no file — load it as soon as the page opens.
  const started = useRef(false);
  useEffect(() => {
    if (!started.current && source === "feed") {
      started.current = true;
      void load({ reset: true });
    }
  }, [source, load]);

  function switchSource(next: Source) {
    if (next === source) return;
    setSource(next);
    setPreview(null);
    setIncluded(new Set());
    setSegments(new Set());
    setErr(null);
    started.current = false;
  }

  function onFile() {
    setPreview(null);
    setIncluded(new Set());
    setSegments(new Set());
    if (fileRef.current?.files?.[0]) void load({ reset: true });
  }

  function toggle<T>(set: Set<T>, value: T): Set<T> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  function editCopy(key: SegmentKey, field: "subject" | "body", value: string) {
    setCopy((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  // A user is actually mailed only if their row is ticked AND their segment is on.
  const users = preview?.users ?? [];
  const finalEmails = users
    .filter((u) => included.has(u.email) && segments.has(u.segment))
    .map((u) => u.email);
  const finalSet = new Set(finalEmails);
  const q = query.trim().toLowerCase();
  const visible = users
    .filter((u) => showAll || !u.excluded)
    .filter((u) => !q || `${u.name} ${u.email} ${u.site}`.toLowerCase().includes(q));
  const segLabel = (k: string) => preview?.segments.find((s) => s.key === k)?.label ?? k;

  const previewSender = {
    displayName: preview?.sender.name ?? senders.find((s) => s.key === senderKey)?.name ?? "",
    title: preview?.sender.title ?? "",
    bookingLink,
  };

  function sampleFor(key: SegmentKey): PreviewSample {
    const f = preview?.focus;
    const s: Sample = f && f.segment === key ? f : preview?.samples[key] ?? null;
    if (!s) return { company: "Jane Doe", toEmail: "jane@example.com", extra: { greeting: "Hi Jane", bookingLink } };
    return { company: s.company, toEmail: s.email, extra: { ...s.extra, bookingLink } };
  }

  return (
    <form action={createReportCampaignAction} onSubmit={() => setSubmitting(true)}>
      <input type="hidden" name="source" value={source} />
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div className="seg-switch" role="radiogroup" aria-label="Where the users come from">
            <label className={source === "feed" ? "on" : ""}>
              <input type="radio" checked={source === "feed"} onChange={() => switchSource("feed")} />
              ● Live users from Olum
            </label>
            <label className={source === "xlsx" ? "on" : ""}>
              <input type="radio" checked={source === "xlsx"} onChange={() => switchSource("xlsx")} />
              Upload a report (.xlsx)
            </label>
          </div>
          {source === "feed" && (
            <button
              type="button"
              className="ghost"
              style={{ fontSize: 12, padding: "6px 12px" }}
              onClick={() => void load({ reset: true })}
              disabled={loading}
            >
              {loading ? "Loading…" : "↻ Refresh from Olum"}
            </button>
          )}
        </div>
        {source === "feed" && !feedReady && (
          <p className="hint" style={{ color: "var(--bad)" }}>
            The live feed isn&rsquo;t configured on this deployment — set OLUM_FEED_URL and
            OLUM_FEED_KEY, or upload a report instead.
          </p>
        )}
        {source === "xlsx" && (
          <>
            <label>Users report (.xlsx)</label>
            <input ref={fileRef} type="file" name="file" accept=".xlsx,.xls" required onChange={onFile} />
          </>
        )}

        <label>Campaign name</label>
        <input name="name" placeholder="Product feedback — Oct 2026 users" required />

        <div className="row">
          <div>
            <label>Send everything from</label>
            <select name="senderKey" value={senderKey} onChange={(e) => setSenderKey(e.target.value)}>
              {senders.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name} — {s.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Founder named on the demo button</label>
            <input
              name="founderName"
              value={founderName}
              onChange={(e) => setFounderName(e.target.value)}
              onBlur={() => preview && void load()}
              placeholder="Rohan"
            />
          </div>
        </div>

        <label>Demo / meeting booking link</label>
        <input
          name="bookingLink"
          value={bookingLink}
          onChange={(e) => setBookingLink(e.target.value)}
          onBlur={() => preview && void load()}
          placeholder="https://cal.com/barath/20min"
        />
        <p className="hint" style={!bookingLink.trim() ? { color: "var(--bad)" } : undefined}>
          {bookingLink.trim()
            ? "Every letter carries a “Book a demo” button pointing here. One mailbox sends the whole list — these are existing users, so they hear from one person."
            : "No link yet — the “Book a demo” button and meeting line are dropped from every email until you paste one."}
        </p>

        {err && <p className="hint" style={{ color: "var(--bad)" }}>{err}</p>}
        {loading && !preview && <p className="hint">{source === "feed" ? "Reading live users from Olum…" : "Reading the report…"}</p>}
      </div>

      {preview && (
        <>
          <div className="mono-note" style={{ margin: "16px 0" }}>
            <strong style={{ color: "var(--text)" }}>{preview.sheetName}</strong> — {preview.users.length} users
            {preview.duplicates > 0 && `, ${preview.duplicates} duplicate email(s) dropped`}
            {preview.skipped > 0 && `, ${preview.skipped} without an email skipped`}. Sending as{" "}
            {preview.sender.name} &lt;{preview.sender.email}&gt;.
          </div>

          <h2>Letters by segment</h2>
          <p className="sub">
            Each segment gets its own HTML letter, filled per person from their own activity — their
            site, runs, the landing page they came in through and the sections they opened.
          </p>

          <div className="grid">
            {preview.segments.map((s) => {
              const count = preview.counts[s.key] ?? 0;
              const on = segments.has(s.key);
              const chosen = finalEmails.filter((e) => users.find((u) => u.email === e)?.segment === s.key).length;
              const open = openSegment === s.key;
              return (
                <div className="card" key={s.key} style={{ opacity: on ? 1 : 0.55 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, color: "var(--text)" }}>
                      <input
                        type="checkbox"
                        name="segments"
                        value={s.key}
                        checked={on}
                        onChange={() => setSegments((p) => toggle(p, s.key))}
                        disabled={count === 0}
                        style={{ width: "auto" }}
                      />
                      <strong>{s.label}</strong>
                      <span className="badge">{count} {count === 1 ? "user" : "users"}</span>
                      {on && chosen !== count && <span className="badge">{chosen} selected</span>}
                    </label>
                    <button
                      type="button"
                      className={open ? "" : "ghost"}
                      style={{ padding: "5px 12px", fontSize: 12 }}
                      onClick={() => setOpenSegment(open ? null : s.key)}
                    >
                      {open ? "Close editor" : "Edit email"}
                    </button>
                  </div>
                  <p className="hint" style={{ margin: "6px 0 0" }}>{s.blurb}</p>

                  {/* Edits survive collapsing: these carry the copy when the editor is closed. */}
                  {!open && (
                    <>
                      <input type="hidden" name={`subject_${s.key}`} value={copy[s.key]?.subject ?? s.subject} />
                      <input type="hidden" name={`body_${s.key}`} value={copy[s.key]?.body ?? s.body} />
                    </>
                  )}

                  {open && (
                    <>
                      {preview.focus?.segment === s.key && (
                        <p className="hint" style={{ margin: "10px 0 0" }}>
                          Previewing as <strong style={{ color: "var(--text)" }}>{preview.focus.name || preview.focus.email}</strong>.
                        </p>
                      )}
                      <EmailEditor
                        subjectName={`subject_${s.key}`}
                        bodyName={`body_${s.key}`}
                        subject={copy[s.key]?.subject ?? s.subject}
                        body={copy[s.key]?.body ?? s.body}
                        onSubjectChange={(v) => editCopy(s.key, "subject", v)}
                        onBodyChange={(v) => editCopy(s.key, "body", v)}
                        sender={previewSender}
                        senderEmail={preview.sender.email}
                        sample={sampleFor(s.key)}
                        placeholders={PLACEHOLDERS}
                      />
                      <div className="actions" style={{ marginBottom: 0 }}>
                        <button
                          type="button"
                          className="ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() =>
                            setCopy((prev) => ({ ...prev, [s.key]: { subject: s.subject, body: s.body } }))
                          }
                        >
                          Reset to the default letter
                        </button>
                        {!preview.samples[s.key] && <span className="hint">No user in this segment — previewing with sample data.</span>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Recipients ({finalEmails.length})</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="search"
                placeholder="Search name, email, site"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ width: 220, padding: "6px 10px" }}
              />
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} style={{ width: "auto" }} />
                Show excluded
              </label>
              <button
                type="button"
                className="ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => setIncluded(new Set(visible.filter((u) => !u.excluded).map((u) => u.email)))}
              >
                Select all shown
              </button>
              <button type="button" className="ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setIncluded(new Set())}>
                Clear
              </button>
            </div>
          </div>

          <p className="hint" style={{ marginBottom: 8 }}>
            Internal accounts and rows flagged <em>team?</em> start unticked — tick one if that&rsquo;s
            wrong. Disposable-domain signups can&rsquo;t be ticked. <strong>Preview</strong> opens
            that person&rsquo;s letter with their own data.
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Person</th>
                  <th>Segment</th>
                  <th>Site · runs</th>
                  <th>Came in through</th>
                  <th>Opened</th>
                  <th>Flags</th>
                  <th>Last seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => {
                  const blocked = u.excluded === "disposable" || u.excluded === "no_email";
                  const live = finalSet.has(u.email);
                  return (
                    <tr key={u.email} style={{ opacity: live ? 1 : 0.5 }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={included.has(u.email)}
                          disabled={blocked}
                          onChange={() => setIncluded((p) => toggle(p, u.email))}
                          style={{ width: "auto" }}
                        />
                      </td>
                      <td>
                        {u.name || "—"}
                        <div className="hint">{u.email}</div>
                      </td>
                      <td>
                        <span className="badge">{segLabel(u.segment)}</span>
                        {!segments.has(u.segment) && <div className="hint">segment off</div>}
                      </td>
                      <td className="hint">
                        {u.site || "—"}
                        {u.sites > 1 && ` +${u.sites - 1}`}
                        <div>
                          {u.analyses} run{u.analyses === 1 ? "" : "s"}
                          {u.failed > 0 && ` · ${u.failed} failed`}
                        </div>
                      </td>
                      <td className="hint">{u.cameFrom || "—"}</td>
                      <td>
                        <div className="pill-list">
                          {u.pages.length ? u.pages.slice(0, 4).map((p) => <span key={p} className="badge">{p}</span>) : <span className="hint">—</span>}
                          {u.pages.length > 4 && <span className="hint">+{u.pages.length - 4}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="pill-list">
                          {u.excluded && <span className="badge failed">{u.excluded}</span>}
                          {u.teamHint && <span className="badge">team?</span>}
                          {u.business && <span className="badge replied">business</span>}
                          {u.landed && <span className="badge sent">dashboard</span>}
                          {u.demoRequested && <span className="badge completed">demo asked</span>}
                          {(u.uiIssues > 0 || u.apiErrors > 0) && (
                            <span className="badge failed" title={`${u.uiIssues} UI issues, ${u.apiErrors} API errors`}>errors</span>
                          )}
                        </div>
                      </td>
                      <td className="hint" style={{ whiteSpace: "nowrap" }}>{shortDate(u.lastVisited)}</td>
                      <td>
                        <button
                          type="button"
                          className="ghost"
                          style={{ padding: "4px 10px", fontSize: 12 }}
                          onClick={() => void load({ previewEmail: u.email })}
                          disabled={loading}
                        >
                          Preview
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {finalEmails.map((e) => (
            <input key={e} type="hidden" name="include" value={e} />
          ))}

          <div className="card" style={{ marginTop: 16 }}>
            <div className="actions">
              <button type="submit" disabled={submitting || loading || finalEmails.length === 0}>
                {submitting ? "Creating…" : `Create draft campaign — ${finalEmails.length} recipients`}
              </button>
            </div>
            <p className="hint">
              Creates a draft. Nothing sends until you press &ldquo;Start sending&rdquo; on the
              campaign page, and sends are then jittered like any other campaign.
            </p>
          </div>
        </>
      )}
    </form>
  );
}
