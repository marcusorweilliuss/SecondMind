import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { googleAuthUrl } from "@/lib/gmail";

export const runtime = "nodejs";

// Kicks off the Gmail read-only OAuth flow. Opened in a popup from the Focus
// page. State carries the user id so the callback can attribute the token.
export async function GET(_req: NextRequest) {
  const supabase = createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.GOOGLE_CLIENT_ID) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID not configured" },
      { status: 500 }
    );
  }

  return NextResponse.redirect(googleAuthUrl(user.id));
}
