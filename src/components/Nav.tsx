"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const TABS = [
  { href: "/focus", label: "Focus" },
  { href: "/radar", label: "Radar" },
  { href: "/projects", label: "Projects" },
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
      <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <Link
            href="/focus"
            className="font-mono font-bold tracking-[0.2em] text-accent text-sm"
          >
            CORTEX
          </Link>
          <nav className="flex items-center gap-1">
            {TABS.map((tab) => {
              const active = pathname?.startsWith(tab.href);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                    active
                      ? "text-ink-100 bg-ink-800"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
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
            className="text-xs text-ink-400 hover:text-ink-200 border border-ink-700 rounded-md px-2.5 py-1"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
