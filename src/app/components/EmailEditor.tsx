"use client";

// Two-pane email editor, GitHub-style: the template's HTML on the left, the
// email exactly as the recipient will see it on the right. The preview runs
// the same composeEmail() the send path uses, so what you see is what goes out
// (spintax shows its first option; "Shuffle" spins a random variant).

import { useEffect, useMemo, useRef, useState } from "react";
import { composeEmail, type SenderLike } from "@/lib/template";
import { looksLikeHtml, textToContentHtml } from "@/lib/email-html";

export interface PreviewSample {
  /** {{company}} — the recipient's company or name. */
  company: string;
  toEmail?: string;
  extra?: Record<string, string>;
}

type View = "split" | "code" | "preview";
type Width = "desktop" | "mobile";

const SNIPPETS: Array<{ label: string; text: string; title: string }> = [
  { label: "¶ paragraph", text: "<p></p>", title: "A paragraph" },
  { label: "Demo button", text: "{{demoButton}}", title: "\"Book a demo\" button — needs a booking link" },
  { label: "Activity card", text: "{{activityCard}}", title: "What this user did on Olum, as a card" },
  { label: "Dashboard button", text: "{{dashboardButton}}", title: "\"Open your dashboard\" button" },
  { label: "Signature", text: "{{signature}}", title: "Sender name and title" },
];

export function EmailEditor({
  bodyName,
  subjectName,
  body: bodyProp,
  subject: subjectProp,
  defaultBody = "",
  defaultSubject = "",
  onBodyChange,
  onSubjectChange,
  sender,
  senderEmail,
  sample,
  placeholders,
  snippets = true,
  rows = 22,
}: {
  bodyName: string;
  subjectName?: string;
  body?: string;
  subject?: string;
  defaultBody?: string;
  defaultSubject?: string;
  onBodyChange?: (v: string) => void;
  onSubjectChange?: (v: string) => void;
  sender: SenderLike;
  senderEmail?: string;
  sample: PreviewSample;
  placeholders?: string[];
  snippets?: boolean;
  rows?: number;
}) {
  const [localBody, setLocalBody] = useState(defaultBody);
  const [localSubject, setLocalSubject] = useState(defaultSubject);
  const body = bodyProp ?? localBody;
  const subject = subjectProp ?? localSubject;
  const setBody = (v: string) => (onBodyChange ? onBodyChange(v) : setLocalBody(v));
  const setSubject = (v: string) => (onSubjectChange ? onSubjectChange(v) : setLocalSubject(v));

  const [view, setView] = useState<View>("split");
  const [width, setWidth] = useState<Width>("desktop");
  const [seed, setSeed] = useState(0);
  const [wrap, setWrap] = useState(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const mail = useMemo(
    () =>
      composeEmail({
        subject,
        body,
        company: sample.company,
        sender,
        extra: sample.extra,
        spin: seed === 0 ? "first" : "random",
      }),
    // seed re-spins on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subject, body, sample, sender, seed]
  );

  const lineCount = body.split("\n").length;
  const isHtml = looksLikeHtml(body);

  useEffect(() => {
    // Keep the gutter aligned if the body is replaced from outside.
    if (gutterRef.current && codeRef.current) gutterRef.current.scrollTop = codeRef.current.scrollTop;
  }, [body]);

  function insert(text: string) {
    const el = codeRef.current;
    if (!el) return setBody(body + "\n" + text);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = body.slice(0, a) + text + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const caret = text === "<p></p>" ? a + 3 : a + text.length;
      el.setSelectionRange(caret, caret);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      insert("  ");
    }
  }

  return (
    <div className="ed">
      {subjectName !== undefined && (
        <div className="ed-subject">
          <label htmlFor={`${bodyName}-subject`}>Subject</label>
          <input
            id={`${bodyName}-subject`}
            name={subjectName}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>
      )}

      <div className="ed-bar">
        <div className="ed-file">
          <span className="ed-dot" />
          {isHtml ? "email.html" : "email.txt"}
          <span className="hint">{lineCount} lines</span>
        </div>
        {view !== "preview" && (
          <label className="ed-wrap">
            <input type="checkbox" checked={wrap} onChange={() => setWrap(!wrap)} /> Wrap
          </label>
        )}
        <div className="ed-tabs" role="tablist">
          {(["code", "split", "preview"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={view === v ? "on" : ""}
              onClick={() => setView(v)}
            >
              {v === "code" ? "Code" : v === "split" ? "Split" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {snippets && view !== "preview" && (
        <div className="ed-snippets">
          <span className="hint">Insert</span>
          {SNIPPETS.map((s) => (
            <button key={s.label} type="button" title={s.title} onClick={() => insert(s.text)}>
              {s.label}
            </button>
          ))}
          {!isHtml && body.trim() && (
            <button
              type="button"
              className="convert"
              title="Turn this plain-text letter into HTML paragraphs"
              onClick={() => setBody(textToContentHtml(body))}
            >
              Convert to HTML
            </button>
          )}
        </div>
      )}

      <div className={`ed-panes ${view}`}>
        <div className="ed-code" hidden={view === "preview"}>
          {/* Line numbers only line up when lines don't wrap. */}
          {!wrap && (
            <div className="ed-gutter" ref={gutterRef} aria-hidden>
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
          )}
          <textarea
            ref={codeRef}
            name={bodyName}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            spellCheck={false}
            rows={rows}
            required
            wrap={wrap ? "soft" : "off"}
          />
        </div>

        {view !== "code" && (
          <div className="ed-preview">
            <div className="ed-inbox">
              <div>
                <span className="hint">From</span> {sender.displayName}
                {senderEmail ? <span className="hint"> &lt;{senderEmail}&gt;</span> : null}
              </div>
              <div>
                <span className="hint">To</span> {sample.company}
                {sample.toEmail ? <span className="hint"> &lt;{sample.toEmail}&gt;</span> : null}
              </div>
              <div className="ed-subj">{mail.subject || <span className="hint">(no subject)</span>}</div>
              <div className="ed-tools">
                <button type="button" className={width === "desktop" ? "on" : ""} onClick={() => setWidth("desktop")}>
                  Desktop
                </button>
                <button type="button" className={width === "mobile" ? "on" : ""} onClick={() => setWidth("mobile")}>
                  Mobile
                </button>
                <button type="button" onClick={() => setSeed((n) => n + 1)} title="Show another spintax variant">
                  Shuffle
                </button>
              </div>
            </div>
            <div className="ed-frame-wrap">
              <iframe
                title="Email preview"
                className={`ed-frame ${width}`}
                srcDoc={mail.html}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        )}
      </div>

      {placeholders?.length ? (
        <div className="ed-help hint">
          Placeholders:{" "}
          {placeholders.map((p) => (
            <code key={p}>{`{{${p}}}`}</code>
          ))}{" "}
          · Spintax <code>{"{a|b|c}"}</code> picks one option per email.
        </div>
      ) : null}
    </div>
  );
}
