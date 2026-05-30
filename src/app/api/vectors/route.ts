import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// List active interest vectors.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("interest_vectors")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vectors: data });
}

// Add a manual interest vector.
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const vectorText = (body.vector_text || "").trim();
  if (!vectorText) {
    return NextResponse.json({ error: "vector_text is required" }, { status: 400 });
  }

  const db = createServiceSupabase();
  const { data, error } = await db
    .from("interest_vectors")
    .insert({ user_id: user.id, vector_text: vectorText, source: "manual", active: true })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ vector: data });
}

// Soft-delete (deactivate) a vector.
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = createServiceSupabase();
  const { error } = await db
    .from("interest_vectors")
    .update({ active: false })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
