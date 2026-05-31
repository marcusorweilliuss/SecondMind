"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PopOver from "@/components/PopOver";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Office: any;
    Word: any;
  }
}

type TableResult = {
  is_table: boolean;
  headers?: string[];
  rows?: string[][];
  markdown?: string;
};
type Project = { id: string; name: string };

type Popup =
  | { kind: "drift"; reason: string }
  | { kind: "fact"; note_text: string; claim: string }
  | { kind: "table"; table: TableResult }
  | null;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export default function WordPanel() {
  const [officeReady, setOfficeReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<string>("");

  const [popup, setPopup] = useState<Popup>(null);
  const [statusLine, setStatusLine] = useState("waiting for your draft…");
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signalMsg, setSignalMsg] = useState("");

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const popupRef = useRef<Popup>(null);
  popupRef.current = popup;

  const tryOpen = useCallback((p: Popup) => {
    if (!popupRef.current) setPopup(p);
  }, []);

  // 1. Load Office.js once.
  useEffect(() => {
    const ready = () => window.Office.onReady(() => setOfficeReady(true));
    if (window.Office) {
      ready();
      return;
    }
    const existing = document.getElementById(
      "office-js"
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", ready);
      return;
    }
    const s = document.createElement("script");
    s.id = "office-js";
    s.src = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
    s.onload = ready;
    document.head.appendChild(s);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("cortex_word_token");
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch("/api/projects", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setProjects(d.projects ?? []);
        const saved = localStorage.getItem("cortex_word_project");
        if (saved) setActiveProject(saved);
      })
      .catch(() => {});
  }, [token]);

  // --- Auth ---------------------------------------------------------------
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error_description || d.msg || "Sign-in failed.");
      }
      const d = await res.json();
      localStorage.setItem("cortex_word_token", d.access_token);
      setToken(d.access_token);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  function signOut() {
    localStorage.removeItem("cortex_word_token");
    setToken(null);
    setProjects([]);
  }

  // --- Read the Word document --------------------------------------------
  const readDocText = useCallback(async (): Promise<string> => {
    return new Promise((resolve) => {
      try {
        window.Word.run(async (context: any) => {
          const body = context.document.body;
          body.load("text");
          await context.sync();
          resolve(body.text || "");
        }).catch(() => resolve(""));
      } catch {
        resolve("");
      }
    });
  }, []);

  // --- Behaviour 2: drift + fact guard -----------------------------------
  const runFocusCheck = useCallback(async () => {
    if (!tokenRef.current) return;
    const text = (await readDocText()).trim();
    const words = text ? text.split(/\s+/).length : 0;
    if (text.length < 20) {
      setStatusLine("✍️ write a bit more and I'll start checking…");
      return;
    }
    setChecking(true);
    setStatusLine("🧠 reading your draft…");
    try {
      const res = await fetch("/api/focus/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ writing: text }),
      });
      if (!res.ok) {
        setStatusLine(`⚠️ check failed (${res.status})`);
        return;
      }
      const d = await res.json();
      if (d.contradiction?.found && d.contradiction.note_text) {
        setStatusLine(`🔍 found a possible factual conflict · ${words} words`);
        tryOpen({
          kind: "fact",
          note_text: d.contradiction.note_text,
          claim: d.contradiction.claim || "",
        });
      } else if (d.drift?.off_track) {
        setStatusLine(`🧭 looks off-track · ${words} words`);
        tryOpen({ kind: "drift", reason: d.drift.reason });
      } else {
        setStatusLine(`✓ on track · ${words} words`);
      }
    } catch (e) {
      setStatusLine(`⚠️ ${String(e).slice(0, 80)}`);
    } finally {
      setChecking(false);
    }
  }, [readDocText, tryOpen]);

  // --- Behaviour 3: auto-table -------------------------------------------
  const runAutoTable = useCallback(async () => {
    if (!tokenRef.current) return;
    const text = (await readDocText()).trim();
    if (text.split(/\s+/).length < 25) return;
    try {
      const res = await fetch("/api/autotable", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ text }),
      });
      const d: TableResult = await res.json();
      if (d.is_table) tryOpen({ kind: "table", table: d });
    } catch {
      /* ignore */
    }
  }, [readDocText, tryOpen]);

  // Run once as soon as Word + auth are ready.
  useEffect(() => {
    if (officeReady && token) runFocusCheck();
  }, [officeReady, token, runFocusCheck]);

  // Safety-net 30s loop.
  useEffect(() => {
    if (!officeReady || !token) return;
    const id = setInterval(runFocusCheck, 30_000);
    return () => clearInterval(id);
  }, [officeReady, token, runFocusCheck]);

  // Idle detector: poll the doc; when it stops changing for 3s, run both the
  // focus check and the table check automatically — no button needed.
  const lastText = useRef("");
  const lastChange = useRef(0);
  const lastScan = useRef(0);
  useEffect(() => {
    if (!officeReady || !token) return;
    const id = setInterval(async () => {
      const text = await readDocText();
      const now = Date.now();
      if (text !== lastText.current) {
        lastText.current = text;
        lastChange.current = now;
        return;
      }
      if (
        lastChange.current &&
        now - lastChange.current >= 3000 &&
        lastChange.current > lastScan.current
      ) {
        lastScan.current = now;
        runFocusCheck();
        runAutoTable();
      }
    }, 1500);
    return () => clearInterval(id);
  }, [officeReady, token, readDocText, runFocusCheck, runAutoTable]);

  // --- Insert table into Word --------------------------------------------
  async function insertTable(table: TableResult) {
    if (!table.headers) return;
    const headers = table.headers;
    const rows = table.rows ?? [];
    try {
      await window.Word.run(async (context: any) => {
        const values = [headers, ...rows];
        const wordTable = context.document.body.insertTable(
          values.length,
          headers.length,
          window.Word.InsertLocation.end,
          values
        );
        wordTable.styleBuiltIn = window.Word.BuiltInStyleName.gridTable4_Accent1;
        await context.sync();
      });
      setPopup(null);
      setStatusLine("📊 table inserted ✓");
    } catch {
      setStatusLine("⚠️ couldn't insert table");
    }
  }

  function copyTable(table: TableResult) {
    if (!table.markdown) return;
    navigator.clipboard.writeText(table.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // --- Behaviour 1: capture the current selection as a signal ------------
  async function captureSelection() {
    if (!tokenRef.current) return;
    window.Office.context.document.getSelectedDataAsync(
      window.Office.CoercionType.Text,
      async (result: any) => {
        const text = (result?.value || "").trim();
        if (!text) {
          setSignalMsg("Select some text in the doc first ✍️");
          setTimeout(() => setSignalMsg(""), 2500);
          return;
        }
        setSignalMsg("saving…");
        try {
          const res = await fetch("/api/signals", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenRef.current}`,
            },
            body: JSON.stringify({
              highlight_text: text,
              source_title: "Microsoft Word",
              project_id: activeProject || null,
            }),
          });
          const d = await res.json();
          setSignalMsg(
            res.ok
              ? d.signal?.connected_to
                ? `saved · ${d.signal.connected_to}`
                : "signal saved ✓"
              : d.error || "save failed"
          );
        } catch {
          setSignalMsg("save failed");
        }
        setTimeout(() => setSignalMsg(""), 5000);
      }
    );
  }

  // --- UI -----------------------------------------------------------------
  if (!token) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-100 p-4">
        <Header />
        <form onSubmit={signIn} className="space-y-3 mt-4">
          <p className="text-xs text-ink-400">
            Sign in with your Cortex account to watch this doc for drift, wrong
            facts, and tables.
          </p>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-ink-850 border border-ink-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-ink-850 border border-ink-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          {authError && <p className="text-xs text-coral">{authError}</p>}
          <button
            type="submit"
            disabled={authLoading}
            className="w-full bg-accent text-ink-950 font-bold rounded-full py-2.5 text-sm disabled:opacity-60"
          >
            {authLoading ? "signing in…" : "let's go →"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 p-4 space-y-4">
      <Header onSignOut={signOut} />

      {!officeReady && (
        <p className="text-xs text-ink-500">connecting to Word…</p>
      )}

      {/* Always-visible live status */}
      <div
        className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-xs font-medium border ${
          checking
            ? "bg-accent/10 border-accent/40 text-accent"
            : "bg-ink-900 border-ink-800 text-ink-300"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            checking ? "bg-accent animate-pulse" : "bg-grass"
          }`}
        />
        {statusLine}
      </div>

      <p className="text-[11px] text-ink-500 leading-relaxed">
        I check automatically as you type (and every 30s). Set your task in the
        Cortex web app so I can catch when you drift off-topic.
      </p>

      {/* Active project + signal capture */}
      <div className="space-y-2">
        <label className="block text-[10px] uppercase tracking-wider text-ink-400">
          Active project
        </label>
        <select
          value={activeProject}
          onChange={(e) => {
            setActiveProject(e.target.value);
            localStorage.setItem("cortex_word_project", e.target.value);
          }}
          className="w-full bg-ink-850 border border-ink-700 rounded-xl px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
        >
          <option value="">Unfiled</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          onClick={runFocusCheck}
          disabled={checking || !officeReady}
          className="flex-1 text-xs font-medium border border-ink-700 rounded-full px-2 py-2 text-ink-200 hover:text-ink-100 disabled:opacity-50"
        >
          ⚡ check now
        </button>
        <button
          onClick={captureSelection}
          disabled={!officeReady}
          className="flex-1 text-xs font-medium border border-ink-700 rounded-full px-2 py-2 text-ink-200 hover:text-ink-100 disabled:opacity-50"
        >
          💾 save highlight
        </button>
      </div>
      {signalMsg && <p className="text-[11px] text-ink-400">{signalMsg}</p>}

      {/* Pop-ups (centered within the task pane) */}
      <PopOver
        open={popup?.kind === "drift"}
        tone="amber"
        emoji="🧭"
        kicker="off the rails?"
        title="This is drifting off-track."
        onClose={() => setPopup(null)}
        actions={
          <>
            <button
              onClick={() => setPopup(null)}
              className="text-xs font-medium border border-ink-700 rounded-full px-3 py-1.5 text-ink-300"
            >
              intentional
            </button>
            <button
              onClick={() => setPopup(null)}
              className="text-xs font-bold bg-accent text-ink-950 rounded-full px-3 py-1.5"
            >
              refocusing
            </button>
          </>
        }
      >
        {popup?.kind === "drift" && popup.reason && (
          <p className="text-xs text-ink-400 text-center">{popup.reason}</p>
        )}
      </PopOver>

      <PopOver
        open={popup?.kind === "fact"}
        tone="coral"
        emoji="🔍"
        kicker="fact check"
        title="Wait — this might not be right."
        onClose={() => setPopup(null)}
        actions={
          <button
            onClick={() => setPopup(null)}
            className="text-xs font-bold bg-coral text-ink-950 rounded-full px-3 py-1.5"
          >
            I&apos;ll double-check
          </button>
        }
      >
        {popup?.kind === "fact" && (
          <div className="text-xs text-ink-300 text-center space-y-2">
            {popup.claim && (
              <p>
                You wrote{" "}
                <span className="bg-ink-800 text-ink-100 px-1 rounded">
                  “{popup.claim}”
                </span>
              </p>
            )}
            <p>
              but your note says{" "}
              <span className="bg-coral/20 text-coral px-1 rounded">
                “{popup.note_text}”
              </span>
            </p>
          </div>
        )}
      </PopOver>

      <PopOver
        open={popup?.kind === "table"}
        tone="yellow"
        emoji="📊"
        kicker="ooh, a table?"
        title="Want this as a table?"
        wide
        onClose={() => setPopup(null)}
        actions={
          popup?.kind === "table" ? (
            <>
              <button
                onClick={() => copyTable(popup.table)}
                className="text-xs font-medium border border-ink-700 rounded-full px-3 py-1.5 text-ink-300"
              >
                {copied ? "copied ✓" : "copy md"}
              </button>
              <button
                onClick={() => insertTable(popup.table)}
                className="text-xs font-bold bg-accent text-ink-950 rounded-full px-3 py-1.5"
              >
                drop it in ↓
              </button>
            </>
          ) : null
        }
      >
        {popup?.kind === "table" && (
          <div className="overflow-auto rounded-xl border border-ink-800 max-h-56">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead className="bg-ink-850">
                <tr>
                  {(popup.table.headers ?? []).map((h, i) => (
                    <th key={i} className="text-left px-2 py-1 text-accent font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(popup.table.rows ?? []).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-2 py-1 text-ink-200 border-t border-ink-800 align-top"
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
    </div>
  );
}

function Header({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 font-black tracking-tight text-accent">
        <span>🧠</span> cortex
      </span>
      {onSignOut && (
        <button
          onClick={onSignOut}
          className="text-[10px] text-ink-500 hover:text-ink-300 border border-ink-700 rounded-full px-2 py-0.5"
        >
          sign out
        </button>
      )}
    </div>
  );
}
