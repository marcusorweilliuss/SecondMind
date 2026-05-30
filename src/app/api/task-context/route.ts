import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Get the active task context.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("task_contexts")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ taskContext: data });
}

// Set a new active task context (deactivates prior ones).
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const taskDescription = (body.task_description || "").trim();
  if (!taskDescription) {
    return NextResponse.json(
      { error: "task_description is required" },
      { status: 400 }
    );
  }

  const db = createServiceSupabase();
  await db
    .from("task_contexts")
    .update({ active: false })
    .eq("user_id", user.id)
    .eq("active", true);

  const { data, error } = await db
    .from("task_contexts")
    .insert({
      user_id: user.id,
      task_description: taskDescription,
      email_thread_text: (body.email_thread_text || "").trim() || null,
      active: true,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ taskContext: data });
}
