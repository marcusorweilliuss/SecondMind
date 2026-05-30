import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { geminiJSON } from "@/lib/gemini";

export const runtime = "nodejs";

// Behaviour 3 — Auto-table.
// Scans the last ~200 words and decides whether the prose describes a
// comparison of 3+ things across 2+ attributes that would read better as a
// table. If so, returns the table structure as markdown + rows.

const SYSTEM = `You are Cortex, a writing assistant that detects when prose would be clearer as a table.
You receive a passage of the user's recent writing.
Decide whether it describes a COMPARISON of THREE OR MORE distinct items across TWO OR MORE shared attributes.

Return STRICT JSON:
{
  "is_table": <boolean>,
  "headers": ["<attribute/column names, first column is the item label>"],
  "rows": [["<cell>", "..."]],
  "markdown": "<the full table as a GitHub-flavored markdown table, or empty string>"
}

Rules:
- is_table = true ONLY when there are >= 3 comparable items AND >= 2 attributes that apply across them. Otherwise is_table = false and the other fields empty.
- The first column header should label the items (e.g. "Approach", "Model", "Option").
- Keep cell text concise; pull values directly from the passage. Do not invent data — if an attribute is missing for an item, use "—".
- "markdown" must be a valid markdown table matching headers/rows exactly.`;

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = (body.text || "").trim();

  // Take the last ~200 words.
  const words = text.split(/\s+/);
  const passage = words.slice(-200).join(" ");

  if (passage.split(/\s+/).length < 25) {
    return NextResponse.json({ is_table: false });
  }

  const result = await geminiJSON<{
    is_table: boolean;
    headers: string[];
    rows: string[][];
    markdown: string;
  }>(SYSTEM, `PASSAGE:\n"""${passage}"""`, {
    temperature: 0.2,
    maxOutputTokens: 700,
  });

  if (!result.is_table) return NextResponse.json({ is_table: false });

  return NextResponse.json({
    is_table: true,
    headers: result.headers ?? [],
    rows: result.rows ?? [],
    markdown: result.markdown ?? "",
  });
}
