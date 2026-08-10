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
  /** Restrict to these domains (Tavily include_domains). */
  includeDomains?: string[];
};

export type Credibility = "high" | "medium" | "unknown";

function getKey(): string {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    throw new Error("TAVILY_API_KEY is not set in the environment.");
  }
  return key;
}

// Domains/TLDs we treat as generally authoritative for fact-checking.
const HIGH_TLDS = [".gov", ".edu", ".mil", ".int", ".ac.uk", ".gov.uk", ".edu.au"];
const HIGH_DOMAINS = [
  "who.int",
  "un.org",
  "worldbank.org",
  "oecd.org",
  "imf.org",
  "nih.gov",
  "cdc.gov",
  "nasa.gov",
  "nature.com",
  "science.org",
  "sciencedirect.com",
  "springer.com",
  "ieee.org",
  "acm.org",
  "jstor.org",
  "pubmed.ncbi.nlm.nih.gov",
  "ncbi.nlm.nih.gov",
  "britannica.com",
  "reuters.com",
  "apnews.com",
  "bbc.co.uk",
  "bbc.com",
  "economist.com",
  "ft.com",
  "nytimes.com",
  "wsj.com",
  "washingtonpost.com",
  "theguardian.com",
  "snopes.com",
  "politifact.com",
  "factcheck.org",
  "wikipedia.org",
];
const MEDIUM_DOMAINS = [
  "medium.com",
  "substack.com",
  "forbes.com",
  "businessinsider.com",
  "cnbc.com",
  "wired.com",
  "arstechnica.com",
  "theverge.com",
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function credibilityOf(url: string): Credibility {
  const host = domainOf(url);
  if (!host) return "unknown";
  if (HIGH_TLDS.some((t) => host.endsWith(t))) return "high";
  if (HIGH_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return "high";
  if (MEDIUM_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return "medium";
  return "unknown";
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
  if (opts.includeDomains && opts.includeDomains.length) {
    body.include_domains = opts.includeDomains;
  }

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

/**
 * Search prioritising authoritative sources: one pass restricted to a curated
 * high-credibility allowlist, merged (dedup by url, high-credibility first)
 * with a general pass. Never throws to the caller past the general pass.
 */
export async function tavilySearchAuthoritative(
  query: string,
  opts: TavilySearchOptions = {}
): Promise<TavilyResult[]> {
  const max = opts.maxResults ?? 4;
  const allowlist = [...HIGH_DOMAINS, "gov", "edu"];

  const [general, authoritative] = await Promise.all([
    tavilySearch(query, { ...opts, maxResults: max }),
    tavilySearch(query, {
      ...opts,
      maxResults: max,
      includeDomains: allowlist,
    }).catch(() => [] as TavilyResult[]),
  ]);

  // Merge: authoritative first, then general; dedup by url; re-rank by credibility.
  const byUrl = new Map<string, TavilyResult>();
  for (const r of [...authoritative, ...general]) {
    if (r.url && !byUrl.has(r.url)) byUrl.set(r.url, r);
  }
  const rank = (u: string) =>
    ({ high: 0, medium: 1, unknown: 2 })[credibilityOf(u)];
  return Array.from(byUrl.values())
    .sort((a, b) => rank(a.url) - rank(b.url))
    .slice(0, Math.max(max, 4));
}
