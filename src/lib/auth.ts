import { NextRequest } from "next/server";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

export type AuthedUser = { id: string; email?: string };

/**
 * Resolve the calling user for an API route.
 *
 * Two paths are supported:
 *  1. Web app — the Supabase session cookie (set by the browser client).
 *  2. Chrome extension — an `Authorization: Bearer <access_token>` header,
 *     where the token is a Supabase access token the extension obtained by
 *     signing in via the popup.
 *
 * Returns null when neither yields a valid user.
 */
export async function getUser(req: NextRequest): Promise<AuthedUser | null> {
  // 1. Bearer token (extension).
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    const svc = createServiceSupabase();
    const { data, error } = await svc.auth.getUser(token);
    if (!error && data.user) {
      return { id: data.user.id, email: data.user.email ?? undefined };
    }
  }

  // 2. Cookie session (web app).
  const supabase = createServerSupabase();
  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) {
    return { id: data.user.id, email: data.user.email ?? undefined };
  }

  return null;
}
