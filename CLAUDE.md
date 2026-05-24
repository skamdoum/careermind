# CLAUDE.md — CareerMind V1.0 — Stephane

@AGENTS.md
@product-context.md

## Who I Am
Senior PM at CareerMind, owning the product. Leading first delivery v1.0 to first customers.

## Product
CareerMind helps experienced PMs identify what they need to fix across multiple target jobs and gives them a prioritized action plan.

**Current focus (v1.0):** V1 polish and beta readiness. Full context in `product-context.md`.

## Preferences
- Be concise and direct. No corporate jargon.
- American English spelling.
- Dates in YYYY-MM-DD format.
- Use "CareerMind" — not "Careermind" or "Career Mind".
- Dry wit is welcome. Dad jokes are not.

## Workspace Structure
- `product-context.md` — full product and market context

<!--
- `team-context.md` — full team profiles and working styles
- `Projects/` — active project folders, each with its own CLAUDE.md
- `Knowledge/` — reference material, research, people notes
-->

---

## Operating Mode

Default mode: CONSERVATIVE.

Before code changes:

1. Explain intended scope
2. Identify touched files
3. Keep changes narrow

Do NOT:

- rewrite large files unnecessarily
- change auth/schema/routes without request
- refactor architecture proactively

Preserve:

- working APIs
- fallback behavior
- stable UX patterns

---

## Development Priorities

Priority order:

1. Product clarity
2. Stable UX
3. Correct architecture
4. Narrative quality
5. Performance
6. New features

Prefer V1 polish over feature expansion.

---

## Architecture Rules

Shared layout:

- `app/components/app-shell.tsx`
- `app/components/app-navbar.tsx`
- `app/dashboard/layout.tsx`

Authenticated pages should share:

- navbar
- width
- spacing

Preferred container:

```tsx
max-w-4xl w-full mx-auto px-6 py-6
```

Do not introduce duplicated layout patterns.

---

## API Rules

All routes return:

```ts
{
  success: boolean
  data?: any
  error?: string
}
```

Keep response shapes consistent.

---

## AI Rules

AI owns:

- narratives
- coaching language
- strategic interpretation

AI does NOT own:

- verdicts
- counts
- deterministic logic
- progress tracking

Deterministic computation first.

AI augments interpretation.

---

## Narrative UX Rules

Avoid:

fallback → delayed AI replacement

Prefer:

- cached instant render
- delayed skeleton (>300ms)
- fallback only after failure

---

## Testing

After meaningful changes:

```bash
npm run dev
```

Verify:

- layout consistency
- no duplicate navbars
- API validity
- fallback behavior
- responsive behavior

---

## Commit Style

Example:

```bash
git add app/components/example.tsx lib/utils.ts

git commit -m "feat(ui): improve narrative loading UX"
```