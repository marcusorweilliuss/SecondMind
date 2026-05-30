# Cortex

A personal cognition layer — a Next.js web app plus a Chrome extension that
watches what you read and write, then intervenes usefully.

Four behaviours:

1. **Signal capture** (extension) — highlight text anywhere; Gemini summarises
   it, names a connection to your past material, and files it into your active
   project.
2. **Focus + Fact Guard** (web) — set a task, write, and get nudged when you
   drift off-topic or contradict your own notes.
3. **Auto-table** (web) — pause while writing and Cortex offers to turn
   comparison-shaped prose into a table.
4. **Radar** (web) — proactive research: derive interest vectors from your
   work, search Tavily (recent + foundational), score with Gemini, and surface
   only what clears the bar.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (PostgreSQL + Auth)
- Google Gemini 1.5 Flash (REST) for all AI calls
- Tavily for Radar search
- Chrome Extension (Manifest V3)

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.local.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `TAVILY_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT` (Gmail OAuth)

### 3. Database

In the Supabase SQL editor, run `supabase/schema.sql`. Optionally seed data:
edit `supabase/seed.sql`, replacing `REPLACE_WITH_USER_ID` with your
`auth.users` id, then run it.

> The schema adds one supporting table beyond the spec — `gmail_tokens` — to
> persist the read-only Gmail OAuth grant used by Behaviour 2.

### 4. Gmail OAuth (optional, for Behaviour 2)

In Google Cloud Console, create an OAuth client (Web application), enable the
Gmail API, add scope `gmail.readonly`, and set the redirect URI to
`http://localhost:3000/api/gmail/callback`.

### 5. Run

```bash
npm run dev
```

Sign up at `/login`, then create a project under **Projects**.

### 6. Chrome extension

1. Edit `extension/config.js` — set `API_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
2. Go to `chrome://extensions`, enable Developer mode, **Load unpacked**, and
   select the `extension/` folder.
3. Open the popup, sign in with the same account, pick an active project.
4. Highlight text on any page → click **+ Signal**.

## AI calls

All Gemini calls are live (no stubs) and routed through `src/lib/gemini.ts`,
each with an explicit system prompt:

- `api/signals` — summarise highlight + name connection
- `api/focus/check` — drift detection + contradiction against notes
- `api/autotable` — detect tabular structure
- `api/radar/generate` — extract interest vectors + score/justify results

## Notes on Radar scoring

A result is surfaced only when `relevance ≥ 7 AND (novelty ≥ 6 OR
actionability ≥ 7)`. Dismissed/seen URLs never resurface.
