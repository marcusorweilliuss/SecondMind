"use client";

import { useState } from "react";

export type Suggestion = {
  title: string;
  url: string;
  source: string;
  why: string;
  angle: string;
  credibility?: "high" | "medium" | "unknown";
};

const CRED: Record<string, { badge: string; label: string }> = {
  high: { badge: "bg-grass/15 text-grass", label: "authoritative" },
  medium: { badge: "bg-accent/15 text-accent", label: "general" },
  unknown: { badge: "bg-ink-700 text-ink-400", label: "source" },
};

export function SuggestionCard({
  s,
  projects,
  onSave,
  compact,
}: {
  s: Suggestion;
  projects: { id: string; name: string }[];
  onSave: (s: Suggestion, projectId: string) => Promise<boolean> | boolean;
  compact?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(projectId: string) {
    if (!projectId) return;
    setSaving(true);
    const ok = await onSave(s, projectId);
    setSaving(false);
    if (ok) setSaved(true);
  }

  const cred = s.credibility ? CRED[s.credibility] ?? CRED.unknown : null;

  return (
    <div className="bg-ink-850 border border-ink-800 rounded-2xl p-3 text-left">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="text-[10px] text-ink-500 font-mono truncate">
          {s.source}
        </span>
        {cred && (
          <span
            className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${cred.badge}`}
          >
            {cred.label}
          </span>
        )}
        <span className="text-[9px] text-ink-600 truncate">· {s.angle}</span>
      </div>
      <a
        href={s.url}
        target="_blank"
        rel="noreferrer"
        className={`${compact ? "text-sm" : "text-[15px]"} font-medium text-ink-100 hover:text-accent leading-snug block`}
      >
        {s.title}
      </a>
      {s.why && (
        <p className={`${compact ? "text-[11px]" : "text-xs"} italic text-ink-400 mt-1.5 leading-relaxed`}>
          {s.why}
        </p>
      )}
      <div className="mt-2">
        {saved ? (
          <span className="text-[11px] text-grass font-medium">saved ✓</span>
        ) : (
          <select
            defaultValue=""
            disabled={saving}
            onChange={(e) => save(e.target.value)}
            className="text-[11px] bg-ink-800 border border-ink-700 rounded-md px-2 py-1 text-ink-300 focus:outline-none focus:border-accent"
          >
            <option value="">{saving ? "saving…" : "save to project →"}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
