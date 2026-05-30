import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { tavilySearch, type TavilyResult } from "@/lib/tavily";

export const runtime = "nodejs";
export const maxDuration = 300;

// Behaviour 4 — Ambient Intelligence Feed (Radar).
// Reads context, derives interest vectors, searches Tavily (recent + foundational),
// scores results with Gemini, and stores only the items that clear the bar.

const VECTOR_SYSTEM = `You are Cortex, a research strategist. From a researcher's active project contexts and their most recently saved highlights, extract the specific topics and themes they are currently working on.
Return STRICT JSON: {"vectors": ["<topic>", ...]}
Rules:
- Produce between 5 and 8 vectors.
- Each vector is a SPECIFIC, named, searchable topic or theme (e.g. "EU AI Act enforcement timeline", "compute thresholds in AI regulation") — NOT a single broad word like "AI".
- Vectors should be the kind of phrase you'd type into a search engine to find fresh, relevant material.
- No duplicates, no numbering, no commentary.`;

const SCORE_SYSTEM = `You are Cortex, an editorial filter for a researcher's intelligence feed.
You receive the researcher's CURRENT WORK context, one INTEREST VECTOR, and a list of candidate search RESULTS.
For EACH result, score it and classify it. Return STRICT JSON:
{"items": [{
  "index": <number, matching the result's number>,
  "relevance": <0-10>,
  "novelty": <0-10>,
  "actionability": <0-10>,
  "type": "news" | "longread" | "paper" | "report",
  "why_read": "<exactly two sentences: (1) what the piece says, (2) why it specifically matters to this researcher's current work>"
}]}
Scoring guidance:
- relevance: how directly this bears on the researcher's current work (10 = squarely on point).
- novelty: how much NEW information vs. what a researcher in this area already knows (10 = genuinely new).
- actionability: how directly it could change what the researcher does next (10 = immediately useful).
- type: "news" for breaking/recent reporting, "longread" for in-depth analysis/essays, "paper" for academic/research papers, "report" for institutional/industry reports.
- why_read MUST be exactly two sentences and reference the researcher's work concretely. No marketing language.
Include an entry for every result by index.`;

type ScoredItem = {
  index: number;
  relevance: number;
  novelty: number;
  actionability: number;
  type: "news" | "longread" | "paper" | "report";
  why_read: string;
};

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceSupabase();

  // 1. Read active project contexts + last 20 saved signals.
  const [{ data: projects }, { data: tasks }, { data: signals }] = await Promise.all([
    db.from("projects").select("name, description").eq("user_id", user.id),
    db
      .from("task_contexts")
      .select("task_description")
      .eq("user_id", user.id)
      .eq("active", true),
    db
      .from("signals")
      .select("signal_summary, highlight_text")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const contextText = [
    "PROJECTS:",
    ...(projects ?? []).map((p) => `- ${p.name}: ${p.description ?? ""}`),
    "",
    "ACTIVE TASKS:",
    ...(tasks ?? []).map((t) => `- ${t.task_description}`),
    "",
    "RECENT SIGNALS:",
    ...(signals ?? []).map((s) => `- ${s.signal_summary || s.highlight_text}`),
  ].join("\n");

  // 2. Extract 5-8 interest vectors with Gemini.
  const { vectors: autoVectors } = await geminiJSON<{ vectors: string[] }>(
    VECTOR_SYSTEM,
    contextText,
    { temperature: 0.4, maxOutputTokens: 400 }
  );

  // Refresh the auto vectors store (keep manual ones intact).
  await db
    .from("interest_vectors")
    .update({ active: false })
    .eq("user_id", user.id)
    .eq("source", "auto");
  if (autoVectors.length) {
    await db.from("interest_vectors").insert(
      autoVectors.slice(0, 8).map((v) => ({
        user_id: user.id,
        vector_text: v,
        source: "auto",
        active: true,
      }))
    );
  }

  // Combine auto + manual active vectors for the search pass.
  const { data: manualVectors } = await db
    .from("interest_vectors")
    .select("vector_text")
    .eq("user_id", user.id)
    .eq("source", "manual")
    .eq("active", true);

  const allVectors = Array.from(
    new Set([
      ...autoVectors.slice(0, 8),
      ...(manualVectors ?? []).map((v) => v.vector_text),
    ])
  );

  // Existing radar URLs (incl. dismissed) so they never resurface.
  const { data: existing } = await db
    .from("radar_items")
    .select("url")
    .eq("user_id", user.id);
  const seenUrls = new Set((existing ?? []).map((r) => r.url));

  let surfaced = 0;

  // 3-5. For each vector: two Tavily passes, score with Gemini, filter, store.
  for (const vector of allVectors) {
    let recent: TavilyResult[] = [];
    let foundational: TavilyResult[] = [];
    try {
      [recent, foundational] = await Promise.all([
        tavilySearch(vector, { days: 7, topic: "news", maxResults: 5 }),
        tavilySearch(`${vector} analysis OR research OR explained`, {
          maxResults: 5,
        }),
      ]);
    } catch {
      continue; // skip this vector on search failure
    }

    // Dedupe by URL within this vector and against what we've already stored.
    const byUrl = new Map<string, TavilyResult>();
    for (const r of [...recent, ...foundational]) {
      if (!r.url || seenUrls.has(r.url) || byUrl.has(r.url)) continue;
      byUrl.set(r.url, r);
    }
    const candidates = Array.from(byUrl.values());
    if (candidates.length === 0) continue;

    const resultList = candidates
      .map(
        (r, i) =>
          `${i + 1}. ${r.title}\nURL: ${r.url}\nDate: ${r.published_date ?? "unknown"}\nExcerpt: ${(r.content || "").slice(0, 400)}`
      )
      .join("\n\n");

    let scored: { items: ScoredItem[] };
    try {
      scored = await geminiJSON<{ items: ScoredItem[] }>(
        SCORE_SYSTEM,
        `CURRENT WORK:\n${contextText}\n\nINTEREST VECTOR: ${vector}\n\nRESULTS:\n${resultList}`,
        { temperature: 0.3, maxOutputTokens: 2000 }
      );
    } catch {
      continue;
    }

    for (const item of scored.items ?? []) {
      const idx = item.index - 1;
      const cand = candidates[idx];
      if (!cand) continue;

      // Threshold: relevance >= 7 AND (novelty >= 6 OR actionability >= 7).
      const passes =
        item.relevance >= 7 &&
        (item.novelty >= 6 || item.actionability >= 7);
      if (!passes) continue;

      seenUrls.add(cand.url);
      await db.from("radar_items").insert({
        user_id: user.id,
        headline: cand.title,
        url: cand.url,
        source: hostname(cand.url),
        published_date: cand.published_date
          ? safeDate(cand.published_date)
          : null,
        type: item.type,
        why_read: item.why_read,
        relevance_score: item.relevance,
        novelty_score: item.novelty,
        actionability_score: item.actionability,
        interest_vector: vector,
        dismissed: false,
      });
      surfaced += 1;
    }
  }

  return NextResponse.json({
    ok: true,
    vectors: allVectors,
    surfaced,
  });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function safeDate(s: string): string | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
