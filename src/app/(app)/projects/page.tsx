"use client";

import { useEffect, useState } from "react";
import type { Project, Signal, KnowledgeNote } from "@/lib/types";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [selected, setSelected] = useState<string | "all" | "notes">("all");

  // New project form
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // New note form
  const [noteContent, setNoteContent] = useState("");
  const [noteTags, setNoteTags] = useState("");

  async function loadAll() {
    const [p, s, n] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/signals/list").then((r) => r.json()),
      fetch("/api/notes").then((r) => r.json()),
    ]);
    setProjects(p.projects ?? []);
    setSignals(s.signals ?? []);
    setNotes(n.notes ?? []);
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function createProject() {
    if (!newName.trim()) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDesc }),
    });
    const d = await res.json();
    if (d.project) {
      setProjects((prev) => [d.project, ...prev]);
      setNewName("");
      setNewDesc("");
      setShowNew(false);
    }
  }

  async function createNote() {
    if (!noteContent.trim()) return;
    const tags = noteTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: noteContent, tags }),
    });
    const d = await res.json();
    if (d.note) {
      setNotes((prev) => [d.note, ...prev]);
      setNoteContent("");
      setNoteTags("");
    }
  }

  const visibleSignals =
    selected === "all" || selected === "notes"
      ? signals
      : signals.filter((s) => s.project_id === selected);

  function countFor(projectId: string) {
    return signals.filter((s) => s.project_id === projectId).length;
  }

  return (
    <div className="cx-fade">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Projects</h1>
          <p className="text-ink-400 text-sm mt-1">
            Every signal, filed and connected.
          </p>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="text-sm border border-ink-700 rounded-md px-3 py-1.5 text-ink-300 hover:text-ink-100"
        >
          + New project
        </button>
      </div>

      {showNew && (
        <div className="bg-ink-900 border border-ink-800 rounded-xl p-4 mb-6 space-y-3 cx-fade">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            className="w-full bg-ink-850 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full bg-ink-850 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
          <button
            onClick={createProject}
            className="bg-accent text-ink-950 text-sm font-semibold rounded-md px-4 py-1.5"
          >
            Create
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
        {/* Sidebar */}
        <aside className="space-y-1">
          <FolderButton
            active={selected === "all"}
            label="All signals"
            count={signals.length}
            onClick={() => setSelected("all")}
          />
          {projects.map((p) => (
            <FolderButton
              key={p.id}
              active={selected === p.id}
              label={p.name}
              count={countFor(p.id)}
              onClick={() => setSelected(p.id)}
            />
          ))}
          <FolderButton
            active={selected === "notes"}
            label="Knowledge notes"
            count={notes.length}
            onClick={() => setSelected("notes")}
          />
        </aside>

        {/* Content */}
        <div className="space-y-3">
          {selected === "notes" ? (
            <>
              <div className="bg-ink-900 border border-ink-800 rounded-xl p-4 space-y-3">
                <textarea
                  value={noteContent}
                  onChange={(e) => setNoteContent(e.target.value)}
                  rows={3}
                  placeholder="Record a fact for the Fact Guard to check against…"
                  className="w-full bg-ink-850 border border-ink-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent resize-y"
                />
                <div className="flex gap-2">
                  <input
                    value={noteTags}
                    onChange={(e) => setNoteTags(e.target.value)}
                    placeholder="tags, comma, separated"
                    className="flex-1 bg-ink-850 border border-ink-700 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-accent"
                  />
                  <button
                    onClick={createNote}
                    className="text-sm bg-accent text-ink-950 font-semibold rounded-md px-4 py-1.5"
                  >
                    Save note
                  </button>
                </div>
              </div>
              {notes.map((n) => (
                <div
                  key={n.id}
                  className="bg-ink-900 border border-ink-800 rounded-xl p-4 font-mono"
                >
                  <p className="text-sm text-ink-200 leading-relaxed">
                    {n.content}
                  </p>
                  {n.tags && n.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-2 flex-wrap">
                      {n.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] bg-ink-800 border border-ink-700 rounded px-1.5 py-0.5 text-ink-400"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {notes.length === 0 && (
                <Empty text="No knowledge notes yet." />
              )}
            </>
          ) : (
            <>
              {visibleSignals.map((s) => (
                <SignalCard
                  key={s.id}
                  signal={s}
                  projectName={
                    projects.find((p) => p.id === s.project_id)?.name ?? null
                  }
                  showProject={selected === "all"}
                />
              ))}
              {visibleSignals.length === 0 && (
                <Empty text="No signals here yet. Highlight text on the web with the Cortex extension to capture one." />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function FolderButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between text-left px-3 py-2 rounded-md text-sm ${
        active ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-200 hover:bg-ink-900"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className="text-xs text-ink-600 font-mono">{count}</span>
    </button>
  );
}

function SignalCard({
  signal,
  projectName,
  showProject,
}: {
  signal: Signal;
  projectName: string | null;
  showProject: boolean;
}) {
  return (
    <article className="bg-ink-900 border border-ink-800 rounded-xl p-5 font-mono">
      {signal.signal_summary && (
        <p className="text-[15px] font-sans font-medium text-ink-100 leading-snug">
          {signal.signal_summary}
        </p>
      )}
      <p className="text-sm text-ink-400 mt-2 leading-relaxed border-l-2 border-ink-700 pl-3">
        {signal.highlight_text}
      </p>
      {signal.connected_to && (
        <p className="text-xs text-accent/90 mt-3 font-sans italic">
          ↳ {signal.connected_to}
        </p>
      )}
      <div className="flex items-center gap-2 mt-3 text-xs text-ink-600">
        {signal.source_url && (
          <a
            href={signal.source_url}
            target="_blank"
            rel="noreferrer"
            className="hover:text-ink-300 truncate max-w-xs"
          >
            {signal.source_title || signal.source_url}
          </a>
        )}
        {showProject && projectName && (
          <span className="ml-auto bg-ink-800 border border-ink-700 rounded px-1.5 py-0.5 text-ink-400">
            {projectName}
          </span>
        )}
      </div>
    </article>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="text-center py-16 text-ink-500 text-sm">{text}</div>
  );
}
