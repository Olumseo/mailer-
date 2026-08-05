"use client";

import { useCallback, useRef, useState } from "react";
import { createReportCampaignAction } from "@/app/actions";

type SegmentKey = string;

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
  excluded: "internal" | "disposable" | "no_email" | null;
  teamHint: boolean;
  business: boolean;
  highFriction: boolean;
  defaultInclude: boolean;
};

type Sample = { subject: string; body: string } | null;

type Preview = {
  sheetName: string;
  duplicates: number;
  skipped: number;
  counts: Record<string, number>;
  segments: SegmentDef[];
  sender: { key: string; name: string; email: string };
  samples: Record<string, Sample>;
  users: User[];
  focus: { email: string; name: string; subject: string; body: string } | null;
};

type Copy = Record<SegmentKey, { subject: string; body: string }>;

export function ReportForm({
  senders,
  defaultSenderKey,
  defaultFounderName,
  defaultBookingLink,
}: {
  senders: Array<{ key: string; name: string; email: string }>;
  defaultSenderKey: string;
  defaultFounderName: string;
  defaultBookingLink: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
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

  /** (Re)read the uploaded file server-side with the current settings. */
  const load = useCallback(
    async (opts: { reset?: boolean; previewEmail?: string; copyOverride?: Copy } = {}) => {
      const file = fileRef.current?.files?.[0];
      if (!file) return;
      setLoading(true);
      setErr(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("senderKey", senderKey);
        fd.append("founderName", founderName);
        fd.append("bookingLink", bookingLink);
        if (!opts.reset) fd.append("copy", JSON.stringify(opts.copyOverride ?? copy));
        if (opts.previewEmail) fd.append("previewEmail", opts.previewEmail);

        const res = await fetch("/api/report-preview", { method: "POST", body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't read the report");

        const p = data as Preview;
        setPreview(p);
        if (opts.reset) {
          const fresh: Copy = {};
          for (const s of p.segments) fresh[s.key] = { subject: s.subject, body: s.body };
          setCopy(fresh);
          setSegments(new Set(p.segments.filter((s) => (p.counts[s.key] ?? 0) > 0).map((s) => s.key)));
          setIncluded(new Set(p.users.filter((u) => u.defaultInclude).map((u) => u.email)));
          setOpenSegment(null);
        }
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [senderKey, founderName, bookingLink, copy]
  );

  function onFile() {
    setPreview(null);
    setIncluded(new Set());
    setSegments(new Set());
    if (fileRef.current?.files?.[0]) void load({ reset: true });
  }

  function toggleSegment(key: SegmentKey) {
    setSegments((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleUser(email: string) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
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
  const visible = showAll ? users : users.filter((u) => !u.excluded);
  const segLabel = (k: string) => preview?.segments.find((s) => s.key === k)?.label ?? k;

  return (
    <form action={createReportCampaignAction} onSubmit={() => setSubmitting(true)}>
      <div className="card">
        <label>Campaign name</label>
        <input name="name" placeholder="Product feedback — Aug 2026 users" required />

        <div className="row">
          <div>
            <label>Send everything from</label>
            <select
              name="senderKey"
              value={senderKey}
              onChange={(e) => setSenderKey(e.target.value)}
            >
              {senders.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name} — {s.email}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Founder named in the meeting line</label>
            <input
              name="founderName"
              value={founderName}
              onChange={(e) => setFounderName(e.target.value)}
              placeholder="Rohan"
            />
          </div>
        </div>
        <p className="hint">
          One mailbox for the whole list — these go to existing users, so they should all come
          from the same person, not round-robined across senders.
        </p>

        <label>Meeting link (Barath&rsquo;s booking link)</label>
        <input
          name="bookingLink"
          value={bookingLink}
          onChange={(e) => setBookingLink(e.target.value)}
          placeholder="https://cal.com/barath/15min"
        />
        {!bookingLink.trim() && (
          <p className="hint" style={{ color: "var(--bad)" }}>
            No link yet — the &ldquo;book a call&rdquo; paragraph will be dropped from every
            email until you paste one.
          </p>
        )}

        <label>Users report (.xlsx)</label>
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept=".xlsx,.xls"
          required
          onChange={onFile}
        />
        <p className="hint">
          The report generated by Olum (Name, Email, Landed dashboard, Workflow state, Sites
          analysed…). Users are segmented by how far they actually got.
        </p>

        {loading && <p className="hint">Reading the report…</p>}
        {err && (
          <p className="hint" style={{ color: "var(--bad)" }}>
            {err}
          </p>
        )}
      </div>

      {preview && (
        <>
          <div className="mono-note" style={{ marginBottom: 16 }}>
            Read <strong style={{ color: "var(--text)" }}>{preview.sheetName}</strong> —{" "}
            {preview.users.length} users
            {preview.duplicates > 0 && `, ${preview.duplicates} duplicate email(s) dropped`}
            {preview.skipped > 0 && `, ${preview.skipped} row(s) with no email skipped`}. Sending
            as {preview.sender.name} &lt;{preview.sender.email}&gt;.
          </div>

          <h2>Segments</h2>
          <p className="sub">
            Each segment gets its own letter. Placeholders are filled per person from their own
            row — their domain, their run count, their error count.
          </p>

          {preview.segments.map((s) => {
            const count = preview.counts[s.key] ?? 0;
            const on = segments.has(s.key);
            const chosen = finalEmails.filter(
              (e) => users.find((u) => u.email === e)?.segment === s.key
            ).length;
            const sample = preview.samples[s.key];
            return (
              <div className="card" key={s.key} style={{ opacity: on ? 1 : 0.55 }}>
                <label
                  style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, color: "var(--text)" }}
                >
                  <input
                    type="checkbox"
                    name="segments"
                    value={s.key}
                    checked={on}
                    onChange={() => toggleSegment(s.key)}
                    disabled={count === 0}
                    style={{ width: "auto" }}
                  />
                  <strong>{s.label}</strong>
                  <span className="badge">{count} users</span>
                  {on && chosen !== count && <span className="badge">{chosen} selected</span>}
                </label>
                <p className="hint" style={{ marginTop: 6 }}>
                  {s.blurb}
                </p>

                <div className="actions" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="ghost"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => setOpenSegment(openSegment === s.key ? null : s.key)}
                  >
                    {openSegment === s.key ? "Hide copy" : "Edit copy & preview"}
                  </button>
                </div>

                {/* Keep edits alive when the panel is collapsed — the visible
                    fields below are the only copy inputs when it's open. */}
                {openSegment !== s.key && (
                  <>
                    <input type="hidden" name={`subject_${s.key}`} value={copy[s.key]?.subject ?? s.subject} />
                    <input type="hidden" name={`body_${s.key}`} value={copy[s.key]?.body ?? s.body} />
                  </>
                )}

                {openSegment === s.key && (
                  <div style={{ marginTop: 10 }}>
                    <label>Subject</label>
                    <input
                      name={`subject_${s.key}`}
                      value={copy[s.key]?.subject ?? s.subject}
                      onChange={(e) => editCopy(s.key, "subject", e.target.value)}
                    />
                    <label>Body</label>
                    <textarea
                      name={`body_${s.key}`}
                      rows={16}
                      value={copy[s.key]?.body ?? s.body}
                      onChange={(e) => editCopy(s.key, "body", e.target.value)}
                    />
                    <div className="actions">
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "4px 10px", fontSize: 12 }}
                        onClick={() => void load()}
                        disabled={loading}
                      >
                        {loading ? "Rendering…" : "Refresh previews"}
                      </button>
                    </div>
                    {sample ? (
                      <div className="mono-note" style={{ marginTop: 10 }}>
                        <div style={{ color: "var(--text)" }}>
                          <strong>Subject:</strong> {sample.subject}
                        </div>
                        <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
                          {sample.body}
                        </pre>
                      </div>
                    ) : (
                      <p className="hint">No user in this segment to preview.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {preview.focus && (
            <div className="card">
              <strong>
                Preview — {preview.focus.name || preview.focus.email} ({preview.focus.email})
              </strong>
              <div className="mono-note" style={{ marginTop: 8 }}>
                <div style={{ color: "var(--text)" }}>
                  <strong>Subject:</strong> {preview.focus.subject}
                </div>
                <pre style={{ whiteSpace: "pre-wrap", margin: "8px 0 0" }}>
                  {preview.focus.body}
                </pre>
              </div>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 24,
              marginBottom: 10,
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <h2 style={{ margin: 0 }}>Recipients ({finalEmails.length})</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={() => setShowAll(!showAll)}
                  style={{ width: "auto" }}
                />
                Show excluded rows
              </label>
              <button
                type="button"
                className="ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() =>
                  setIncluded(new Set(visible.filter((u) => !u.excluded).map((u) => u.email)))
                }
              >
                Select all shown
              </button>
              <button
                type="button"
                className="ghost"
                style={{ padding: "4px 10px", fontSize: 12 }}
                onClick={() => setIncluded(new Set())}
              >
                Clear
              </button>
            </div>
          </div>

          <p className="hint" style={{ marginBottom: 8 }}>
            Internal accounts (your own domains, non-user roles) and rows flagged <em>team?</em>{" "}
            start unticked — tick one if that&rsquo;s wrong. Disposable-domain signups can&rsquo;t
            be ticked at all.
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Person</th>
                  <th>Segment</th>
                  <th>Site</th>
                  <th>Runs</th>
                  <th>Errors</th>
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
                          onChange={() => toggleUser(u.email)}
                          style={{ width: "auto" }}
                        />
                      </td>
                      <td>
                        {u.name || "—"}
                        <div className="hint">{u.email}</div>
                      </td>
                      <td>
                        <span className="badge">{segLabel(u.segment)}</span>
                        {!segments.has(u.segment) && (
                          <div className="hint">segment off</div>
                        )}
                      </td>
                      <td className="hint">
                        {u.site || "—"}
                        {u.sites > 1 && ` +${u.sites - 1}`}
                      </td>
                      <td className="hint">
                        {u.analyses}
                        {u.failed > 0 && ` / ${u.failed} failed`}
                      </td>
                      <td className="hint">
                        {u.uiIssues > 0 && `${u.uiIssues} UI`}
                        {u.uiIssues > 0 && u.apiErrors > 0 && ", "}
                        {u.apiErrors > 0 && `${u.apiErrors} API`}
                        {u.uiIssues === 0 && u.apiErrors === 0 && "—"}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {u.excluded && <span className="badge failed">{u.excluded}</span>}
                          {u.teamHint && <span className="badge">team?</span>}
                          {u.business && <span className="badge replied">business</span>}
                          {u.landed && <span className="badge sent">dashboard</span>}
                        </div>
                      </td>
                      <td className="hint">{u.lastVisited || "—"}</td>
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
                {submitting
                  ? "Creating…"
                  : `Create draft campaign — ${finalEmails.length} recipients`}
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
