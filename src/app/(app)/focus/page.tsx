"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PopOver from "@/components/PopOver";
import { FactResultCard, type FactResult } from "@/components/FactCheckPanel";
import { SuggestionCard, type Suggestion } from "@/components/SuggestedReading";
import { locateClaim } from "@/lib/highlight";

type DriftResult = { off_track: boolean; reason: string };
type ContradictionResult = {
  found: boolean;
  note_index: number | null;
  claim: string;
  note_text: string;
  note_id: string | null;
};
type TableResult = {
  is_table: boolean;
  headers?: string[];
  rows?: string[][];
  markdown?: string;
};

type Source = { title: string; url: string } | null;
type Popup =
  | { kind: "drift"; reason: string }
  | {
      kind: "fact";
      note_text: string;
      claim: string;
      correction: string;
      source: Source;
    }
  | { kind: "table"; table: TableResult }
  | null;

const CATEGORY_BG: Record<string, string> = {
  inaccurate: "rgba(255,107,107,0.38)", // coral
  overclaimed: "rgba(255,138,76,0.36)", // orange
  needs_source: "rgba(255,212,59,0.32)", // amber
  unverifiable: "rgba(255,212,59,0.28)", // amber (lighter)
  accurate: "rgba(123,216,143,0.30)", // green
};

