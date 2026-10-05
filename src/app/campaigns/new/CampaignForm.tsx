"use client";

import { useState } from "react";
import { createCampaignAction } from "@/app/actions";

type Sheet = { name: string; count: number };
type SenderOption = { key: string; name: string; email: string };

export function CampaignForm({
  defaultTemplate,
  senders,
}: {
  defaultTemplate: string;
  senders: SenderOption[];
}) {
  const [senderKey, setSenderKey] = useState("");
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setSheets(null);
    setSelected(new Set());
    setErr(null);
    if (!file) return;

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/sheets", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to read sheets");
      const data = (await res.json()) as { sheets: Sheet[] };
      setSheets(data.sheets);
      setSelected(new Set(data.sheets.map((s) => s.name))); // default: all selected
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const multi = sheets && sheets.length > 1;
  const allSelected = sheets ? selected.size === sheets.length : false;
  const totalSelected = sheets
    ? sheets.filter((s) => selected.has(s.name)).reduce((a, s) => a + s.count, 0)
    : 0;

  return (
    <form action={createCampaignAction} onSubmit={() => setSubmitting(true)}>
      <div className="card">
        <label>Campaign name</label>
        <input name="name" placeholder="Singapore — bookkeeping July" required />

        <label>Subject line</label>
        <input
          name="subject"
          defaultValue="Businesses searching for bookkeeping help in Singapore"
          required
        />

        <label>Send from</label>
        <select name="senderKey" value={senderKey} onChange={(e) => setSenderKey(e.target.value)}>
          <option value="">All mailboxes — split evenly ({senders.length} senders)</option>
          {senders.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name} — {s.email}
            </option>
          ))}
        </select>
        <p className="hint">
          {senderKey
            ? `Every email in this campaign goes out from ${
                senders.find((s) => s.key === senderKey)?.email ?? "the selected mailbox"
              }.`
            : "Recipients are round-robined across every configured mailbox. Pick one to send the whole list from a single address."}
        </p>

        <label>Recipient list (.xlsx)</label>
        <input type="file" name="file" accept=".xlsx,.xls" required onChange={onFile} />

        {loading && <p className="hint">Reading sheets…</p>}
        {err && <p className="hint" style={{ color: "var(--bad)" }}>{err}</p>}

        {multi && (
          <div className="mono-note" style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ color: "var(--text)" }}>
                This file has {sheets!.length} sheets — choose which to send to:
              </strong>
              <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? new Set() : new Set(sheets!.map((s) => s.name)))
                  }
                  style={{ width: "auto" }}
                />
                Select all
              </label>
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
              {sheets!.map((s) => (
                <label
                  key={s.name}
                  style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, color: "var(--text)" }}
                >
                  <input
                    type="checkbox"
                    name="sheets"
                    value={s.name}
                    checked={selected.has(s.name)}
                    onChange={() => toggle(s.name)}
                    style={{ width: "auto" }}
                  />
                  {s.name} <span className="hint">({s.count} recipients)</span>
                </label>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              {selected.size} sheet(s) · ~{totalSelected} recipients selected (before dedupe).
            </div>
          </div>
        )}
        {sheets && sheets.length === 1 && (
          <input type="hidden" name="sheets" value={sheets[0].name} />
        )}

        <label>Body template</label>
        <textarea name="bodyTemplate" defaultValue={defaultTemplate} required />
        <div className="mono-note" style={{ marginTop: 8 }}>
          Placeholders: <code>{"{{company}}"}</code> <code>{"{{senderName}}"}</code>{" "}
          <code>{"{{senderTitle}}"}</code> <code>{"{{bookingLink}}"}</code>. Spintax{" "}
          <code>{"{a|b|c}"}</code> varies each email so no two are identical.
        </div>

        <div className="actions">
          <button type="submit" disabled={submitting || loading || (multi ? selected.size === 0 : false)}>
            {submitting ? "Creating…" : "Create campaign"}
          </button>
        </div>
        <p className="hint">
          Creating stages the campaign as a draft — nothing sends until you press
          &ldquo;Start&rdquo; on the next screen.
        </p>
      </div>
    </form>
  );
}
