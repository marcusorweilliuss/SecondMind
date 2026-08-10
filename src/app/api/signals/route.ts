import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { llmGenerate, llmJSON } from "@/lib/llm";

export const runtime = "nodejs";

// Behaviour 1 — Signal capture.
// Receives a highlight from the Chrome extension, asks Gemini to summarise it
// and name a connection to related prior signals/notes, then files it.

type CaptureBody = {
  highlight_text: string;
  source_url?: string;
  source_title?: string;
  project_id?: string | null;
  /** "self" marks a passage of the user's own writing (vs a web capture). */
  origin?: "self" | "web";
};

const SUMMARY_SYSTEM = `You are Cortex, a research assistant that distils highlighted text into a single crisp sentence.
Rules:
- Output exactly ONE declarative sentence capturing the core claim or idea of the highlight.
- No preamble, no quotation marks, no "This highlight...". Just the sentence.
- Preserve specific entities, numbers, and named concepts.`;

const CONNECTION_SYSTEM = `You are Cortex, a research assistant that finds the intellectual through-line between a new highlight and a researcher's existing material.
You are given: (1) a NEW highlight and its one-sentence summary, and (2) a numbered list of the researcher's PRIOR signals and notes.
Decide whether the new highlight is thematically connected to any prior item.
Return STRICT JSON: {"connected_index": <number or null>, "connection": "<one sentence naming the relationship, or empty string if none>"}
Rules:
- "connected_index" is the number of the single most related prior item, or null if nothing is genuinely related.
- "connection" must NAME the relationship (e.g. "Extends...", "Contradicts...", "Provides evidence for...", "Bridges to..."), referencing the prior item's idea concretely. One sentence.
- Do NOT invent connections. If nothing is related, return null and an empty string.`;

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CaptureBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const highlight = (body.highlight_text || "").trim();
  if (!highlight) {
    return NextResponse.json({ error: "highlight_text is required" }, { status: 400 });
  }

  const isSelf = body.origin === "self";
  // Label self-authored passages distinctly from web captures.
  const sourceTitle = body.source_title || (isSelf ? "My writing" : null);

  const db = createServiceSupabase();

  // (a) Summarise the highlight.
  const signalSummary = await llmGenerate(
    SUMMARY_SYSTEM,
    `Highlight:\n"""${highlight}"""\n\nSource: ${sourceTitle || "unknown"} (${body.source_url || "n/a"})`,
    { temperature: 0.2, maxOutputTokens: 120 }
  );

  // (b) Pull prior signals + notes to search for thematic relations.
  const [{ data: priorSignals }, { data: priorNotes }] = await Promise.all([
    db
      .from("signals")
      .select("id, signal_summary, highlight_text, project_id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
    db
      .from("knowledge_notes")
      .select("id, content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  const priorItems = [
    ...(priorSignals ?? []).map((s) => ({
      kind: "signal" as const,
      id: s.id,
      text: s.signal_summary || s.highlight_text,
    })),
    ...(priorNotes ?? []).map((n) => ({
      kind: "note" as const,
      id: n.id,
      text: n.content,
    })),
  ];

  // (c) Generate a named connection to the most related prior item.
  let connectedTo: string | null = null;
  if (priorItems.length > 0) {
    const list = priorItems
      .map((it, i) => `${i + 1}. [${it.kind}] ${it.text}`)
      .join("\n");
    try {
      const result = await llmJSON<{
        connected_index: number | null;
        connection: string;
      }>(
        CONNECTION_SYSTEM,
        `NEW highlight summary: "${signalSummary}"\nNEW highlight text: """${highlight}"""\n\nPRIOR items:\n${list}`,
        { temperature: 0.3, maxOutputTokens: 200 }
      );
      if (result.connection && result.connection.trim()) {
        connectedTo = result.connection.trim();
      }
    } catch {
      // If the connection step fails, still save the signal without one.
      connectedTo = null;
    }
  }

  // Auto-file into the active project (may be null = unfiled).
  const projectId = body.project_id || null;

  const { data: inserted, error } = await db
    .from("signals")
    .insert({
      user_id: user.id,
      project_id: projectId,
      highlight_text: highlight,
      source_url: body.source_url || null,
      source_title: sourceTitle,
      signal_summary: signalSummary,
      connected_to: connectedTo,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve the project name for the toast.
  let projectName: string | null = null;
  if (projectId) {
    const { data: proj } = await db
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single();
    projectName = proj?.name ?? null;
  }

  return NextResponse.json({
    signal: { ...inserted, project_name: projectName },
  });
}
