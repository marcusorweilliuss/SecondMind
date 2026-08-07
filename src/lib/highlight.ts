// Locating flagged claims inside the user's actual text — robust to the AI
// rewording the quote and to Word's search limitations.

export type Span = { start: number; end: number };

function normToken(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokenize(s: string): string[] {
  return s
    .split(/\s+/)
    .map(normToken)
    .filter((w) => w.length > 2);
}

// Split text into sentence-ish segments, tracking original offsets.
export function splitSentences(text: string): Span[] {
  const parts: Span[] = [];
  let start = 0;
  const re = /[.!?](?=\s|$)|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (text.slice(start, end).trim().length) parts.push({ start, end });
    start = end;
  }
  if (start < text.length && text.slice(start).trim().length) {
    parts.push({ start, end: text.length });
  }
  return parts.map((p) => trimSpan(text, p));
}

function trimSpan(text: string, span: Span): Span {
  let { start, end } = span;
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return { start, end };
}

// Build a normalized copy (lowercase, collapsed whitespace, straightened
// quotes/dashes) plus a map from each normalized index back to the original.
function buildNormalized(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (/\s/.test(c)) {
      if (prevSpace) continue;
      norm += " ";
      map.push(i);
      prevSpace = true;
      continue;
    }
    prevSpace = false;
    c = c.toLowerCase();
    if (c === "‘" || c === "’") c = "'";
    else if (c === "“" || c === "”") c = '"';
    else if (c === "–" || c === "—") c = "-";
    norm += c;
    map.push(i);
  }
  return { norm, map };
}

function normalizeQuote(q: string): string {
  return buildNormalized(q).norm.trim();
}

/**
 * Find the span in `text` that best matches `quote`.
 * 1) Normalized substring match — tolerant of whitespace/case/quote/dash
 *    differences, mapped back to the exact original span. (Confident.)
 * 2) IDF-weighted sentence match — tolerant of light rewording, but SKIPS
 *    (returns null) when the best sentence isn't a clear winner, so it never
 *    highlights the wrong sentence.
 */
export function locateClaim(text: string, quote: string): Span | null {
  const qClean = (quote || "").trim();
  if (qClean.length < 6) return null;

  // 1) Normalized substring.
  const { norm, map } = buildNormalized(text);
  const qn = normalizeQuote(qClean);
  if (qn.length >= 6) {
    const at = norm.indexOf(qn);
    if (at !== -1) {
      const start = map[at];
      const end = map[at + qn.length - 1] + 1;
      return trimSpan(text, { start, end });
    }
  }

  // 2) IDF-weighted sentence match.
  const qTokens = new Set(tokenize(qClean));
  if (qTokens.size === 0) return null;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return null;

  const df = new Map<string, number>();
  const sentTokenSets = sentences.map((s) => {
    const set = new Set(tokenize(text.slice(s.start, s.end)));
    for (const t of set) df.set(t, (df.get(t) || 0) + 1);
    return set;
  });
  const N = sentences.length;
  const idf = (t: string) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 0.1;

  let qTotal = 0;
  for (const t of qTokens) qTotal += idf(t);
  if (qTotal === 0) return null;

  let bestI = -1;
  let best = 0;
  let second = 0;
  sentences.forEach((_s, i) => {
    let sc = 0;
    for (const t of qTokens) if (sentTokenSets[i].has(t)) sc += idf(t);
    const score = sc / qTotal;
    if (score > best) {
      second = best;
      best = score;
      bestI = i;
    } else if (score > second) {
      second = score;
    }
  });

  // Confident only when the match is strong AND clearly beats the runner-up.
  // When in doubt, return null: a missing highlight is fine (the finding still
  // shows in the list); a highlight on the WRONG sentence would mislead.
  if (bestI >= 0 && best >= 0.66 && best - second >= 0.3) {
    return sentences[bestI];
  }
  return null;
}

/**
 * Break a span of text into pieces Word's search can handle: within a single
 * paragraph (no line breaks) and under Word's ~255-char search limit.
 */
export function chunkForWordSearch(segment: string): string[] {
  const out: string[] = [];
  const paragraphs = segment.split(/[\r\n\v\f]+/);
  for (const para of paragraphs) {
    let p = para.trim();
    if (!p) continue;
    while (p.length > 200) {
      let cut = p.lastIndexOf(" ", 200);
      if (cut <= 0) cut = 200;
      out.push(p.slice(0, cut).trim());
      p = p.slice(cut).trim();
    }
    if (p) out.push(p);
  }
  return out.filter((c) => c.length >= 4);
}
