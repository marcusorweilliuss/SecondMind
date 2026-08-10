import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

// Step 5 — Auto-bibliography.
// Gathers a project's cited sources (signals with a URL + saved radar items)
// and formats them into a reference list in the requested style.

const STYLES = ["apa", "mla", "chicago"] as const;
type Style = (typeof STYLES)[number];

const SYSTEM = `You are a meticulous reference librarian. You are given a list of SOURCES (title, site/publisher, url, date) and a citation STYLE.
Format each source as a single reference entry in that exact style (APA 7th, MLA 9th, or Chicago author-date).
Return STRICT JSON: {"entries": ["<one formatted reference>", ...]}
Rules:
- Use ONLY the data provided. Do NOT invent authors, dates, or publishers. If a field is unknown, follow the style's convention for missing data (e.g. "n.d." for no date; use the site/publisher as author when no author is given).
- Keep the URL in the entry. Preserve the given title exactly.
- One entry per source, in the same order given. No numbering, no commentary.`;

function hostname(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId: string | null = body.project_id || null;
  const style: Style = STYLES.includes(body.style) ? body.style : "apa";

  const db = createServiceSupabase();

  // Signals with a source URL (captured highlights + saved suggestions).
  let sigQuery = db
    .from("signals")
    .select("highlight_text, signal_summary, source_url, source_title, created_at")
    .eq("user_id", user.id)
    .not("source_url", "is", null)
    .order("created_at", { ascending: false });
  if (projectId) sigQuery = sigQuery.eq("project_id", projectId);
  const { data: signals } = await sigQuery;

  // Radar items saved to this project.
  let radarQuery = db
    .from("radar_items")
    .select("headline, url, source, published_date")
    .eq("user_id", user.id)
    .not("saved_to_project_id", "is", null);
  if (projectId) radarQuery = radarQuery.eq("saved_to_project_id", projectId);
  const { data: radar } = await radarQuery;

  // Normalise + dedup by URL.
  const byUrl = new Map<
    string,
    { title: string; publisher: string; url: string; date: string }
  >();
  for (const s of signals ?? []) {
    if (!s.source_url) continue;
    if (byUrl.has(s.source_url)) continue;
    byUrl.set(s.source_url, {
      title: s.source_title || s.signal_summary || s.highlight_text || s.source_url,
      publisher: s.source_title || hostname(s.source_url),
      url: s.source_url,
      date: s.created_at ? String(s.created_at).slice(0, 10) : "",
    });
  }
  for (const r of radar ?? []) {
    if (!r.url || byUrl.has(r.url)) continue;
    byUrl.set(r.url, {
      title: r.headline || r.url,
      publisher: r.source || hostname(r.url),
      url: r.url,
      date: r.published_date ? String(r.published_date).slice(0, 10) : "",
    });
  }

  const sources = Array.from(byUrl.values());
  if (sources.length === 0) {
    return NextResponse.json({
      style,
      entries: [],
      formatted: "",
      message:
        "No cited sources in this project yet — capture highlights or save suggested reading first.",
    });
  }

  const list = sources
    .map(
      (s, i) =>
        `${i + 1}. title: ${s.title}\n   publisher/site: ${s.publisher}\n   url: ${s.url}\n   date: ${s.date || "unknown"}`
    )
    .join("\n");

  let entries: string[] = [];
  try {
    const out = await llmJSON<{ entries: string[] }>(
      SYSTEM,
      `STYLE: ${style.toUpperCase()}\n\nSOURCES:\n${list}`,
      { temperature: 0.1, maxOutputTokens: 1500 }
    );
    entries = (out.entries ?? []).filter((e) => e && e.trim());
  } catch {
    return NextResponse.json(
      { style, entries: [], formatted: "", message: "Couldn't format the bibliography — try again." },
      { status: 200 }
    );
  }

  // Alphabetise, which is what all three styles expect for a reference list.
  entries.sort((a, b) => a.localeCompare(b));

  return NextResponse.json({
    style,
    entries,
    formatted: entries.join("\n\n"),
    count: entries.length,
  });
}