// Pick the highlight category for a result (flags can outrank a soft verdict).
function highlightCategory(r: FactResult): string {
  if (r.verdict === "inaccurate") return "inaccurate";
  if (r.flag === "overclaimed") return "overclaimed";
  if (r.flag === "needs_source") return "needs_source";
  if (r.verdict === "unverifiable") return "unverifiable";
  return "accurate";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Build the highlighted backdrop HTML: wrap each flagged quote in a colored
// <mark> so it shows behind the (transparent-bg) textarea text.
function buildHighlightHtml(text: string, results: FactResult[]): string {
  type Range = { start: number; end: number; category: string };
  const ranges: Range[] = [];
  for (const r of results) {
    // Locate the best-matching sentence — robust to the AI rewording the quote.
    const span = locateClaim(text, r.quote || r.claim || "");
    if (!span) continue;
    ranges.push({ start: span.start, end: span.end, category: highlightCategory(r) });
  }
  ranges.sort((a, b) => a.start - b.start);
  // Drop overlaps (keep the earliest).
  const merged: Range[] = [];
  for (const r of ranges) {
    if (merged.length && r.start < merged[merged.length - 1].end) continue;
    merged.push(r);
  }
  let html = "";
  let cursor = 0;
  for (const r of merged) {
    html += escapeHtml(text.slice(cursor, r.start));
    const bg = CATEGORY_BG[r.category] ?? CATEGORY_BG.unverifiable;
    html += `<mark style="background:${bg};color:transparent;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone">${escapeHtml(
      text.slice(r.start, r.end)
    )}</mark>`;
    cursor = r.end;
  }
  html += escapeHtml(text.slice(cursor));
  // Trailing newline so the backdrop matches the textarea's last line height.
  return html + "\n";
}

export default function FocusPage() {
  // Task context
  const [taskDescription, setTaskDescription] = useState("");
  const [emailThread, setEmailThread] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [taskSaved, setTaskSaved] = useState(false);

  // Gmail
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [pullingThread, setPullingThread] = useState(false);

  // Writing surface
  const [writing, setWriting] = useState("");
  const [checking, setChecking] = useState(false);
  const [wordCount, setWordCount] = useState(0);

  // Deep fact-check (against notes + the web)
  const [factChecking, setFactChecking] = useState(false);
  const [factResults, setFactResults] = useState<FactResult[] | null>(null);
  const [factMessage, setFactMessage] = useState("");
  const [showFactModal, setShowFactModal] = useState(false);
  const [factCheckedText, setFactCheckedText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Suggested reading (Step 3)
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestMessage, setSuggestMessage] = useState("");
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  // Save own writing as a signal (Step 4)
  const [showSaveSignal, setShowSaveSignal] = useState(false);
  const [saveSignalText, setSaveSignalText] = useState("");
  const [saveSignalStatus, setSaveSignalStatus] = useState("");

  // Bibliography (Step 5)
  const [showBiblio, setShowBiblio] = useState(false);
  const [biblioStyle, setBiblioStyle] = useState<"apa" | "mla" | "chicago">("apa");
  const [biblioProject, setBiblioProject] = useState("");
  const [biblioEntries, setBiblioEntries] = useState<string[] | null>(null);
  const [biblioLoading, setBiblioLoading] = useState(false);
  const [biblioMessage, setBiblioMessage] = useState("");
  const [biblioCopied, setBiblioCopied] = useState(false);

  // Single active centered popup + dismissal memory
  const [popup, setPopup] = useState<Popup>(null);
  const [copied, setCopied] = useState(false);
  const popupRef = useRef<Popup>(null);
  popupRef.current = popup;

  const writingRef = useRef(writing);
  writingRef.current = writing;

  // open a popup only if none is currently showing
  const tryOpen = useCallback((p: Popup) => {
    if (!popupRef.current) setPopup(p);
  }, []);

  useEffect(() => {
    fetch("/api/task-context")
      .then((r) => r.json())
      .then((d) => {
        if (d.taskContext) {
          setTaskDescription(d.taskContext.task_description || "");
          setEmailThread(d.taskContext.email_thread_text || "");
        }
      })
      .catch(() => {});
    fetch("/api/gmail/thread")
      .then((r) => r.json())
      .then((d) => {
        setGmailConnected(!!d.connected);
        setGmailEmail(d.email ?? null);
      })
      .catch(() => {});
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(d.projects ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "cortex-gmail-connected") {
        fetch("/api/gmail/thread")
          .then((r) => r.json())
          .then((d) => {
            setGmailConnected(!!d.connected);
            setGmailEmail(d.email ?? null);
          });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function saveTask() {
    setSavingTask(true);
    setTaskSaved(false);
    try {
      await fetch("/api/task-context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_description: taskDescription,
          email_thread_text: emailThread,
        }),
      });
      setTaskSaved(true);
      setTimeout(() => setTaskSaved(false), 2000);
    } finally {
      setSavingTask(false);
    }
  }

  function connectGmail() {
    window.open(
      "/api/gmail/auth",
      "cortex-gmail",
      "width=520,height=640,menubar=no,toolbar=no"
    );
  }

  async function pullThread() {
    setPullingThread(true);
    try {
      const res = await fetch("/api/gmail/thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: taskDescription.slice(0, 120) }),
      });
      if (res.ok) {
        const d = await res.json();
        setEmailThread(d.text || "");
      }
    } finally {
      setPullingThread(false);
    }
  }

  // Behaviour 2: drift + fact guard every 30s
  const lastCheckedText = useRef("");
  const runFocusCheck = useCallback(async (force = false) => {
    const text = writingRef.current.trim();
    if (text.length < 20) return;
    // Skip re-checking unchanged text so the 30s loop doesn't burn API quota.
    if (force !== true && text === lastCheckedText.current) return;
    lastCheckedText.current = text;
    setChecking(true);
    try {
      const res = await fetch("/api/focus/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writing: text }),
      });
      const d = await res.json();
      if (d.contradiction?.found && d.contradiction.note_text) {
        tryOpen({
          kind: "fact",
          note_text: d.contradiction.note_text,
          claim: d.contradiction.claim || "",
          correction: d.contradiction.correction || d.contradiction.note_text,
          source: d.contradiction.source || null,
        });
      } else if (d.drift?.off_track) {
        tryOpen({ kind: "drift", reason: d.drift.reason });
      }
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }, [tryOpen]);

  useEffect(() => {
    const id = setInterval(runFocusCheck, 30_000);
    return () => clearInterval(id);
  }, [runFocusCheck]);

  // Deep fact-check against notes + the web (on demand).
  async function runFactCheck() {
    const text = writingRef.current.trim();
    if (text.length < 20) {
      setFactMessage("Write a bit more to fact-check.");
      setFactResults(null);
      setShowFactModal(true);
      return;
    }
    setFactChecking(true);
    setShowFactModal(true);
    setFactMessage("");
    setFactResults(null);
    try {
      const res = await fetch("/api/factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writing: text }),
      });
      const d = await res.json();
      setFactResults(d.results ?? []);
      setFactMessage(d.message || "");
      setFactCheckedText(text);
    } catch {
      setFactMessage("Couldn't run the fact-check — try again.");
    } finally {
      setFactChecking(false);
    }
  }

  // Suggested reading (Step 3).
  async function runSuggestSources() {
    const text = writingRef.current.trim();
    setShowSuggestModal(true);
    if (text.length < 20) {
      setSuggestions(null);
      setSuggestMessage("Write a bit more and I'll suggest reading.");
      return;
    }
    setSuggesting(true);
    setSuggestions(null);
    setSuggestMessage("");
    try {
      const res = await fetch("/api/suggest-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writing: text }),
      });
      const d = await res.json();
      setSuggestions(d.suggestions ?? []);
      setSuggestMessage(d.message || "");
    } catch {
      setSuggestMessage("Couldn't fetch suggestions — try again.");
    } finally {
      setSuggesting(false);
    }
  }

  // Save the selected passage (or whole draft) as a self-authored signal.
  function openSaveSignal() {
    const ta = textareaRef.current;
    let selected = "";
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      selected = writing.slice(ta.selectionStart, ta.selectionEnd);
    }
    setSaveSignalText((selected || writing).trim());
    setSaveSignalStatus("");
    setShowSaveSignal(true);
  }

  async function saveOwnSignal(projectId: string) {
    if (!saveSignalText.trim()) return;
    const pid = projectId === "__unfiled__" ? null : projectId || null;
    setSaveSignalStatus("saving…");
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: pid,
          highlight_text: saveSignalText.trim(),
          source_title: "My writing",
          origin: "self",
        }),
      });
      if (res.ok) {
        setSaveSignalStatus("saved ✓");
        setTimeout(() => setShowSaveSignal(false), 900);
      } else {
        setSaveSignalStatus("save failed");
      }
    } catch {
      setSaveSignalStatus("save failed");
    }
  }

  // Bibliography (Step 5).
  async function runBibliography(
    projectId = biblioProject,
    style = biblioStyle
  ) {
    setBiblioLoading(true);
    setBiblioEntries(null);
    setBiblioMessage("");
    try {
      const res = await fetch("/api/bibliography", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId || null,
          style,
        }),
      });
      const d = await res.json();
      setBiblioEntries(d.entries ?? []);
      setBiblioMessage(d.message || "");
    } catch {
      setBiblioMessage("Couldn't build the bibliography — try again.");
    } finally {
      setBiblioLoading(false);
    }
  }

  function copyBiblio() {
    if (!biblioEntries?.length) return;
    navigator.clipboard.writeText(biblioEntries.join("\n\n"));
    setBiblioCopied(true);
    setTimeout(() => setBiblioCopied(false), 1500);
  }

  async function saveSuggestion(s: Suggestion, projectId: string): Promise<boolean> {
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          highlight_text: s.title,
          source_url: s.url,
          source_title: s.source,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Swap a flagged sentence for the suggested correction (opt-in).
  function useSuggestion(r: FactResult) {
    const text = writingRef.current;
    const span = locateClaim(text, r.quote || r.claim || "");
    if (!span || !r.correction) return;
    const next = text.slice(0, span.start) + r.correction + text.slice(span.end);
    setWriting(next);
    setFactCheckedText(next);
    setWordCount(next.trim() ? next.trim().split(/\s+/).length : 0);
    // Drop the applied finding; the rest re-locate against the new text.
    setFactResults((prev) => (prev ? prev.filter((x) => x !== r) : prev));
  }

  // Behaviour 3: auto-table after a 3s pause
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onWritingChange(value: string) {
    setWriting(value);
    setWordCount(value.trim() ? value.trim().split(/\s+/).length : 0);
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(async () => {
      if (value.trim().split(/\s+/).length < 25) return;
      try {
        const res = await fetch("/api/autotable", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        const d: TableResult = await res.json();
        if (d.is_table) tryOpen({ kind: "table", table: d });
      } catch {
        /* ignore */
      }
    }, 3000);
  }

  function insertTable(table: TableResult) {
    if (!table.markdown) return;
    setWriting((prev) => `${prev.trimEnd()}\n\n${table.markdown}\n`);
    setPopup(null);
  }

  function copyTable(table: TableResult) {
    if (!table.markdown) return;
    navigator.clipboard.writeText(table.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">
            Focus mode <span className="inline-block animate-floaty">🧠</span>
          </h1>
          <p className="text-ink-400 text-sm mt-1.5">
            Drop your assignment, start typing, and your second mind keeps you on
            track.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-medium ${
              checking
                ? "bg-accent/15 text-accent"
                : "bg-grass/10 text-grass"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                checking ? "bg-accent animate-pulse" : "bg-grass"
              }`}
            />
            {checking ? "thinking…" : "watching"}
          </span>
        </div>
      </div>

      {/* Task context */}
      <section className="bg-ink-900 border border-ink-800 rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-100 flex items-center gap-2">
            <span>🎯</span> What are you working on?
          </h2>
          {gmailConnected ? (
            <button
              onClick={pullThread}
              disabled={pullingThread}
              className="text-xs font-medium border border-ink-700 rounded-full px-3 py-1 text-ink-300 hover:text-ink-100 hover:border-ink-600 disabled:opacity-60"
            >
              {pullingThread ? "pulling…" : "📥 pull recent email"}
            </button>
          ) : (
            <button
              onClick={connectGmail}
              className="text-xs font-medium border border-ink-700 rounded-full px-3 py-1 text-ink-300 hover:text-ink-100 hover:border-ink-600"
            >
              ✉️ connect Gmail
            </button>
          )}
        </div>
        {gmailConnected && gmailEmail && (
          <p className="text-xs text-ink-500 font-mono">📬 {gmailEmail}</p>
        )}
        <textarea
          value={taskDescription}
          onChange={(e) => setTaskDescription(e.target.value)}
          placeholder="e.g. Essay comparing the causes of WWI and WWII — focus on alliances, economics, and ideology. Don't get sidetracked into the Cold War."
          rows={3}
          className="w-full bg-ink-850 border border-ink-700 rounded-2xl px-4 py-3 text-sm leading-relaxed focus:outline-none focus:border-accent resize-y"
        />
        {emailThread && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-400 hover:text-ink-200 text-xs">
              📎 linked email thread ({emailThread.length} chars)
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-ink-850 border border-ink-800 rounded-2xl p-3 text-xs text-ink-300 font-mono">
              {emailThread}
            </pre>
          </details>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={saveTask}
            disabled={savingTask || !taskDescription.trim()}
            className="bg-accent text-ink-950 text-sm font-bold rounded-full px-5 py-2 disabled:opacity-50 hover:brightness-105 active:scale-95 transition"
          >
            {savingTask ? "saving…" : "lock it in →"}
          </button>
          {taskSaved && (
            <span className="text-xs text-grass font-medium animate-pop-in">
              locked in ✓
            </span>
          )}
        </div>
      </section>

      {/* Writing surface */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink-100 flex items-center gap-2">
            <span>✍️</span> Your draft
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-500 font-mono">
              {wordCount} words
            </span>
            <button
              onClick={() => runFocusCheck(true)}
              className="text-xs font-medium text-accent hover:text-accent-soft"
            >
              check me now ⚡
            </button>
            <button
              onClick={runFactCheck}
              disabled={factChecking}
              className="text-xs font-bold bg-sky/15 text-sky rounded-full px-3 py-1 hover:bg-sky/25 disabled:opacity-60"
            >
              {factChecking ? "fact-checking…" : "🔎 fact-check"}
            </button>
            <button
              onClick={runSuggestSources}
              disabled={suggesting}
              className="text-xs font-bold bg-grass/15 text-grass rounded-full px-3 py-1 hover:bg-grass/25 disabled:opacity-60"
            >
              {suggesting ? "finding…" : "📚 suggested reading"}
            </button>
            <button
              onClick={openSaveSignal}
              className="text-xs font-bold bg-ink-800 text-ink-200 rounded-full px-3 py-1 hover:bg-ink-700"
            >
              💾 save as signal
            </button>
            <button
              onClick={() => {
                setShowBiblio(true);
                setBiblioEntries(null);
                setBiblioMessage("");
              }}
              className="text-xs font-bold bg-ink-800 text-ink-200 rounded-full px-3 py-1 hover:bg-ink-700"
            >
              🔖 bibliography
            </button>
          </div>
        </div>

        <div className="relative">
          {/* Highlight backdrop (behind the transparent textarea). */}
          {factResults && writing === factCheckedText && (
            <div
              ref={backdropRef}
              aria-hidden
              className="absolute inset-0 overflow-auto rounded-3xl border border-transparent bg-ink-900 text-transparent px-6 py-5 text-[16px] leading-8 whitespace-pre-wrap break-words pointer-events-none"
              dangerouslySetInnerHTML={{
                __html: buildHighlightHtml(writing, factResults),
              }}
            />
          )}
          <textarea
            ref={textareaRef}
            value={writing}
            onChange={(e) => onWritingChange(e.target.value)}
            onScroll={() => {
              if (backdropRef.current && textareaRef.current) {
                backdropRef.current.scrollTop = textareaRef.current.scrollTop;
                backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
              }
            }}
            placeholder="Start writing… I'll pop in if you wander off-topic, fact-check against your notes, and offer to build tables when you pause. Just vibe. ✨"
            rows={18}
            className="relative w-full bg-ink-900 border border-ink-800 rounded-3xl px-6 py-5 text-[16px] leading-8 focus:outline-none focus:border-ink-600 resize-y shadow-inner"
            style={
              factResults && writing === factCheckedText
                ? { background: "transparent" }
                : undefined
            }
          />
        </div>
        {factResults && factResults.length > 0 && writing === factCheckedText ? (
          <p className="text-center text-[11px] text-ink-500">
            🔎 <span className="text-coral">●</span> wrong ·{" "}
            <span style={{ color: "#ff8a4c" }}>●</span> overclaimed ·{" "}
            <span className="text-accent">●</span> needs source / unverified ·{" "}
            <span className="text-grass">●</span> checks out — edit to clear
          </p>
        ) : (
          <p className="text-center text-[11px] text-ink-600">
            auto-checks every 30s · table radar fires when you pause for 3s
          </p>
        )}
      </section>

      {/* Drift popup */}
      <PopOver
        open={popup?.kind === "drift"}
        tone="amber"
        emoji="🧭"
        kicker="off the rails?"
        title="Heads up — this is drifting off-track."
        onClose={() => setPopup(null)}
        actions={
          <>
            <button
              onClick={() => setPopup(null)}
              className="text-sm font-medium border border-ink-700 rounded-full px-4 py-2 text-ink-300 hover:text-ink-100"
            >
              it&apos;s intentional
            </button>
            <button
              onClick={() => setPopup(null)}
              className="text-sm font-bold bg-accent text-ink-950 rounded-full px-4 py-2 active:scale-95 transition"
            >
              got it, refocusing
            </button>
          </>
        }
      >
        {popup?.kind === "drift" && popup.reason && (
          <p className="text-sm text-ink-400 text-center leading-relaxed">
            {popup.reason}
          </p>
        )}
      </PopOver>

      {/* Fact-check popup */}
      <PopOver
        open={popup?.kind === "fact"}
        tone="coral"
        emoji="🔍"
        kicker="fact check"
        title="Wait — this might not be right."
        onClose={() => setPopup(null)}
        actions={
          <>
            <button
              onClick={() => setPopup(null)}
              className="text-sm font-medium border border-ink-700 rounded-full px-4 py-2 text-ink-300 hover:text-ink-100"
            >
              intentional divergence
            </button>
            <button
              onClick={() => setPopup(null)}
              className="text-sm font-bold bg-coral text-ink-950 rounded-full px-4 py-2 active:scale-95 transition"
            >
              I&apos;ll double-check
            </button>
          </>
        }
      >
        {popup?.kind === "fact" && (
          <div className="text-sm text-ink-300 text-center leading-relaxed space-y-3">
            {popup.claim && (
              <p>
                You wrote{" "}
                <span className="bg-ink-800 text-ink-100 px-1 rounded line-through decoration-coral/70">
                  “{popup.claim}”
                </span>
              </p>
            )}
            <div className="bg-grass/10 border border-grass/30 rounded-2xl px-4 py-3 text-left">
              <p className="text-[11px] uppercase tracking-wider text-grass font-bold mb-1">
                ✅ the right answer
              </p>
              <p className="text-ink-100">{popup.correction}</p>
              {popup.source && (
                <a
                  href={popup.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-sky hover:underline break-all"
                >
                  📚 {popup.source.title}
                </a>
              )}
            </div>
          </div>
        )}
      </PopOver>

      {/* Auto-table popup */}
      <PopOver
        open={popup?.kind === "table"}
        tone="yellow"
        emoji="📊"
        kicker="ooh, a table?"
        title="This is comparing a few things — want a table?"
        wide
        onClose={() => setPopup(null)}
        actions={
          popup?.kind === "table" ? (
            <>
              <button
                onClick={() => copyTable(popup.table)}
                className="text-sm font-medium border border-ink-700 rounded-full px-4 py-2 text-ink-300 hover:text-ink-100"
              >
                {copied ? "copied ✓" : "copy markdown"}
              </button>
              <button
                onClick={() => insertTable(popup.table)}
                className="text-sm font-bold bg-accent text-ink-950 rounded-full px-4 py-2 active:scale-95 transition"
              >
                drop it in ↓
              </button>
            </>
          ) : null
        }
      >
        {popup?.kind === "table" && (
          <div className="overflow-auto rounded-2xl border border-ink-800 max-h-72">
            <table className="w-full text-sm font-mono border-collapse">
              <thead className="bg-ink-850 sticky top-0">
                <tr>
                  {(popup.table.headers ?? []).map((h, i) => (
                    <th
                      key={i}
                      className="text-left px-3 py-2 text-accent font-bold whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(popup.table.rows ?? []).map((row, ri) => (
                  <tr key={ri} className="even:bg-ink-850/40">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-3 py-2 text-ink-200 border-t border-ink-800 align-top"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PopOver>

      {/* Deep fact-check results modal */}
      {showFactModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6 bg-ink-950/70 backdrop-blur-sm animate-backdrop-in"
          onClick={() => setShowFactModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-ink-900 border-2 border-sky/40 rounded-3xl p-6 animate-pop-in max-h-[80vh] overflow-auto"
          >
            <button
              onClick={() => setShowFactModal(false)}
              className="absolute top-3 right-4 text-ink-500 hover:text-ink-200 text-lg"
            >
              ×
            </button>
            <div className="text-center mb-4">
              <div className="text-3xl mb-1">🔎</div>
              <h3 className="text-lg font-bold">Fact-check</h3>
              <p className="text-xs text-ink-400 mt-1">
                Checked against your notes + the web.
              </p>
            </div>

            {factChecking && (
              <p className="text-sm text-ink-400 text-center py-8">
                extracting claims → searching the web → verifying…
              </p>
            )}

            {!factChecking && factMessage && (!factResults || factResults.length === 0) && (
              <p className="text-sm text-ink-300 text-center py-6">{factMessage}</p>
            )}

            {!factChecking && factResults && factResults.length > 0 && (
              <div className="space-y-2.5">
                {factResults.map((r, i) => (
                  <FactResultCard
                    key={i}
                    r={r}
                    onUseSuggestion={useSuggestion}
                    onDismiss={(x) =>
                      setFactResults((prev) =>
                        prev ? prev.filter((y) => y !== x) : prev
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save-as-signal popup */}
      <PopOver
        open={showSaveSignal}
        tone="yellow"
        emoji="💾"
        kicker="save to research"
        title="Save this as a signal"
        onClose={() => setShowSaveSignal(false)}
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-400 text-center">
            Filing your own writing into a project — it&apos;ll be summarised and
            connected like any captured signal.
          </p>
          <textarea
            value={saveSignalText}
            onChange={(e) => setSaveSignalText(e.target.value)}
            rows={4}
            className="w-full bg-ink-850 border border-ink-700 rounded-2xl px-3 py-2 text-sm focus:outline-none focus:border-accent resize-y"
          />
          <div className="flex items-center gap-2">
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) saveOwnSignal(e.target.value);
              }}
              className="flex-1 bg-ink-850 border border-ink-700 rounded-full px-3 py-2 text-sm focus:outline-none focus:border-accent"
            >
              <option value="">save to project →</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              <option value="__unfiled__">Unfiled</option>
            </select>
            {saveSignalStatus && (
              <span className="text-xs text-grass whitespace-nowrap">
                {saveSignalStatus}
              </span>
            )}
          </div>
        </div>
      </PopOver>

      {/* Bibliography modal */}
      {showBiblio && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6 bg-ink-950/70 backdrop-blur-sm animate-backdrop-in"
          onClick={() => setShowBiblio(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-ink-900 border-2 border-ink-700 rounded-3xl p-6 animate-pop-in max-h-[80vh] overflow-auto"
          >
            <button
              onClick={() => setShowBiblio(false)}
              className="absolute top-3 right-4 text-ink-500 hover:text-ink-200 text-lg"
            >
              ×
            </button>
            <div className="text-center mb-4">
              <div className="text-3xl mb-1">🔖</div>
              <h3 className="text-lg font-bold">Bibliography</h3>
              <p className="text-xs text-ink-400 mt-1">
                Formatted from a project&apos;s cited sources.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 justify-center mb-4">
              <select
                value={biblioProject}
                onChange={(e) => setBiblioProject(e.target.value)}
                className="text-xs bg-ink-850 border border-ink-700 rounded-full px-3 py-1.5 focus:outline-none focus:border-accent"
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="flex rounded-full border border-ink-700 overflow-hidden">
                {(["apa", "mla", "chicago"] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setBiblioStyle(st)}
                    className={`text-xs px-3 py-1.5 ${
                      biblioStyle === st
                        ? "bg-accent text-ink-950 font-bold"
                        : "text-ink-300 hover:text-ink-100"
                    }`}
                  >
                    {st.toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={() => runBibliography()}
                disabled={biblioLoading}
                className="text-xs font-bold bg-accent text-ink-950 rounded-full px-4 py-1.5 disabled:opacity-60"
              >
                {biblioLoading ? "building…" : "generate"}
              </button>
            </div>

            {biblioMessage && (!biblioEntries || biblioEntries.length === 0) && (
              <p className="text-sm text-ink-300 text-center py-6">{biblioMessage}</p>
            )}

            {biblioEntries && biblioEntries.length > 0 && (
              <>
                <div className="space-y-2 text-sm text-ink-200 leading-relaxed">
                  {biblioEntries.map((e, i) => (
                    <p key={i} className="pl-6 -indent-6">
                      {e}
                    </p>
                  ))}
                </div>
                <div className="flex justify-end mt-4">
                  <button
                    onClick={copyBiblio}
                    className="text-sm border border-ink-700 rounded-full px-4 py-1.5 text-ink-300 hover:text-ink-100"
                  >
                    {biblioCopied ? "copied ✓" : "copy all"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Suggested reading modal */}
      {showSuggestModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center px-6 bg-ink-950/70 backdrop-blur-sm animate-backdrop-in"
          onClick={() => setShowSuggestModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-ink-900 border-2 border-grass/40 rounded-3xl p-6 animate-pop-in max-h-[80vh] overflow-auto"
          >
            <button
              onClick={() => setShowSuggestModal(false)}
              className="absolute top-3 right-4 text-ink-500 hover:text-ink-200 text-lg"
            >
              ×
            </button>
            <div className="text-center mb-4">
              <div className="text-3xl mb-1">📚</div>
              <h3 className="text-lg font-bold">Suggested reading</h3>
              <p className="text-xs text-ink-400 mt-1">
                Sources worth reading for what you&apos;re working on.
              </p>
            </div>

            {suggesting && (
              <p className="text-sm text-ink-400 text-center py-8">
                finding reading angles → searching → picking the best…
              </p>
            )}

            {!suggesting && suggestMessage && (!suggestions || suggestions.length === 0) && (
              <p className="text-sm text-ink-300 text-center py-6">{suggestMessage}</p>
            )}

            {!suggesting && suggestions && suggestions.length > 0 && (
              <div className="space-y-2.5">
                {suggestions.map((s, i) => (
                  <SuggestionCard
                    key={i}
                    s={s}
                    projects={projects}
                    onSave={saveSuggestion}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
