<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## Supabase Client Rules

Use the correct client for the context — do not swap them:

- `lib/supabase/client.ts` — browser components (Client Components only)
- `lib/supabase/server.ts` — Server Components and API routes
- `lib/supabase/admin.ts` — privileged server operations only; never in routes exposed to users

---

## OpenAI API

This project uses the **OpenAI Responses API** — not `chat.completions.create`.

Do not default to `openai.chat.completions.create`. Read the existing API route implementations before writing or editing any AI call.

---

## Narrative Caching

Narratives are cached in `insight_narratives` and `strategy_narratives` tables using a deterministic SHA-256 hash of the input payload.

Always check the cache before calling the AI. Never regenerate narratives on every page load. Follow the existing hash → lookup → AI on miss → save pattern.
