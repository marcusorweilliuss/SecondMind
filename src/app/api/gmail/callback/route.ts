import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { exchangeCode } from "@/lib/gmail";

export const runtime = "nodejs";

// OAuth redirect target. Exchanges the code, stores tokens for the user
// (carried in `state`), then renders a tiny page that closes the popup.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const userId = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code || !userId) {
    return closePopup(`Gmail connection failed: ${error || "missing code"}`);
  }

  try {
    const tokens = await exchangeCode(code);
    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Fetch the connected email address for display.
    let email: string | null = null;
    const profileRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );
    if (profileRes.ok) {
      const profile = await profileRes.json();
      email = profile.emailAddress ?? null;
    }

    const db = createServiceSupabase();
    await db.from("gmail_tokens").upsert({
      user_id: userId,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      expiry,
      email,
    });

    return closePopup("Gmail connected. You can close this window.");
  } catch (e) {
    return closePopup(`Gmail connection failed: ${String(e)}`);
  }
}

function closePopup(message: string) {
  const html = `<!doctype html><html><body style="background:#0a0a0b;color:#e8e8ea;font-family:ui-monospace,monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center">
    <p>${message}</p>
    <script>
      if (window.opener) { window.opener.postMessage({ type: 'cortex-gmail-connected' }, '*'); }
      setTimeout(() => window.close(), 1200);
    </script>
  </div></body></html>`;
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
