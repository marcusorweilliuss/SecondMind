// Tavily search API client. Used by the Radar (Behaviour 4) to find recent
// news and foundational pieces for each interest vector.

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
};

type TavilySearchOptions = {
  /** "day" | "week" | "month" | "year" — Tavily's time window. */
  days?: number;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  topic?: "general" | "news";
};

function getKey(): string {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw new Error("TAVILY_API_KEY is not set in the environment.");
  }
  return key;
}

export async function tavilySearch(
  query: string,
  opts: TavilySearchOptions = {}
): Promise<TavilyResult[]> {
  const body: Record<string, unknown> = {
    api_key: getKey(),
    query,
    search_depth: opts.searchDepth ?? "advanced",
    max_results: opts.maxResults ?? 6,
    include_answer: false,
    include_raw_content: false,
    topic: opts.topic ?? "general",
  };
  if (opts.days) body.days = opts.days;

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Tavily API error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  return (data?.results ?? []) as TavilyResult[];
}
