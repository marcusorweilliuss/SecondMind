import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";
import { tavilySearch, type TavilyResult } from "@/lib/tavily";

export const runtime = "nodejs";
export const maxDuration = 60;

// Deep fact-check: verify the writing's factual claims against BOTH the user's
// knowledge notes AND real-world evidence from the web (Tavily). On-demand
// (button-triggered), not part of the ambient 30s loop.

const EXTRACT_SYSTEM = `You are a fact-checking assistant. From the passage, extract the distinct, CHECKABLE factual claims — statements that could be verified true or false against evidence (dates, statistics, historical/scientific/causal assertions, named attributions, definitions).
Ignore opinions, questions, hypotheticals, and vague statements.
Return STRICT JSON: {"claims": [{"claim": "<concise standalone claim, pronouns resolved>", "quote": "<the EXACT verbatim sentence or span copied character-for-character from the passage that states this claim>"}]}
Rules:
- At most 5 claims.
- "quote" MUST be an exact substring of the passage — copy it verbatim (same words, casing, and punctuation) so it can be located in the text. Do not paraphrase the quote.
- If there are no checkable factual claims, return {"claims": []}.`;

const VERIFY_SYSTEM = `You are a rigorous, impartial fact-checker and critical reader. For each CLAIM you are given the user's own NOTES and a numbered list of web SEARCH RESULTS (title, snippet, url). Judge each claim using BOTH sources of evidence.
Return STRICT JSON:
{"results":[{"claim":"<the claim>","verdict":"accurate"|"inaccurate"|"unverifiable","support":"well-supported"|"weak"|"unsupported","flag":"needs_source"|"overclaimed"|null,"correction":"<corrected statement if inaccurate, else empty>","explanation":"<one sentence on what the evidence shows>","source_number":<the number of the single best supporting/contradicting result, or null>}]}
Rules:
- verdict: "accurate" = the claim matches the evidence; "inaccurate" = the evidence clearly contradicts it (give a correction); "unverifiable" = evidence is insufficient or absent.
- support: how strongly the evidence backs the claim — "well-supported" (clear corroboration), "weak" (partial/indirect only), or "unsupported" (no real evidence found).
- flag: set to
  - "needs_source" when the claim is a specific factual/statistical/attributed assertion that has NO citation in the text AND no corroborating web result (i.e. it should be backed by a source but isn't);
  - "overclaimed" when the wording is absolute or universal (e.g. "proves", "always", "never", "everyone", "the first/only", "guarantees") but the evidence supports only a qualified/partial version;
  - otherwise null.
- correction: only when verdict is "inaccurate" (or an "overclaimed" claim that should be softened) — else empty.
- source_number MUST be one of the provided result numbers for that claim, or null. NEVER invent a URL or cite a result that wasn't provided.
- Judge from evidence, not assumptions. Prefer authoritative, current sources. Return one entry per claim, in order.`;

type Verdict = "accurate" | "inaccurate" | "unverifiable";
type Support = "well-supported" | "weak" | "unsupported";
type Flag = "needs_source" | "overclaimed" | null;
type VerifyItem = {
  claim: string;
  verdict: Verdict;
  support: Support;
  flag: Flag;
  correction: string;
  explanation: string;
  source_number: number | null;
};

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const writing = (body.writing || "").trim();
  if (writing.length < 20) {
    return NextResponse.json({ results: [], message: "Write a bit more to fact-check." });
  }

  const db = createServiceSupabase();

  // 1. Extract checkable claims (with the verbatim quote from the passage).
  let claimObjs: { claim: string; quote: string }[] = [];
  try {
    const extracted = await llmJSON<{
      claims: { claim: string; quote: string }[];
    }>(EXTRACT_SYSTEM, `PASSAGE:\n"""${writing}"""`, {
      temperature: 0.2,
      maxOutputTokens: 700,
    });
    claimObjs = (extracted.claims ?? [])
      .slice(0, 5)
      .filter((c) => c && c.claim && c.claim.trim());
  } catch {
    return NextResponse.json(
      { results: [], message: "Couldn't analyze the text right now — try again." },
      { status: 200 }
    );
  }

  if (claimObjs.length === 0) {
    return NextResponse.json({ results: [], message: "No checkable factual claims found." });
  }

  const claims = claimObjs.map((c) => c.claim);

  // 2. Web evidence for each claim (best-effort).
  const perClaimResults = await Promise.all(
    claims.map(async (claim) => {
      try {
        const r = await tavilySearch(claim, { maxResults: 3, searchDepth: "basic" });
        return r;
      } catch {
        return [] as TavilyResult[];
      }
    })
  );

  // 3. User's notes (for the "against your own knowledge" half).
  const { data: notes } = await db
    .from("knowledge_notes")
    .select("content")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(40);
  const notesText = (notes ?? []).map((n, i) => `${i + 1}. ${n.content}`).join("\n") || "(none)";

  // Build the verification prompt with numbered results per claim.
  const claimsBlock = claims
    .map((claim, ci) => {
      const results = perClaimResults[ci];
      const resultLines =
        results.length > 0
          ? results
              .map(
                (r, ri) =>
                  `   [${ri + 1}] ${r.title}\n       url: ${r.url}\n       snippet: ${(r.content || "").slice(0, 300)}`
              )
              .join("\n")
          : "   (no web results found)";
      return `CLAIM ${ci + 1}: ${claim}\n SEARCH RESULTS:\n${resultLines}`;
    })
    .join("\n\n");

  // 4. Verify.
  let verified: { results: VerifyItem[] };
  try {
    verified = await llmJSON<{ results: VerifyItem[] }>(
      VERIFY_SYSTEM,
      `NOTES (the user's own knowledge):\n${notesText}\n\n${claimsBlock}`,
      { temperature: 0.2, maxOutputTokens: 1500 }
    );
  } catch {
    return NextResponse.json(
      { results: [], message: "Fact-check is busy (rate limit) — try again in a moment." },
      { status: 200 }
    );
  }

  // 5. Map source_number -> real URL from that claim's Tavily results.
  const results = (verified.results ?? []).map((item, i) => {
    const claimResults = perClaimResults[i] ?? [];
    let source: { title: string; url: string } | null = null;
    if (
      typeof item.source_number === "number" &&
      item.source_number >= 1 &&
      item.source_number <= claimResults.length
    ) {
      const r = claimResults[item.source_number - 1];
      source = { title: r.title, url: r.url };
    }
    const flag: Flag =
      item.flag === "needs_source" || item.flag === "overclaimed"
        ? item.flag
        : null;
    return {
      claim: item.claim || claims[i] || "",
      quote: claimObjs[i]?.quote || "",
      verdict: item.verdict,
      support: item.support || "weak",
      flag,
      correction: item.correction || "",
      explanation: item.explanation || "",
      source,
    };
  });

  return NextResponse.json({ results });
}
