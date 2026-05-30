"use client";

import { useEffect, useState } from "react";
import type { RadarItem, InterestVector, Project } from "@/lib/types";

const TYPE_LABELS: Record<string, string> = {
  news: "Breaking",
  longread: "Long read",
  paper: "Paper",
  report: "Report",
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "news", label: "Breaking" },
  { key: "deep", label: "Deep reads" },
];

export default function RadarPage() {
  const [items, setItems] = useState<RadarItem[]>([]);
  const [vectors, setVectors] = useState<InterestVector[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [trackingOpen, setTrackingOpen] = useState(true);
  const [newVector, setNewVector] = useState("");
  const [status, setStatus] = useState("");

  async function loadItems() {
    const res = await fetch("/api/radar/items");
    const d = await res.json();
    setItems(d.items ?? []);
    setLastUpdated(d.lastUpdated ?? null);
  }
  async function loadVectors() {
    const res = await fetch("/api/vectors");
    const d = await res.json();
    setVectors(d.vectors ?? []);
  }
  async function loadProjects() {
    const res = await fetch("/api/projects");
    const d = await res.json();
    setProjects(d.projects ?? []);
  }

  useEffect(() => {
    loadItems();
    loadVectors();
    loadProjects();
  }, []);

  async function refreshRadar() {
    setRefreshing(true);
    setStatus("Scanning your context, searching, and scoring results…");
    try {
      const res = await fetch("/api/radar/generate", { method: "POST" });
      const d = await res.json();
      if (res.ok) {
        setStatus(
          `Surfaced ${d.surfaced} new item${d.surfaced === 1 ? "" : "s"} across ${d.vectors.length} vectors.`
        );
        await Promise.all([loadItems(), loadVectors()]);
      } else {
        setStatus(d.error || "Refresh failed.");
      }
    } catch (e) {
      setStatus(String(e));
    } finally {
      setRefreshing(false);
      setTimeout(() => setStatus(""), 6000);
    }
  }

  async function dismiss(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch("/api/radar/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "dismiss" }),
    });
  }

  async function saveToProject(id: string, projectId: string) {
    if (!projectId) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    await fetch("/api/radar/items", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "save", project_id: projectId }),
    });
  }

  async function addVector() {
    const text = newVector.trim();
    if (!text) return;
    setNewVector("");
    const res = await fetch("/api/vectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vector_text: text }),
    });
    const d = await res.json();
    if (d.vector) setVectors((prev) => [d.vector, ...prev]);
  }

  async function removeVector(id: string) {
    setVectors((prev) => prev.filter((v) => v.id !== id));
    await fetch(`/api/vectors?id=${id}`, { method: "DELETE" });
  }

  const filtered = items.filter((i) => {
    if (filter === "news" && i.type !== "news") return false;
    if (filter === "deep" && !["longread", "paper", "report"].includes(i.type ?? "")) {
      return false;
    }
    if (projectFilter && i.saved_to_project_id !== projectFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6 cx-fade">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Radar</h1>
          <p className="text-ink-400 text-sm mt-1">
            Proactive research on what you&apos;re working on.
          </p>
        </div>
        <div className="text-right">
          <button
            onClick={refreshRadar}
            disabled={refreshing}
            className="bg-accent text-ink-950 text-sm font-semibold rounded-md px-4 py-1.5 disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh radar"}
          </button>
          <p className="text-xs text-ink-500 mt-1.5">
            {lastUpdated
              ? `Last updated ${new Date(lastUpdated).toLocaleString()}`
              : "Not yet run"}
          </p>
        </div>
      </div>

      {status && (
        <div className="text-xs text-ink-300 bg-ink-850 border border-ink-800 rounded-md px-3 py-2">
          {status}
        </div>
      )}

      {/* Currently tracking ------------------------------------------------ */}
      <section className="bg-ink-900 border border-ink-800 rounded-xl p-4">
        <button
          onClick={() => setTrackingOpen((v) => !v)}
          className="flex items-center gap-2 text-sm text-ink-300 hover:text-ink-100"
        >
          <span className="text-ink-500">{trackingOpen ? "▾" : "▸"}</span>
          Currently tracking ({vectors.length})
        </button>
        {trackingOpen && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {vectors.map((v) => (
                <span
                  key={v.id}
                  className="group inline-flex items-center gap-1.5 bg-ink-800 border border-ink-700 rounded-full pl-3 pr-2 py-1 text-xs font-mono text-ink-200"
                >
                  {v.vector_text}
                  <span
                    className={`text-[10px] ${v.source === "manual" ? "text-accent" : "text-ink-500"}`}
                  >
                    {v.source === "manual" ? "·m" : "·a"}
                  </span>
                  <button
                    onClick={() => removeVector(v.id)}
                    className="text-ink-500 hover:text-red-400"
                    aria-label="Remove vector"
                  >
                    ×
                  </button>
                </span>
              ))}
              {vectors.length === 0 && (
                <span className="text-xs text-ink-500">
                  No vectors yet — run a refresh to derive them automatically.
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <input
                value={newVector}
                onChange={(e) => setNewVector(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addVector()}
                placeholder="Add a topic to track…"
                className="flex-1 bg-ink-850 border border-ink-700 rounded-md px-3 py-1.5 text-xs font-mono focus:outline-none focus:border-accent"
              />
              <button
                onClick={addVector}
                className="text-xs border border-ink-700 rounded-md px-3 py-1.5 text-ink-300 hover:text-ink-100"
              >
                Add
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Filter bar -------------------------------------------------------- */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs rounded-md px-3 py-1.5 border ${
              filter === f.key
                ? "bg-ink-800 border-ink-600 text-ink-100"
                : "border-ink-800 text-ink-400 hover:text-ink-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="text-xs bg-ink-900 border border-ink-800 rounded-md px-2.5 py-1.5 text-ink-300 focus:outline-none focus:border-accent"
        >
          <option value="">By project ▾</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Feed -------------------------------------------------------------- */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-ink-500 text-sm">
            {items.length === 0
              ? "No radar items yet. Hit “Refresh radar” to scan your current work."
              : "Nothing matches this filter."}
          </div>
        )}
        {filtered.map((item) => (
          <RadarCard
            key={item.id}
            item={item}
            projects={projects}
            onDismiss={() => dismiss(item.id)}
            onSave={(pid) => saveToProject(item.id, pid)}
          />
        ))}
      </div>
    </div>
  );
}

function RadarCard({
  item,
  projects,
  onDismiss,
  onSave,
}: {
  item: RadarItem;
  projects: Project[];
  onDismiss: () => void;
  onSave: (projectId: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const relevance = Math.max(0, Math.min(10, item.relevance_score ?? 0));

  return (
    <article className="bg-ink-900 border border-ink-800 rounded-xl p-5 font-mono">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            {item.type && (
              <span className="text-[10px] uppercase tracking-wider bg-ink-800 border border-ink-700 rounded px-1.5 py-0.5 text-accent">
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
            )}
            <span className="text-xs text-ink-500">{item.source}</span>
            {item.published_date && (
              <span className="text-xs text-ink-600">
                · {new Date(item.published_date).toLocaleDateString()}
              </span>
            )}
          </div>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-[15px] font-sans font-medium text-ink-100 hover:text-accent leading-snug"
          >
            {item.headline}
          </a>
          {item.why_read && (
            <p className="text-sm font-sans italic text-ink-400 mt-2 leading-relaxed">
              {item.why_read}
            </p>
          )}
          {/* relevance bar */}
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1 w-28 bg-ink-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent"
                style={{ width: `${relevance * 10}%` }}
              />
            </div>
            <span className="text-[10px] text-ink-600 uppercase tracking-wider">
              relevance
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4 pt-3 border-t border-ink-800">
        <select
          defaultValue=""
          disabled={saving}
          onChange={(e) => {
            if (e.target.value) {
              setSaving(true);
              onSave(e.target.value);
            }
          }}
          className="text-xs bg-ink-850 border border-ink-700 rounded-md px-2 py-1 text-ink-300 focus:outline-none focus:border-accent"
        >
          <option value="">Save to project →</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={onDismiss}
          className="text-xs text-ink-500 hover:text-ink-300"
        >
          Dismiss
        </button>
      </div>
    </article>
  );
}
