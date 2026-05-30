"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export default function FocusPage() {
  // Task context ------------------------------------------------------------
  const [taskDescription, setTaskDescription] = useState("");
  const [emailThread, setEmailThread] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [taskSaved, setTaskSaved] = useState(false);

  // Gmail -------------------------------------------------------------------
  const [gmailConnected, setGmailConnected] = useState(false);
  const [gmailEmail, setGmailEmail] = useState<string | null>(null);
  const [pullingThread, setPullingThread] = useState(false);

  // Writing surface ---------------------------------------------------------
  const [writing, setWriting] = useState("");
  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [driftDismissed, setDriftDismissed] = useState(false);
  const [contradiction, setContradiction] = useState<ContradictionResult | null>(null);
  const [contradictionDismissed, setContradictionDismissed] = useState(false);

  // Auto-table --------------------------------------------------------------
  const [table, setTable] = useState<TableResult | null>(null);
  const [showTableModal, setShowTableModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const writingRef = useRef(writing);
  writingRef.current = writing;

  // Load existing task context + gmail status on mount.
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
  }, []);

  // Listen for the OAuth popup completion.
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

  // Behaviour 2: drift + fact guard every 30s.
  const runFocusCheck = useCallback(async () => {
    const text = writingRef.current.trim();
    if (text.length < 20) return;
    try {
      const res = await fetch("/api/focus/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writing: text }),
      });
      const d = await res.json();
      if (d.drift?.off_track) {
        setDrift(d.drift);
        setDriftDismissed(false);
      } else {
        setDrift(null);
      }
      if (d.contradiction?.found) {
        setContradiction(d.contradiction);
        setContradictionDismissed(false);
      } else {
        setContradiction(null);
      }
    } catch {
      /* ignore transient failures */
    }
  }, []);

  useEffect(() => {
    const id = setInterval(runFocusCheck, 30_000);
    return () => clearInterval(id);
  }, [runFocusCheck]);

  // Behaviour 3: auto-table after a 3s pause.
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onWritingChange(value: string) {
    setWriting(value);
    setTaskSaved(false);
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
        setTable(d.is_table ? d : null);
      } catch {
        /* ignore */
      }
    }, 3000);
  }

  function insertTable() {
    if (!table?.markdown) return;
    setWriting((prev) => `${prev.trimEnd()}\n\n${table.markdown}\n`);
    setTable(null);
    setShowTableModal(false);
  }

  function copyTable() {
    if (!table?.markdown) return;
    navigator.clipboard.writeText(table.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-8 cx-fade">
      <div>
        <h1 className="text-xl font-semibold">Focus</h1>
        <p className="text-ink-400 text-sm mt-1">
          Set your task, then write. Cortex watches for drift, factual conflicts,
          and structure worth tabling.
        </p>
      </div>

      {/* Task context ------------------------------------------------------ */}
      <section className="bg-ink-900 border border-ink-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-200">Current task</h2>
          <div className="flex items-center gap-2">
            {gmailConnected ? (
              <button
                onClick={pullThread}
                disabled={pullingThread}
                className="text-xs border border-ink-700 rounded-md px-2.5 py-1 text-ink-300 hover:text-ink-100 disabled:opacity-60"
              >
                {pullingThread ? "Pulling…" : "Pull recent thread"}
              </button>
            ) : (
              <button
                onClick={connectGmail}
                className="text-xs border border-ink-700 rounded-md px-2.5 py-1 text-ink-300 hover:text-ink-100"
              >
                Connect Gmail
              </button>
            )}
          </div>
        </div>
        {gmailConnected && gmailEmail && (
          <p className="text-xs text-ink-500 font-mono">Gmail: {gmailEmail}</p>
        )}
        <textarea
          value={taskDescription}
          onChange={(e) => setTaskDescription(e.target.value)}
          placeholder="Paste an email or note describing what you're working on and your priorities…"
          rows={4}
          className="w-full bg-ink-850 border border-ink-700 rounded-md px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-accent resize-y"
        />
        {emailThread && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-400 hover:text-ink-200 text-xs">
              Linked email thread ({emailThread.length} chars)
            </summary>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap bg-ink-850 border border-ink-800 rounded-md p-3 text-xs text-ink-300 font-mono">
              {emailThread}
            </pre>
          </details>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={saveTask}
            disabled={savingTask || !taskDescription.trim()}
            className="bg-accent text-ink-950 text-sm font-semibold rounded-md px-4 py-1.5 disabled:opacity-50"
          >
            {savingTask ? "Saving…" : "Set task"}
          </button>
          {taskSaved && <span className="text-xs text-accent">Saved.</span>}
        </div>
      </section>

      {/* Writing surface --------------------------------------------------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-200">Writing</h2>
          <button
            onClick={runFocusCheck}
            className="text-xs text-ink-500 hover:text-ink-300"
          >
            Check now
          </button>
        </div>

        {/* Drift banner */}
        {drift?.off_track && !driftDismissed && (
          <div className="flex items-start justify-between gap-3 bg-ink-850 border border-ink-700 border-l-2 border-l-accent rounded-md px-4 py-2.5 text-sm cx-fade">
            <div>
              <span className="text-ink-100">
                Heads up — this looks off-track. Still relevant?
              </span>
              {drift.reason && (
                <span className="block text-ink-400 text-xs mt-0.5">
                  {drift.reason}
                </span>
              )}
            </div>
            <button
              onClick={() => setDriftDismissed(true)}
              className="text-ink-500 hover:text-ink-300 text-xs whitespace-nowrap"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Contradiction banner */}
        {contradiction?.found && !contradictionDismissed && (
          <div className="flex items-start justify-between gap-3 bg-ink-850 border border-ink-700 border-l-2 border-l-red-500 rounded-md px-4 py-2.5 text-sm cx-fade">
            <div>
              <span className="text-ink-100">
                This might not be right — your earlier note says{" "}
                <span className="italic text-ink-300">
                  “{contradiction.note_text}”
                </span>
                . Want to double-check?
              </span>
            </div>
            <div className="flex flex-col items-end gap-1 whitespace-nowrap">
              <button
                onClick={() => setContradictionDismissed(true)}
                className="text-ink-500 hover:text-ink-300 text-xs"
              >
                Dismiss
              </button>
              <button
                onClick={() => setContradictionDismissed(true)}
                className="text-ink-500 hover:text-ink-300 text-xs"
              >
                Intentional divergence
              </button>
            </div>
          </div>
        )}

        <textarea
          value={writing}
          onChange={(e) => onWritingChange(e.target.value)}
          placeholder="Start writing… Cortex reviews for drift and factual conflicts every 30s, and suggests tables when you pause."
          rows={16}
          className="w-full bg-ink-900 border border-ink-800 rounded-xl px-5 py-4 text-[15px] leading-7 font-sans focus:outline-none focus:border-ink-600 resize-y"
        />

        {/* Auto-table suggestion */}
        {table?.is_table && (
          <div className="flex items-center justify-between bg-ink-850 border border-ink-800 rounded-md px-4 py-2.5 text-sm cx-fade">
            <span className="text-ink-300">
              This looks like it could be a table.
            </span>
            <button
              onClick={() => setShowTableModal(true)}
              className="text-accent hover:underline text-sm"
            >
              Preview
            </button>
          </div>
        )}
      </section>

      {/* Table modal */}
      {showTableModal && table?.is_table && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center px-6"
          onClick={() => setShowTableModal(false)}
        >
          <div
            className="bg-ink-900 border border-ink-700 rounded-xl p-6 max-w-2xl w-full cx-fade"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-ink-200 mb-4">
              Table preview
            </h3>
            <div className="overflow-auto">
              <table className="w-full text-sm font-mono border-collapse">
                <thead>
                  <tr>
                    {(table.headers ?? []).map((h, i) => (
                      <th
                        key={i}
                        className="text-left border-b border-ink-700 px-3 py-2 text-ink-300 font-medium"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(table.rows ?? []).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((cell, ci) => (
                        <td
                          key={ci}
                          className="border-b border-ink-800 px-3 py-2 text-ink-200"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={copyTable}
                className="text-sm border border-ink-700 rounded-md px-3 py-1.5 text-ink-300 hover:text-ink-100"
              >
                {copied ? "Copied" : "Copy markdown"}
              </button>
              <button
                onClick={insertTable}
                className="text-sm bg-accent text-ink-950 font-semibold rounded-md px-3 py-1.5"
              >
                Insert into text
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
