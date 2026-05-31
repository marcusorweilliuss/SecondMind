import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { MODEL } from "@/lib/llm";

export const runtime = "nodejs";

// Diagnostic endpoint. Reports which keys are present (booleans only, never the
// values), whether the request is authenticated, and whether a live LLM call
// succeeds. Visit /api/health in the browser while logged in.
export async function GET(req: NextRequest) {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    GROQ_API_KEY: !!process.env.GROQ_API_KEY,
    TAVILY_API_KEY: !!process.env.TAVILY_API_KEY,
  };

  // Is the caller authenticated (cookie session)?
  let authenticated = false;
  try {
    const user = await getUser(req);
    authenticated = !!user;
  } catch {
    authenticated = false;
  }

  // Live LLM ping (Groq).
  let llm: { ok: boolean; model: string; status?: number; error?: string } = {
    ok: false,
    model: MODEL,
  };
  if (env.GROQ_API_KEY) {
    try {
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 5,
          }),
        }
      );
      llm = res.ok
        ? { ok: true, model: MODEL, status: res.status }
        : {
            ok: false,
            model: MODEL,
            status: res.status,
            error: (await res.text()).slice(0, 800),
          };
    } catch (e) {
      llm = { ok: false, model: MODEL, error: String(e).slice(0, 800) };
    }
  } else {
    llm = { ok: false, model: MODEL, error: "GROQ_API_KEY not set" };
  }

  return NextResponse.json({ env, authenticated, llm });
}
