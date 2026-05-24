# Product Context — CareerMind V1.0

## Product Overview

CareerMind is an AI-powered career decision system for experienced Product Managers targeting Senior / Principal roles.

CareerMind helps users answer:

1. Where do I stand?
2. What should I target?
3. What should I do next?

CareerMind is NOT just resume analysis.

---

## ICP

Target users:

- Product Managers
- 5–15 years experience
- Senior / Principal role seekers
- Platform / Infra / AI / Technical PM profiles

Pain points:

- unclear rejection signals
- conflicting resume advice
- weak positioning clarity
- no structured improvement plan

---

## Product Model

### 1. Job Assessment

Purpose:

“How do I stack up against THIS role?”

Inputs:

- resume
- job description

Outputs:

- verdict
- strengths
- gaps
- positioning summary
- job guidance

---

### 2. Cross-Job Insights

Purpose:

“What patterns repeat across analyses?”

Outputs:

- recurring signals
- recurring gaps
- coaching insight
- recommended focus
- trend tracking

---

### 3. Strategy

Purpose:

“What direction should I take?”

Outputs:

- target positioning
- role targeting
- narrative
- risks
- tradeoffs

Strategy = decisions + direction.

NO execution tracking.

---

### 4. Action Plan

Purpose:

“What should I execute?”

Outputs:

- prioritized tasks
- progress
- status
- effort
- impact

Action Plan = execution layer.

---

## Navigation

Current navigation:

- Overview → `/dashboard`
- Strategy → `/dashboard/strategy-v2`
- Action Plan → `/dashboard/strategy`
- History → `/dashboard/history`
- Run Analysis → `/analyze`

**Important:** `/dashboard/strategy` is the Action Plan route, not Strategy. `/dashboard/strategy-v2` is the Strategy route. The naming is historical — do not swap them.

Avoid Analyze vs Analyses confusion.

---

## Current V1 Scope

Active priorities:

1. Product clarity
2. Landing page polish
3. Strategy intelligence
4. Narrative quality
5. Stable cached AI UX
6. Beta readiness

Not active V1:

- payments
- recruiter mode
- public sharing
- enterprise workflows

---

## Multi-Job Direction

Planned future capability.

User provides:

- target role
- 2–3 jobs

System generates:

- role cluster analysis
- targeting strategy
- cross-job recommendations

Not active V1 scope.

---

## Tech Stack

Frontend:

- Next.js App Router
- React
- TypeScript
- TailwindCSS

Backend:

- Next.js API routes
- OpenAI Responses API

Database:

- Supabase Auth
- Supabase Postgres
- Supabase Storage

Deploy:

- Vercel

---

## Supabase Rules

Browser:

```ts
lib/supabase/client.ts
```

Server:

```ts
lib/supabase/server.ts
```

Admin:

```ts
lib/supabase/admin.ts
```

---

## Narrative Routes

Insights:

`/api/insights/narrative`

Returns:

- career_summary
- coaching_insight
- recommended_focus

Strategy:

`/api/strategy/narrative`

Returns:

- target_positioning
- strategic_direction
- where_to_focus
- where_to_avoid
- positioning_tradeoffs
- narrative_to_tell
- risks

---

## Narrative Caching

Tables:

- insight_narratives
- strategy_narratives

Hash pattern:

```ts
createHash("sha256")
  .update(JSON.stringify(inputPayload))
  .digest("hex")
```

Flow:

1. deterministic payload
2. source_hash
3. cache lookup
4. AI on miss
5. save result

Do not regenerate narratives every page load.

---

## UX Principles

Each section must have distinct purpose.

Summary → situation

Pattern → evidence

Strategy → direction

Action Plan → execution

History → past attempts

Avoid:

- duplicated messaging
- repetitive summaries
- unstructured long pages

Prefer:

- concise
- scannable
- product-like UX

---

## Landing Page Positioning

CareerMind positioning:

AI-powered career strategy for Senior PM roles.

Preferred language:

- structured evaluation
- recurring gaps
- positioning
- cross-job insights
- prioritized action plan

Avoid describing product as only resume analysis.

Recommended page flow:

1. Hero
2. Problem
3. Solution
4. Demo
5. Differentiation
6. CTA

---

## Future Roadmap

Potential future areas:

- multi-job targeting
- role cluster strategy
- persistent task storage
- analytics
- resume rewrite assistant
- demo video
- onboarding improvements

V1 quality > roadmap expansion.