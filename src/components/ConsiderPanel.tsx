"use client";

export type Consider = {
  supporting_points: string[];
  tensions: string[];
  future_work: string[];
  open_questions: string[];
};

const SECTIONS: {
  key: keyof Consider;
  label: string;
  emoji: string;
  color: string;
}[] = [
  { key: "supporting_points", label: "supporting points", emoji: "🧱", color: "text-grass" },
  { key: "tensions", label: "tensions", emoji: "⚡", color: "text-coral" },
  { key: "future_work", label: "future work", emoji: "🚀", color: "text-sky" },
  { key: "open_questions", label: "open questions", emoji: "❓", color: "text-accent" },
];

export function ConsiderSections({
  data,
  compact,
  onInsert,
}: {
  data: Consider;
  compact?: boolean;
  onInsert?: (line: string) => void;
}) {
  const nonEmpty = SECTIONS.filter((s) => (data[s.key] ?? []).length > 0);
  if (nonEmpty.length === 0) {
    return (
      <p className="text-sm text-ink-400 text-center py-4">
        Nothing substantive to add — the draft holds together.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {nonEmpty.map((s) => (
        <div key={s.key}>
          <p
            className={`text-[11px] font-bold uppercase tracking-wider ${s.color} mb-1.5`}
          >
            {s.emoji} {s.label}
          </p>
          <ul className="space-y-1.5">
            {data[s.key].map((item, i) => (
              <li
                key={i}
                className={`${compact ? "text-xs" : "text-sm"} text-ink-200 leading-relaxed flex items-start gap-2`}
              >
                <span className="text-ink-600 mt-0.5">•</span>
                <span className="flex-1">{item}</span>
                {onInsert && (
                  <button
                    onClick={() => onInsert(item)}
                    className="text-[10px] text-ink-500 hover:text-accent whitespace-nowrap"
                    title="Insert into draft"
                  >
                    + insert
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
