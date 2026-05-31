"use client";

import { useEffect } from "react";

type Tone = "amber" | "coral" | "yellow";

const TONE: Record<Tone, { ring: string; chip: string; glow: string }> = {
  amber: {
    ring: "border-accent",
    chip: "bg-accent/15 text-accent",
    glow: "shadow-[0_0_60px_-12px_rgba(255,212,59,0.5)]",
  },
  coral: {
    ring: "border-coral",
    chip: "bg-coral/15 text-coral",
    glow: "shadow-[0_0_60px_-12px_rgba(255,107,107,0.5)]",
  },
  yellow: {
    ring: "border-accent",
    chip: "bg-accent/15 text-accent",
    glow: "shadow-[0_0_60px_-12px_rgba(255,212,59,0.55)]",
  },
};

export default function PopOver({
  open,
  tone = "yellow",
  emoji,
  kicker,
  title,
  onClose,
  children,
  actions,
  wide,
}: {
  open: boolean;
  tone?: Tone;
  emoji: string;
  kicker: string;
  title: React.ReactNode;
  onClose: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const t = TONE[tone];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6 bg-ink-950/70 backdrop-blur-sm animate-backdrop-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${wide ? "max-w-2xl" : "max-w-md"} bg-ink-900 border-2 ${t.ring} rounded-3xl p-6 animate-pop-in ${t.glow}`}
      >
        {/* floating emoji badge */}
        <div className="absolute -top-6 left-1/2 -translate-x-1/2">
          <div className="h-12 w-12 rounded-2xl bg-ink-850 border-2 border-ink-700 grid place-items-center text-2xl animate-floaty">
            {emoji}
          </div>
        </div>

        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-ink-500 hover:text-ink-200 text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>

        <div className="pt-5 text-center">
          <span
            className={`inline-block text-[10px] font-bold uppercase tracking-[0.18em] px-2.5 py-1 rounded-full ${t.chip}`}
          >
            {kicker}
          </span>
          <h3 className="mt-3 text-lg font-bold text-ink-100 leading-snug">
            {title}
          </h3>
        </div>

        {children && <div className="mt-4">{children}</div>}

        {actions && (
          <div className="mt-6 flex items-center justify-center gap-2.5">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
