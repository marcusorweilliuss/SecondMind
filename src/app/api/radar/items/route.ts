import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// List non-dismissed radar items, optionally filtered by type or project.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const type = req.nextUrl.searchParams.get("type");
  const projectId = req.nextUrl.searchParams.get("project_id");

  const db = createServiceSupabase();
  let query = db
    .from("radar_items")
    .select("*")
    .eq("user_id", user.id)
    .eq("dismissed", false)
    .order("relevance_score", { ascending: false })
    .order("created_at", { ascending: false });

  if (type) query = query.eq("type", type);
  if (projectId) query = query.eq("saved_to_project_id", projectId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also return the last-updated timestamp (newest radar item created_at).
  const lastUpdated = data?.[0]?.created_at ?? null;
  return NextResponse.json({ items: data, lastUpdated });
}

// Dismiss an item or save it to a project.
export async function PATCH(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, action, project_id } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = createServiceSupabase();

  if (action === "dismiss") {
    const { error } = await db
      .from("radar_items")
      .update({ dismissed: true })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === "save") {
    if (!project_id) {
      return NextResponse.json({ error: "project_id is required to save" }, { status: 400 });
    }
    // Mark the radar item saved, and create a signal in the project so it
    // shows up in the project folder alongside captured highlights.
    const { data: item, error: fetchErr } = await db
      .from("radar_items")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    if (fetchErr || !item) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    await db
      .from("radar_items")
      .update({ saved_to_project_id: project_id })
      .eq("id", id)
      .eq("user_id", user.id);

    await db.from("signals").insert({
      user_id: user.id,
      project_id,
      highlight_text: item.headline,
      source_url: item.url,
      source_title: item.source,
      signal_summary: item.why_read,
      connected_to: `Surfaced by Radar via interest vector: ${item.interest_vector ?? "—"}`,
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
