import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { fetchRecentThreadText } from "@/lib/gmail";

export const runtime = "nodejs";

// Connection status.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceSupabase();
  const { data } = await db
    .from("gmail_tokens")
    .select("email")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({ connected: !!data, email: data?.email ?? null });
}

// Pull the most recent relevant thread. Optional `query` narrows the search
// (e.g. keywords from the current task).
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const query = (body.query || "").trim() || undefined;

  const thread = await fetchRecentThreadText(user.id, query);
  if (!thread) {
    return NextResponse.json(
      { error: "Gmail not connected or no thread found." },
      { status: 404 }
    );
  }
  return NextResponse.json(thread);
}
