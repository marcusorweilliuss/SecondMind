"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PopOver from "@/components/PopOver";
import { FactResultCard, type FactResult } from "@/components/FactCheckPanel";
import { locateClaim, chunkForWordSearch } from "@/lib/highlight";

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
  const [projectsError, setProjectsError] = useState("");

  // Deep fact-check (notes + web)
  const [factChecking, setFactChecking] = useState(false);
  const [factResults, setFactResults] = useState<FactResult[] | null>(null);
  const [factMessage, setFactMessage] = useState("");
  const [showFacts, setShowFacts] = useState(false);

  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;
  const refreshRef = useRef<string | null>(null);
  const popupRef = useRef<Popup>(null);
  popupRef.current = popup;

  const tryOpen = useCallback((p: Popup) => {
    if (!popupRef.current) setPopup(p);
  }, []);

  // Exchange the refresh token for a fresh access token (Supabase tokens
  // expire after ~1h). Returns the new access token, or null on failure.
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const rt = refreshRef.current || localStorage.getItem("cortex_word_refresh");
    if (!rt) return null;
    try {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
          body: JSON.stringify({ refresh_token: rt }),
        }
      );
      if (!res.ok) return null;
      const d = await res.json();
      localStorage.setItem("cortex_word_token", d.access_token);
      localStorage.setItem("cortex_word_refresh", d.refresh_token);
      refreshRef.current = d.refresh_token;
      tokenRef.current = d.access_token;
      setToken(d.access_token);
      return d.access_token;
    } catch {
      return null;
    }
  }, []);

  // fetch() with the current Bearer token; on 401, refresh once and retry.
  const authedFetch = useCallback(
    async (input: string, init: RequestInit = {}): Promise<Response> => {
      const withAuth = (tok: string): RequestInit => ({
        ...init,
        headers: { ...(init.headers || {}), Authorization: `Bearer ${tok}` },
      });
      let res = await fetch(input, withAuth(tokenRef.current || ""));
      if (res.status === 401) {
        const fresh = await refreshAccessToken();
        if (fresh) res = await fetch(input, withAuth(fresh));
      }
      return res;
    },
    [refreshAccessToken]
  );

  const loadProjects = useCallback(async () => {
    setProjectsError("");
    try {
      const res = await authedFetch("/api/projects");
      if (res.status === 401) {
        setProjectsError("session expired — sign out and back in");
        return;
      }
      if (!res.ok) {
        setProjectsError(`couldn't load projects (${res.status})`);
        return;
      }
      const d = await res.json();
      setProjects(d.projects ?? []);
      const saved = localStorage.getItem("cortex_word_project");
      if (saved) setActiveProject(saved);
    } catch {
      setProjectsError("couldn't reach the server");
    }
  }, [authedFetch]);

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
    const savedRefresh = localStorage.getItem("cortex_word_refresh");
    if (savedRefresh) refreshRef.current = savedRefresh;
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) return;
    loadProjects();
  }, [token, loadProjects]);

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
      localStorage.setItem("cortex_word_refresh", d.refresh_token);
      refreshRef.current = d.refresh_token;
      setToken(d.access_token);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  function signOut() {
    localStorage.removeItem("cortex_word_token");
    localStorage.removeItem("cortex_word_refresh");
    refreshRef.current = null;
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
  const lastCheckedText = useRef("");
  const runFocusCheck = useCallback(async (force = false) => {
    if (!tokenRef.current) return;
    const text = (await readDocText()).trim();
    const words = text ? text.split(/\s+/).length : 0;
    if (text.length < 20) {
      setStatusLine("✍️ write a bit more and I'll start checking…");
      return;
    }
    // Don't burn API quota re-checking unchanged text (the 30s loop would
    // otherwise call on every tick forever). Manual "check now" forces it.
    if (force !== true && text === lastCheckedText.current) return;
    lastCheckedText.current = text;
    setChecking(true);
    setStatusLine("🧠 reading your draft…");
    try {
      const res = await authedFetch("/api/focus/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writing: text }),
      });
      if (!res.ok) {
        setStatusLine(`⚠️ check failed (${res.status})`);
        return;
      }
      const d = await res.json();
      if (d.skipped) {
        setStatusLine(
          d.reason === "rate_limited"
            ? "⏳ busy (rate limit) — will retry shortly"
            : `✍️ ${words} words`
        );
        return;
      }
      if (d.contradiction?.found && d.contradiction.note_text) {
        setStatusLine(`🔍 found a possible factual conflict · ${words} words`);
        tryOpen({
          kind: "fact",
          note_text: d.contradiction.note_text,
          claim: d.contradiction.claim || "",
          correction: d.contradiction.correction || d.contradiction.note_text,
          source: d.contradiction.source || null,
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
  }, [readDocText, tryOpen, authedFetch]);

  // --- Behaviour 3: auto-table -------------------------------------------
  const lastTableText = useRef("");
  const runAutoTable = useCallback(async () => {
    if (!tokenRef.current) return;
    const text = (await readDocText()).trim();
    if (text.split(/\s+/).length < 25) return;
    if (text === lastTableText.current) return; // skip unchanged text
    lastTableText.current = text;
    try {
      const res = await authedFetch("/api/autotable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const d: TableResult = await res.json();
      if (d.is_table) tryOpen({ kind: "table", table: d });
    } catch {
      /* ignore */
    }
  }, [readDocText, tryOpen, authedFetch]);

  // Highlight the flagged sentences directly in the Word document. We locate
  // the actual sentence in the doc (robust to reworded quotes), then highlight
  // it in paragraph- and length-safe chunks so Word's search can find them.
  const highlightedQuotes = useRef<string[]>([]);
  const highlightInWord = useCallback(
    async (results: FactResult[], docText: string) => {
      const colorFor = (v: string) =>
        v === "inaccurate" ? "#FFC7CE" : v === "unverifiable" ? "#FFEB9C" : "#C6EFCE";
      const chunks: { text: string; color: string }[] = [];
      for (const r of results) {
        const span = locateClaim(docText, r.quote || r.claim || "");
        if (!span) continue;
        const sentence = docText.slice(span.start, span.end);
        for (const c of chunkForWordSearch(sentence)) {
          chunks.push({ text: c, color: colorFor(r.verdict) });
        }
      }
      if (chunks.length === 0) return;
      const done: string[] = [];
      try {
        await window.Word.run(async (context: any) => {
          for (const c of chunks) {
            try {
              const search = context.document.body.search(c.text, {
                matchCase: false,
                ignorePunct: true,
              });
              search.load("items");
              await context.sync();
              for (const item of search.items) {
                item.font.highlightColor = c.color;
              }
              if (search.items.length) done.push(c.text);
            } catch {
              /* skip a chunk Word can't search */
            }
          }
          await context.sync();
        });
        highlightedQuotes.current = done;
      } catch {
        /* ignore */
      }
    },
    []
  );

  const clearWordHighlights = useCallback(async () => {
    if (!highlightedQuotes.current.length) return;
    try {
      await window.Word.run(async (context: any) => {
        for (const q of highlightedQuotes.current) {
          const search = context.document.body.search(q, {
            matchCase: false,
            ignorePunct: true,
          });
          search.load("items");
          await context.sync();
          for (const item of search.items) {
            item.font.highlightColor = null;
          }
        }
        await context.sync();
      });
      highlightedQuotes.current = [];
    } catch {
      /* ignore */
    }
  }, []);

  // Deep fact-check against notes + the web (on demand).
  const runFactCheck = useCallback(async () => {
    if (!tokenRef.current) return;
    const text = (await readDocText()).trim();
    setShowFacts(true);
    if (text.length < 20) {
      setFactResults(null);
      setFactMessage("Write a bit more to fact-check.");
      return;
    }
    setFactChecking(true);
    setFactResults(null);
    setFactMessage("");
    await clearWordHighlights();
    try {
      const res = await authedFetch("/api/factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ writing: text }),
      });
      const d = await res.json();
      const results: FactResult[] = d.results ?? [];
      setFactResults(results);
      setFactMessage(d.message || "");
      if (results.length) highlightInWord(results, text);
    } catch {
      setFactMessage("Couldn't run the fact-check — try again.");
    } finally {
      setFactChecking(false);
    }
  }, [readDocText, authedFetch, highlightInWord, clearWordHighlights]);

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
        lastChange.current > lastScan.current &&
        now - lastScan.current >= 15000 // throttle: at most one auto-scan / 15s
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
          const res = await authedFetch("/api/signals", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
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
        <div className="flex items-center justify-between">
          <label className="block text-[10px] uppercase tracking-wider text-ink-400">
            Active project
          </label>
          <button
            onClick={loadProjects}
            className="text-[10px] text-ink-500 hover:text-accent"
          >
            ↻ reload
          </button>
        </div>
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
        {projectsError && (
          <p className="text-[11px] text-coral">{projectsError}</p>
        )}
        {!projectsError && projects.length === 0 && (
          <p className="text-[11px] text-ink-500">
            No projects yet — create one in the Cortex web app, then hit reload.
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => runFocusCheck(true)}
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
      <button
        onClick={runFactCheck}
        disabled={factChecking || !officeReady}
        className="w-full text-xs font-bold bg-sky/15 text-sky rounded-full px-2 py-2 hover:bg-sky/25 disabled:opacity-60"
      >
        {factChecking ? "fact-checking…" : "🔎 fact-check against the web"}
      </button>
      {signalMsg && <p className="text-[11px] text-ink-400">{signalMsg}</p>}

      {/* Fact-check results */}
      {showFacts && (
        <div className="bg-ink-900 border border-sky/30 rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky">🔎 Fact-check</span>
            <div className="flex items-center gap-2">
              {factResults && factResults.length > 0 && (
                <button
                  onClick={clearWordHighlights}
                  className="text-[11px] text-ink-500 hover:text-ink-300"
                >
                  clear highlights
                </button>
              )}
              <button
                onClick={() => setShowFacts(false)}
                className="text-[11px] text-ink-500 hover:text-ink-300"
              >
                hide
              </button>
            </div>
          </div>
          {factChecking && (
            <p className="text-[11px] text-ink-400">
              extracting claims → searching → verifying…
            </p>
          )}
          {!factChecking && factMessage && (!factResults || factResults.length === 0) && (
            <p className="text-[11px] text-ink-300">{factMessage}</p>
          )}
          {!factChecking && factResults && factResults.length > 0 && (
            <>
              <p className="text-[10px] text-ink-500">
                Flagged sentences are highlighted in your document.
              </p>
              <div className="space-y-2">
                {factResults.map((r, i) => (
                  <FactResultCard key={i} r={r} compact />
                ))}
              </div>
            </>
          )}
        </div>
      )}

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
                <span className="bg-ink-800 text-ink-100 px-1 rounded line-through decoration-coral/70">
                  “{popup.claim}”
                </span>
              </p>
            )}
            <div className="bg-grass/10 border border-grass/30 rounded-xl px-3 py-2 text-left">
              <p className="text-[10px] uppercase tracking-wider text-grass font-bold mb-0.5">
                ✅ the right answer
              </p>
              <p className="text-ink-100">{popup.correction}</p>
              {popup.source && (
                <a
                  href={popup.source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-sky hover:underline break-all"
                >
                  📚 {popup.source.title}
                </a>
              )}
            </div>
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
