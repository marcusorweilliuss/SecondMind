// Google Gemini 1.5 Flash via the REST API.
// All AI behaviour in Cortex goes through this module. No stubs — every call
// hits the live generateContent endpoint.

const MODEL = "gemini-1.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

type GeminiOptions = {
  /** Ask Gemini to return strict JSON (response_mime_type=application/json). */
  json?: boolean;
  /** Sampling temperature. Lower = more deterministic. Defaults to 0.3. */
  temperature?: number;
  maxOutputTokens?: number;
};

function getKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set in the environment.");
  }
  return key;
}

/**
 * Run a single-turn Gemini generation with an explicit system instruction.
 * Returns the raw text of the first candidate.
 */
export async function geminiGenerate(
  systemPrompt: string,
  userPrompt: string,
  opts: GeminiOptions = {}
): Promise<string> {
  const body: Record<string, unknown> = {
    systemInstruction: {
      role: "system",
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };

  const res = await fetch(`${ENDPOINT}?key=${getKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? undefined;

  if (text === undefined) {
    throw new Error("Gemini returned no text candidate.");
  }
  return text.trim();
}

/**
 * Convenience wrapper that parses Gemini's JSON output. Strips ```json fences
 * if the model wraps the payload despite the JSON mime type.
 */
export async function geminiJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  opts: Omit<GeminiOptions, "json"> = {}
): Promise<T> {
  const raw = await geminiGenerate(systemPrompt, userPrompt, {
    ...opts,
    json: true,
  });
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Last-ditch: extract the first {...} or [...] block.
    const match = cleaned.match(/[[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error(`Could not parse Gemini JSON output: ${raw}`);
  }
}
