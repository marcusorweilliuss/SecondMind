"use client";

export type FactVerdict = "accurate" | "inaccurate" | "unverifiable";
export type FactResult = {
  claim: string;
  verdict: FactVerdict;
  correction: string;
  explanation: string;
  source: { title: string; url: string } | null;
};

const STYLE: Record<
  FactVerdict,
  { badge: string; ring: string; emoji: string; label: string }
> = {
  accurate: {
    badge: "bg-grass/15 text-grass",
    ring: "border-grass/30",
    emoji: "✅",
    label: "checks out",
  },
  inaccurate: {
    badge: "bg-coral/15 text-coral",
    ring: "border-coral/40",
    emoji: "❌",
    label: "looks wrong",
  },
  unverifiable: {
    badge: "bg-ink-700 text-ink-300",
    ring: "border-ink-700",
    emoji: "❓",
    label: "can't verify",
  },
};

export function FactResultCard({ r, compact }: { r: FactResult; compact?: boolean }) {
  const s = STYLE[r.verdict] ?? STYLE.unverifiable;
  return (
    <div className={`bg-ink-850 border ${s.ring} rounded-2xl p-3 text-left`}>
      <div className="flex items-start gap-2">
        <span className={compact ? "text-sm" : "text-base"}>{s.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${s.badge}`}
            >
              {s.label}
            </span>
          </div>
          <p className={`${compact ? "text-xs" : "text-sm"} text-ink-100 leading-snug`}>
            {r.claim}
          </p>
          {r.explanation && (
            <p className={`${compact ? "text-[11px]" : "text-xs"} text-ink-400 mt-1.5 leading-relaxed`}>
              {r.explanation}
            </p>
          )}
          {r.verdict === "inaccurate" && r.correction && (
            <div className="mt-2 bg-grass/10 border border-grass/25 rounded-lg px-2.5 py-1.5">
              <span className="text-[10px] uppercase tracking-wider text-grass font-bold">
                correction
              </span>
              <p className={`${compact ? "text-[11px]" : "text-xs"} text-ink-100 mt-0.5`}>
                {r.correction}
              </p>
            </div>
          )}
          {r.source && (
            <a
              href={r.source.url}
              target="_blank"
              rel="noreferrer"
              className={`${compact ? "text-[11px]" : "text-xs"} mt-2 inline-flex items-center gap-1 text-sky hover:underline break-all`}
            >
              📚 {r.source.title}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
