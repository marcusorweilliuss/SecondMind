"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/focus", label: "Focus", emoji: "🧠" },
  { href: "/radar", label: "Radar", emoji: "📡" },
  { href: "/projects", label: "Projects", emoji: "🗂️" },
];

export default function Nav({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-ink-800 bg-ink-950/80 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto max-w-5xl px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/focus" className="flex items-center gap-2 group">
            <span className="text-xl group-hover:animate-wiggle">🧠</span>
            <span className="font-black tracking-tight text-lg text-accent">
              cortex
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {TABS.map((tab) => {
              const active = pathname?.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-all ${
                    active
                      ? "text-ink-950 bg-accent"
                      : "text-ink-400 hover:text-ink-100 hover:bg-ink-800"
                  }`}
                >
                  <span className="mr-1">{tab.emoji}</span>
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {email && (
            <span className="text-xs text-ink-500 font-mono hidden sm:block">
              {email}
            </span>
          )}
          <button
            onClick={signOut}
            className="text-xs font-medium text-ink-400 hover:text-ink-100 border border-ink-700 hover:border-ink-600 rounded-full px-3 py-1"
          >
            peace out ✌️
          </button>
        </div>
      </div>
    </header>
  );
}
