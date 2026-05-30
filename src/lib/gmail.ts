import { createServiceSupabase } from "@/lib/supabase/server";

// Gmail read-only helpers. Tokens are stored per-user in gmail_tokens.

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function googleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT!,
    response_type: "code",
    scope: GMAIL_SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(code: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: process.env.GOOGLE_OAUTH_REDIRECT!,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>;
}

async function refreshToken(refresh_token: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

// Returns a valid access token for the user, refreshing if expired.
async function getValidAccessToken(userId: string): Promise<string | null> {
  const db = createServiceSupabase();
  const { data } = await db
    .from("gmail_tokens")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;

  const expired = data.expiry && new Date(data.expiry).getTime() < Date.now() + 60_000;
  if (expired && data.refresh_token) {
    const refreshed = await refreshToken(data.refresh_token);
    const expiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await db
      .from("gmail_tokens")
      .update({ access_token: refreshed.access_token, expiry })
      .eq("user_id", userId);
    return refreshed.access_token;
  }
  return data.access_token;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf-8"
  );
}

// Walks a Gmail message payload and concatenates text/plain parts.
function extractText(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    return payload.parts.map(extractText).filter(Boolean).join("\n");
  }
  if (payload.body?.data && payload.mimeType?.startsWith("text/")) {
    return decodeBase64Url(payload.body.data);
  }
  return "";
}

/**
 * Fetch the most recent relevant thread as plain text. `query` is an optional
 * Gmail search string (e.g. keywords from the current task). Falls back to the
 * latest inbox thread.
 */
export async function fetchRecentThreadText(
  userId: string,
  query?: string
): Promise<{ text: string; subject: string } | null> {
  const token = await getValidAccessToken(userId);
  if (!token) return null;
  const auth = { Authorization: `Bearer ${token}` };

  const q = query?.trim()
    ? `${query.trim()} -in:chats`
    : "in:inbox -category:promotions -category:social";
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=1&q=${encodeURIComponent(q)}`,
    { headers: auth }
  );
  if (!listRes.ok) return null;
  const list = await listRes.json();
  const threadId = list.threads?.[0]?.id;
  if (!threadId) return null;

  const threadRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
    { headers: auth }
  );
  if (!threadRes.ok) return null;
  const thread = await threadRes.json();

  let subject = "(no subject)";
  const parts: string[] = [];
  for (const msg of thread.messages ?? []) {
    const headers = msg.payload?.headers ?? [];
    const from = headers.find((h: any) => h.name === "From")?.value ?? "";
    const subj = headers.find((h: any) => h.name === "Subject")?.value;
    if (subj && subject === "(no subject)") subject = subj;
    const text = extractText(msg.payload).trim();
    if (text) parts.push(`From: ${from}\n${text}`);
  }

  return { text: parts.join("\n\n---\n\n").slice(0, 8000), subject };
}
