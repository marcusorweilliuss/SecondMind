import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { llmJSON } from "@/lib/llm";

export const runtime = "nodejs";

// Step 6 — "Things to consider".
// A structured critique of the draft: supporting points, tensions, future work,
// and open questions — grounded in the actual text (and the active task).

const SYSTEM = `You are a sharp, constructive thinking partner for a writer. Read the DRAFT (and the writer's TASK if given) and surface what's worth considering next.
Return STRICT JSON:
{
  "supporting_points": ["<a point that would strengthen the argument, grounded in the draft>", ...],
  "tensions": ["<an internal contradiction, counterpoint, or weak link in the draft>", ...],
  "future_work": ["<a concrete next step or extension the draft implies>", ...],
  "open_questions": ["<an unresolved question the draft raises but doesn't answer>", ...]
}
Rules:
- 2 to 4 items per list. Each item is one concise, specific sentence tied to the ACTUAL content of the draft — no generic writing advice or filler.
- If a list genuinely has nothing substantive, return an empty array for it rather than padding.
- Be direct and useful, not flattering.`;

type Consider = {
  supporting_points: string[];
  tensions: string[];
  future_work: string[];
  open_questions: string[];
};

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const writing = (body.writing || "").trim();
  if (writing.length < 40) {
    return NextResponse.json({
      consider: null,
      message: "Write a bit more and I'll surface things to consider.",
    });
  }

  // Include the active task for framing, if set.
  const db = createServiceSupabase();
  const { data: task } = await db
    .from("task_contexts")
    .select("task_description")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const taskText = task?.task_description
    ? `TASK: ${task.task_description}\n\n`
    : "";

  let consider: Consider;
  try {
    consider = await llmJSON<Consider>(
      SYSTEM,
      `${taskText}DRAFT:\n"""${writing.slice(0, 8000)}"""`,
      { temperature: 0.4, maxOutputTokens: 900 }
    );
  } catch {
    return NextResponse.json(
      { consider: null, message: "Couldn't analyze the draft right now — try again." },
      { status: 200 }
    );
  }

  const clean = (arr: unknown): string[] =>
    Array.isArray(arr)
      ? arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 4)
      : [];

  return NextResponse.json({
    consider: {
      supporting_points: clean(consider.supporting_points),
      tensions: clean(consider.tensions),
      future_work: clean(consider.future_work),
      open_questions: clean(consider.open_questions),
    },
  });
}
