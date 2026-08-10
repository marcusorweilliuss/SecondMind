import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { llmJSON } from "@/lib/llm";
import {
  tavilySearchAuthoritative,
  credibilityOf,
  type TavilyResult,
  type Credibility,
} from "@/lib/tavily";

export const runtime = "nodejs";
export const maxDuration = 60;

// Step 3 — Suggested reading.
// From the current draft, derive a few reading angles, search the web, and
// return real, useful sources with a one-line reason each. On-demand.

const ANGLE_SYSTEM = `You are a research librarian. From the passage, infer what the writer is working on and produce specific, searchable "reading angles" — topics, questions, or debates whose sources would genuinely help or interest this writer.
Return STRICT JSON: {"angles": ["<specific searchable topic/question>", ...]}
Rules:
- 3 to 5 angles, each a concrete phrase you'd type into a search engine (not a single broad word).
- Cover useful directions: foundational background, counterpoints/debates, and recent developments.
- No duplicates, no commentary.`;

const WHY_SYSTEM = `You are a research librarian recommending reading to a writer. You are given the writer's DRAFT context, one reading ANGLE, and a numbered list of candidate SOURCES (title, snippet, url).
For the most worthwhile sources, write a one-sentence reason it's worth reading for THIS writer.
Return STRICT JSON: {"picks":[{"number":<result number>,"why":"<one concrete sentence: what it offers and why it helps this draft>"}]}
Rules:
- Only include genuinely relevant sources (skip weak/off-topic ones). At most 3 per angle.
- "number" MUST be one of the provided result numbers. Never invent sources or URLs.
- "why" is one sentence, concrete, no marketing fluff.`;

type Suggestion = {
  title: string;
  url: string;
  source: string;
  why: string;
  angle: string;
  credibility: Credibility;
};

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const writing = (body.writing || "").trim();
  if (writing.length < 20) {
    return NextResponse.json({
      suggestions: [],
      message: "Write a bit more and I'll suggest reading.",
    });
  }

  // 1. Derive reading angles.
  let angles: string[] = [];
  try {
    const out = await llmJSON<{ angles: string[] }>(
      ANGLE_SYSTEM,
      `PASSAGE:\n"""${writing.slice(0, 6000)}"""`,
      { temperature: 0.4, maxOutputTokens: 400 }
    );
    angles = (out.angles ?? []).slice(0, 5).filter((a) => a && a.trim());
  } catch {
    return NextResponse.json(
      { suggestions: [], message: "Couldn't analyze the draft — try again." },
      { status: 200 }
    );
  }
  if (angles.length === 0) {
    return NextResponse.json({ suggestions: [], message: "No clear reading angles found." });
  }

  // 2. Search per angle (authoritative-first), then let the LLM pick + justify.
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];

  for (const angle of angles) {
    let results: TavilyResult[] = [];
    try {
      results = await tavilySearchAuthoritative(angle, {
        maxResults: 4,
        searchDepth: "basic",
      });
    } catch {
      continue;
    }
    const fresh = results.filter((r) => r.url && !seen.has(r.url));
    if (fresh.length === 0) continue;

    const list = fresh
      .map(
        (r, i) =>
          `[${i + 1}] ${r.title}\n url: ${r.url}\n snippet: ${(r.content || "").slice(0, 260)}`
      )
      .join("\n\n");

    let picks: { picks: { number: number; why: string }[] };
    try {
      picks = await llmJSON<{ picks: { number: number; why: string }[] }>(
        WHY_SYSTEM,
        `DRAFT:\n"""${writing.slice(0, 3000)}"""\n\nANGLE: ${angle}\n\nSOURCES:\n${list}`,
        { temperature: 0.3, maxOutputTokens: 600 }
      );
    } catch {
      continue;
    }

    for (const p of picks.picks ?? []) {
      const idx = p.number - 1;
      const r = fresh[idx];
      if (!r || seen.has(r.url)) continue;
      seen.add(r.url);
      suggestions.push({
        title: r.title,
        url: r.url,
        source: hostname(r.url),
        why: p.why || "",
        angle,
        credibility: credibilityOf(r.url),
      });
    }
  }

  return NextResponse.json({
    suggestions: suggestions.slice(0, 12),
    message: suggestions.length ? "" : "No strong reading matches found.",
  });
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
