// Provider-agnostic LLM client. Currently targets Groq's OpenAI-compatible
// Chat Completions API (free tier, no billing required). All AI behaviour in
// Cortex goes through this module — no stubs; every call hits the live API.
//
// Configure with:
//   GROQ_API_KEY   (required)
//   GROQ_MODEL     (optional, defaults below)

export const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

type LLMOptions = {
  /** Request strict JSON output (response_format json_object). */
  json?: boolean;
  /** Sampling temperature. Lower = more deterministic. Defaults to 0.3. */
  temperature?: number;
  maxOutputTokens?: number;
};

function getKey(): string {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is not set in the environment.");
  }
  return key;
}

/**
 * Single-turn completion with an explicit system instruction.
 * Returns the assistant message text.
 */
export async function llmGenerate(
  systemPrompt: string,
  userPrompt: string,
  opts: LLMOptions = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxOutputTokens ?? 2048,
    ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getKey()}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`LLM API error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const text: string | undefined = data?.choices?.[0]?.message?.content;
  if (text === undefined || text === null) {
    throw new Error("LLM returned no message content.");
  }
  return text.trim();
}

/**
 * Convenience wrapper that parses JSON output, tolerating ```json fences.
 */
export async function llmJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  opts: Omit<LLMOptions, "json"> = {}
): Promise<T> {
  const raw = await llmGenerate(systemPrompt, userPrompt, { ...opts, json: true });
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Could not parse LLM JSON output: ${raw}`);
  }
}
