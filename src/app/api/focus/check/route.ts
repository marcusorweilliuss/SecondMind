import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";

export const runtime = "nodejs";

// Behaviour 2 — Focus + Fact Guard.
// Given the user's current writing, the active task context, and their
// knowledge notes, returns (a) whether the writing has drifted off-task and
// (b) any factual claim that contradicts a stored note.

const SYSTEM = `You are Cortex, a focus-and-fact guardian for a researcher who is writing.
You receive:
- TASK: a description of what the user is currently working on and their priorities.
- WRITING: the text the user has written so far.
- NOTES: a numbered list of the user's own previously-recorded factual notes.

Perform TWO independent checks and return STRICT JSON:
{
  "drift": {
    "off_track": <boolean>,
    "reason": "<one short sentence explaining the drift, or empty string>"
  },
  "contradiction": {
    "found": <boolean>,
    "note_index": <number or null>,
    "claim": "<the user's claim that conflicts, or empty string>",
    "note_text": "<the conflicting note text, or empty string>"
  }
}

DRIFT rules:
- off_track = true ONLY if the WRITING has clearly diverged from the TASK's topic/priorities. Mild tangents are fine; require a SIGNIFICANT divergence.
- If the writing is empty, too short to judge, or on-topic, off_track = false.

CONTRADICTION rules:
- found = true ONLY if a factual claim in WRITING directly conflicts with a specific NOTE. Be conservative — do not flag mere differences in phrasing or topics the notes don't cover.
- When found, set note_index to the conflicting note's number, claim to the user's conflicting sentence, and note_text to the note it contradicts.
- If nothing conflicts, found = false and the rest empty/null.`;

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const writing = (body.writing || "").trim();
  if (writing.length < 20) {
    // Too little to judge — return a quiet all-clear.
    return NextResponse.json({
      drift: { off_track: false, reason: "" },
      contradiction: { found: false, note_index: null, claim: "", note_text: "" },
    });
  }

  const db = createServiceSupabase();
  const [{ data: task }, { data: notes }] = await Promise.all([
    db
      .from("task_contexts")
      .select("task_description, email_thread_text")
      .eq("user_id", user.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("knowledge_notes")
      .select("id, content")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const taskText = task
    ? [task.task_description, task.email_thread_text].filter(Boolean).join("\n\n")
    : "(no task context set)";

  const noteList = (notes ?? [])
    .map((n, i) => `${i + 1}. ${n.content}`)
    .join("\n");

  const result = await llmJSON<{
    drift: { off_track: boolean; reason: string };
    contradiction: {
      found: boolean;
      note_index: number | null;
      claim: string;
      note_text: string;
    };
  }>(
    SYSTEM,
    `TASK:\n${taskText}\n\nWRITING:\n"""${writing}"""\n\nNOTES:\n${noteList || "(none)"}`,
    { temperature: 0.2, maxOutputTokens: 400 }
  );

  // Attach the note id when a contradiction references one.
  let noteId: string | null = null;
  if (
    result.contradiction?.found &&
    typeof result.contradiction.note_index === "number" &&
    notes
  ) {
    const idx = result.contradiction.note_index - 1;
    if (idx >= 0 && idx < notes.length) noteId = notes[idx].id;
  }

  return NextResponse.json({
    drift: result.drift,
    contradiction: { ...result.contradiction, note_id: noteId },
  });
}
