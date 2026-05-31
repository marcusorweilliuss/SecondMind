"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    Office: any;
    Word: any;
  }
}

type DriftResult = { off_track: boolean; reason: string };
type ContradictionResult = {
  found: boolean;
  claim: string;
  note_text: string;
};
type TableResult = {
  is_table: boolean;
  headers?: string[];
  rows?: string[][];
  markdown?: string;
};
type Project = { id: string; name: string };

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

  const [drift, setDrift] = useState<DriftResult | null>(null);
  const [driftDismissed, setDriftDismissed] = useState(false);
  const [contradiction, setContradiction] = useState<ContradictionResult | null>(null);
  const [contradictionDismissed, setContradictionDismissed] = useState(false);
  const [table, setTable] = useState<TableResult | null>(null);
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState(false);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  // 1. Load Office.js and wait for the host to be ready.
  useEffect(() => {
    if (window.Office) {
      window.Office.onReady(() => setOfficeReady(true));
      return;
    }
    const s = document.createElement("script");
    s.src = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
    s.onload = () => window.Office.onReady(() => setOfficeReady(true));
    document.body.appendChild(s);
  }, []);

  // Restore a saved session token.
  useEffect(() => {
    const saved = localStorage.getItem("cortex_word_token");
    if (saved) setToken(saved);
  }, []);

  // Load projects once authenticated.
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
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ email, password }),
        }
      );
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
    if (text.length < 20) return;
    setChecking(true);
    try {
      const res = await fetch("/api/focus/check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ writing: text }),
      });
      const d = await res.json();
      if (d.drift?.off_track) {
        setDrift(d.drift);
        setDriftDismissed(false);
      } else setDrift(null);
      if (d.contradiction?.found) {
        setContradiction(d.contradiction);
        setContradictionDismissed(false);
      } else setContradiction(null);
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }, [readDocText]);

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
      setTable(d.is_table ? d : null);
    } catch {
      /* ignore */
    }
  }, [readDocText]);

  // 30s focus loop.
  useEffect(() => {
    if (!officeReady || !token) return;
    const id = setInterval(runFocusCheck, 30_000);
    return () => clearInterval(id);
  }, [officeReady, token, runFocusCheck]);

  // 3s-pause auto-table: poll the doc; when text stops changing for 3s, scan.
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
      // Unchanged. If it's been >= 3s since the last change and we haven't
      // scanned this idle period, run the table check.
      if (
        lastChange.current &&
        now - lastChange.current >= 3000 &&
        lastChange.current > lastScan.current
      ) {
        lastScan.current = now;
        runAutoTable();
      }
    }, 1500);
    return () => clearInterval(id);
  }, [officeReady, token, readDocText, runAutoTable]);

  // --- Insert table into Word --------------------------------------------
  async function insertTable() {
    if (!table?.headers) return;
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
      setTable(null);
      setStatus("Table inserted.");
      setTimeout(() => setStatus(""), 2500);
    } catch {
      setStatus("Could not insert table.");
    }
  }

  function copyTable() {
    if (!table?.markdown) return;
    navigator.clipboard.writeText(table.markdown);
    setStatus("Markdown copied.");
    setTimeout(() => setStatus(""), 2000);
  }

  // --- Behaviour 1: capture the current selection as a signal ------------
  async function captureSelection() {
    if (!tokenRef.current) return;
    window.Office.context.document.getSelectedDataAsync(
      window.Office.CoercionType.Text,
      async (result: any) => {
        const text = (result?.value || "").trim();
        if (!text) {
          setStatus("Select some text first.");
          setTimeout(() => setStatus(""), 2500);
          return;
        }
        setStatus("Saving signal…");
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
          if (res.ok) {
            setStatus(
              d.signal?.connected_to
                ? `Saved · ${d.signal.connected_to}`
                : "Signal saved."
            );
          } else {
            setStatus(d.error || "Save failed.");
          }
        } catch {
          setStatus("Save failed.");
        }
        setTimeout(() => setStatus(""), 5000);
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
            Sign in with your Cortex account to bring the focus, fact-check, and
            table tools into Word.
          </p>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full bg-ink-850 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-ink-850 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          {authError && <p className="text-xs text-red-400">{authError}</p>}
          <button
            type="submit"
            disabled={authLoading}
            className="w-full bg-accent text-ink-950 font-semibold rounded-md py-2 text-sm disabled:opacity-60"
          >
            {authLoading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 p-4 space-y-4">
      <Header onSignOut={signOut} />

      {!officeReady && (
        <p className="text-xs text-ink-500">Connecting to Word…</p>
      )}

      {/* Active project for captured signals */}
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-ink-400 mb-1">
          Active project
        </label>
        <select
          value={activeProject}
          onChange={(e) => {
            setActiveProject(e.target.value);
            localStorage.setItem("cortex_word_project", e.target.value);
          }}
          className="w-full bg-ink-850 border border-ink-700 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
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
          className="flex-1 text-xs border border-ink-700 rounded-md px-2 py-1.5 text-ink-200 hover:text-ink-100 disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check now"}
        </button>
        <button
          onClick={captureSelection}
          disabled={!officeReady}
          className="flex-1 text-xs border border-ink-700 rounded-md px-2 py-1.5 text-ink-200 hover:text-ink-100 disabled:opacity-50"
        >
          Save selection
        </button>
      </div>

      {/* Drift banner */}
      {drift?.off_track && !driftDismissed && (
        <div className="bg-ink-850 border border-ink-700 border-l-2 border-l-accent rounded-md px-3 py-2 text-xs cx-fade">
          <p className="text-ink-100">
            Heads up — this looks off-track. Still relevant?
          </p>
          {drift.reason && (
            <p className="text-ink-400 mt-1">{drift.reason}</p>
          )}
          <button
            onClick={() => setDriftDismissed(true)}
            className="text-ink-500 hover:text-ink-300 mt-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Contradiction banner */}
      {contradiction?.found && !contradictionDismissed && (
        <div className="bg-ink-850 border border-ink-700 border-l-2 border-l-red-500 rounded-md px-3 py-2 text-xs cx-fade">
          <p className="text-ink-100">
            This might not be right — your note says{" "}
            <span className="italic text-ink-300">
              “{contradiction.note_text}”
            </span>
            .
          </p>
          <div className="flex gap-3 mt-1">
            <button
              onClick={() => setContradictionDismissed(true)}
              className="text-ink-500 hover:text-ink-300"
            >
              Dismiss
            </button>
            <button
              onClick={() => setContradictionDismissed(true)}
              className="text-ink-500 hover:text-ink-300"
            >
              Intentional
            </button>
          </div>
        </div>
      )}

      {/* Auto-table suggestion */}
      {table?.is_table && (
        <div className="bg-ink-850 border border-ink-800 rounded-md px-3 py-2 text-xs cx-fade space-y-2">
          <p className="text-ink-300">This looks like it could be a table.</p>
          <div className="overflow-auto max-h-40">
            <table className="w-full text-[11px] font-mono border-collapse">
              <thead>
                <tr>
                  {(table.headers ?? []).map((h, i) => (
                    <th
                      key={i}
                      className="text-left border-b border-ink-700 px-2 py-1 text-ink-300"
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
                        className="border-b border-ink-800 px-2 py-1 text-ink-200"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              onClick={insertTable}
              className="flex-1 bg-accent text-ink-950 font-semibold rounded-md py-1.5"
            >
              Insert into doc
            </button>
            <button
              onClick={copyTable}
              className="flex-1 border border-ink-700 rounded-md py-1.5 text-ink-300"
            >
              Copy markdown
            </button>
          </div>
        </div>
      )}

      {status && <p className="text-xs text-ink-400">{status}</p>}

      <p className="text-[10px] text-ink-600 pt-2 border-t border-ink-800">
        Cortex checks your draft for drift and factual conflicts every 30s, and
        suggests tables when you pause.
      </p>
    </div>
  );
}

function Header({ onSignOut }: { onSignOut?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono font-bold tracking-[0.2em] text-accent text-sm">
        CORTEX
      </span>
      {onSignOut && (
        <button
          onClick={onSignOut}
          className="text-[10px] text-ink-500 hover:text-ink-300 border border-ink-700 rounded px-2 py-0.5"
        >
          Sign out
        </button>
      )}
    </div>
  );
}
