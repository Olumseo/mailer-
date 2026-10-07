"use client";

import { useEffect, useRef, useState } from "react";

/** One sent email's HTML, fetched the first time its row is opened and shown
 *  in a sandboxed srcdoc frame — 200 rows don't each download an email. */
export function MailFrame({ id, title }: { id: number; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) return;
    let started = false;
    const onToggle = () => {
      if (!details.open || started) return;
      started = true;
      fetch(`/api/sent-html/${id}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          setLegacy(r.headers.get("X-Rendered-From") === "text");
          return r.text();
        })
        .then(setHtml)
        .catch((e: Error) => setErr(e.message));
    };
    details.addEventListener("toggle", onToggle);
    onToggle();
    return () => details.removeEventListener("toggle", onToggle);
  }, [id]);

  return (
    <div ref={ref}>
      {err ? (
        <p className="hint" style={{ color: "var(--bad)" }}>Couldn&rsquo;t load this email: {err}</p>
      ) : html === null ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          {legacy && (
            <p className="hint" style={{ marginTop: 0 }}>
              Sent before HTML was recorded — this is its text shown in today&rsquo;s layout.
            </p>
          )}
          {/* No allow-scripts: same-origin only lets the frame paint, never run code. */}
          <iframe title={title} srcDoc={html} sandbox="allow-same-origin" />
        </>
      )}
    </div>
  );
}
