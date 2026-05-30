import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// List knowledge notes.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("knowledge_notes")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: data });
}

// Create a knowledge note.
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const content = (body.content || "").trim();
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t: string) => String(t).trim()).filter(Boolean)
    : null;

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("knowledge_notes")
    .insert({
      user_id: user.id,
      content,
      tags,
      source_url: (body.source_url || "").trim() || null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
